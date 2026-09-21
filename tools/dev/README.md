# Development & verification tools

**English** · [Русский](#русский)

These scripts were used to build and verify the mods. They are not needed to
install or use them.

| Script | Purpose | Needs |
|---|---|---|
| `test-host.mjs` | 11 checks on the prompt mod's host half, against the real `renderPrompt` | Harness packages resolvable |
| `test-client.mjs` | 6 checks on the prompt mod's browser bundle, with stub React and primitives | Node only |
| `test-locale-ru.mjs` | Verifies the language pack's contract and full key coverage | Node only |
| `test-links.mjs` | Checks every relative link and `#anchor` in the repository's Markdown | Node only |
| `scan-secrets.mjs` | Looks for secrets in tracked names, in every blob (unreachable ones included) and on disk | Node, git |
| `verify-live.mjs` | End-to-end HTTP checks against a running instance: boot graph, the translations actually served, the prompt route's documented shape | Node, a running `dsh web` |
| `test-mod-manager.mjs` | 27 checks on the mod manager's host half: patch parsing, the actions, and every refusal | Node only |
| `test-mod-manager-client.mjs` | 13 checks on the mod manager's browser bundle, with a React stub that honours hook dependencies | Node only |
| `push-mirrors.mjs` | Pushes to every published mirror and says which ones it could not reach | Node, git, tokens in files |
| `link-dsh.mjs` | Links the repository to a harness installation so `@deepseek-ai/*` resolves for the unit tests | A harness home |
| `ui-check.mjs` | Renders the real GUI in headless Edge over CDP, opens a session, clicks the prompt control, screenshots | Windows, Edge, a running `dsh web` |
| `ui-locale.mjs` | Same harness: opens Settings, switches the language, screenshots | Windows, Edge, a running `dsh web` |
| `verify-live.ps1` | End-to-end pass over the prompt mod's HTTP API on a running instance | PowerShell, a running `dsh web` |
| `picker-extract.mjs` | Extracts the one dictionary the main extractor cannot follow (registered in a loop) | A harness installation |
| `locale-chunk.mjs` | Splits extracted dictionaries into balanced work groups for translation | A `locale-en.json` |
| `restart-web.mjs` | Restarts the `dsh web` process that owns a port; written for one machine, adapt the paths at the top | Windows |

### Live checks and the shared cookie helper

`verify-live.mjs` answers what `tools/boot-check.mjs` does not: whether the
served bundle really carries the translations, and whether the prompt route
answers with the shape its README documents. It reproduces rows 7, 12 and 18 of
[`docs/VERIFICATION.md`](../../docs/VERIFICATION.md) from a fresh clone — that
table used to cite one-off scripts that lived outside the repository.

Both it and `boot-check.mjs` mint the browser-session cookie through
`tools/lib/session-cookie.mjs`, so the credential handling has one source of
truth. The secret is read from `$DSH_HOME` and never printed.

`scan-secrets.mjs` is what makes the "no secrets" claim checkable rather than
asserted. It fails on a key shape, on a `.env` that got tracked, and — the case
that matters — on a secret that was committed and then deleted, because the blob
is still in the object database. It scans unreachable blobs too, since
`git push --mirror` would send those. Without git it reports `PARTIAL` and exits
2 rather than claiming a clean result it did not establish.

### The unit tests and harness packages

`test-host.mjs` imports `@deepseek-ai/dsh-system-prompt` to exercise the real
prompt assembly, so it needs the harness packages reachable from the repository.
One command creates that link (a junction on Windows, a symlink elsewhere):

```bash
node tools/dev/link-dsh.mjs
node tools/dev/test-host.mjs
```

The link lands in `node_modules/`, which git ignores. It is not needed for
`test-client.mjs`, `test-locale-ru.mjs`, `test-links.mjs` or `scan-secrets.mjs`,
and never for installing or using the mods.

`test-host.mjs` also writes: it points `DSH_HOME` at `tools/dev/_testhome-host/`,
wipes it, and lets the host half create its state file there. That directory is
inside the checkout but matches the `_testhome*/` rule in
[`.gitignore`](../../.gitignore), so it never shows up in `git status`.

### The link check

`test-links.mjs` reads every `.md` file in the repository and fails on a relative
path that does not exist and on a `#anchor` that no heading produces. It never
touches the network, so it runs in CI next to the other Node-only checks. It was
written after a public-facing review pointed out that a reader follows a
repository through its links; the first version of the checker was itself broken
by CRLF line endings and reported nine false failures, which is why the file
carries a comment about it.

### The browser checks

`ui-check.mjs` and `ui-locale.mjs` drive a headless Edge over the DevTools
Protocol, so they need Windows, Edge, and a running `dsh web`. What they assume:

| | Value |
|---|---|
| server | `http://127.0.0.1:3080` unless you pass a URL as the first argument |
| Harness home | `$DSH_HOME`, else `~/.dsh` — they read its browser-session secret |
| screenshots | `%TEMP%\dsh-mod-shots` (override with `DSH_SHOTS`), so a run never dirties the checkout |
| Edge profile | a throwaway directory next to the script, removed at start and left after the run |

Start your own server for them if you would rather not touch a live one — the
launch recipe is in [`docs/AI-INSTALL.md`](../../docs/AI-INSTALL.md) Step 4.

`restart-web.mjs` and `verify-live.ps1` carry machine-specific paths and ports;
read them before use.

The absolute paths inside `ui-check.mjs`, `ui-locale.mjs`, `restart-web.mjs`,
`picker-extract.mjs` and `verify-live.ps1` are machine-specific: edit them before
reuse. The installer and the builders under `tools/` take no absolute paths.

---

## Русский

Эти скрипты использовались, чтобы собрать и проверить моды. Для установки и
работы самих модов они не нужны.

| Скрипт | Назначение | Что требуется |
|---|---|---|
| `test-host.mjs` | 11 проверок host-половины мода промпта на настоящем `renderPrompt` | Пакеты харнесса должны резолвиться |
| `test-client.mjs` | 6 проверок браузерного бандла мода промпта на заглушках React и примитивов | Только Node |
| `test-locale-ru.mjs` | Проверка контракта языкового пакета и полного покрытия ключей | Только Node |
| `test-links.mjs` | Проверяет все относительные ссылки и `#якоря` в markdown репозитория | Только Node |
| `scan-secrets.mjs` | Ищет секреты в именах файлов git, во всех блобах (включая недостижимые) и на диске | Node, git |
| `verify-live.mjs` | Сквозные HTTP-проверки живого инстанса: boot-граф, реально отдаваемые переводы, документированная форма роута промпта | Node, запущенный `dsh web` |
| `test-mod-manager.mjs` | 27 проверок host-половины менеджера модов: разбор патча, действия и все отказы | Только Node |
| `test-mod-manager-client.mjs` | 13 проверок браузерного бандла менеджера, на заглушке React, которая уважает зависимости хуков | Только Node |
| `push-mirrors.mjs` | Пушит во все зеркала и сообщает, до каких не добрался | Node, git, токены в файлах |
| `link-dsh.mjs` | Привязывает репозиторий к установке харнесса, чтобы юнит-тесты видели `@deepseek-ai/*` | Домашний каталог харнесса |
| `ui-check.mjs` | Отрисовка настоящей GUI в headless Edge по CDP: открыть сессию, нажать кнопку промпта, снять скриншоты | Windows, Edge, запущенный `dsh web` |
| `ui-locale.mjs` | Тот же стенд: открыть настройки, переключить язык, снять скриншоты | Windows, Edge, запущенный `dsh web` |
| `verify-live.ps1` | Сквозной прогон HTTP-API мода промпта на живом инстансе | PowerShell, запущенный `dsh web` |
| `picker-extract.mjs` | Извлекает единственный словарь, который не берёт основной извлекатель (он регистрируется в цикле) | Установленный харнесс |
| `locale-chunk.mjs` | Нарезает извлечённые словари на сбалансированные группы для перевода | Файл `locale-en.json` |
| `restart-web.mjs` | Перезапускает процесс `dsh web`, владеющий портом; написан под одну машину — поправь пути в начале файла | Windows |

### Живые проверки и общий помощник для cookie

`verify-live.mjs` отвечает на то, на что не отвечает `tools/boot-check.mjs`:
действительно ли отдаваемый бандл несёт переводы и отвечает ли роут промпта
той формой, что описана в его README. Он воспроизводит строки 7, 12 и 18 из
[`docs/VERIFICATION.ru.md`](../../docs/VERIFICATION.ru.md) прямо из свежего
клона — раньше эта таблица ссылалась на разовые скрипты вне репозитория.

И он, и `boot-check.mjs` выпускают cookie браузерной сессии через
`tools/lib/session-cookie.mjs`, поэтому работа с этим секретом имеет один
источник истины. Секрет читается из `$DSH_HOME` и нигде не печатается.

`scan-secrets.mjs` превращает утверждение «секретов нет» из заявления в
проверяемый факт. Он падает на форме ключа, на попавшем в git `.env` и — на
самом важном случае — на секрете, который закоммитили, а потом удалили: блоб
всё ещё лежит в базе объектов. Недостижимые блобы тоже сканируются, потому что
`git push --mirror` отправил бы и их. Без git он сообщает `PARTIAL` и выходит с
кодом 2, а не заявляет чистый результат, которого не устанавливал.

### Юнит-тесты и пакеты харнесса

`test-host.mjs` импортирует `@deepseek-ai/dsh-system-prompt`, чтобы работать с
настоящей сборкой промпта, поэтому пакеты харнесса должны быть видны из
репозитория. Одна команда создаёт нужную ссылку (junction в Windows, symlink в
остальных системах):

```bash
node tools/dev/link-dsh.mjs
node tools/dev/test-host.mjs
```

Ссылка появляется в `node_modules/`, который git игнорирует. Для
`test-client.mjs`, `test-locale-ru.mjs`, `test-links.mjs` и `scan-secrets.mjs`
она не нужна — как и для установки и использования самих модов.

`test-host.mjs` ещё и пишет на диск: он направляет `DSH_HOME` в
`tools/dev/_testhome-host/`, очищает его и даёт host-половине создать там свой
файл состояния. Каталог лежит внутри репозитория, но подпадает под правило
`_testhome*/` в [`.gitignore`](../../.gitignore), поэтому в `git status` не
появляется.

### Проверка ссылок

`test-links.mjs` читает все `.md` файлы репозитория и падает, если
относительный путь не существует или `#якорь` не соответствует ни одному
заголовку. В сеть он не ходит, поэтому в CI работает рядом с остальными
проверками, которым нужен только Node. Он появился после ревизии, указавшей,
что читатель идёт по репозиторию через ссылки; первая версия самого чекера
ломалась на переводах строк CRLF и выдала девять ложных срабатываний — поэтому
в файле про это есть комментарий.

### Браузерные проверки

`ui-check.mjs` и `ui-locale.mjs` управляют headless Edge по DevTools Protocol,
поэтому им нужны Windows, Edge и запущенный `dsh web`. Что они предполагают:

| | Значение |
|---|---|
| сервер | `http://127.0.0.1:3080`, если не передать URL первым аргументом |
| домашний каталог | `$DSH_HOME`, иначе `~/.dsh` — оттуда берётся секрет браузерной сессии |
| скриншоты | `%TEMP%\dsh-mod-shots` (переопределяется через `DSH_SHOTS`), поэтому запуск не пачкает репозиторий |
| профиль Edge | временный каталог рядом со скриптом: чистится при старте, остаётся после запуска |

Если не хочется трогать живой сервер — подними свой: рецепт запуска в
[`docs/AI-INSTALL.ru.md`](../../docs/AI-INSTALL.ru.md), шаг 4.

`restart-web.mjs` и `verify-live.ps1` содержат машинно-зависимые пути и порты —
читай их перед использованием.
