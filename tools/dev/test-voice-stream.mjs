#!/usr/bin/env node
/**
 * Does the live voice reader work — the parts that can be checked without the GUI?
 *
 * 1. **Piece cutting.** The reader must start with a small piece and never let a piece
 *    grow into a paragraph: that is the whole point of reading during generation.
 * 2. **Hook wiring.** Feeding synthetic `agent/assistant-stream` frames must produce the
 *    pieces, in order, in a voice process — and reasoning deltas must produce nothing.
 * 3. **Refusal.** A loader row without paths must fail at activation, not at the first
 *    spoken word.
 *
 * The voice process is a stand-in written at run time: it records what it was handed and
 * answers like the real one, so the test measures the reader, not the speech engine.
 *
 * Usage: node tools/dev/test-voice-stream.mjs
 *
 * @module tools/dev/test-voice-stream
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(HERE))
const PACKAGE = join(REPO, 'packages', 'voice-stream')

const results = []
const check = (title, passed, detail) => {
  results.push({ title, passed })
  console.log(`${passed ? 'ПРОШЛО' : 'ПРОВАЛ'}  ${title}${detail === undefined ? '' : `\n        ${detail}`}`)
}

/** Read the deployed loader row, so the test checks what actually runs. */
function deployedConfig() {
  const patch = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml')
  const fallback = {
    pythonPath: 'C:\\Users\\admin\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
    streamPath: 'C:\\Users\\admin\\Documents\\ds1\\_voice\\say_stream.py',
  }
  try {
    const text = readFileSync(patch, 'utf8')
    const block = text.slice(text.indexOf('id: voice-stream'))
    const python = /pythonPath:\s*'([^']+)'/u.exec(block)
    const stream = /streamPath:\s*'([^']+)'/u.exec(block)
    return { pythonPath: python?.[1] ?? fallback.pythonPath, streamPath: stream?.[1] ?? fallback.streamPath }
  } catch {
    return fallback
  }
}

