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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'voice-stream'

/**
 * Служба связи: нужна для кнопки в панели.
 *
 * ОБЪЯВЛЯТЬ ОБЯЗАТЕЛЬНО, И ЭТО НЕ ФОРМАЛЬНОСТЬ. Первая версия читала `ctx.connection`
 * «на всякий случай», необязательной цепочкой, а объявляла `inject: []`. Харнесс такую
 * службу не отдаёт: в консоли появилось
 * `Error: cannot get property "connection" without inject`, плагин не поднялся целиком,
 * и вместе с кнопкой пропало чтение вслух. Отсюда правило: службу читаешь — объяви.
 * Необязательной формы объявления в этой версии cordis нет, поэтому связь объявлена
 * требуемой; в запуске без панели мод просто не активируется, и это ожидаемо.
 */
export const inject = ['connection']

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
  /** Проговаривать ли короткие подводки, пока ответ ещё готовится. */
  fillers: true,
  /** Сколько тишины терпеть, прежде чем сказать «работаю». */
  workAfterMs: 12000,
  /** Не чаще, чем раз в это время, напоминать, что работа идёт. */
  workRepeatMs: 30000,
  /** Сколько подводок на один ход: дальше это уже болтовня. */
  maxFillersPerTurn: 4,
}

/** Message of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Русское окончание после числа: 1 секунду, 2 секунды, 5 секунд. */
export function plural(count, one, few, many) {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/**
 * Как сказать про ожидание.
 *
 * Правило оператора: до минуты называть секунды, дальше минуты. Врать нельзя: фраза
 * говорится перед ожиданием, поэтому она должна совпадать с тем, сколько ждать придётся.
 */
export function describeWait(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 60) {
    const value = Math.round(seconds)
    return `Подождём ${value} ${plural(value, 'секунду', 'секунды', 'секунд')}.`
  }
  const minutes = Math.max(1, Math.round(seconds / 60))
  // «Подождём одну минуту» звучит как отчёт; живая речь говорит «подождём минуту».
  if (minutes === 1) return 'Подождём минуту.'
  return `Подождём ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}.`
}

/**
 * Найти в аргументах инструмента НАЗНАЧЕННОЕ ожидание, в секундах.
 *
 * Только явные паузы: `Start-Sleep -Seconds`, `timeout /t`, `sleep N`. Предел времени
 * (`timeoutMs`) сюда не берём нарочно: это граница, а не ожидание, и объявлять по нему
 * «подождём десять минут» для команды, которая кончится через три секунды, значит соврать.
 */
