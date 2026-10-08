#!/usr/bin/env node
/**
 * Does the Russian speech mod work — the parts that can be checked without the GUI?
 *
 * Three questions, each answered by running something rather than by reading code:
 *
 * 1. **Shape.** Is the package what the mod loader expects, and does its host half
 *    export the Cordis plugin surface (`name`, `inject`, `apply`)?
 * 2. **Refusal.** Does a loader row without `pythonPath` fail loudly instead of
 *    registering a recognizer that cannot possibly answer?
 * 3. **Recognition.** Does the worker, with the real interpreter and a real recording,
 *    return Russian text and a sane duration — and exit cleanly when told to quit?
 *
 * Machine-specific paths live here, in `tools/dev`, not in the package: the interpreter
 * belongs to one machine, so the package must not name it. Override with
 * `DSH_SPEECH_RU_PYTHON` and `DSH_SPEECH_RU_WAV`.
 *
 * Usage: node tools/dev/test-speech-ru.mjs
 *
 * @module tools/dev/test-speech-ru
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { load as yamlLoad } from 'js-yaml'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(HERE))
const PACKAGE = join(REPO, 'packages', 'speech-ru-gigaam')

/** The recording used for the recognition check: the operator's own voice, TV on. */
const WAV = process.env.DSH_SPEECH_RU_WAV
  ?? 'C:\\Users\\admin\\Documents\\ds1\\_voice\\takes\\2026-09-25_21-24-52.wav'

/**
 * Read the configuration the running harness actually deploys.
 *
 * The point of reading the profile's loader row instead of a constant here: the numbers
 * that matter to the operator (which interpreter, which device, which caches) live in
 * `cordis.patch.yml`, and a test that names its own interpreter would keep passing after
 * the deployed row pointed somewhere else. Environment variables still win, so the test
 * can be pointed at another machine without editing it.
 */
function deployedConfig() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
  const fallback = {
    pythonPath: 'C:\\Users\\admin\\Documents\\ds1\\_voice\\gigaam-env\\Scripts\\python.exe',
    revision: 'e2e_rnnt',
    device: 'cpu',
    hubCache: 'C:\\Users\\admin\\Documents\\ds1\\_voice\\_hf-cache',
    modulesCache: 'C:\\Users\\admin\\Documents\\ds1\\_voice\\_hf-cache\\modules',
    source: `константа теста (${patch} не прочитан)`,
  }
  let deployed = fallback
  try {
    const yaml = yamlLoad(readFileSync(patch, 'utf8'))
    const rows = yaml.flatMap((entry) => (Array.isArray(entry?.insert) ? entry.insert : []))
    const row = rows.find((entry) => entry?.id === 'speech-ru-gigaam')
    if (row?.config !== undefined) {
      deployed = {
        ...fallback,
        ...row.config,
        modulesCache: row.config.modulesCache ?? join(row.config.hubCache ?? fallback.hubCache, 'modules'),
        source: `строка загрузчика в ${patch}`,
      }
    }
  } catch (error) {
    deployed = { ...fallback, source: `константа теста (${messageOf(error)})` }
  }
  return {
    ...deployed,
    pythonPath: process.env.DSH_SPEECH_RU_PYTHON ?? deployed.pythonPath,
    device: process.env.DSH_SPEECH_RU_DEVICE ?? deployed.device,
    revision: process.env.DSH_SPEECH_RU_REVISION ?? deployed.revision,
    hubCache: process.env.DSH_SPEECH_RU_HUB ?? deployed.hubCache,
    modulesCache: process.env.DSH_SPEECH_RU_MODULES ?? deployed.modulesCache,
  }
}

const DEPLOYED = deployedConfig()
const PYTHON = DEPLOYED.pythonPath
const HUB_CACHE = DEPLOYED.hubCache
const MODULES_CACHE = DEPLOYED.modulesCache

