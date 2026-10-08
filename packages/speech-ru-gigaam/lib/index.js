/**
 * `@local/dsh-speech-ru-gigaam` — host half.
 *
 * The Voice Input bundle registers exactly one local recognizer, SenseVoiceSmall, and
 * that model knows five languages: Chinese, English, Cantonese, Japanese and Korean.
 * Russian is not among them, and the model has no way to say "I do not know": fed
 * Russian speech it answers in the nearest language it does know, which is why the
 * operator's dictation arrived as katakana and hangul. The language list is not a
 * setting — it is compiled into both halves of that provider, and the Settings service
 * refuses to store a language the selected provider does not advertise.
 *
 * This mod adds a *second* recognizer next to it, registered with the same service
 * under its own id. The shipped provider is left exactly as it ships: pick this one in
 * the voice panel and Russian is transcribed; pick SenseVoice and nothing changes. If
 * this mod fails to load, the microphone keeps working the way it did.
 *
 * The recognition itself runs in a warm Python process (`lib/worker.py`) holding
 * GigaAM-v3, Sber's Russian ASR. The measurement that chose it, against Whisper
 * large-v3 and Vosk on the operator's own noisy recordings, is in
 * `_voice\ЗАМЕР-распознавания.md` in the workspace.
 *
 * @module @local/dsh-speech-ru-gigaam
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name. */
export const name = 'speech-ru-gigaam'

/** Required service: the registry the Voice Input bundle routes recordings through. */
export const inject = ['speechToText']

const HERE = dirname(fileURLToPath(import.meta.url))

/** The worker that ships inside this package. */
export const DEFAULT_WORKER = join(HERE, 'worker.py')

/** The stand-in for `pyannote`, added to the worker's import path when the real one is absent. */
export const PYANNOTE_STUB = join(HERE, 'pyannote-stub')

/**
 * Defaults.
 *
 * `pythonPath` has no default on purpose: the interpreter is a fact about one machine,
 * so it belongs in the profile's loader row, not in this package. Every other value is
 * something the worker can be trusted with until the operator says otherwise.
 *
 * `requestTimeoutMs` is generous because the *first* request may download 428 MB of
 * weights (a few minutes on a slow line) and the first one also loads them. Later
 * requests take one to three seconds for a sentence. Point `hubCache` at a directory
 * that already holds the model and even the first request is fast.
 */
export const DEFAULTS = {
  providerId: 'gigaam-ru-local',
  pythonPath: '',
  workerPath: DEFAULT_WORKER,
  revision: 'e2e_rnnt',
  device: 'cpu',
  threads: 0,
  hubCache: '',
  modulesCache: '',
  requestTimeoutMs: 300000,
  idleTimeoutMs: 600000,
  maxAudioBytes: 32 * 1024 * 1024,
  maxLogBytes: 64 * 1024,
}

/** Resolve this harness home the same way the shipped plugins do. */
export function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured.trim() !== '' ? configured : join(homedir(), '.dsh')
}

/** Message of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One warm Python process, serialized: the model is single-threaded, so requests are
 * queued in arrival order rather than raced.
 *
 * Stopping it is not a failure — the model occupies about 1.5 GB of memory, so the
 * process is released after `idleTimeoutMs` of silence and started again on the next
 * recording. The state is only ever "running" or "not running"; nothing is lost by
 * stopping except the few seconds of the next model load.
 */
export class GigaAmWorker {
  constructor(config, options = {}) {
    this.config = config
    this.onLog = options.onLog ?? (() => {})
    this.child = null
    this.pending = new Map()
    this.nextId = 1
    this.buffer = ''
    this.exit = null
    this.idle = null
    this.logTail = ''
    this.tail = Promise.resolve()
    this.stopped = false
  }

