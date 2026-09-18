# AI prompt — build a DSH mod

**English** · [Русский](AI-PROMPT.ru.md)

This file is both a **prompt** and a **reference**. To have an AI build a mod,
paste everything below the line into the conversation (or just tell an agent
working in this repository to read this file). [AGENTS.md](../AGENTS.md) points
here automatically.

---

## Mission

You are adding a plugin ("mod") to **DeepSeek Harness (DSH)**, an agent harness
whose browser UI is served by `dsh web`. Work in the user's own installation:
research it, build a package, install it, and **prove it works**.

Two rules override everything else:

- **Never edit the DSH installation.** Mods are separate packages installed into
  the Harness home.
- **Verify with evidence.** Never report success from code inspection alone. Run
  the check, read the output.

## Phase 0 — reconnaissance (do not skip, do not guess)

Everything you need is readable in the installed packages. They are built
JavaScript plus `.d.ts` declarations and READMEs — no TypeScript sources.

```bash
echo "$DSH_HOME"                       # empty → ~/.dsh
ls "$DSH_HOME/profiles"                # profiles; `web` is the browser GUI
ls "$DSH_HOME/profiles/node_modules/@deepseek-ai"   # ~240 plugin packages
```

Answer these questions **from the code**, quoting what you found:

1. **Where does my feature belong?** See the extension table in Phase 1.
2. **What is the exact API?** Read `lib/types/*.d.ts` (declarations) and
   `lib/index.js` / `lib/client.js` (implementations). Both are readable.
3. **Which service names and slot names exist?** Service names come from the
   `declare module '@deepseek-ai/cordis'` blocks in the `.d.ts` files. Slot
   names are visible in any plugin that uses them:

   ```bash
   # every slot the shipped plugins register into
   grep -rho 'slots\.inject(\s*"[^"]*"' "$DSH_HOME"/profiles/node_modules/@deepseek-ai/*/lib/client.js
   ```

   The full declared catalogue lives in `dsh-cordis-client-runner` (a
   `CLIENT_SLOT_API` constant in its `lib/client.js`).
4. **Find a first-party plugin that already does something similar** and copy its
   shape. That is the single highest-value move: `dsh-session-log-export` shows
   a host route plus a header control plus a modal; `dsh-client-ui-jobs` shows a
   minimal header slot registration.

Report your findings before writing code. If you cannot verify an API, say so
and state what is missing — do not invent signatures.

## Phase 1 — pick the extension point

| You want | Mechanism | Where it runs |
|---|---|---|
| A button, panel, tab or dialog in the GUI | a **client slot** (`ctx.slots`) | browser |
| Something the *agent* can call (a tool) | register a tool schema + handler | host |
| Text added to the system prompt | `ctx.systemPrompt.section()` | host |
| A new language or translations | `ctx.locale.addLanguage` / `.register` | browser |
| Persisted settings | `ctx.settings.register(namespace, schema)` | host |
| An HTTP endpoint for the GUI | `ctx.connection.fetch.register()` | host |
| React to agent/tool/session events | `ctx.on(event, listener)` | host or browser |
| Extra static guidance for the agent | an `AGENTS.md` file in the workspace | — |

The most common request is "put a control in the GUI", which is a client slot
plus, usually, a host half to talk to.

## Phase 2 — package skeleton

A dual-face package (host + browser) is the general case:

```
my-mod/
  package.json
  lib/index.js     host half   (ESM, exports apply/inject)
  lib/client.js    browser half (the served bundle, see Phase 3)
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

- `dsh.client.platform` must be exactly `"web"`, and `exports["./client"]` must
  exist, or the package is silently skipped by the browser roster.
- `dsh.client.inject` lists **package names** whose bundles must arrive first
  (a package-arrival edge); `dsh.client.external` lists non-baseline module
  specifiers the bundle requests. Neither is needed when the bundle only uses
  baseline modules (Phase 3).
- Keep `private: true` for anything installed locally.

Host half (`lib/index.js`) — a Cordis plugin:

```js
/** Cordis plugin name. */
export const name = 'my-mod'
/** Services that must exist before `apply` runs. */
export const inject = ['connection']
export function apply(ctx, config) { /* … */ }
```

The browser half's `inject` is a **different** list — see below.

## Phase 3 — the browser bundle

The client module system serves each package's `./client` file **as written**;
there is no build step. The format is a lazy-CJS factory registration:

```js
window.__ModuleLoader__.load({
  id: "@local/dsh-my-mod",            // MUST equal the package name
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    /** Cordis SERVICE names the client half needs (not package names). */
    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "my-mod",
          inject: (sessionId) => ({ /* props handed to the component */ }),
        }, MyControl));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

