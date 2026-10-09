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
import { fileURLToPath } from 'node:url'

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
  /**
   * Сколько тишины в потоке считать остановкой работы.
   *
   * Это предохранитель от болтовни в пустоту: если кадров из потока нет дольше этого времени,
   * подводки запрещены, даже если ход почему-то не закрылся.
   */
  workQuietMs: 12000,
  /**
   * Объявлять ли, чем занят агент: «Читаю файл», «Ищу по коду», «Выполняю команду».
   *
   * Оператор попросил заменить бессмысленные подводки на осмысленные: он хочет слышать, что
   * происходит, а не «смотрю» и «понял, работаю». Объявления идут синтезом (они разные), но
   * короткие: две-четыре секунды на фразу.
   */
  announceActions: true,
  /** Не чаще одной фразы о действии в это время: иначе получается болтовня. */
  actionGapMs: 3000,
  /** Одну и ту же фразу не повторять чаще, чем раз в это время. */
  actionRepeatMs: 15000,
  /** Сколько думать молча, прежде чем сказать «обдумываю». */
  thinkingAfterMs: 4000,
  /**
   * Расставлять ли ударения перед синтезом.
   *
   * Русский голос ставит ударение сам и на омонимах ошибается: «за́мок» и «замо́к». Пометку «+»
   * перед ударной гласной он понимает (проверено замером: пометка на втором слоге меняет форму
   * звука, на первом не меняет ничего). Расставляет пометки необязательная зависимость ruaccent
   * в голосовом процессе: нет её — текст уходит как есть и читалка работает ровно как раньше,
   * поэтому включено по умолчанию, цена ошибки нулевая.
   */
  stress: true,
}

/** Message of an unknown thrown value. */
function messageOf(error) {  return error instanceof Error ? error.message : String(error)
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
 * ТОЧКА ВНУТРИ ИМЕНИ ЭТО НЕ КОНЕЦ ПРЕДЛОЖЕНИЯ. Оператор услышал, как фраза
 * «…объявляет dsh.bundle.patch, и его слои…» распалась на «…объявляет ди эс эйч бэндэл»
 * и «пэч, и его слои…»: рез шёл по точке внутри имени, и половинки читались порознь
 * огрызками. Поэтому концом предложения считается только знак, за которым стоит пробел
 * или конец текста: у `dsh.bundle.patch` точки окружены буквами, и он не режется.
 *
 * @param text - накопленный, ещё не прочитанный текст.
 * @param options - `min` знаков до первого чтения, `limit` знаков до принудительного реза.
 * @returns кусок и его длину в исходнике, либо null, если читать ещё рано.
 */
export function takePiece(text, { min, limit }) {
  if (text.length < min) return null
  const window = text.slice(0, Math.min(text.length, limit * 2))
  for (let index = min - 1; index < window.length; index += 1) {
    if (!'.!?…'.includes(window[index])) continue
    const next = text[index + 1]
    // Конец предложения: дальше пробел, конец текста или закрывающая скобка с пробелом.
    if (next !== undefined && !/[\s)\]»"]/u.test(next)) continue
    return { text: text.slice(0, index + 1).trim(), consumed: index + 1 }
  }
  if (text.length < limit) return null
  const head = text.slice(0, limit)
  const stop = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf(' '))
  const consumed = stop > min ? stop : limit
  return { text: text.slice(0, consumed).trim(), consumed }
}

/**
 * Короткая русская фраза о том, что делает инструмент.
 *
 * Оператор: «у тебя есть шаги — читаешь файл, ищешь код, выполняешь команды; может, это кратенько
 * описывать, чтобы было постоянное понимание, что сейчас происходит». Здесь только название
 * действия: два-четыре слова, которые успевают прозвучать, пока инструмент работает. Незнакомый
 * инструмент не выдумываем: говорим «выполняю шаг», чтобы не обещать того, чего не знаем.
 *
 * @param name - имя инструмента из кадра потока.
 * @returns фраза для голоса.
 */