  /** Start the process if it is not running; the model itself loads on first use. */
  start() {
    if (this.child !== null) return
    this.stopped = false
    const args = [
      this.config.workerPath,
      '--revision', this.config.revision,
      '--device', this.config.device,
      '--threads', String(this.config.threads),
    ]
    if (this.config.hubCache !== '') args.push('--hub-cache', this.config.hubCache)
    if (this.config.modulesCache !== '') args.push('--modules-cache', this.config.modulesCache)
    this.onLog(`speech-ru-gigaam: запускаю ${this.config.pythonPath} ${args.join(' ')}`)
    const child = spawn(this.config.pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })
    this.child = child
    this.buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.consume(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      this.logTail = `${this.logTail}${chunk}`.slice(-this.config.maxLogBytes)
      for (const line of String(chunk).split(/\r?\n/u)) {
        if (line.trim() !== '') this.onLog(`speech-ru-gigaam [питон]: ${line.trim()}`)
      }
    })
    this.exit = new Promise((resolve) => {
      const finish = (reason) => {
        if (this.child !== child) return
        this.child = null
        this.buffer = ''
        this.releaseAll(new Error(reason))
        resolve()
      }
      child.on('error', (error) => finish(`сторожевой процесс не запустился: ${messageOf(error)}`))
      child.on('close', (code, signal) => finish(
        `сторожевой процесс завершился (код ${code}${signal === null ? '' : `, сигнал ${signal}`})`
        + (this.logTail.trim() === '' ? '' : `: последние строки: ${this.logTail.trim().slice(-500)}`),
      ))
    })
  }

  /** Turn buffered stdout into settled requests; incomplete lines wait for more bytes. */
  consume(chunk) {
    this.buffer += chunk
    for (;;) {
      const breakAt = this.buffer.indexOf('\n')
      if (breakAt < 0) return
      const line = this.buffer.slice(0, breakAt).trim()
      this.buffer = this.buffer.slice(breakAt + 1)
      if (line === '') continue
      let message
      try {
        message = JSON.parse(line)
      } catch (error) {
        this.onLog(`speech-ru-gigaam: не разобрал строку сторожа: ${line.slice(0, 200)}`)
        continue
      }
      if (message.ready === true) {
        this.onLog(`speech-ru-gigaam: модель ${message.revision} загружена за ${message.loadSeconds} с`)
        continue
      }
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) {
        this.onLog(`speech-ru-gigaam: ответ без запроса: ${line.slice(0, 200)}`)
        continue
      }
      this.pending.delete(message.id)
      clearTimeout(waiter.timer)
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      if (typeof message.error === 'string') waiter.reject(new Error(message.error))
      else waiter.resolve(message)
    }
  }

  /** Reject everything in flight; used when the process goes away. */
  releaseAll(error) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.reject(error)
    }
    this.pending.clear()
  }

  /** Send one recording and wait for its transcript. */
  transcribe(audio, signal) {
    const task = this.tail.then(() => this.exchange(audio, signal))
    // Keep the chain alive whatever happens to one recording: a rejection must not
    // poison every later request.
    this.tail = task.then(() => undefined, () => undefined)
    return task
  }

  exchange(audio, signal) {
    signal?.throwIfAborted()
    this.start()
    if (this.idle !== null) {
      clearTimeout(this.idle)
      this.idle = null
    }
    const id = this.nextId
    this.nextId += 1
    const child = this.child
    if (child === null || !child.stdin.writable) {
      return Promise.reject(new Error('сторожевой процесс недоступен'))
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, timer: null, onAbort: null }
      // The idle release is armed by whichever way this request settles, so the
      // wrappers must be in place before anything can settle it.
      const settle = waiter.resolve
      const fail = waiter.reject
      waiter.resolve = (value) => {
        settle(value)
        this.armIdle()
      }
      waiter.reject = (error) => {
        fail(error)
        this.armIdle()
      }
      waiter.timer = setTimeout(() => {
        this.pending.delete(id)
        waiter.reject(new Error(`сторож не ответил за ${this.config.requestTimeoutMs} мс`))
      }, this.config.requestTimeoutMs)
      waiter.onAbort = () => {
        this.pending.delete(id)
        clearTimeout(waiter.timer)
        waiter.reject(signal.reason ?? new Error('запись отменена'))
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.pending.set(id, waiter)
      child.stdin.write(`${JSON.stringify({ id, wav: Buffer.from(audio).toString('base64'), language: 'ru' })}\n`, (error) => {
        if (error === undefined || error === null) return
        this.pending.delete(id)
        clearTimeout(waiter.timer)
        waiter.reject(new Error(`не отдал запись сторожу: ${messageOf(error)}`))
      })
    })
  }

  /** Release the process after a quiet period; the next recording starts it again. */
  armIdle() {
    if (this.pending.size > 0 || this.config.idleTimeoutMs <= 0) return
    if (this.idle !== null) clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      this.idle = null
      this.stop('освобождаю сторожевой процесс после простоя')
    }, this.config.idleTimeoutMs)
    this.idle.unref?.()
  }

  /** Stop the process and settle everything it owed. */
  stop(reason = 'плагин выгружен') {
    if (this.idle !== null) {
      clearTimeout(this.idle)
      this.idle = null
    }
    const child = this.child
    if (child === null) return
    this.stopped = true
    this.onLog(`speech-ru-gigaam: ${reason}`)
    this.releaseAll(new Error(reason))
    child.kill()
  }
}