**Baseline modules** — these nine can be `require`d with no declaration:

```
react · react/jsx-runtime · react-dom · react-dom/client
@deepseek-ai/cordis · @deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots · @deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-dockkit
```

Anything else throws a loud "missed the module table" error: declare it in
`dsh.client.external` (specifier, usually `<package>/client`) **and**
`dsh.client.inject` (the package name).

### Slot registration

```js
ctx.slots.inject(slotName, () => ctx.slots.register(options, Component))
```

`inject` waits until the slot is declared and disposes your contribution when
the plugin unloads; `register` itself is effect-scoped to your plugin too.

Slot cardinality decides the required options (verify the target slot's kind in
the catalogue):

| Kind | Required options |
|---|---|
| `single` | — (occupying it replaces the shipped occupant) |
| `list` | `id` (string); optional `order`, `label` |
| `keyed` | `key` (string) |
| `chain` | `select(owner)` |

Useful, verified slots in the **chat page**: `conversation.session.header.utilities`
(right-aligned header actions), `conversation.session.header.actions`,
`conversation.input.dock` (above the composer), `shell.overlay` (frame-wide
floating layer), `settings.section` / `settings.general.item` (settings pages).
Never register into `root` — it is a `single` slot occupied by the app frame.

Slot-rendered components receive standard session props (`sessionId`,
`useProjection`, `t`, …) plus whatever your `inject` returns.

### Primitives (verified props)

- `Modal` — `{ open, onClose, title, description, closeLabel, children, footer, className, contentClassName, headless }`; portals to `document.body`, closes on Escape and mask click, renders nothing when closed.
- `Button` — `{ variant: 'ghost'|'outline'|'primary', size, icon, className, children, …rest }` (rest goes to the `<button>`).
- `Switch` — `{ checked, onChange(next), label, disabled, title }`.
- `Tag` — `{ tone: 'neutral'|'solid', children }`; `Menu`, `Input`, `Tooltip`, `Pill`, icons.
- **There is no `Textarea`** — use a raw `<textarea>`.

The stock `Modal` is `min(380px, 100%)` wide. To change it, pass `className`
and inject a style tag once (this is the first-party CSS idiom):

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

## Phase 4 — talking between the two halves

**There is no runtime "expose a host method" API.** Client→host RPC is
build-time codegen and the generator is not shipped, so choose one of:

1. **Your own authenticated route** (recommended, no codegen). Host:

   ```js
   export const inject = ['connection']
   export function apply(ctx) {
     const dispose = ctx.connection.fetch.register({
       path: '/api/my-mod',                     // absolute, below /api
       methods: ['GET', 'POST'],
       requestBody: 'buffered',
       fetch: async (request) => new Response(JSON.stringify({ ok: true }), {
         headers: { 'content-type': 'application/json' },
       }),
     })
     ctx.effect(() => () => { void dispose() }, 'my-mod: route')
   }
   ```

   Browser: a plain `fetch('/api/my-mod')` — the cookie is already there. This is
   how `dsh-session-log-export` streams a ZIP.

2. **The settings channel** when the state *is* a setting:
   `ctx.settings.register(ns, schema, { applies: 'live' })` on the host, and the
   already-compiled `remote.settings` namespace in the browser. Persisted in
   `$DSH_HOME/settings.yaml`, applied live.

3. **A hand-written Remote descriptor** if you truly need a new typed namespace.
   Doable but fiddly: read `dsh-api-settings-controller`'s descriptors first.

Calling an *existing* compiled remote from the browser uses the envelope:

```
POST /api/<namespace>/<method>
{ "type": "client-request", "rpcId": "<uuid>", "method": "<namespace>/<method>",
  "payload": { "args": { … } } }
→ { "type": "server-response", "rpcId": "…", "result": { … } }
```

The payload must contain exactly one plain-object `args` field; the argument
names must match the descriptor exactly.

## Phase 5 — verified host APIs

```js
// Ordered prompt sections. `text` as a FUNCTION is re-evaluated at every
// assembly — that is what makes an edit live. `complete` is read at
// REGISTRATION time, so switching it means dispose + re-register.
const dispose = ctx.systemPrompt.section({
  name: 'my-mod:section', order: 10300,
  text: () => myState.text, complete: false,
})

// Assemble in the live agent's scope: that is where the loop's {{model}} and
// {{cwd}} variables live. `renderPrompt` is a MODULE-LEVEL export.
const agent = ctx.agents.get(sessionId)          // note: ctx.agents is PLURAL
const assembly = await ctx.systemPrompt.assemble(agent ? { agent, scope: agent } : {})
const text = renderPrompt(assembly)               // throws on an unresolved {{var}}
```