export function describeAction(name) {
  const table = {
    read: 'Читаю файл',
    write: 'Пишу файл',
    edit: 'Правлю файл',
    grep: 'Ищу по коду',
    glob: 'Ищу файлы',
    list: 'Смотрю каталог',
    pwsh: 'Выполняю команду',
    bash: 'Выполняю команду',
    job_output: 'Читаю вывод задачи',
    todo_write: 'Веду план',
    subagent: 'Запускаю подагента',
    subagent_fork: 'Запускаю подагента',
    workflow: 'Запускаю поток задач',
    web_search: 'Ищу в интернете',
    web_fetch: 'Открываю страницу',
    ask_user_question: 'Спрашиваю',
    skill: 'Открываю навык',
    present: 'Показываю файл',
    create_goal: 'Ставлю цель',
    update_goal: 'Обновляю цель',
  }
  if (typeof name !== 'string' || name.trim() === '') return 'Выполняю шаг'
  return table[name] ?? 'Выполняю шаг'
}

/** Один тёплый голосовой процесс на все ответы. */
export class VoiceStream {
  constructor(config, onLog = () => {}) {
    this.config = config
    this.onLog = onLog
    this.child = null
    /**
     * Почему голос молчит, если молчит.
     *
     * Раньше сбой запуска процесса (нет питона, нет прав) был виден только в консоли харнесса,
     * а в панели кнопка выглядела рабочей: человек включал голос и не слышал ничего, без причины.
     * Теперь причина хранится здесь и уезжает в панель вместе со снимком состояния.
     */
    this.lastError = null
    /** До какого времени не пытаться снова: без этого каждая фраза рождала новый сбойный запуск. */
    this.retryAfter = 0
    this.startFailures = 0
    this.buffer = ''
    this.nextId = 1
    this.spoken = 0
    this.idle = null
    /** Текущий ход и учёт подводок: тишину заполняем, но не болтаем. */
    this.turn = null
    /** Когда пришёл последний кадр потока: по нему такт понимает, идёт ли работа вообще. */
    this.lastFrameAt = 0
    /** Объявления о действиях: когда говорили последний раз и что именно. */
    this.lastActionAt = 0
    this.lastActionPhrase = null
    /** Номер последнего вызова инструмента и начало размышления: чтобы объявлять по разу. */
    this.lastCallId = null
    this.thinkingSince = 0
    this.announcedThinking = false
    this.fillersPlayed = 0
    this.lastSpokenAt = 0
    this.lastFillerAt = 0
    /**
     * Текст последнего ответа, собранный из живого потока.
     *
     * Зачем он нужен. Оператор отошёл, ответ прозвучал без него, и повторить чтение было
     * нечем: чтец отдаёт куски голосу и тут же про них забывает. Теперь весь текст хода
     * копится, а на закрытии запоминается последним ответом, который можно прочитать заново.
     */
    this.collected = ''
    this.lastAnswer = ''
    // ПИТОНА МОЖЕТ НЕ БЫТЬ ВОВСЕ (Ubuntu без python3, чужой профиль без PATH). Тогда не пытаемся
    // запускать процесс ни разу: причина записана, кнопка её покажет, и харнесс работает дальше.
    if (config.pythonMissing === true) {
      this.lastError = config.pythonReason !== undefined
        ? `голос недоступен: ${config.pythonReason}`
        : `не найден ${config.pythonPath} — поставьте Python 3.11+ `
          + '(в Ubuntu: sudo apt install python3) или задайте DSH_VOICE_PYTHON'
      this.retryAfter = Number.POSITIVE_INFINITY
    }
  }

