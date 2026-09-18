/**
 * Local verification of the `@local/dsh-system-prompt-mod` browser bundle.
 *
 * Evaluates the hand-written bundle against a stub module loader, a minimal
 * React, and a stub primitives module: it proves the bundle registers the
 * expected graph row, exports the Cordis contract, registers into the Session
 * Header utilities slot, and that the component tree builds and talks to the
 * host route.
 *
 * Usage: node _dsh_mod/test-client.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  join(here, '..', '..', 'packages', 'system-prompt-mod', 'lib', 'client.js'),
  'utf8',
)

/** Rows the bundle registered through `window.__ModuleLoader__.load`. */
const rows = []
const fakeWindow = { __ModuleLoader__: { load: (row) => rows.push(row) } }

// The bundle is a plain script, exactly as the shell evaluates it.
new Function('window', source)(fakeWindow)
assert.equal(rows.length, 1, 'the bundle registers exactly one module row')
const row = rows[0]
assert.equal(row.id, '@local/dsh-system-prompt-mod', 'the row id is the package name')
assert.equal(typeof row.factory, 'function')

// ── stub modules ───────────────────────────────────────────────────────────
const VALID_PRIMITIVES = new Set([
  'Button', 'Modal', 'Switch', 'Tag', 'IconPersonalizationOutline16',
])

function makePrimitives() {
  const table = {}
  for (const name of VALID_PRIMITIVES) table[name] = name
  return table
}

/** Minimal React: enough for a single render pass of this plugin. */
function makeReact() {
  const effects = []
  return {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      if (type === undefined || type === null) throw new Error('createElement received no type')
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useState(initial) {
      return [initial, () => {}]
    },
    useEffect(callback) {
      effects.push(callback())
    },
    useRef(value) {
      return { current: value }
    },
    __effects: effects,
  }
}

/** Requests the component tree issued. */
const requests = []
const SNAPSHOT = {
  ok: true,
  enabled: false,
  mode: 'append',
  text: '',
  active: false,
  path: 'C:\\Users\\you\\.dsh\\system-prompt-mod.json',
  section: 'mod:user-system-prompt',
  order: 10300,
  basePrompt: 'You are an AI agent powered by DeepSeek Harness.',
  baseAvailable: true,
  effectivePrompt: 'You are an AI agent powered by DeepSeek Harness.',
  error: null,
}

const react = makeReact()
const primitives = makePrimitives()
const requireStub = (specifier) => {
  if (specifier === 'react') return react
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require(${specifier})`)
}

const previousWindow = globalThis.window
globalThis.window = fakeWindow
globalThis.location = { origin: 'http://127.0.0.1:3080' }
globalThis.fetch = async (url, init) => {
  requests.push({ url, init })
  return {
    ok: true,
    status: 200,
    json: async () => (init?.method === 'POST' ? { ...SNAPSHOT, ...JSON.parse(init.body) } : SNAPSHOT),
  }
}

try {
  const plugin = row.factory(requireStub)

  // ── 1. exports ───────────────────────────────────────────────────────────
  assert.equal(typeof plugin.apply, 'function', 'apply is exported')
  assert.deepEqual(plugin.inject, ['slots'], 'the plugin injects the slot registry')
  console.log('ok  1. bundle exports apply/inject')

  // ── 2. slot registration ─────────────────────────────────────────────────
  const injections = []
  let registered = null
  const ctx = {
    slots: {
      inject(name, callback) {
        injections.push(name)
        // The real `inject` runs its callback once the slot is declared.
        return callback()
      },
      register(options, component) {
        registered = { options, component }
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.deepEqual(injections, ['conversation.session.header.utilities'], 'targets the session header utilities slot')
  assert.equal(registered.options.name, 'conversation.session.header.utilities')
  assert.equal(registered.options.id, 'system-prompt-mod', 'list slots require an id')
  assert.equal(typeof registered.component, 'function')
  assert.deepEqual(registered.options.inject(), {}, 'per-entry props are empty')
  console.log('ok  2. registers one header control into the chat page header')

  // ── 3. the control renders and opens the modal independently ────────────
  const control = registered.component({ sessionId: 'sess-1' })
  assert.equal(control.type, react.Fragment, 'the control renders a fragment')
  const [button, editor] = control.props.children
  assert.equal(button.type, 'Button', 'the header shows a Button primitive')
  assert.equal(button.props.icon.type, 'IconPersonalizationOutline16', 'the button carries an icon')
  assert.equal(typeof button.props.onClick, 'function')
  assert.equal(editor.type.name, 'SystemPromptEditor', 'the dialog is mounted next to the button')
  assert.equal(editor.props.open, false, 'the dialog starts closed')
  assert.equal(editor.props.sessionId, 'sess-1', 'the outlet session reaches the editor')

  const closed = editor.type({ open: false, onClose: () => {}, sessionId: 'sess-1' })
  assert.equal(closed.props.open, false)
  console.log('ok  3. header control renders with a closed dialog')

  // ── 4. opening the dialog loads the live prompt from the host ───────────
  requests.length = 0
  const dialog = editor.type({ open: true, onClose: () => {}, sessionId: 'sess-1' })
  assert.equal(dialog.type, 'Modal', 'the editor renders the Modal primitive')
  assert.equal(dialog.props.title, 'Системный промпт')
  assert.equal(dialog.props.open, true)
  assert.equal(typeof dialog.props.onClose, 'function')
  assert.ok(dialog.props.footer !== undefined, 'the modal carries a footer')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(requests.length, 1, 'opening issues exactly one host request')
  assert.equal(
    requests[0].url,
    'http://127.0.0.1:3080/api/system-prompt.mod?sessionId=sess-1',
    'the dialog calls the host route in the current session scope',
  )
  assert.equal(requests[0].init.method, 'GET')
  console.log('ok  4. opening the dialog reads the live prompt from the host route')

  // ── 5. the dialog body carries the editor and the actions ───────────────
  const body = dialog.props.children
  const bodyChildren = Array.isArray(body.props.children) ? body.props.children : [body.props.children]
  const textarea = bodyChildren.find((node) => node?.type === 'textarea')
  assert.ok(textarea !== undefined, 'the body contains a raw textarea (no Textarea primitive exists)')
  assert.equal(typeof textarea.props.onChange, 'function')
  assert.equal(textarea.props.spellCheck, false)
  const footerChildren = dialog.props.footer.props.children.flat().filter(Boolean)
  const labels = footerChildren.map((node) => node.props.children).flat()
  assert.ok(labels.includes('Сохранить и применить'), 'the footer offers an apply action')
  assert.ok(labels.includes('Закрыть'), 'the footer offers a close action')
  console.log('ok  5. the dialog body holds the editor and its actions')

  // ── 6. apply posts the edit back to the host ────────────────────────────
  requests.length = 0
  const applyButton = footerChildren.find((node) => node.props.children === 'Сохранить и применить')
  applyButton.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(requests.length, 1, 'apply issues one host request')
  assert.equal(requests[0].init.method, 'POST')
  assert.equal(requests[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    sessionId: 'sess-1',
    enabled: true,
    mode: 'append',
    text: '',
  }, 'apply posts the editor state for the current session')
  console.log('ok  6. apply posts the edited prompt to the host route')

  console.log('\nPASS — browser bundle verified')
} finally {
  globalThis.window = previousWindow
}