/** Reject a configuration that cannot possibly work, loudly and at activation. */
export function validateConfig(raw) {
  const config = { ...DEFAULTS, ...(raw ?? {}) }
  if (typeof config.pythonPath !== 'string' || config.pythonPath.trim() === '') {
    throw new Error('speech-ru-gigaam: set `pythonPath` in the loader row — the interpreter that has torch and transformers')
  }
  if (!isAbsolute(config.pythonPath)) throw new Error(`speech-ru-gigaam: pythonPath must be absolute: ${config.pythonPath}`)
  if (!existsSync(config.pythonPath)) throw new Error(`speech-ru-gigaam: pythonPath does not exist: ${config.pythonPath}`)
  if (!isAbsolute(config.workerPath)) throw new Error(`speech-ru-gigaam: workerPath must be absolute: ${config.workerPath}`)
  if (!existsSync(config.workerPath)) throw new Error(`speech-ru-gigaam: workerPath does not exist: ${config.workerPath}`)
  return config
}

/**
 * Register the Russian recognizer.
 * @param ctx - host context carrying `speechToText`.
 * @param rawConfig - the loader row's `config`.
 */
export function apply(ctx, rawConfig) {
  const config = validateConfig(rawConfig)
  const worker = new GigaAmWorker(config, {
    onLog: (line) => {
      if (ctx.logger?.debug !== undefined) ctx.logger.debug(line)
      else console.log(line)
    },
  })

  ctx.effect(() => {
    const unregister = ctx.speechToText.register({
      info: {
        id: config.providerId,
        name: `GigaAM-v3 ${config.revision} (русская речь, ${config.device})`,
        location: 'host-local',
        // `auto` is advertised on purpose and must stay. The voice panel keeps ONE
        // language for every recognizer and sends only `providerId` when the operator
        // switches: the service then checks the *stored* language (shipped default
        // `auto`) against the new provider's list and refuses the switch outright if it
        // is missing. A provider advertising `ru` alone is therefore unreachable from
        // the interface — the language dropdown belongs to the provider already selected,
        // so there is no way to set `ru` first. Here both hints mean the same thing:
        // GigaAM is a Russian model, so every recording is Russian.
        languages: ['auto', 'ru'],
        downloadSources: [],
        setupEstimate: {
          recommendedDiskBytes: 1500 * 1024 * 1024,
          expectedMemoryBytes: 2000 * 1024 * 1024,
          minimumMinutes: 0,
          maximumMinutes: 0,
        },
      },
      transcribe: async (input, signal) => {
        const audio = Buffer.from(input.audio)
        if (audio.byteLength === 0) throw new Error('пустая запись')
        if (audio.byteLength > config.maxAudioBytes) {
          throw new Error(`запись больше предела (${audio.byteLength} байт против ${config.maxAudioBytes})`)
        }
        const answer = await worker.transcribe(audio, signal)
        return {
          text: String(answer.text ?? ''),
          audioSeconds: Number(answer.audioSeconds ?? 0),
          inferenceSeconds: Number(answer.inferenceSeconds ?? 0),
        }
      },
    })
    ctx.logger?.info?.(`speech-ru-gigaam: распознаватель «${config.providerId}» зарегистрирован`)
    return async () => {
      worker.stop()
      await worker.exit
      await unregister()
    }
  }, 'speech-ru-gigaam: provider lifecycle')
}

export default { name, inject, apply }