  /**
   * Отправить запрос голосовому процессу, пережив мёртвую трубу.
   *
   * ПОЧЕМУ ЭТО НЕ ОСТОРОЖНОСТЬ, А ОБЯЗАННОСТЬ. Я сам убил голосовой процесс снаружи, чтобы он
   * взял свежий код, и запись в его вход уронила **весь харнесс**:
   * `dsh: fatal uncaught exception: Error: write EPIPE at VoiceStream.begin`. Ошибка потока это
   * не исключение метода, а событие `error`, и без обработчика оно валит процесс. Поэтому:
   * проверяем, что вход ещё жив, ловим ошибку, забываем процесс (следующая фраза поднимет новый)
   * и говорим об этом в журнал.
   *
   * @param request - то, что уходит голосу строкой JSON.
   * @returns ушло ли.
   */
  send(request) {
    const child = this.child
    if (child === null || child.stdin === undefined || child.stdin === null || child.stdin.writable !== true) {
      this.onLog('voice-stream: голосовой процесс недоступен, подниму новый на следующей фразе')
      this.child = null
      return false
    }
    try {
      child.stdin.write(`${JSON.stringify(request)}\n`)
      return true
    } catch (error) {
      this.onLog(`voice-stream: запись голосу не удалась (${messageOf(error)}), подниму новый процесс`)
      this.child = null
      return false
    }
  }

  /** Запомнить кусок ответа для возможного повтора. */
  collect(text) {
    if (typeof text === 'string' && text !== '') this.collected += text
  }

  /** Ход закрылся: собранное становится «последним ответом». */
  finishTurn() {
    if (this.collected.trim() !== '') this.lastAnswer = this.collected
    this.collected = ''
    // ХОД ЗАКРЫВАЕТСЯ, И ЭТО ГЛАВНОЕ. Раньше здесь не сбрасывался `turn`, поэтому после первого
    // ответа такт считал, что работа продолжается, и подводки звучали в пустой комнате.
    this.turn = null
    this.lastFrameAt = 0
  }

  /** Есть ли что повторять. */
  get hasLast() {
    return this.lastAnswer.trim() !== ''
  }

  /**
   * Прочитать последний ответ заново.
   *
   * Идём ТЕМ ЖЕ путём, что и вживую: `begin`, потом по куску, потом остаток. Поэтому повтор
   * звучит так же, как звучал ответ, и не заводит второго способа нарезки, который однажды
   * разойдётся с первым.
   */
  repeat() {
    if (!this.hasLast) return { ok: false, error: 'повторять нечего: в этой сессии ответа ещё не было' }
    this.begin()
    this.feed(this.lastAnswer)
    this.flush()
    return { ok: true, chars: this.lastAnswer.length }
  }

