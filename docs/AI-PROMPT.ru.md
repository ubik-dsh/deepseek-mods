# Промпт для ИИ — создать мод для харнесса

[English](AI-PROMPT.md) · **Русский**

Этот файл — одновременно **промпт** и **справочник**. Чтобы ИИ сделал мод,
вставь в диалог всё, что ниже черты (или просто скажи агенту, работающему в
этом репозитории, прочитать этот файл). [AGENTS.md](../AGENTS.md) ссылается
сюда автоматически.

---

## Задача

Ты добавляешь плагин («мод») в **харнесс агентов**,
браузерный интерфейс которого отдаёт `dsh web`. Работай в установке самого
пользователя: исследуй её, собери пакет, установи и **докажи, что он работает**.

Два правила важнее остальных:

- **Никогда не правь установку харнесса.** Моды — отдельные пакеты, которые ставятся в
  домашний каталог харнесса.
- **Проверяй фактами.** Никогда не отчитывайся об успехе, опираясь только на
  чтение кода. Запусти проверку и прочитай её вывод.

## Фаза 0 — разведка (не пропускать, не угадывать)

Всё нужное читается прямо в установленных пакетах. Это собранный JavaScript
плюс декларации `.d.ts` и README — исходников TypeScript там нет.

```bash
echo "$DSH_HOME"                       # пусто → ~/.dsh
ls "$DSH_HOME/profiles"                # профили; `web` — браузерный интерфейс
ls "$DSH_HOME/profiles/node_modules/@deepseek-ai"   # ~240 пакетов плагинов
```

Ответь на эти вопросы **по коду**, цитируя найденное:

1. **Куда относится моя задача?** См. таблицу точек расширения в фазе 1.
2. **Каков точный API?** Читай `lib/types/*.d.ts` (декларации) и
   `lib/index.js` / `lib/client.js` (реализации). И то и другое читаемо.
3. **Какие есть имена сервисов и слотов?** Имена сервисов — из блоков
   `declare module '@deepseek-ai/cordis'` в `.d.ts`. Имена слотов видны в любом
   плагине, который их использует:

   ```bash
   # все слоты, в которые регистрируются штатные плагины
   grep -rho 'slots\.inject(\s*"[^"]*"' "$DSH_HOME"/profiles/node_modules/@deepseek-ai/*/lib/client.js
   ```

   Полный объявленный каталог лежит в `dsh-cordis-client-runner` (константа
   `CLIENT_SLOT_API` в его `lib/client.js`).
4. **Найди штатный плагин, который делает похожее**, и повтори его форму. Это
   самый выгодный ход: `dsh-session-log-export` показывает роут на хосте плюс
   контрол в шапке плюс модальное окно; `dsh-client-ui-jobs` — минимальную
   регистрацию в слоте шапки.

Перед написанием кода доложи находки. Если API проверить не удалось — так и
скажи и укажи, чего не хватает. Не выдумывай сигнатуры.

## Фаза 1 — выбрать точку расширения

| Что нужно | Механизм | Где работает |
|---|---|---|
| Кнопка, панель, вкладка или окно в GUI | **клиентский слот** (`ctx.slots`) | браузер |
| То, что может вызвать *агент* (инструмент) | регистрация схемы инструмента и обработчика | хост |
| Текст, добавляемый в системный промпт | `ctx.systemPrompt.section()` | хост |
| Новый язык или переводы | `ctx.locale.addLanguage` / `.register` | браузер |
| Сохраняемые настройки | `ctx.settings.register(namespace, schema)` | хост |
| HTTP-эндпоинт для GUI | `ctx.connection.fetch.register()` | хост |
| Реакция на события агента, инструментов, сессии | `ctx.on(event, listener)` | хост или браузер |
| Дополнительные указания агенту | файл `AGENTS.md` в рабочем пространстве | — |

Самый частый запрос — «сделай кнопку в интерфейсе»: это клиентский слот плюс,
как правило, host-половина для связи.

## Фаза 2 — каркас пакета

Общий случай — пакет с двумя половинами:

```
my-mod/
  package.json
  lib/index.js     host-половина   (ESM, экспортирует apply/inject)
  lib/client.js    браузерная половина (отдаваемый бандл, см. фазу 3)
```

`package.json`:

```json
{
  "name": "@local/dsh-my-mod",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web"
    }
  }
}
```

- `dsh.client.platform` должен быть ровно `"web"`, и `exports["./client"]`
  должен существовать, иначе пакет молча выпадет из браузерного ростера.
- `dsh.client.inject` перечисляет **имена пакетов**, чьи бандлы должны прийти
  раньше (ребро порядка загрузки); `dsh.client.external` — небазовые
  спецификаторы модулей, которые запрашивает бандл. Ни то, ни другое не нужно,
  если бандл использует только базовые модули (фаза 3).
- Для локально установленного пакета оставляй `private: true`.

Host-половина (`lib/index.js`) — плагин Cordis:

```js
/** Имя плагина Cordis. */
export const name = 'my-mod'
/** Сервисы, которые должны существовать до вызова `apply`. */
export const inject = ['connection']
export function apply(ctx, config) { /* … */ }
```

У браузерной половины `inject` — **другой** список, см. ниже.

## Фаза 3 — браузерный бандл

Клиентская модульная система отдаёт файл `./client` пакета **как есть**; шага
сборки нет. Формат — регистрация лениво-CJS-фабрики:

```js
window.__ModuleLoader__.load({
  id: "@local/dsh-my-mod",            // ОБЯЗАН совпадать с именем пакета
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    /** Имена СЕРВИСОВ Cordis, нужных браузерной половине (не имена пакетов). */
    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "my-mod",
          inject: (sessionId) => ({ /* пропсы, передаваемые компоненту */ }),
        }, MyControl));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

**Базовые модули** — эти девять можно `require` без объявлений:

```
react · react/jsx-runtime · react-dom · react-dom/client
@deepseek-ai/cordis · @deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots · @deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-dockkit
```

Всё остальное даёт громкую ошибку «missed the module table»: объяви его в
`dsh.client.external` (спецификатор, обычно `<пакет>/client`) **и** в
`dsh.client.inject` (имя пакета).

### Регистрация в слоте

```js
ctx.slots.inject(slotName, () => ctx.slots.register(options, Component))
```

`inject` ждёт, пока слот объявят, и снимает твой вклад при выгрузке плагина;
`register` тоже привязан к эффекту плагина.

Кардинальность слота определяет обязательные опции (вид целевого слота проверь
по каталогу):

| Вид | Обязательные опции |
|---|---|
| `single` | — (заняв его, ты заменяешь штатного обитателя) |
| `list` | `id` (строка); необязательные `order`, `label` |
| `keyed` | `key` (строка) |
| `chain` | `select(owner)` |

Полезные проверенные слоты **страницы чата**:
`conversation.session.header.utilities` (действия шапки справа),
`conversation.session.header.actions`, `conversation.input.dock` (над
композером), `shell.overlay` (плавающий слой поверх приложения),
`settings.section` / `settings.general.item` (страницы настроек).
Никогда не регистрируйся в `root` — это `single`-слот, занятый каркасом
приложения.

Компонент в слоте получает стандартные пропсы сессии (`sessionId`,
`useProjection`, `t`, …) плюс то, что вернул твой `inject`.

### Примитивы (проверенные пропсы)

- `Modal` — `{ open, onClose, title, description, closeLabel, children, footer, className, contentClassName, headless }`; рендерится порталом в `document.body`, закрывается по Escape и клику по маске, при `open: false` не рендерит ничего.
- `Button` — `{ variant: 'ghost'|'outline'|'primary', size, icon, className, children, …rest }` (остальное уходит в `<button>`).
- `Switch` — `{ checked, onChange(next), label, disabled, title }`.
- `Tag` — `{ tone: 'neutral'|'solid', children }`; `Menu`, `Input`, `Tooltip`, `Pill`, иконки.
- **`Textarea` нет** — используй обычный `<textarea>`.

Штатная `Modal` шириной `min(380px, 100%)`. Чтобы изменить — передай
`className` и один раз внедри тег стиля (это штатный приём плагинов):

```js
const CSS = ".my-dialog{width:min(760px,100%) !important}";
if (typeof document !== "undefined"
    && document.querySelector('style[data-plugin-css="my-mod"]') === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@local/dsh-my-mod";
  tag.dataset.pluginCss = "my-mod";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
```

## Фаза 4 — связь между половинами

**Runtime-API «отдать метод хоста в браузер» не существует.** RPC
клиент→хост — это кодогенерация на этапе сборки, а генератор в поставку не
входит. Поэтому выбирай одно из:

1. **Свой аутентифицированный роут** (рекомендуется, без кодогенерации). Хост:

   ```js
   export const inject = ['connection']
   export function apply(ctx) {
     const dispose = ctx.connection.fetch.register({
       path: '/api/my-mod',                     // абсолютный, ниже /api
       methods: ['GET', 'POST'],
       requestBody: 'buffered',
       fetch: async (request) => new Response(JSON.stringify({ ok: true }), {
         headers: { 'content-type': 'application/json' },
       }),
     })
     ctx.effect(() => () => { void dispose() }, 'my-mod: route')
   }
   ```

   Браузер: обычный `fetch('/api/my-mod')` — cookie уже на месте. Именно так
   `dsh-session-log-export` стримит ZIP.

2. **Канал настроек**, если состояние *и есть* настройка:
   `ctx.settings.register(ns, schema, { applies: 'live' })` на хосте и уже
   скомпилированное пространство `remote.settings` в браузере. Хранится в
   `$DSH_HOME/settings.yaml`, применяется на лету.

3. **Написанный руками Remote-дескриптор**, если действительно нужно новое
   типизированное пространство. Возможно, но муторно: сначала прочитай
   дескрипторы `dsh-api-settings-controller`.

Вызов *существующего* скомпилированного remote из браузера идёт конвертом:

```
POST /api/<пространство>/<метод>
{ "type": "client-request", "rpcId": "<uuid>", "method": "<пространство>/<метод>",
  "payload": { "args": { … } } }
→ { "type": "server-response", "rpcId": "…", "result": { … } }
```

В payload должен быть ровно один plain-object `args`; имена аргументов обязаны
точно совпадать с дескриптором.

## Фаза 5 — проверенные API хоста

```js
// Упорядоченные секции промпта. `text` как ФУНКЦИЯ перечитывается при каждой
// сборке — именно это делает правку живой. `complete` читается при
// РЕГИСТРАЦИИ, поэтому его переключение — это dispose + повторная регистрация.
const dispose = ctx.systemPrompt.section({
  name: 'my-mod:section', order: 10300,
  text: () => myState.text, complete: false,
})

// Сборка в scope живого агента: именно там живут переменные {{model}} и
// {{cwd}} петли агента. `renderPrompt` — экспорт МОДУЛЯ, а не метод.
const agent = ctx.agents.get(sessionId)          // внимание: ctx.agents во МНОЖЕСТВЕННОМ
const assembly = await ctx.systemPrompt.assemble(agent ? { agent, scope: agent } : {})
const text = renderPrompt(assembly)               // падает на нерешённой {{переменной}}
```

```js
ctx.settings.register('my-mod', Schema.object({ … }), { applies: 'live' })
ctx.on('agent/created', ({ agent }) => { … })
ctx.effect(() => ctx.locale.register(ns, { zh, en }), 'dictionaries')
```

Локализация, если твоему интерфейсу нужны свои строки:

```js
export const inject = ['locale']
ctx.locale.register('myNamespace', { zh, en })          // штатные локали
ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })
ctx.locale.register('common', 'ja', { … })              // языковой пакет
```

## Фаза 6 — установить и проверить

Плагин — это пакет плюс **одна строка загрузчика** в слое патчей целевого
профиля (`$DSH_HOME/profiles/<профиль>/cordis.patch.yml`):

```yaml
- insert:
    - id: my-mod
      name: '@local/dsh-my-mod'