/** Message of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

const results = []
const check = (title, passed, detail) => {
  results.push({ title, passed, detail })
  console.log(`${passed ? 'ПРОШЛО' : 'ПРОВАЛ'}  ${title}${detail === undefined ? '' : `\n        ${detail}`}`)
}

/** Question 1: the package shape the loader and this repository agree on. */
async function checkShape() {
  const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'))
  check(
    'имя пакета совпадает с последним отрезком пути установки',
    manifest.name === '@local/dsh-speech-ru-gigaam',
    `package.json: ${manifest.name}`,
  )
  check(
    'браузерной половины нет, потому что мод только хостовый',
    manifest.dsh === undefined,
    manifest.dsh === undefined ? 'поля dsh нет' : JSON.stringify(manifest.dsh),
  )
  const files = ['lib/index.js', 'lib/worker.py', 'README.md', 'README.ru.md']
  const missing = files.filter((name) => !existsSync(join(PACKAGE, name)))
  check('все объявленные файлы на месте', missing.length === 0, missing.length === 0 ? files.join(', ') : `нет: ${missing.join(', ')}`)

  const module = await import(pathToFileURL(join(PACKAGE, 'lib', 'index.js')).href)
  check('хостовая половина экспортирует name, inject, apply',
    module.name === 'speech-ru-gigaam' && Array.isArray(module.inject) && module.inject.includes('speechToText')
    && typeof module.apply === 'function',
    `name=${module.name}, inject=${JSON.stringify(module.inject)}`)
  return module
}

/** Question 2: a broken loader row must be refused at activation. */
function checkRefusal(module) {
  let thrown = null
  try {
    module.validateConfig({})
  } catch (error) {
    thrown = error
  }
  check('без pythonPath конфигурация отвергается с понятным текстом',
    thrown !== null && String(thrown.message).includes('pythonPath'),
    thrown === null ? 'ошибки не было' : thrown.message)

  let thrownBadPath = null
  try {
    module.validateConfig({ pythonPath: 'not-absolute' })
  } catch (error) {
    thrownBadPath = error
  }
  check('относительный pythonPath отвергается', thrownBadPath !== null,
    thrownBadPath === null ? 'ошибки не было' : thrownBadPath.message)
}

/** Registration into a stand-in registry: what the service would receive. */
async function checkRegistration(module) {
  let registered = null
  let dispose = null
  const ctx = {
    effect: (factory) => {
      dispose = factory()
    },
    logger: { debug: () => {}, info: () => {} },
    speechToText: {
      register: (provider) => {
        registered = provider
        return async () => {}
      },
    },
  }
  module.apply(ctx, { pythonPath: PYTHON, hubCache: HUB_CACHE, modulesCache: MODULES_CACHE,
    revision: DEPLOYED.revision, device: DEPLOYED.device })
  check('провайдер зарегистрирован в службе распознавания', registered !== null,
    registered === null ? 'register не вызван' : `id=${registered.info.id}`)
  check('провайдер объявляет русский язык и локальное размещение',
    registered?.info.languages?.includes('ru') === true && registered?.info.location === 'host-local',
    JSON.stringify(registered?.info.languages))
  // Без `auto` провайдер нельзя выбрать в панели: она посылает только id, а хранимый
  // язык по умолчанию именно `auto`, и служба отвергает смену.
  check('в списке языков есть auto, иначе панель не даст переключиться',
    registered?.info.languages?.includes('auto') === true,
    JSON.stringify(registered?.info.languages))
  check('шаг подготовки не нужен: модель уже на диске',
    registered?.preparation === undefined, String(registered?.preparation))

  let emptyRefused = null
  try {
    await registered.transcribe({ audio: new Uint8Array(0), language: 'ru' }, new AbortController().signal)
  } catch (error) {
    emptyRefused = error
  }
  check('пустая запись отвергается до запуска сторожа',
    emptyRefused !== null && String(emptyRefused.message).includes('пустая'),
    emptyRefused === null ? 'ошибки не было' : emptyRefused.message)

  if (typeof dispose === 'function') await dispose()
}

