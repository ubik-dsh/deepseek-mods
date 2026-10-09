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

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(HERE))
const PACKAGE = join(REPO, 'packages', 'voice-stream')

const results = []
const check = (title, passed, detail) => {
  results.push({ title, passed })
  console.log(`${passed ? 'ПРОШЛО' : 'ПРОВАЛ'}  ${title}${detail === undefined ? '' : `\n        ${detail}`}`)
}

/**
 * Read the deployed loader row, so the test checks what actually runs.
 *
 * No fallback paths here on purpose: this file is published, and a fallback is a machine-specific
 * path, which is exactly what a published file must not carry. Not deployed means "not configured
 * here", and the informational line says so instead of inventing a path that may not exist.
 */
function deployedConfig() {
  const patch = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml')
  try {
    const text = readFileSync(patch, 'utf8')
    const block = text.slice(text.indexOf('id: voice-stream'))
    const python = /pythonPath:\s*'([^']+)'/u.exec(block)
    const stream = /streamPath:\s*'([^']+)'/u.exec(block)
    return { pythonPath: python?.[1] ?? null, streamPath: stream?.[1] ?? null }
  } catch {
    return { pythonPath: null, streamPath: null }
  }
}

async function main() {
  const module = await import(pathToFileURL(join(PACKAGE, 'lib', 'index.js')).href)
  console.log(`пакет: ${PACKAGE}\n`)

  check('хостовая половина экспортирует name, inject, apply',
    module.name === 'voice-stream' && Array.isArray(module.inject) && typeof module.apply === 'function',
    `name=${module.name}`)

  // ЛОВУШКА, СТОИВШАЯ ПРОСТОЯ. Харнесс не отдаёт службу, которую плагин не объявил:
  // чтение `ctx.connection` без объявления бросает «cannot get property "connection"
  // without inject», плагин не поднимается целиком, и вместе с кнопкой пропадает
  // чтение вслух. Проверяем не поведение, а само правило: читаешь — объяви.
  const source = readFileSync(join(PACKAGE, 'lib', 'index.js'), 'utf8')
  const readsConnection = /ctx\.connection/u.test(source)
  check('служба связи объявлена, раз код её читает',
    !readsConnection || module.inject.includes('connection'),
    `inject=${JSON.stringify(module.inject)}, чтение ctx.connection: ${readsConnection}`)

  // ПЛАГИН-BUNDLE НЕ НЕСЁТ МАШИННЫХ ПУТЕЙ, поэтому пустая настройка должна работать: процесс
  // берётся из самого пакета, а питон из PATH. Явный несуществующий путь по-прежнему отвергается
  // громко: опечатка в настройке не должна выглядеть как «голос молчит».
  const defaults = module.validateConfig({})
  check('без путей процесс берётся из пакета, а питон ищется в PATH',
    isAbsolute(defaults.streamPath) && defaults.streamPath.endsWith('say_stream.py')
    && existsSync(defaults.streamPath) && typeof defaults.pythonSource === 'string'
    && defaults.pythonPath !== '',
    `streamPath=${defaults.streamPath}, pythonPath=${defaults.pythonPath} (${defaults.pythonSource})`)

  let refused = null
  try {
    module.validateConfig({ streamPath: 'C:\\нет\\такого\\say_stream.py' })
  } catch (error) {
    refused = error
  }
  check('явный несуществующий путь отвергается на запуске', refused !== null, refused?.message)

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

  // ЛОВУШКА, УСЛЫШАННАЯ ОПЕРАТОРОМ. В фразе «…объявляет dsh.bundle.patch, и его слои…» рез шёл
  // по точке ВНУТРИ имени: кусок кончался на «dsh.bundle», а следующий начинался с «patch,»,
  // и половинки читались огрызками («бэндэл», «пэч»). Концом предложения считается только знак,
  // за которым пробел или конец текста.
  const dotted = 'объявляет dsh.bundle.patch, и его слои применяются в порядке dsh.profile.bundles'
  check('точка внутри имени не режет кусок',
    take(dotted, { min: 20, limit: 260 }) === null,
    JSON.stringify(take(dotted, { min: 20, limit: 260 })))
  const dottedEnd = take(`${dotted} дальше.`, { min: 20, limit: 260 })
  check('настоящая точка в конце режет кусок целиком',
    dottedEnd !== null && dottedEnd.text === `${dotted} дальше.`,
    dottedEnd?.text ?? 'пусто')

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

  // --- 4б. повтор чтения последнего ответа ------------------------------------
  // Оператор отошёл, ответ прозвучал без него. Кнопка «Повторить» должна прочитать его
  // заново. Голос для этой проверки тот же подставной, что и выше, поэтому видно, что
  // именно ушло в процесс.
  const emptyRepeat = await route.fetch(new Request('http://local/api/voice-stream.mod', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repeat: true }),
  }))
  check('повтор без ответа отвечает отказом, а не молчанием',
    emptyRepeat.status === 409 && (await emptyRepeat.json()).ok === false, `HTTP ${emptyRepeat.status}`)

  let repeatHook = null
  let repeatRoute = null
  const repeatCtx = {
    on: (eventName, listener) => {
      if (eventName === 'agent/assistant-stream') repeatHook = listener
    },
    effect: () => {},
    logger: { debug: () => {}, info: () => {} },
    connection: { fetch: { register: (definition) => { repeatRoute = definition; return () => {} } } },
  }
  module.apply(repeatCtx, {
    pythonPath: process.execPath, streamPath: fakeVoice, firstChunk: 20, chunkChars: 60, fillers: false,
  })
  const answerFrames = [
    { type: 'start', turn: 7 },
    { type: 'chunk', chunk: { type: 'text-delta', text: 'Первый ответ целиком. ' } },
    { type: 'chunk', chunk: { type: 'text-delta', text: 'Его надо уметь повторить.' } },
    { type: 'end' },
  ]
  for (const frame of answerFrames) repeatHook({ agent, frame })
  await new Promise((resolve) => setTimeout(resolve, 600))

  const linesBefore = readFileSync(received, 'utf8').split('\n').filter((line) => line.trim() !== '')
  const afterTurn = await (await repeatRoute.fetch(new Request('http://local/api/voice-stream.mod'))).json()
  check('после хода есть что повторять',
    afterTurn.hasLast === true && afterTurn.lastChars > 0, JSON.stringify(afterTurn))

  const repeatReply = await repeatRoute.fetch(new Request('http://local/api/voice-stream.mod', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repeat: true }),
  }))
  const repeatBody = await repeatReply.json()
  await new Promise((resolve) => setTimeout(resolve, 700))
  const linesAfter = readFileSync(received, 'utf8').split('\n').filter((line) => line.trim() !== '')
  const repeated = linesAfter.slice(linesBefore.length)
    .map((line) => JSON.parse(line)).filter((record) => record.text).map((record) => record.text)
  check('повтор читает тот же текст заново',
    repeatBody.ok === true && repeated.join(' ').includes('Первый ответ целиком'),
    `ok=${repeatBody.ok}, знаков ${repeatBody.chars}, куски: ${JSON.stringify(repeated)}`)
  check('повтор начинается с метки нового ответа, как живое чтение',
    linesAfter.slice(linesBefore.length).map((line) => JSON.parse(line)).some((record) => record.command === 'begin'),
    JSON.stringify(linesAfter.slice(linesBefore.length).map((line) => line.trim()).slice(0, 3)))

  // --- 4в. новый шаг внутри хода не выбрасывает недоговорённый хвост ----------
  // `begin()` вызывается на КАЖДОЙ попытке, а попытка это и новый шаг того же хода. Раньше он
  // чистил накопитель, и хвост предложения, начатого в одном шаге, пропадал: оператор услышал
  // это как «между двумя латиницами теряется текст».
  const beforeSplit = readFileSync(received, 'utf8').split('\n').filter((line) => line.trim() !== '').length
  const splitFrames = [
    { type: 'start', turn: 11 },
    { type: 'chunk', chunk: { type: 'text-delta', text: 'Это начало фразы без точки, но уже длинное' } },
    { type: 'start', turn: 11 },
    { type: 'chunk', chunk: { type: 'text-delta', text: ', и вот её конец.' } },
    { type: 'end' },
  ]
  for (const frame of splitFrames) repeatHook({ agent, frame })
  await new Promise((resolve) => setTimeout(resolve, 800))
  const saidAfterSplit = readFileSync(received, 'utf8').split('\n').filter((line) => line.trim() !== '')
    .slice(beforeSplit).map((line) => JSON.parse(line)).filter((record) => record.text)
    .map((record) => record.text).join(' ')
  check('новый шаг внутри хода не теряет недоговорённый хвост',
    saidAfterSplit.includes('Это начало фразы без точки') && saidAfterSplit.includes('и вот её конец'),
    saidAfterSplit === '' ? 'голосу не ушло ничего' : saidAfterSplit)

  // --- 4г. мёртвая труба голоса не должна ронять харнесс ----------------------
  // Я убил голосовой процесс снаружи, чтобы он взял свежий код, и запись в его вход уронила
  // весь dsh: `fatal uncaught exception: Error: write EPIPE at VoiceStream.begin`. Ошибка потока
  // это событие `error`, а не исключение метода, и без обработчика она фатальна для процесса.
  const broken = new module.VoiceStream({
    pythonPath: process.execPath, streamPath: fakeVoice, firstChunk: 20, chunkChars: 60,
    fillers: false, maxChars: 6000, idleStopMs: 600000, readSubagents: false,
  }, () => {})
  broken.child = { stdin: { writable: false, write: () => { throw new Error('write EPIPE') } } }
  let threw = null
  try {
    broken.begin()
  } catch (error) {
    threw = error
  }
  const forgotAfterBegin = broken.child === null
  try {
    broken.say('проверка мёртвой трубы')
  } catch (error) {
    threw = threw ?? error
  }
  const respawned = broken.child !== null
  try {
    broken.filler(1)
    broken.stop('тест закончен: убираю поднятый процесс')
  } catch (error) {
    threw = threw ?? error
  }
  check('запись в мёртвый голосовой процесс не бросает исключение, а процесс поднимается заново',
    threw === null && forgotAfterBegin && respawned,
    `исключение: ${threw?.message ?? 'нет'}, обрыв замечен: ${forgotAfterBegin}, поднят заново: ${respawned}`)
  // --- 4д. платформа: питон, сбой запуска и внятный отказ ----------------------
  // Задание с Ubuntu 24.04: там нет команды `python`, и `spawn python ENOENT` уронил ВЕСЬ харнесс,
  // потому что у ChildProcess не было обработчика `'error'`. Проверяем и выбор имени, и то, что
  // отказ не убивает процесс, и что повторные попытки не копятся.
  const fakeBin = mkdtempSync(join(tmpdir(), 'dsh-voice-bin-'))
  writeFileSync(join(fakeBin, 'python3'), '#!/bin/sh\nexit 0\n')
  const linuxFind = module.resolveInterpreter({ env: { PATH: fakeBin }, platform: 'linux' })
  check('на linux выбран python3, если он есть в PATH',
    linuxFind.command.endsWith('python3') && linuxFind.missing !== true, linuxFind.command)
  const linuxFallback = module.resolveInterpreter({ env: { PATH: '' }, platform: 'linux' })
  check('без питона в PATH отказ помечен, а не выдуман',
    linuxFallback.missing === true && linuxFallback.command === 'python3',
    `${linuxFallback.command} (${linuxFallback.source})`)
  check('на windows первым идёт python, на linux первым python3',
    module.defaultPythonNames('win32').join(',') === 'python,python3'
    && module.defaultPythonNames('linux').join(',') === 'python3,python',
    module.defaultPythonNames('win32').join(','))
  const given = module.resolveInterpreter({ configured: '/opt/py/bin/python3', env: { PATH: '' }, platform: 'linux' })
  check('заданный питон не переопределяется поиском',
    given.command === '/opt/py/bin/python3' && given.source.includes('задано'), given.command)
  rmSync(fakeBin, { recursive: true, force: true })

  // СБОЙ ЗАПУСКА НЕ РОНЯЕТ ХАРНЕСС. Здесь запускаем НАСТОЯЩИЙ spawn с несуществующей программой:
  // именно этот случай давал `fatal uncaught exception` на Ubuntu.
  const brokenPython = new module.VoiceStream({
    pythonPath: 'этого-питона-нет-нигде', streamPath: join(PACKAGE, 'runtime', 'say_stream.py'),
    firstChunk: 20, chunkChars: 60, fillers: false, maxChars: 6000, idleStopMs: 600000,
    readSubagents: false,
  }, () => {})
  let launchThrew = null
  try {
    brokenPython.start()
    brokenPython.say('первая фраза')
    brokenPython.say('вторая фраза')
  } catch (error) {
    launchThrew = error
  }
  await new Promise((resolve) => setTimeout(resolve, 800))
  check('отсутствие программы не бросает исключение и записывается причиной',
    launchThrew === null && brokenPython.child === null && typeof brokenPython.lastError === 'string',
    launchThrew === null ? `причина: ${brokenPython.lastError}` : `бросило: ${launchThrew.message}`)
  check('повторные попытки запуска не копятся (одна попытка на все фразы)',
    brokenPython.startFailures === 1, `попыток: ${brokenPython.startFailures}`)

  // Питона нет вовсе: плагин обязан подняться и объяснить, что поставить.
  const noPython = module.validateConfig({ streamPath: join(PACKAGE, 'runtime', 'say_stream.py') })
  check('пустая настройка не падает, а называет найденный питон',
    typeof noPython.pythonPath === 'string' && noPython.pythonPath !== ''
    && noPython.pythonSource !== undefined, `${noPython.pythonPath} (${noPython.pythonSource})`)

  // ЗАДАНИЕ ПРИЁМКИ: `DSH_VOICE_PYTHON=/nonexistent` — сервер поднимается, кнопка неактивна и
  // называет причину. Значит конфигурация с несуществующим путём НЕ бросает, а помечает отказ.
  const bogus = module.validateConfig({
    streamPath: join(PACKAGE, 'runtime', 'say_stream.py'),
    pythonPath: join(tmpdir(), 'нет-такого-питона', 'python3'),
  })
  const bogusVoice = new module.VoiceStream(bogus, () => {})
  check('несуществующий заданный питон не ломает подъём мода, а даёт причину для кнопки',
    bogus.pythonMissing === true && typeof bogusVoice.lastError === 'string'
    && bogusVoice.lastError.includes('не существует'),
    bogusVoice.lastError ?? 'причины нет')

  const panelSource = readFileSync(join(PACKAGE, 'lib', 'client.js'), 'utf8')
  check('кнопка показывает причину недоступности голоса, а не молчит',
    panelSource.includes('voiceError') && panelSource.includes('голос недоступен'),
    panelSource.includes('voiceError') ? 'состояние и подпись на месте' : 'поля voiceError нет')

  // --- 4е. подводки молчат, когда работы нет --------------------------------
  // Оператор услышал «понял, работаю» и «работаю, подожди» уже после того, как ответ кончился:
  // ход не закрывался, и такт продолжал болтать в пустой комнате. Проверяем оба предохранителя.
  const tickConfig = module.validateConfig({ streamPath: join(PACKAGE, 'runtime', 'say_stream.py') })
  const tickVoice = new module.VoiceStream(tickConfig, () => {})
  const tickSent = []
  tickVoice.child = { stdin: { writable: true, write: (line) => tickSent.push(JSON.parse(line)) } }
  tickVoice.startTurn(7)
  tickVoice.lastSpokenAt = 0
  tickVoice.lastFillerAt = 0
  tickVoice.lastFrameAt = Date.now() - 60000
  check('без свежих кадров подводка не звучит',
    tickVoice.tick() === 'кадров нет: молчу' && tickSent.length === 0,
    `${tickVoice.tick()} , отправлено ${String(tickSent.length)}`)
  tickVoice.lastFrameAt = Date.now()
  check('пока кадры идут, подводка звучит',
    tickVoice.tick() === 'сказал' && tickSent.length === 1,
    `отправлено ${String(tickSent.length)}: ${JSON.stringify(tickSent[0] ?? null)}`)
  tickVoice.finishTurn()
  tickVoice.lastSpokenAt = 0
  tickVoice.lastFillerAt = 0
  check('после конца хода такт молчит, даже если время прошло',
    tickVoice.tick() === 'нет хода' && tickSent.length === 1,
    `${tickVoice.tick()} , отправлено ${String(tickSent.length)}`)

  // ВЫБОР ПРОИГРЫВАТЕЛЯ. Платформенную ветку нельзя проверить «своим» запуском, поэтому она
  // вынесена в чистую функцию с подменяемым поиском, а здесь мы гоняем её для всех платформ.
  const selftest = spawnSync(module.resolveInterpreter({}).command,
    [join(PACKAGE, 'runtime', 'say_stream.py'), '--selftest'], { encoding: 'utf8', timeout: 120000 })
  const selftestOut = `${selftest.stdout ?? ''}${selftest.stderr ?? ''}`
  const selftestCount = /проверок: (\d+), провалов: (\d+)/u.exec(selftestOut)
  check('выбор проигрывателя проходит проверку на всех платформах',
    selftest.status === 0 && selftestCount !== null && selftestCount[2] === '0',
    selftestCount === null ? selftestOut.trim().split('\n').slice(-3).join(' | ') : `${selftestCount[1]} проверок`)
  rmSync(stateDir, { recursive: true, force: true })

  // --- 4ж. осмысленные объявления о работе ------------------------------------
  // Оператор просил вместо «смотрю» и «понял, работаю» коротко говорить, что делается:
  // «читаю файл», «ищу по коду», «выполняю команду».
  check('инструменты называют себя по-русски и коротко',
    module.describeAction('read') === 'Читаю файл'
    && module.describeAction('grep') === 'Ищу по коду'
    && module.describeAction('pwsh') === 'Выполняю команду'
    && module.describeAction('edit') === 'Правлю файл',
    ['read', 'grep', 'pwsh', 'edit'].map((one) => module.describeAction(one)).join(' / '))
  check('незнакомый инструмент не выдумывает фразу',
    module.describeAction('что-то-новое') === 'Выполняю шаг'
    && module.describeAction('') === 'Выполняю шаг',
    module.describeAction('что-то-новое'))

  const actionVoice = new module.VoiceStream(tickConfig, () => {})
  const actionSent = []
  actionVoice.child = { stdin: { writable: true, write: (line) => actionSent.push(JSON.parse(line)) } }
  check('фраза о работе звучит один раз, а не подряд',
    actionVoice.action('Читаю файл') === true && actionSent.length === 1,
    `отправлено ${String(actionSent.length)}`)
  actionVoice.lastActionAt = Date.now() - 4000
  check('ту же фразу не повторяем чаще, чем разрешено',
    actionVoice.action('Читаю файл') === false && actionSent.length === 1,
    `отправлено ${String(actionSent.length)}`)
  check('а другую фразу о работе говорим сразу',
    actionVoice.action('Ищу по коду') === true && actionSent.length === 2,
    JSON.stringify(actionSent[1] ?? null))
  actionVoice.config.announceActions = false
  actionVoice.lastActionAt = 0
  check('объявления выключаются настройкой',
    actionVoice.action('Выполняю команду') === false && actionSent.length === 2,
    'выключено')

  // --- 4з. ударения -----------------------------------------------------------
  // Оператор выбрал ruaccent для ударений. Мод только передаёт выключатель, пометки расставляет
  // голосовой процесс, и без акцентуатора текст обязан уходить как есть.
  const stressConfig = module.validateConfig({ streamPath: join(PACKAGE, 'runtime', 'say_stream.py') })
  check('ударения включены настройкой по умолчанию',
    stressConfig.stress === true, `stress=${String(stressConfig.stress)}`)
  check('выключатель ударений доходит до подготовки текста',
    readFileSync(join(PACKAGE, 'lib', 'index.js'), 'utf8').includes('DSH_VOICE_STRESS')
    && readFileSync(join(PACKAGE, 'runtime', 'числа.py'), 'utf8').includes('DSH_VOICE_STRESS'),
    'переменная есть и в моде, и в подготовке текста')
  const numbers = spawnSync(module.resolveInterpreter({}).command,
    [join(PACKAGE, 'runtime', 'числа.py'), '--selftest'], { encoding: 'utf8', timeout: 180000 })
  const numbersOut = `${numbers.stdout ?? ''}${numbers.stderr ?? ''}`
  const numbersCount = /проверок: (\d+), провалов: (\d+)/u.exec(numbersOut)
  check('подготовка текста проходит свою проверку (числа, латиница, ударения)',
    numbers.status === 0 && numbersCount !== null && numbersCount[2] === '0',
    numbersCount === null ? numbersOut.trim().split('\n').slice(-2).join(' | ') : `${numbersCount[1]} проверок`)

  // --- 4и. подводки: разнообразие и связь с кэшем ------------------------------
  // Оператор: «добавь больше синонимов слов-паразитов, а то как-то одно и то же». Номера подводок
  // живут в моде, а сами фразы в голосовом процессе, и связь между ними держалась на памяти.
  const sayStreamSource = readFileSync(join(PACKAGE, 'runtime', 'say_stream.py'), 'utf8')
  const fillerBlock = /FILLERS = \[([\s\S]*?)\n\]/u.exec(sayStreamSource)?.[1] ?? ''
  const fillerCount = (fillerBlock.match(/^\s*"/gmu) ?? []).length
  const highestIndex = Math.max(...module.START_FILLERS, ...module.WORK_FILLERS)
  check('номера подводок не выходят за список в голосовом процессе',
    fillerCount > highestIndex,
    `в списке ${String(fillerCount)} фраз, старший номер ${String(highestIndex)}`)
  check('наборы подводок не пустые и не пересекаются',
    module.START_FILLERS.length >= 5 && module.WORK_FILLERS.length >= 4
    && module.START_FILLERS.every((one) => !module.WORK_FILLERS.includes(one)),
    `начало ${String(module.START_FILLERS.length)}, работа ${String(module.WORK_FILLERS.length)}`)

  const bagVoice = new module.VoiceStream(tickConfig, () => {})
  const bagSent = []
  bagVoice.child = { stdin: { writable: true, write: (line) => bagSent.push(JSON.parse(line).which) } }
  for (let step = 0; step < 30; step += 1) bagVoice.takeFiller(module.START_FILLERS)
  const backToBack = bagSent.filter((value, index) => index > 0 && value === bagSent[index - 1]).length
  const distinctFillers = new Set(bagSent).size
  check('подводки идут без повторов подряд и покрывают весь набор',
    backToBack === 0 && distinctFillers === module.START_FILLERS.length
    && bagSent.every((value) => module.START_FILLERS.includes(value)),
    `повторов подряд ${String(backToBack)}, разных ${String(distinctFillers)} `
    + `из ${String(module.START_FILLERS.length)}`)

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

  const clientSource = readFileSync(join(PACKAGE, 'lib', 'client.js'), 'utf8')
  check('в браузерной половине есть кнопка повтора и запрос на повтор',
    clientSource.includes('Повторить') && clientSource.includes('repeat: true'),
    `Повторить: ${clientSource.includes('Повторить')}, repeat: true: ${clientSource.includes('repeat: true')}`)

  // ЛОВУШКА, НА КОТОРУЮ НАСТУПИЛ ОПЕРАТОР. Страница подтягивает новую браузерную половину
  // сразу, а хост обновляется только перезапуском. Кнопка при этом видна и мертва, и это
  // выглядит как поломка. Проверяем, что мёртвая кнопка называет причину: без этого
  // «не активна» снова будет загадкой. Проверка читает исходник, а не рисует компонент:
  // рисование требует настоящего React, и подделка здесь проверяла бы подделку.
  check('кнопка повтора объясняет старую сборку хоста, а не молчит',
    clientSource.includes('staleHost') && clientSource.includes('нужен перезапуск dsh web'),
    `staleHost: ${clientSource.includes('staleHost')}, подсказка: ${clientSource.includes('нужен перезапуск dsh web')}`)

  const deployed = deployedConfig()
  console.log(deployed.pythonPath === null
    ? '\nразвёрнутая строка загрузчика не найдена: этот тест проверяет мод, а не ваши пути'
    : `\nразвёрнутые пути: ${deployed.pythonPath}\n                  ${deployed.streamPath}`)
  rmSync(directory, { recursive: true, force: true })

  const failed = results.filter((entry) => !entry.passed)
  console.log(`\nпроверок: ${results.length}, провалов: ${failed.length}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