```

Скопируй пакет в `$DSH_HOME/profiles/node_modules/@local/<каталог>/` и добавь
строку — ровно это делает `tools/install.mjs` в этом репозитории, и он сам
находит пакеты в `packages/`.

Дальше проверяй в таком порядке:

1. **Юнит-тесты половин** без харнесса: выполни браузерный бандл с заглушкой
   `window.__ModuleLoader__`, заглушкой `require`, минимальным React и
   заглушками примитивов; проверь id записи, экспорты, регистрацию в слоте и
   дерево компонентов. Вызови host-половину с фальшивым `ctx` и пройди все
   ветки. Это отлавливает большинство ошибок до установки.
2. **Установи и проверь ростер** — `node tools/boot-check.mjs` (этот
   репозиторий) либо запроси `/` с cookie браузерной сессии и поищи имя своего
   пакета в отданном `__DSH_BOOT__`.
3. **Проверь роут хоста** — `GET /api/<твой путь>` должен отвечать.
4. **Отрисуй по-настоящему**, если есть браузер. В Windows headless Edge по
   DevTools Protocol работает без единой зависимости (в Node 24 есть глобальный
   `WebSocket`): поставь cookie через `Network.setCookie`, перейди на страницу,
   кликай настоящими событиями `Input.dispatchMouseEvent`, снимай
   `Page.captureScreenshot` и читай DOM через `Runtime.evaluate`.
   `tools/dev/ui-check.mjs` здесь — рабочий пример.

## Фаза 7 — правила, добытые на практике

1. **Правка загруженного пакета его не перезагружает.** Загрузчик импортирует
   модуль один раз на процесс, ключ — разрешённый URL, без cache-busting.
   Поэтому изменение файлов пакета требует перезапуска `dsh web`.
2. **Правки патча ведут себя по-разному** — все три случая проверены на живом
   сервере: *новая* строка монтируется на лету; *удалённая* строка снимается на
   лету, и отдаваемый boot-граф теряет её без перезапуска; *изменённая* строка
   **не** переимпортируется — подмена `name` на заведомо несуществующий
   спецификатор оставила старый роут отвечать `200`. Не планируй горячую подмену
   существующей записи: нужен перезапуск.
3. **`renderPrompt` падает на нерешённой `{{переменной}}`**, а синтаксиса
   экранирования в харнессе нет. Если пользователь может вводить текст промпта —
   валидируй его, иначе сломаешь каждый следующий запрос. В своём предпросмотре
   деградируй к мягкой подстановке вместо падения.
4. **Собирай текст промпта в scope агента.** Сборка без scope не имеет
   `{{model}}`/`{{cwd}}` и падает.
5. **`complete` читается при регистрации.** Чтобы переключить — перерегистрируй
   секцию, не пытайся менять поле.
6. **Бесплатны только девять базовых модулей.** Всё остальное требует
   `external` + `inject` в манифесте.
7. **`system-prompt/change` в браузер не форвардится**, а список форвардимых
   событий фиксирован на этапе сборки. Пусть браузер сам запрашивает состояние.
8. **`ctx.fs` — это песочница** и она запрещает запись вне рабочего пространства
   сессии. Для файла в домашнем каталоге харнесса используй обычный `node:fs`
   (host-плагин исполняется в Node) или `@deepseek-ai/dsh-atomic-write`.
9. **Никогда не перезапускай сервер пользователя без разрешения** и не убивай
   процесс, внутри которого работаешь. Отдай команду.
10. **Не коммить секреты.** В `$DSH_HOME/.credentials.yaml` ключи API и секрет
    подписи сессии; бэкап домашнего каталога может содержать личные настройки.
11. **Версионный дрейф реальность.** Харнесс до 1.0, его плагинные API меняются.
    Зафиксируй, на чём проверял, и делай отказ мягким: пропавший слот должен
    стоить пользователю функции, а не интерфейса.
12. **PowerShell 5.1 портит UTF-8**, когда скрипт использует `Get-Content -Raw`
    + `Set-Content`. Правь текстовые файлы инструментом, который понимает
    UTF-8, и после массовой перезаписи проверяй кодировку.

## Чек-лист результата

- [ ] Пакеты в `packages/`, у каждого `package.json` и обе половины.
- [ ] Браузерный бандл ровно в форме `window.__ModuleLoader__.load({ id, factory })`.
- [ ] Host-половина экспортирует `apply` и `inject`.
- [ ] README пакета на двух языках (английский `README.md`, русский `README.ru.md`).
- [ ] Ставится установщиком репозитория; в нём нет абсолютных путей.
- [ ] Юнит-тесты обеих половин проходят.
- [ ] Установлено в **чистый** домашний каталог и подтверждено в отданном
      boot-графе.
- [ ] Записано, что проверено, а что нет.

Отчитывайся честно: что работает, что не проверено и что зависит от версии харнесса.