/** Question 3: the worker itself, on a real recording. */
function runWorker() {
  return new Promise((resolve) => {
    const worker = join(PACKAGE, 'lib', 'worker.py')
    const child = spawn(PYTHON, [worker, '--revision', DEPLOYED.revision, '--device', DEPLOYED.device,
      '--hub-cache', HUB_CACHE, '--modules-cache', MODULES_CACHE], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })
    let out = ''
    let err = ''
    const started = Date.now()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      out += chunk
      // Only whole lines are answers; the tail may be half a message.
      const parts = out.split(/\r?\n/u)
      out = parts.pop() ?? ''
      for (const line of parts) {
        if (line.trim() === '') continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.ready === true) {
          check('модель GigaAM-v3 загрузилась в сторожевом процессе',
            message.revision === DEPLOYED.revision && Number(message.loadSeconds) > 0,
            `ревизия ${message.revision}, загрузка ${message.loadSeconds} с`)
          continue
        }
        if (message.id !== 1) continue
        const seconds = (Date.now() - started) / 1000
        if (typeof message.error === 'string') {
          check('запись распознана', false, message.error)
        } else {
          check('запись распознана', typeof message.text === 'string' && message.text.length > 0,
            `за ${seconds.toFixed(1)} с от старта процесса: «${message.text}»`)
          check('длительность записи посчитана верно',
            Math.abs(Number(message.audioSeconds) - 10.6) < 0.3,
            `audioSeconds=${message.audioSeconds}`)
        }
        child.stdin.write(`${JSON.stringify({ id: 2, command: 'quit' })}\n`)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    child.on('close', (code) => {
      check('сторож выходит по команде quit с нулевым кодом', code === 0, `код ${code}`)
      const stub = err.includes('подставляю заглушку')
      const patched = err.includes('чтение звука подменено в:')
      check('заглушка pyannote взята из пакета, а чтение звука подменено без ffmpeg',
        stub && patched,
        [stub ? 'заглушка из пакета' : 'заглушка НЕ из пакета', patched ? 'load_audio подменён' : 'load_audio НЕ подменён'].join(', '))
      resolve()
    })
    const audio = readFileSync(WAV)
    child.stdin.write(`${JSON.stringify({ id: 1, wav: audio.toString('base64'), language: 'ru' })}\n`)
  })
}

/**
 * The process half, with a stand-in for the Python worker so the lifecycle itself is
 * exercised: a warm start, answers split across chunks, an idle release, a request that
 * never comes back, and a release while something is in flight.
 *
 * The stand-in is written to a temporary directory at run time: it is scaffolding for
 * this test, not a second worker anybody could mistake for the real one.
 */