  start() {
    if (this.child !== null) return
    // ПОВТОРЫ НЕ КОПЯТСЯ. Если питона нет, каждый кусок ответа порождал бы новый сбойный запуск:
    // сотни попыток за один ответ. После сбоя ждём, а после «интерпретатора нет вовсе» не
    // пытаемся больше ни разу — это ждёт человека, а не времени.
    if (Date.now() < this.retryAfter) return
    const args = [this.config.streamPath, '--max-total', String(this.config.maxChars)]
    this.onLog(`voice-stream: поднимаю голос: ${this.config.pythonPath} ${args.join(' ')}`)
    let child = null
    try {
      child = spawn(this.config.pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          // Ударения расставляет голосовой процесс (ruaccent), а включает их эта переменная: одна
          // настройка в строке загрузчика, а не две в разных местах.
          DSH_VOICE_STRESS: this.config.stress === true ? '1' : '0',
        },
      })
    } catch (error) {
      // `spawn` бросает синхронно на неверных аргументах; `ENOENT` приходит событием ниже.
      this.noteStartFailure(null, error)
      return
    }
    this.child = child
    this.lastError = null
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
    // ОБОРОТ ВХОДА НЕ ДОЛЖЕН ВАЛИТЬ ХАРНЕСС. Процесс может умереть снаружи (его убивают, он
    // падает сам), и тогда запись в его вход это событие `error` на потоке. Без обработчика оно
    // становится фатальным для всего процесса: `dsh: fatal uncaught exception: write EPIPE`.
    child.stdin.on('error', (error) => {
      this.onLog(`voice-stream: вход голосового процесса оборвался (${messageOf(error)})`)
      if (this.child === child) this.child = null
    })
    // ЗАПУСК ПРОЦЕССА ТОЖЕ МОЖЕТ НЕ СОСТОЯТЬСЯ, И ЭТО НЕ ПОВОД РОНЯТЬ ХАРНЕСС. Без обработчика
    // `'error'` у ChildProcess становится `uncaughtException` и завершает процесс целиком: на
    // Ubuntu 24.04 установка плагина давала `dsh: fatal uncaught exception: Error: spawn python
    // ENOENT`, и падал весь `dsh web`. Случай `EPIPE` ниже был закрыт, случай «процесса нет» — нет.
    child.on('error', (error) => {
      this.noteStartFailure(child, error)
    })
    child.on('close', (code) => {
      if (this.child === child) this.child = null
      this.onLog(`voice-stream: голосовой процесс закрылся (код ${code})`)
    })
  }

  /**
   * Запомнить, что голос не поднялся: причину для кнопки и паузу для повторов.
   *
   * @param child - процесс, который не поднялся (может быть null при синхронном отказе).
   * @param error - ошибка запуска.
   */
  noteStartFailure(child, error) {
    if (child === null || this.child === child) this.child = null
    this.startFailures += 1
    const reason = messageOf(error)
    this.lastError = `голос не поднялся: ${reason}`
    // ENOENT значит «интерпретатора нет вовсе»: повторять каждую фразу бессмысленно, а иногда и
    // вредно (сто попыток запуска на один ответ). Ждём человека, а не времени.
    const waitMs = error?.code === 'ENOENT' ? Number.POSITIVE_INFINITY : 5000
    this.retryAfter = waitMs === Number.POSITIVE_INFINITY ? waitMs : Date.now() + waitMs
    const waitText = waitMs === Number.POSITIVE_INFINITY
      ? 'повторю только после правки настроек'
      : `следующая попытка через ${Math.round(waitMs / 1000)} с`
    this.onLog(`voice-stream: ${this.lastError} (${waitText})`)
  }

  /**
   * Новый ответ начался: сказать голосу, что это новый ответ.
   *
   * НЕДОГОВОРЁННОЕ НЕ ВЫБРАСЫВАЕМ. Раньше здесь стояло `this.buffer = ''`, и на каждом новом
   * шаге (а шаг это новая попытка того же хода) накопленный хвост предложения пропадал: если
   * фраза начиналась в одном шаге и кончалась в другом, середина не звучала вовсе. Оператор
   * услышал ровно это: «между двумя латиницами теряется текст». Теперь чистится только счётчик
   * предохранителя, а хвост остаётся и звучит вместе со следующим куском.
   */
  begin() {
    this.spoken = 0
    this.start()
    this.send({ command: 'begin', chunks: 0, chars: 0 })
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
    this.send({ id, text: piece })
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
    this.send({ command: 'filler', id, which })
  }

  /**
   * Сказать, чем занят: «Читаю файл», «Ищу по коду», «Обдумываю».
   *
   * ЧАСТОТА ЗДЕСЬ ГЛАВНОЕ. Осмысленная фраза полезна, а поток фраз — та же болтовня, только
   * умнее. Поэтому: не чаще одной фразы в `actionGapMs` и не чаще повтора одной и той же фразы
   * в `actionRepeatMs`. Признак `announceActions` выключает объявления целиком.
   *
   * @param phrase - короткая фраза для голоса.
   * @returns сказали ли.
   */
  action(phrase) {
    if (this.config.announceActions !== true) return false
    if (typeof phrase !== 'string' || phrase.trim() === '') return false
    const now = Date.now()
    if (now - this.lastActionAt < this.config.actionGapMs) return false
    if (phrase === this.lastActionPhrase && now - this.lastActionAt < this.config.actionRepeatMs) return false
    this.lastActionAt = now
    this.lastActionPhrase = phrase
    this.onLog(`voice-stream: объявляю действие: ${phrase}`)
    this.say(phrase)
    return true
  }

  /** Сказать служебную фразу, которую нужно синтезировать: например про ожидание. */
  announce(text) {
    if (typeof text !== 'string' || text.trim() === '') return
    this.onLog(`voice-stream: объявляю ожидание: ${text}`)
    this.say(text)
  }

  /** Начался новый ход: считаем подводки заново, копилку текста чистим. */
  startTurn(turn) {
    this.turn = turn
    this.lastFrameAt = Date.now()
    this.fillersPlayed = 0
    this.lastSpokenAt = Date.now()
    this.lastFillerAt = 0
    this.collected = ''
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
    // ТИШИНА ЗНАЧИТ ТИШИНА. Оператор услышал «понял, работаю» и «работаю, подожди» уже после того,
    // как ответ кончился и работа встала: ход не закрывался, и такт продолжал болтать. Теперь
    // подводка возможна только пока из потока идут кадры: нет кадров давно — нет и слов.
    const now = Date.now()
    if (this.lastFrameAt === 0 || now - this.lastFrameAt > this.config.workQuietMs) {
      return 'кадров нет: молчу'
    }
    if (this.fillersPlayed >= this.config.maxFillersPerTurn) return 'лимит подводок'
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
    const child = this.child
    if (child === null) return
    this.onLog(reason)
    // Тоже через `send`: прощание с уже умершим процессом не должно бросать исключение.
    if (!this.send({ command: 'quit' })) {
      try {
        child.kill()
      } catch {
        // Процесс уже мёртв, убивать нечего.
      }
    }
    this.child = null
  }
}

