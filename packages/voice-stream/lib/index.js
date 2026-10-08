/**
 * `@local/dsh-voice-stream` — host half.
 *
 * Читает ответ вслух **по мере того, как он печатается**, а не после того, как он готов.
 *
 * ПОЧЕМУ ПРЕЖНИЙ ЧТЕЦ ЖДАЛ КОНЦА. `_voice\dsh_voice.mjs` следит за журналом сеанса, а в
 * журнал ответ попадает одним событием `assistant/message` на закрытии шага: пока текст
 * пишется, в файле его ещё нет. Поэтому первое слово звучало через секунды после того,
 * как ответ был закончен, и ожидание складывалось из всего написания плюс синтеза.
 *
 * ОТКУДА БЕРЁТСЯ ЖИВОЙ ТЕКСТ. Харнесс публикует процессные кадры потока событием
 * `agent/assistant-stream` — из них рисуется текст в браузере. Кадр бывает трёх видов:
 * `start`, `chunk` и `end`; внутри `chunk` лежит кусок модели, и нас интересует только
 * `text-delta` (готовый ответ). `reasoning-delta` — размышления, `tool-call-delta` —
 * вызовы инструментов: вслух они не читаются.
 *
 * КАК ЧИТАЕТСЯ. Накопитель ждёт первый конец предложения не раньше `firstChunk` знаков
 * и сразу отдаёт кусок голосу; дальше куски идут по мере печати. Голосовой процесс
 * (`_voice\say_stream.py`) синтезирует следующий, пока звучит предыдущий, поэтому речь
 * не догоняет печать и не отстаёт на всё написание ответа.
 *
 * @module @local/dsh-voice-stream
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** Cordis plugin name. */
export const name = 'voice-stream'

/** No injected service: the streaming event is published on the process-wide dispatch. */
export const inject = []

/** Defaults; the machine-specific paths belong in the profile's loader row. */
export const DEFAULTS = {
  pythonPath: '',
  streamPath: '',
  /** Первый кусок: не читать раньше этого числа знаков, чтобы звук пошёл почти сразу. */
  firstChunk: 50,
  /** Обычный кусок: до этого размера терпим, дальше режем. */
  chunkChars: 260,
  /** Сколько всего знаков ответа читать за один ход. */
  maxChars: 6000,
  /** Простой, после которого голосовой процесс освобождается. */
  idleStopMs: 600000,
  /** Читать ли ответы подагентов: у них свои сеансы и своя болтовня. */
  readSubagents: false,
}

/** Message of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Взять из накопленного текста готовый кусок речи, или `null`, если рано.
 *
 * Правило: ждём `min` знаков, дальше ищем конец предложения; если предложение не
 * кончается и текст дорос до `limit`, режем по запятой или пробелу. Тянуть абзац
 * целиком нельзя, иначе звук снова уедет в конец ответа.
 *
 * ВОЗВРАЩАЕМ И СЪЕДЕННОЕ. Первая версия отдавала обрезанный кусок, а накопитель резался
 * по его длине — и в следующий кусок попадал лишний знак: «. Хвост без точки». Поэтому
 * здесь рядом с текстом идёт `consumed`: сколько знаков исходника этот кусок занял.
 *
 * @param text - накопленный, ещё не прочитанный текст.
 * @param options - `min` знаков до первого чтения, `limit` знаков до принудительного реза.
 * @returns кусок и его длину в исходнике, либо null, если читать ещё рано.
 */
export function takePiece(text, { min, limit }) {
  if (text.length < min) return null
  const window = text.slice(0, Math.min(text.length, limit * 2))
  for (let index = min - 1; index < window.length; index += 1) {
    if ('.!?…'.includes(window[index])) {
      return { text: text.slice(0, index + 1).trim(), consumed: index + 1 }
    }
  }
  if (text.length < limit) return null
  const head = text.slice(0, limit)
  const stop = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf(' '))
  const consumed = stop > min ? stop : limit
  return { text: text.slice(0, consumed).trim(), consumed }
}

/** Один тёплый голосовой процесс на все ответы. */
export class VoiceStream {
  constructor(config, onLog = () => {}) {
    this.config = config
    this.onLog = onLog
    this.child = null
    this.buffer = ''
    this.nextId = 1
    this.spoken = 0
    this.idle = null
  }