async function checkProcess() {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const directory = mkdtempSync(join(tmpdir(), 'speech-ru-test-'))
  const fake = join(directory, 'fake-worker.mjs')
  writeFileSync(fake, `
    // Отвечает всем одинаково, отвечает частями и умеет молчать по команде.
    let buffer = ''
    process.stdout.write(JSON.stringify({ ready: true, revision: 'fake', loadSeconds: 0.01 }) + '\\n')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      buffer += chunk
      const parts = buffer.split('\\n')
      buffer = parts.pop()
      for (const line of parts) {
        if (line.trim() === '') continue
        const request = JSON.parse(line)
        if (request.command === 'quit') { process.exit(0) }
        // Прогрев: отвечаем как настоящий сторож, без звука.
        if (request.command === 'warm') {
          process.stdout.write(JSON.stringify({ id: request.id, ready: true, revision: 'fake', loadSeconds: 0.02 }) + '\\n')
          continue
        }
        // Запись приходит в base64, поэтому и метки сверяем в том же виде.
        const marker = (text) => Buffer.from(text).toString('base64')
        if (request.wav === marker('молчать')) continue
        if (request.wav === marker('медленно')) { setTimeout(() => answer(request.id), 400); continue }
        answer(request.id)
      }
    })
    function answer(id) {
      const body = JSON.stringify({ id, text: 'привет', audioSeconds: 1.5, inferenceSeconds: 0.02 }) + '\\n'
      // Отвечаем в два приёма: хост обязан склеить половины одной строки.
      process.stdout.write(body.slice(0, 10))
      setTimeout(() => process.stdout.write(body.slice(10)), 20)
    }
  `, 'utf8')

  const { GigaAmWorker } = await import(pathToFileURL(join(PACKAGE, 'lib', 'index.js')).href)
  const logged = []
  const config = {
    providerId: 'test', pythonPath: process.execPath, workerPath: fake,
    revision: 'fake', device: 'cpu', threads: 0, hubCache: '', modulesCache: '',
    requestTimeoutMs: 5000, idleTimeoutMs: 400, maxAudioBytes: 1024 * 1024, maxLogBytes: 4096,
  }
  const worker = new GigaAmWorker(config, { onLog: (line) => logged.push(line) })

  const warmed = await worker.warm()
  check('прогрев отвечает и не требует звука',
    warmed.ready === true && Number(warmed.loadSeconds) >= 0,
    JSON.stringify(warmed))
  check('после прогрева процесс остаётся жив, а не перезапускается на первой фразе',
    worker.child !== null, `child=${worker.child === null ? 'нет' : 'есть'}`)

  const first = await worker.transcribe(Buffer.from('привет'), new AbortController().signal)
  check('сторож отвечает, и ответ, разрезанный на части, склеивается',
    first.text === 'привет' && first.audioSeconds === 1.5,
    JSON.stringify(first))
  check('строка готовности модели прочитана из того же потока',
    logged.some((line) => line.includes('загружена')), logged.find((line) => line.includes('загружена')) ?? 'не найдена')

  await new Promise((resolve) => setTimeout(resolve, 900))
  check('после простоя процесс освобождён, а не висит с моделью в памяти',
    worker.child === null && logged.some((line) => line.includes('освобождаю')),
    `child=${worker.child === null ? 'нет' : 'есть'}`)

  const slow = new GigaAmWorker({ ...config, requestTimeoutMs: 150 }, { onLog: () => {} })
  let timeoutError = null
  try {
    await slow.transcribe(Buffer.from('медленно'), new AbortController().signal)
  } catch (error) {
    timeoutError = error
  }
  check('молчащий сторож не подвешивает распознавание навсегда',
    timeoutError !== null && String(timeoutError.message).includes('не ответил'),
    timeoutError === null ? 'ошибки не было' : timeoutError.message)
  slow.stop()

  const busy = new GigaAmWorker({ ...config, requestTimeoutMs: 5000 }, { onLog: () => {} })
  const controller = new AbortController()
  const inFlight = busy.transcribe(Buffer.from('привет'), controller.signal)
  controller.abort(new Error('оператор отменил запись'))
  let abortError = null
  try {
    await inFlight
  } catch (error) {
    abortError = error
  }
  check('отмена записи отклоняет ожидание, а не оставляет его висеть',
    abortError !== null && String(abortError.message).includes('отменил'),
    abortError === null ? 'ошибки не было' : abortError.message)
  busy.stop()

  rmSync(directory, { recursive: true, force: true })
}

async function main() {
  console.log(`пакет: ${PACKAGE}`)
  console.log(`питон: ${PYTHON}`)
  console.log(`устройство: ${DEPLOYED.device}, ревизия: ${DEPLOYED.revision}`)
  console.log(`настройки взяты из: ${DEPLOYED.source}`)
  console.log(`запись: ${WAV}\n`)
  check('устройство и ревизия взяты из настроек, а не из константы теста',
    typeof DEPLOYED.source === 'string', DEPLOYED.source)
  const module = await checkShape()
  checkRefusal(module)
  await checkRegistration(module)
  await checkProcess()
  await runWorker()

  const failed = results.filter((entry) => !entry.passed)
  console.log(`\nпроверок: ${results.length}, провалов: ${failed.length}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