/**
 * Имена интерпретатора по умолчанию, в порядке предпочтения.
 *
 * НА UBUNTU НЕТ КОМАНДЫ `python`. Debian и Ubuntu поставляют только `python3`, и `spawn('python')`
 * падает там с `ENOENT`: плагин, который «работает на Windows», на Linux не запускался вовсе.
 * Поэтому имён два, и порядок зависит от платформы.
 *
 * @param platform - `process.platform`.
 * @returns имена для поиска в PATH, лучшее первым.
 */
export function defaultPythonNames(platform = process.platform) {
  return platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
}

/**
 * Найти команду в PATH: полный путь или `null`.
 *
 * Расширения проверяем тоже: на Windows `python` лежит как `python.exe`, и без PATHEXT поиск не
 * нашёл бы ничего. Пустые каталоги пропускаем: пустой элемент PATH значит текущий каталог, а искать
 * интерпретатор в текущем каталоге небезопасно.
 *
 * @param command - имя команды.
 * @param env - окружение, откуда берём PATH.
 * @param platform - платформа, чтобы знать разделитель и расширения.
 * @returns путь к найденному файлу или null.
 */
export function findOnPath(command, env = process.env, platform = process.platform) {
  const separator = platform === 'win32' ? ';' : ':'
  const extensions = platform === 'win32'
    ? String(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter((item) => item !== '')
    : ['']
  for (const directory of String(env.PATH ?? env.Path ?? '').split(separator)) {
    if (directory.trim() === '') continue
    for (const extension of ['', ...extensions]) {
      const candidate = join(directory, command + extension)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * Какой питон запускать.
 *
 * Явно заданное (`pythonPath` в строке загрузчика или `DSH_VOICE_PYTHON`) не переопределяем
 * никогда: человек сказал — значит сказал. Если не задано, ищем по платформе и говорим, что нашли.
 * Когда не нашли ничего, возвращаем имя первого кандидата и признак `missing`: плагин должен
 * отказать словами, а не молчанием.
 *
 * @param options - `configured` из настроек, окружение и платформа.
 * @returns команда, объяснение и признак «не найден».
 */
export function resolveInterpreter({ configured = '', env = process.env, platform = process.platform } = {}) {
  const explicit = String(configured ?? '').trim() || String(env.DSH_VOICE_PYTHON ?? '').trim()
  if (explicit !== '') return { command: explicit, source: 'задано настройкой или DSH_VOICE_PYTHON' }
  const names = defaultPythonNames(platform)
  for (const name of names) {
    const found = findOnPath(name, env, platform)
    if (found !== null) return { command: found, source: `нашёл ${name} в PATH` }
  }
  return {
    command: names[0],
    source: `не найден ни ${names.join(', ни ')}`,
    missing: true,
  }
}

/**
 * Настройки, которые нельзя записать в опубликованный слой.
 *
 * ПЛАГИН-СЛОЙ НЕ МОЖЕТ НЕСТИ МАШИННЫЕ ПУТИ. Пока пакет ставился своим установщиком, слой писал
 * сам установщик, и пути к питону и к голосовому процессу лежали в нём. Когда пакет становится
 * plugin-bundle, слой едет вместе с пакетом в общий репозиторий, и чужих путей там быть не
 * должно. Поэтому: путь ищется в строке настроек, потом в окружении, а потом рядом с самим
 * пакетом (у него внутри лежит папка `runtime`). Пустой настройки больше не бывает.
 *
 * @param raw - то, что стоит в строке загрузчика.
 * @returns полная конфигурация.
 */
export function validateConfig(raw) {
  const config = { ...DEFAULTS, ...(raw ?? {}) }
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  if (typeof config.streamPath !== 'string' || config.streamPath.trim() === '') {
    config.streamPath = config.streamPath || process.env.DSH_VOICE_STREAM
      || join(packageRoot, 'runtime', 'say_stream.py')
  }
  if (!isAbsolute(config.streamPath)) {
    throw new Error(`voice-stream: streamPath must be absolute: ${String(config.streamPath)}`)
  }
  if (!existsSync(config.streamPath)) {
    throw new Error(`voice-stream: streamPath does not exist: ${String(config.streamPath)}. `
      + 'Ожидается файл runtime/say_stream.py внутри установленного пакета; если путь задан '
      + 'настройкой, проверьте его.')
  }
  // ОТСУТСТВИЕ ПИТОНА ЭТО НЕ ОШИБКА НАСТРОЙКИ. Раньше здесь выбиралось между «`python` в PATH» и
  // падением, и пустая настройка на Ubuntu приводила к `spawn python ENOENT`, который валил весь
  // харнесс. Теперь плагин поднимается всегда, а отказывает только голос: словами и с причиной.
  const resolved = resolveInterpreter({ configured: config.pythonPath })
  const python = String(resolved.command)
  const looksLikePath = /[\\/]/u.test(python)
  let missing = resolved.missing === true
  let reason = resolved.source
  if (!missing && looksLikePath && !isAbsolute(python)) {
    // Относительный путь с разделителем (`./venv/bin/python`) это всегда опечатка.
    throw new Error(`voice-stream: pythonPath must be absolute: ${python}`)
  }
  if (!missing && looksLikePath && !existsSync(python)) {
    // ПУТЬ ЗАДАН, НО ЕГО НЕТ. Это не ошибка настройки, а отсутствие голоса: плагин обязан
    // подняться, чтобы кнопка в панели сказала человеку причину. Раньше здесь было исключение —
    // и при `DSH_VOICE_PYTHON=/nonexistent` мод не поднимался вовсе, вместе с кнопкой.
    missing = true
    reason = `заданный путь не существует: ${python}`
  }
  config.pythonPath = python
  config.pythonSource = reason
  config.pythonMissing = missing
  if (missing) config.pythonReason = reason
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
  // ЧТО НАШЛИ, ТЕМ И ГОВОРИМ. Человек должен видеть в журнале, каким питоном плагин собирается
  // читать, и почему не будет — до того, как решит, что «голос сломан».
  ctx.logger?.info?.(`voice-stream: питон для голоса: ${config.pythonPath} (${config.pythonSource ?? 'задано'})`)
  if (config.pythonMissing === true) {
    ctx.logger?.warn?.(`voice-stream: ${voice.lastError}. Плагин работает, чтение вслух — нет.`)
  }

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
      voice.lastFrameAt = Date.now()
      if (voice.turn !== frame.turn) {
        voice.startTurn(frame.turn)
        voice.lastCallId = null
        voice.thinkingSince = 0
        voice.announcedThinking = false
        toolArguments = ''
        announcedWaits = new Set()
        if (config.fillers) voice.filler(1)
      }
      voice.begin()
      return
    }
    if (frame.type === 'chunk') {
      const chunk = frame.chunk
      voice.lastFrameAt = Date.now()
      // Читаем ровно видимый ответ: размышления и вызовы инструментов вслух не нужны.
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        voice.feed(chunk.text)
        voice.collect(chunk.text)
        voice.lastSpokenAt = Date.now()
        return
      }
      // ДОЛГОЕ РАЗМЫШЛЕНИЕ СТОИТ НАЗВАТЬ. Первые секунды молчания закрывает подводка из кэша,
      // но когда анализ идёт долго, человек хочет знать, что это анализ, а не зависание.
      if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text.trim() !== '') {
        if (voice.thinkingSince === 0) voice.thinkingSince = Date.now()
        if (!voice.announcedThinking && Date.now() - voice.thinkingSince > voice.config.thinkingAfterMs) {
          voice.announcedThinking = true
          voice.action('Обдумываю задачу')
        }
        return
      }
      if (chunk?.type === 'tool-call-delta' && typeof chunk.argumentsDelta === 'string') {
        // ИМЯ ИНСТРУМЕНТА ПРИХОДИТ В ПЕРВОМ КАДРЕ ВЫЗОВА, и по нему мы говорим, чем заняты:
        // «Читаю файл», «Ищу по коду», «Выполняю команду». Оператор просил именно это вместо
        // бессмысленных «смотрю» и «понял, работаю».
        if (typeof chunk.name === 'string' && chunk.id !== voice.lastCallId) {
          voice.lastCallId = chunk.id
          voice.action(describeAction(chunk.name))
        }
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
      // Ход закрылся: то, что собрано из потока, становится последним ответом и его можно
      // прочитать заново кнопкой (оператор отошёл, а ответ прозвучал без него).
      voice.finishTurn()
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
        /** Снимок для кнопок: состояние голоса и есть ли что повторять. */
        const snapshot = () => ({
          on: readVoiceOn(statePath),
          hasLast: voice.hasLast,
          lastChars: voice.lastAnswer.length,
          statePath,
          // ПОЧЕМУ МОЛЧИТ. Кнопка показывает это человеку вместо тишины: «не найден python3 —
          // поставьте Python 3.11+ или задайте DSH_VOICE_PYTHON».
          voiceError: voice.lastError,
          pythonPath: config.pythonPath,
          pythonSource: config.pythonSource ?? null,
        })
        if (request.method === 'GET') return json(snapshot())
        let payload = null
        try {
          payload = await request.json()
        } catch {
          return json({ ok: false, error: 'тело запроса должно быть JSON' }, 400)
        }
        // ПОВТОР ЧТЕНИЯ. Оператор отошёл, ответ прозвучал без него; теперь его можно
        // прочитать заново тем же путём, каким он читался вживую.
        if (payload?.repeat === true) {
          const outcome = voice.repeat()
          if (!outcome.ok) return json({ ...snapshot(), ok: false, error: outcome.error }, 409)
          ctx.logger?.info?.(`voice-stream: повторяю последний ответ (${outcome.chars} знаков)`)
          return json({ ...snapshot(), ok: true, chars: outcome.chars })
        }
        if (typeof payload?.on !== 'boolean') {
          return json({ ok: false, error: 'нужно поле on: true или false, либо repeat: true' }, 400)
        }
        try {
          writeVoiceOn(statePath, payload.on)
        } catch (error) {
          return json({ ok: false, error: `переключатель не записался: ${messageOf(error)}` }, 500)
        }
        ctx.logger?.info?.(`voice-stream: голос ${payload.on ? 'включён' : 'выключен'} кнопкой в панели`)
        return json(snapshot())
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