  start() {
    if (this.child !== null) return
    const args = [this.config.streamPath, '--max-total', String(this.config.maxChars)]
    this.onLog(`voice-stream: поднимаю голос: ${this.config.pythonPath} ${args.join(' ')}`)
    const child = spawn(this.config.pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/u)) {
        if (line.trim() === '') continue
        if (line.startsWith('{')) {
          try {
            const reply = JSON.parse(line)
            if (reply.spoken !== undefined) {
              this.onLog(`voice-stream: кусок ${reply.id} прочитан (${reply.spoken} знаков, синтез ${reply.synthSeconds} с)`)
            }
          } catch {
            // Строку уже записал сам голосовой процесс; здесь она не нужна.
          }
        } else {
          this.onLog(`voice-stream [голос]: ${line.trim()}`)
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/u)) if (line.trim() !== '') this.onLog(`voice-stream [голос]: ${line.trim()}`)
    })
    child.on('close', (code) => {
      this.child = null
      this.onLog(`voice-stream: голосовой процесс закрылся (код ${code})`)
    })
  }

  /** Новый ответ начался: обнулить накопитель и сказать голосу, что это новый ответ. */
  begin() {
    this.buffer = ''
    this.spoken = 0
    this.start()
    this.child?.stdin.write(`${JSON.stringify({ command: 'begin', chunks: 0, chars: 0 })}\n`)
  }

  /** Пришёл кусок текста от модели. */
  feed(text) {
    if (typeof text !== 'string' || text === '') return
    this.buffer += text
    for (;;) {
      if (this.spoken >= this.config.maxChars) {
        this.buffer = ''
        return
      }
      const taken = takePiece(this.buffer, {
        min: this.config.firstChunk,
        limit: this.config.chunkChars,
      })
      if (taken === null) return
      this.buffer = this.buffer.slice(taken.consumed)
      this.say(taken.text)
    }
  }

  /** Ответ кончился: прочитать остаток и отпустить процесс по простою. */
  flush() {
    const rest = this.buffer.trim()
    this.buffer = ''
    if (rest !== '') this.say(rest)
    if (this.idle !== null) clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      this.idle = null
      this.stop('voice-stream: освобождаю голосовой процесс после простоя')
    }, this.config.idleStopMs)
    this.idle.unref?.()
  }

  /** Отдать кусок голосу, не дожидаясь звука. */
  say(piece) {
    this.start()
    if (this.idle !== null) {
      clearTimeout(this.idle)
      this.idle = null
    }
    const id = this.nextId
    this.nextId += 1
    this.spoken += piece.length
    this.onLog(`voice-stream: читаю кусок ${id} (${piece.length} знаков): ${piece.slice(0, 60)}…`)
    this.child?.stdin.write(`${JSON.stringify({ id, text: piece })}\n`)
  }

  stop(reason = 'voice-stream: плагин выгружен') {
    if (this.idle !== null) {
      clearTimeout(this.idle)
      this.idle = null
    }
    if (this.child === null) return
    this.onLog(reason)
    try {
      this.child.stdin.write(`${JSON.stringify({ command: 'quit' })}\n`)
    } catch {
      this.child.kill()
    }
    this.child = null
  }
}

/** Reject a configuration that cannot work, loudly and at activation. */
export function validateConfig(raw) {
  const config = { ...DEFAULTS, ...(raw ?? {}) }
  for (const key of ['pythonPath', 'streamPath']) {
    if (typeof config[key] !== 'string' || config[key].trim() === '') {
      throw new Error(`voice-stream: set \`${key}\` in the loader row`)
    }
    if (!isAbsolute(config[key])) throw new Error(`voice-stream: ${key} must be absolute: ${config[key]}`)
    if (!existsSync(config[key])) throw new Error(`voice-stream: ${key} does not exist: ${config[key]}`)
  }
  return config
}

/**
 * Подписаться на живой поток текста и читать его вслух.
 * @param ctx - host context.
 * @param rawConfig - the loader row's `config`.
 */
export function apply(ctx, rawConfig) {
  const config = validateConfig(rawConfig)
  const voice = new VoiceStream(config, (line) => {
    if (ctx.logger?.debug !== undefined) ctx.logger.debug(line)
    else console.log(line)
  })

  /**
   * Читаем только ведущий агент: у подагентов свои сеансы, и их переписка вслух
   * превратилась бы в кашу. Глубину берём с сеанса, а если поля нет — считаем нулевой.
   */
  const isLead = (agent) => {
    if (config.readSubagents) return true
    const depth = agent?.session?.delegationDepth ?? agent?.delegationDepth ?? 0
    return !(typeof depth === 'number' && depth > 0)
  }

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame === undefined || !isLead(agent)) return
    if (frame.type === 'start') {
      voice.begin()
      return
    }
    if (frame.type === 'chunk') {
      // Читаем ровно видимый ответ: размышления и вызовы инструментов вслух не нужны.
      if (frame.chunk?.type === 'text-delta' && typeof frame.chunk.text === 'string') voice.feed(frame.chunk.text)
      return
    }
    if (frame.type === 'end') voice.flush()
  }, { global: true })

  ctx.logger?.info?.(`voice-stream: читаю ответы вслух по мере печати (кусок от ${config.firstChunk} знаков)`)
  ctx.effect(() => () => voice.stop(), 'voice-stream: life of the voice process')
}

export default { name, inject, apply }