async function main() {
  const module = await import(pathToFileURL(join(PACKAGE, 'lib', 'index.js')).href)
  console.log(`пакет: ${PACKAGE}\n`)

  check('хостовая половина экспортирует name, inject, apply',
    module.name === 'voice-stream' && Array.isArray(module.inject) && typeof module.apply === 'function',
    `name=${module.name}`)

  let refused = null
  try {
    module.validateConfig({})
  } catch (error) {
    refused = error
  }
  check('без путей конфигурация отвергается на запуске', refused !== null, refused?.message)

  // --- 1. нарезка кусков -----------------------------------------------------
  const take = module.takePiece
  check('короткий текст не читается раньше срока', take('Привет', { min: 50, limit: 260 }) === null,
    'вернулось не null')
  const first = take('Очень длинное первое предложение тут. Короткий хвост.', { min: 10, limit: 260 })
  check('первый кусок кончается на конце предложения после порога',
    first?.text === 'Очень длинное первое предложение тут.', first?.text ?? '—')
  check('длина съеденного совпадает с куском (иначе в следующий кусок лезет лишний знак)',
    first?.consumed === 'Очень длинное первое предложение тут.'.length,
    `съедено ${first?.consumed}, кусок ${first?.text?.length}`)
  const runOn = 'Это очень длинное предложение без единой точки, зато с запятыми, и оно всё тянется, и тянется'
  const cut = take(runOn, { min: 50, limit: 80 })
  check('без точек кусок режется по запятой и не растёт в абзац',
    cut !== null && cut.text.length <= 80 && cut.consumed <= 80, `${cut?.text.length} знаков: ${cut?.text}`)

  // --- 1б. как объявляются ожидания ------------------------------------------
  check('до минуты ожидание называется в секундах',
    module.describeWait(59) === 'Подождём 59 секунд.', module.describeWait(59))
  check('больше минуты называется в минутах',
    module.describeWait(180) === 'Подождём 3 минуты.', module.describeWait(180))
  check('склонение после числа верное',
    module.describeWait(21) === 'Подождём 21 секунду.' && module.describeWait(61) === 'Подождём минуту.',
    `${module.describeWait(21)} / ${module.describeWait(61)}`)
  check('явная пауза находится в аргументах инструмента',
    module.waitFromArguments('Start-Sleep -Seconds 59') === 59
    && module.waitFromArguments('timeout /t 30') === 30
    && module.waitFromArguments('--sleep 5') === 5,
    String(module.waitFromArguments('Start-Sleep -Seconds 59')))
  check('предел времени за ожидание не принимается',
    module.waitFromArguments('{"timeoutMs":600000}') === null && module.waitFromArguments('') === null,
    String(module.waitFromArguments('{"timeoutMs":600000}')))

  // --- 2. подписка, подводки и объявления ------------------------------------
  const directory = mkdtempSync(join(tmpdir(), 'voice-stream-test-'))
  const fakeVoice = join(directory, 'fake-voice.mjs')
  const received = join(directory, 'received.jsonl')
  writeFileSync(fakeVoice, `
    import { appendFileSync } from 'node:fs'
    let buffer = ''
    process.stdout.write('готово\\n')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      buffer += chunk
      const parts = buffer.split('\\n')
      buffer = parts.pop()
      for (const line of parts) {
        if (line.trim() === '') continue
        appendFileSync(${JSON.stringify(received)}, line + '\\n')
        const request = JSON.parse(line)
        if (request.command === 'quit') process.exit(0)
        if (request.text) {
          process.stdout.write(JSON.stringify({ id: request.id, spoken: request.text.length, synthSeconds: 0.01, played: true }) + '\\n')
        }
        if (request.command === 'filler') {
          process.stdout.write(JSON.stringify({ id: request.id, spoken: 5, synthSeconds: 0, played: true }) + '\\n')
        }
      }
    })
  `, 'utf8')

  let hook = null
  const ctx = {
    on: (eventName, listener) => {
      if (eventName === 'agent/assistant-stream') hook = listener
    },
    effect: () => {},
    logger: { debug: () => {}, info: () => {} },
  }
  module.apply(ctx, { pythonPath: process.execPath, streamPath: fakeVoice, firstChunk: 20, chunkChars: 60 })
  check('мод подписался на живой поток текста', hook !== null, 'agent/assistant-stream не пойман')

  const agent = { session: { id: 'session-test', delegationDepth: 0 } }
  const frames = [
    { type: 'start', turn: 1 },
    { type: 'chunk', chunk: { type: 'reasoning-delta', text: 'тут я думаю про себя, это вслух не читается' } },
    { type: 'chunk', chunk: { type: 'text-delta', text: 'Первое предложение ответа. ' } },
    { type: 'chunk', chunk: { type: 'text-delta', text: 'Второе предложение, и оно тоже длинное, чтобы набрать кусок. ' } },
    { type: 'chunk', chunk: { type: 'text-delta', text: 'Хвост без точки' } },
    { type: 'end' },
  ]
  for (const frame of frames) hook({ agent, frame })
  await new Promise((resolve) => setTimeout(resolve, 700))

  const lines = existsSync(received) ? readFileSync(received, 'utf8').split('\n').filter((line) => line.trim() !== '') : []
  const records = lines.map((line) => JSON.parse(line))
  const pieces = records.filter((record) => record.text).map((record) => record.text)
  check('куски ушли голосу по порядку и без размышлений',
    pieces.length >= 2 && !pieces.join(' ').includes('думаю про себя'),
    `${pieces.length} кусков: ${JSON.stringify(pieces)}`)
  check('хвост без точки прочитан последним, а не потерян',
    pieces.length > 0 && pieces[pieces.length - 1].includes('Хвост'), pieces[pieces.length - 1] ?? '—')
  check('в начале хода сказана подводка из кэша, без синтеза',
    records.some((record) => record.command === 'filler'), JSON.stringify(records[0]))
  check('начало ответа объявлено до кусков',
    records.some((record) => record.command === 'begin'), lines[0] ?? '—')

  // Объявление назначенной паузы: сказано ДО ожидания, поэтому проверяем сразу.
  hook({ agent, frame: { type: 'start', turn: 2 } })
  hook({ agent, frame: { type: 'chunk', chunk: { type: 'tool-call-delta', argumentsDelta: '{"command":"pwsh Start-Sleep -Seconds 59"}' } } })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const afterWait = readFileSync(received, 'utf8')
  check('назначенная пауза объявлена словами и в секундах',
    afterWait.includes('Подождём 59 секунд'),
    afterWait.split('\n').filter((line) => line.includes('Подождём')).join(' | ') || 'фразы про ожидание нет')

  hook({ agent, frame: { type: 'start', turn: 3 } })
  hook({ agent, frame: { type: 'chunk', chunk: { type: 'tool-call-delta', argumentsDelta: '{"timeoutMs":600000}' } } })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const afterLimit = readFileSync(received, 'utf8')
  check('предел времени не выдаётся за ожидание (иначе это враньё)',
    !afterLimit.includes('Подождём 10 минут'),
    afterLimit.split('\n').filter((line) => line.includes('Подождём')).join(' | ') || 'фраз про ожидание нет')

  // --- 3. подагенты молчат ----------------------------------------------------
  hook({ agent: { session: { id: 'sub', delegationDepth: 1 } }, frame: { type: 'start' } })
  hook({ agent: { session: { id: 'sub', delegationDepth: 1 } }, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'Болтовня подагента, её слышать не нужно.' } } })
  hook({ agent: { session: { id: 'sub', delegationDepth: 1 } }, frame: { type: 'end' } })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const after = readFileSync(received, 'utf8')
  check('текст подагента не читается', !after.includes('Болтовня подагента'))

  // --- 4. кнопка в панели: маршрут и состояние --------------------------------
  const stateDir = mkdtempSync(join(tmpdir(), 'voice-state-'))
  const streamStub = join(stateDir, 'say_stream.py')
  writeFileSync(streamStub, '# заглушка: этот тест голос не поднимает\n', 'utf8')
  const stateFile = join(stateDir, 'ГОЛОС.txt')
  let route = null
  const ctxButton = {
    on: () => {},
    effect: () => {},
    logger: { debug: () => {}, info: () => {} },
    connection: { fetch: { register: (definition) => { route = definition; return () => {} } } },
  }
  module.apply(ctxButton, {
    pythonPath: process.execPath, streamPath: streamStub, firstChunk: 50, chunkChars: 60, fillers: false,
  })
  check('маршрут кнопки поднят по своему адресу',
    route !== null && route.path === '/api/voice-stream.mod', route?.path ?? 'маршрута нет')

  const getBody = await (await route.fetch(new Request('http://local/api/voice-stream.mod'))).json()
  check('без файла-переключателя голос считается включённым', getBody.on === true, JSON.stringify(getBody))

  const postReply = await route.fetch(new Request('http://local/api/voice-stream.mod', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }),
  }))
  const postBody = await postReply.json()
  check('кнопка выключает голос и это попадает в файл',
    postBody.on === false && readFileSync(stateFile, 'utf8').trim() === 'ВЫКЛ',
    `${JSON.stringify(postBody)}, в файле «${readFileSync(stateFile, 'utf8').trim()}»`)

  const backReply = await route.fetch(new Request('http://local/api/voice-stream.mod', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }),
  }))
  check('кнопка включает голос обратно',
    (await backReply.json()).on === true && readFileSync(stateFile, 'utf8').trim() === 'ВКЛ',
    readFileSync(stateFile, 'utf8').trim())

  const badReply = await route.fetch(new Request('http://local/api/voice-stream.mod', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: 'да' }),
  }))
  check('мусор в теле отвергается, а не пишется в переключатель',
    badReply.status === 400, `HTTP ${badReply.status}`)
  rmSync(stateDir, { recursive: true, force: true })

  // --- 5. браузерная половина --------------------------------------------------
  let bundle = null
  globalThis.window = { __ModuleLoader__: { load: (definition) => { bundle = definition } } }
  await import(pathToFileURL(join(PACKAGE, 'lib', 'client.js')).href)
  check('браузерная половина зарегистрирована под именем пакета',
    bundle?.id === '@local/dsh-voice-stream', bundle?.id ?? 'не загрузилась')

  const fakeReact = { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} }
  const client = bundle.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`базовый модуль не объявлен: ${name}`)
  })
  check('браузерная половина просит только базовые модули',
    typeof client.apply === 'function' && Array.isArray(client.inject) && client.inject.includes('slots'),
    `inject=${JSON.stringify(client.inject)}`)

  let registered = null
  client.apply({ slots: { inject: (_name, factory) => factory(), register: (options) => { registered = options } } })
  check('кнопка встаёт в строку служебных действий шапки сеанса',
    registered?.name === 'conversation.session.header.utilities' && registered?.id === 'voice-stream',
    JSON.stringify({ name: registered?.name, id: registered?.id }))

  const deployed = deployedConfig()
  console.log(`\nразвёрнутые пути: ${deployed.pythonPath}\n                  ${deployed.streamPath}`)
  rmSync(directory, { recursive: true, force: true })

  const failed = results.filter((entry) => !entry.passed)
  console.log(`\nпроверок: ${results.length}, провалов: ${failed.length}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
