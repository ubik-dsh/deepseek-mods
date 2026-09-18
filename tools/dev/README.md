# Development & verification tools

**English** · [Русский](#русский)

These scripts were used to build and verify the mods. They are not needed to
install or use them.

| Script | Purpose | Needs |
|---|---|---|
| `test-host.mjs` | 11 checks on the prompt mod's host half, against the real `renderPrompt` | DSH packages resolvable |
| `test-client.mjs` | 6 checks on the prompt mod's browser bundle, with stub React and primitives | Node only |
| `test-locale-ru.mjs` | Verifies the language pack's contract and full key coverage | Node only |
| `link-dsh.mjs` | Links the repository to a DSH installation so `@deepseek-ai/*` resolves for the unit tests | A DSH home |
| `ui-check.mjs` | Renders the real GUI in headless Edge over CDP, opens a session, clicks the prompt control, screenshots | Windows, Edge, a running `dsh web` |
| `ui-locale.mjs` | Same harness: opens Settings, switches the language, screenshots | Windows, Edge, a running `dsh web` |
| `verify-live.ps1` | End-to-end pass over the prompt mod's HTTP API on a running instance | PowerShell, a running `dsh web` |
| `picker-extract.mjs` | Extracts the one dictionary the main extractor cannot follow (registered in a loop) | A DSH installation |
| `locale-chunk.mjs` | Splits extracted dictionaries into balanced work groups for translation | A `locale-en.json` |
| `restart-web.mjs` | Restarts the `dsh web` process that owns a port; written for one machine, adapt the paths at the top | Windows |

### The unit tests and DSH packages

`test-host.mjs` imports `@deepseek-ai/dsh-system-prompt` to exercise the real
prompt assembly, so it needs the DSH packages reachable from the repository.
One command creates that link (a junction on Windows, a symlink elsewhere):

```bash
node tools/dev/link-dsh.mjs
node tools/dev/test-host.mjs
```

The link lands in `node_modules/`, which git ignores. It is not needed for
`test-client.mjs` or `test-locale-ru.mjs`, and never for installing or using the
mods.

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
| `test-host.mjs` | 11 проверок host-половины мода промпта на настоящем `renderPrompt` | Пакеты DSH должны резолвиться |
| `test-client.mjs` | 6 проверок браузерного бандла мода промпта на заглушках React и примитивов | Только Node |
| `test-locale-ru.mjs` | Проверка контракта языкового пакета и полного покрытия ключей | Только Node |
| `link-dsh.mjs` | Привязывает репозиторий к установке DSH, чтобы юнит-тесты видели `@deepseek-ai/*` | Домашний каталог DSH |
| `ui-check.mjs` | Отрисовка настоящей GUI в headless Edge по CDP: открыть сессию, нажать кнопку промпта, снять скриншоты | Windows, Edge, запущенный `dsh web` |
| `ui-locale.mjs` | Тот же стенд: открыть настройки, переключить язык, снять скриншоты | Windows, Edge, запущенный `dsh web` |
| `verify-live.ps1` | Сквозной прогон HTTP-API мода промпта на живом инстансе | PowerShell, запущенный `dsh web` |
| `picker-extract.mjs` | Извлекает единственный словарь, который не берёт основной извлекатель (он регистрируется в цикле) | Установленный DSH |
| `locale-chunk.mjs` | Нарезает извлечённые словари на сбалансированные группы для перевода | Файл `locale-en.json` |
| `restart-web.mjs` | Перезапускает процесс `dsh web`, владеющий портом; написан под одну машину — поправь пути в начале файла | Windows |

### Юнит-тесты и пакеты DSH

`test-host.mjs` импортирует `@deepseek-ai/dsh-system-prompt`, чтобы работать с
настоящей сборкой промпта, поэтому пакеты DSH должны быть видны из
репозитория. Одна команда создаёт нужную ссылку (junction в Windows, symlink в
остальных системах):

```bash
node tools/dev/link-dsh.mjs
node tools/dev/test-host.mjs
```

Ссылка появляется в `node_modules/`, который git игнорирует. Для
`test-client.mjs` и `test-locale-ru.mjs` она не нужна — как и для установки и
использования самих модов.

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