export function waitFromArguments(text) {
  if (typeof text !== 'string' || text === '') return null
  const seconds = [
    /Start-Sleep\s+-Seconds\s+(\d+)/iu,
    /Start-Sleep\s+-Milliseconds\s+(\d+)/iu,
    /timeout\s+\/t\s+(\d+)/iu,
    /--sleep\s+(\d+)/iu,
    /\bsleep\s+(\d+)\b/iu,
  ]
  for (const pattern of seconds) {
    const found = pattern.exec(text)
    if (found !== null) return Number(found[1])
  }
  const milliseconds = /Start-Sleep\s+-Milliseconds\s+(\d+)/iu.exec(text)
  if (milliseconds !== null) return Number(milliseconds[1]) / 1000
  return null
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
    /** Текущий ход и учёт подводок: тишину заполняем, но не болтаем. */
    this.turn = null
    this.fillersPlayed = 0
    this.lastSpokenAt = 0
    this.lastFillerAt = 0
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
              this.onLog(`voice-stream: кусок ${reply.id} прочитан (${reply.spoken} знаков, синтез ${reply.synthSeconds} с, ${reply.played ? 'сыграл' : 'молчал'})`)
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

  /**
   * Сказать короткую подводку из кэша голоса.
   *
   * Ради этого подводки и заготовлены заранее: синтеза нет вовсе, только проигрыш,
   * поэтому первое слово звучит за доли секунды. Номер выбирает вызывающий, чтобы
   * «так» не звучало каждый раз одинаково.
   */
  filler(which) {
    this.start()
    if (this.idle !== null) {
      clearTimeout(this.idle)
      this.idle = null
    }
    const id = this.nextId
    this.nextId += 1
    this.fillersPlayed += 1
    this.lastSpokenAt = Date.now()
    this.lastFillerAt = Date.now()
    this.onLog(`voice-stream: подводка ${which} (всего ${this.fillersPlayed} за ход)`)
    this.child?.stdin.write(`${JSON.stringify({ command: 'filler', id, which })}\n`)
  }

  /** Сказать служебную фразу, которую нужно синтезировать: например про ожидание. */
  announce(text) {
    if (typeof text !== 'string' || text.trim() === '') return
    this.onLog(`voice-stream: объявляю ожидание: ${text}`)
    this.say(text)
  }

  /** Начался новый ход: считаем подводки заново. */
  startTurn(turn) {
    this.turn = turn
    this.fillersPlayed = 0
    this.lastSpokenAt = Date.now()
    this.lastFillerAt = 0
  }

  /**
   * Такт раз в пару секунд: если работа идёт, а голос молчит, сказать, что работаем.
   *
   * Это ровно то, что делает голосовой режим у больших ассистентов: тишину не оставляют
   * пустой, иначе человек решает, что его не услышали. Но и болтать нельзя: подводок
   * на ход ограниченное число, и повтор не чаще `workRepeatMs`.
   */
  tick() {
    if (this.turn === null) return 'нет хода'
    if (this.fillersPlayed >= this.config.maxFillersPerTurn) return 'лимит подводок'
    const now = Date.now()
    if (now - this.lastSpokenAt < this.config.workAfterMs) return 'рано'
    if (now - this.lastFillerAt < this.config.workRepeatMs) return 'недавно говорил'
    // Разные подводки по очереди: 5 «понял, работаю», 9 «работаю, подожди», 7 «ещё немного».
    const rotation = [5, 7, 9]
    this.filler(rotation[this.fillersPlayed % rotation.length])
    return 'сказал'
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

/** Exact route below `/api` owned by this mod: the panel's voice switch. */
export const MOD_ROUTE_PATH = '/api/voice-stream.mod'

/**
 * Включён ли голос по файлу-переключателю.
 *
 * Тот же файл, что читает `speak.py`, поэтому кнопка в панели, лампа и голосовой
 * процесс говорят об одном и том же состоянии, и второго переключателя не заводится.
 */
export function readVoiceOn(statePath) {
  try {
    return readFileSync(statePath, 'utf8').trim().toUpperCase() !== 'ВЫКЛ'
  } catch {
    // Файла нет — голос включён: так же решает и speak.py.
    return true
  }
}

/** Записать переключатель голоса. */
export function writeVoiceOn(statePath, on) {
  writeFileSync(statePath, on ? 'ВКЛ' : 'ВЫКЛ', 'utf8')
}

/** Ответ маршрута в формате, который ждёт браузерная половина. */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
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

  /** Аргументы вызовов инструментов в этом ответе: из них берём назначенное ожидание. */
  let toolArguments = ''
  let announcedWaits = new Set()

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame === undefined || !isLead(agent)) return
    if (frame.type === 'start') {
      // Новый ход: заводим счётчики и сразу говорим короткую подводку из кэша, чтобы
      // тишина не висела, пока модель думает и пока идут инструменты.
      if (voice.turn !== frame.turn) {
        voice.startTurn(frame.turn)
        toolArguments = ''
        announcedWaits = new Set()
        if (config.fillers) voice.filler(1)
      }
      voice.begin()
      return
    }
    if (frame.type === 'chunk') {
      const chunk = frame.chunk
      // Читаем ровно видимый ответ: размышления и вызовы инструментов вслух не нужны.
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        voice.feed(chunk.text)
        voice.lastSpokenAt = Date.now()
        return
      }
      if (chunk?.type === 'tool-call-delta' && typeof chunk.argumentsDelta === 'string') {
        // Аргументы приходят по кускам. Собираем и смотрим, не назначена ли пауза:
        // «подождём 59 секунд» говорится ДО ожидания, поэтому её надо назвать заранее.
        toolArguments += chunk.argumentsDelta
        const wait = waitFromArguments(toolArguments)
        if (wait !== null) {
          const phrase = describeWait(wait)
          if (phrase !== null && !announcedWaits.has(phrase)) {
            announcedWaits.add(phrase)
            voice.announce(phrase)
          }
        }
      }
      return
    }
    if (frame.type === 'end') {
      voice.flush()
      toolArguments = ''
    }
  }, { global: true })

  // Такт: пока работа идёт и голос молчит, напоминаем о себе подводкой из кэша.
  const timer = setInterval(() => {
    if (!config.fillers) return
    const decision = voice.tick()
    if (decision === 'сказал') ctx.logger?.debug?.('voice-stream: сказал, что работаю')
  }, 2000)
  timer.unref?.()

  ctx.logger?.info?.(
    `voice-stream: читаю ответы вслух по мере печати (кусок от ${config.firstChunk} знаков, `
    + `подводки ${config.fillers ? 'включены' : 'выключены'})`)

  // Кнопка в панели. Маршрут поднимаем только если служба связи есть: чтение вслух
  // не должно зависеть от неё, а без панели оно работает и так.
  const statePath = join(dirname(config.streamPath), 'ГОЛОС.txt')
  let disposeRoute = null
  if (ctx.connection?.fetch?.register !== undefined) {
    disposeRoute = ctx.connection.fetch.register({
      path: MOD_ROUTE_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method === 'GET') return json({ on: readVoiceOn(statePath), statePath })
        let payload = null
        try {
          payload = await request.json()
        } catch {
          return json({ ok: false, error: 'тело запроса должно быть JSON' }, 400)
        }
        if (typeof payload?.on !== 'boolean') return json({ ok: false, error: 'нужно поле on: true или false' }, 400)
        try {
          writeVoiceOn(statePath, payload.on)
        } catch (error) {
          return json({ ok: false, error: `переключатель не записался: ${messageOf(error)}` }, 500)
        }
        ctx.logger?.info?.(`voice-stream: голос ${payload.on ? 'включён' : 'выключен'} кнопкой в панели`)
        return json({ on: readVoiceOn(statePath), statePath })
      },
    })
  } else {
    ctx.logger?.debug?.('voice-stream: службы связи нет, кнопка в панели не поднята')
  }

  ctx.effect(() => () => {
    clearInterval(timer)
    voice.stop()
    void disposeRoute?.()
  }, 'voice-stream: life of the voice process')
}

export default { name, inject, apply }