```js
ctx.settings.register('my-mod', Schema.object({ … }), { applies: 'live' })
ctx.on('agent/created', ({ agent }) => { … })
ctx.effect(() => ctx.locale.register(ns, { zh, en }), 'dictionaries')
```

Localization, when your UI needs its own strings:

```js
export const inject = ['locale']
ctx.locale.register('myNamespace', { zh, en })          // shipped locales
ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })
ctx.locale.register('common', 'ja', { … })              // a language pack
```

## Phase 6 — install and verify

A plugin is a package plus **one loader row** in the target profile's patch
layer (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- insert:
    - id: my-mod
      name: '@local/dsh-my-mod'
```

Copy the package into `$DSH_HOME/profiles/node_modules/@local/<dir>/` and add
the row — that is all `tools/install.mjs` in this repository does, and it
discovers packages under `packages/` automatically.

Then verify, in this order:

1. **Unit-test the halves** without DSH: evaluate the browser bundle with a stub
   `window.__ModuleLoader__`, stub `require`, a minimal React and stub
   primitives; assert the row id, the exports, the slot registration and the
   component tree. Call the host half with a fake `ctx` and exercise every
   branch. This catches most mistakes before anything is installed.
2. **Install and check the roster** — `node tools/boot-check.mjs` (this
   repository) or fetch `/` with the browser-session cookie and look for your
   package name in the served `__DSH_BOOT__`.
3. **Check the host route** — `GET /api/<your path>` must answer.
4. **Render it for real** if a browser is available. On Windows, Edge headless
   over the DevTools Protocol works without any dependency (Node 24 has a global
   `WebSocket`): set the auth cookie with `Network.setCookie`, navigate, click
   with real `Input.dispatchMouseEvent` events, `Page.captureScreenshot`, and
   read the DOM back with `Runtime.evaluate`. `tools/dev/ui-check.mjs` here is a
   working example.

## Phase 7 — rules learned the hard way

1. **Editing a loaded package does not reload it.** The loader imports a module
   once per process, keyed by resolved URL, with no cache-busting. A *new* row
   is applied live; a *changed* package file needs a `dsh web` restart.
2. **A patch reload does not recreate an existing row.** Changing a row's
   `name` to a nonexistent specifier left the old route serving `200` — proof
   that mounted entries are not re-imported. Do not plan a hot-swap.
3. **`renderPrompt` throws on an unresolved `{{variable}}`**, and DSH has no
   escape syntax. If a user can type prompt text, validate it — otherwise you
   break every later request. In your own preview, degrade to tolerant
   interpolation instead of failing.
4. **Assemble prompt text in the agent's scope.** A scope-less assembly has no
   `{{model}}`/`{{cwd}}` and throws.
5. **`complete` is registration-time.** Re-register the section to toggle it; do
   not try to mutate it.
6. **Only the nine baseline modules are free.** Everything else needs
   `external` + `inject` in the manifest.
7. **`system-prompt/change` is not forwarded to the browser**, and the forwarded
   event allowlist is fixed at build time. Have the browser pull state when it
   needs it.
8. **`ctx.fs` is the sandbox backend** and denies writes outside the session
   workspace. For a file under the Harness home use plain `node:fs` (a host
   plugin runs in Node) or `@deepseek-ai/dsh-atomic-write`.
9. **Never restart the user's server unasked**, and never kill the process you
   are running inside. Hand over the command.
10. **Do not commit credentials.** `$DSH_HOME/.credentials.yaml` holds API keys
    and the session signing secret; a DSH-home backup may hold personal
    settings.
11. **Version drift is real.** DSH is pre-1.0 and its plugin APIs move. Pin what
    you tested against, and make failure graceful — a missing slot should cost
    the user a feature, not the GUI.
12. **PowerShell 5.1 mangles UTF-8** when a script uses `Get-Content -Raw` +
    `Set-Content`. Edit text files with a UTF-8-aware tool; verify encoding after
    any bulk rewrite.

## Deliverable checklist

- [ ] Package(s) under `packages/`, each with `package.json` and both halves.
- [ ] Browser bundle in the exact `window.__ModuleLoader__.load({ id, factory })` form.
- [ ] Host half exporting `apply` and `inject`.
- [ ] Bilingual README for the package (English `README.md`, Russian `README.ru.md`).
- [ ] Installable with the repository installer; no absolute paths in it.
- [ ] Unit tests for both halves, passing.
- [ ] Installed into a **clean** Harness home and confirmed in the served boot graph.
- [ ] Written record of what was verified and what was not.

Report honestly: what works, what is unverified, and what depends on the DSH
version.
