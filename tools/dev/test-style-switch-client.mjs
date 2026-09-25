/**
 * Local verification of the `@local/dsh-style-switch` browser bundle.
 *
 * Evaluates the hand-written bundle against a stub module loader, a minimal
 * React that actually holds state (so a second render sees what the first one
 * loaded), and stub primitives: it proves the bundle registers the expected
 * graph row, exports the Cordis contract, registers into the Session Header
 * utilities slot, renders the control, reads the host on open, and posts the
 * chosen style back.
 *
 * Usage: node tools/dev/test-style-switch-client.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  join(here, '..', '..', 'packages', 'style-switch', 'lib', 'client.js'),
  'utf8',
)

/** Rows the bundle registered through `window.__ModuleLoader__.load`. */
const rows = []
const fakeWindow = { __ModuleLoader__: { load: (row) => rows.push(row) } }

new Function('window', source)(fakeWindow)
assert.equal(rows.length, 1, 'the bundle registers exactly one module row')
const row = rows[0]
assert.equal(row.id, '@local/dsh-style-switch', 'the row id is the package name')
assert.equal(typeof row.factory, 'function')

const VALID_PRIMITIVES = new Set([
  'Button', 'Modal', 'Switch', 'Tag', 'IconPersonalizationOutline16',
])

function makePrimitives() {
  const table = {}
  for (const name of VALID_PRIMITIVES) table[name] = name
  return table
}

/**
 * Minimal React that keeps state across renders.
 *
 * The stub in the sibling prompt-mod test never advances state, which is enough
 * for one render pass. This dialog loads its state in an effect and then shows
 * options derived from it, so the stub has to remember what the effect stored —
 * otherwise the option cards, the very thing this test exists to check, never
 * appear.
 */
function makeReact() {
  const store = []
  const effects = []
  let cursor = 0
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
      const index = cursor++
      if (!(index in store)) store[index] = initial
      return [store[index], (next) => {
        store[index] = typeof next === 'function' ? next(store[index]) : next
      }]
    },
    useEffect(callback) {
      effects.push(callback())
    },
    /** Start a render pass for one component: hook order starts from zero. */
    __begin() {
      cursor = 0
    },
    /** Throw the state away: the next component starts from its initial values. */
    __hardReset() {
      store.length = 0
      effects.length = 0
      cursor = 0
    },
    __store: store,
  }
}

/** Every node of a rendered tree, flattened. */
function flatten(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out)
  } else if (node !== null && node !== undefined && typeof node === 'object') {
    out.push(node)
    if (node.props !== undefined) flatten(node.props.children, out)
  }
  return out
}

/** Requests the component tree issued. */
const requests = []
const SNAPSHOT = {
  ok: true,
  style: 'dsh',
  label: 'DSH',
  summary: 'обычный: разбор, карта задачи, проверка запуска',
  text: '',
  contributes: false,
  styles: [
    { id: 'dsh', label: 'DSH', summary: 'обычный', contributes: false, length: 0 },
    { id: 'codex', label: 'КОДЕКС', summary: 'кратко', contributes: true, length: 900 },
  ],
  section: 'mod:style-switch',
  order: 10350,
  path: 'C:\\Users\\you\\.dsh\\style-switch.json',
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
    json: async () => (init?.method === 'POST'
      ? { ...SNAPSHOT, ...JSON.parse(init.body), contributes: true, label: 'КОДЕКС', text: 'СТИЛЬ РАБОТЫ: КОДЕКС' }
      : SNAPSHOT),
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

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
        return callback()
      },
      register(options, component) {
        registered = { options, component }
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.deepEqual(injections, ['conversation.session.header.utilities'])
  assert.equal(registered.options.name, 'conversation.session.header.utilities')
  assert.equal(registered.options.id, 'style-switch', 'list slots require an id')
  assert.equal(typeof registered.component, 'function')
  console.log('ok  2. registers one header control into the chat page header')

  // ── 3. the control renders and shows the style it read from the host ─────
  requests.length = 0
  react.__hardReset()
  react.__begin()
  const control = registered.component({})
  assert.equal(control.type, react.Fragment, 'the control renders a fragment')
  const [button, dialog] = control.props.children
  assert.equal(button.type, 'Button', 'the header shows a Button primitive')
  assert.equal(button.props.icon.type, 'IconPersonalizationOutline16', 'the button carries an icon')
  assert.equal(button.props.children, 'Стиль', 'with no state yet it shows the short label')
  assert.equal(dialog.type.name, 'StyleDialog', 'a dialog must be mounted next to the button')
  await tick()
  assert.equal(requests.length, 1, 'the control reads its state once on mount')
  assert.equal(requests[0].url, 'http://127.0.0.1:3080/api/style-switch.mod')
  assert.equal(requests[0].init.method, 'GET')
  react.__begin()
  const second = registered.component({})
  assert.equal(second.props.children[0].props.children, 'Стиль: DSH', 'after loading it names the style')
  console.log('ok  3. header control reads the current style from the host route')

  // ── 4. opening the dialog lists the styles ───────────────────────────────
  requests.length = 0
  react.__hardReset()
  react.__begin()
  const dialogNode = dialog.type
  let rendered = dialogNode({ open: true, onClose: () => {} })
  assert.equal(rendered.type, 'Modal', 'the dialog renders the Modal primitive')
  assert.equal(rendered.props.title, 'Стиль работы')
  assert.equal(rendered.props.open, true)
  assert.equal(typeof rendered.props.onClose, 'function')
  await tick()
  assert.equal(requests.length, 1, 'opening issues exactly one host request')
  assert.equal(requests[0].url, 'http://127.0.0.1:3080/api/style-switch.mod')
  console.log('ok  4. opening the dialog reads the host route')

  react.__begin()
  rendered = dialogNode({ open: true, onClose: () => {} })
  const nodes = flatten(rendered.props.children)
  const cards = nodes.filter((node) => node.type === 'button')
  assert.equal(cards.length, 2, 'both styles are offered as cards')
  assert.deepEqual(cards.map((card) => card.props.key), ['dsh', 'codex'])
  const tag = nodes.find((node) => node.type === 'Tag')
  assert.deepEqual(tag.props.children, 'ничего не добавляет', 'DSH contributes nothing, and the dialog says so')
  const codexCard = cards[1]
  assert.ok(
    flatten(codexCard).some((node) => node.props?.children === 'КОДЕКС'),
    'the concise style is named on its card',
  )
  console.log('ok  5. the dialog offers both styles and states what DSH contributes')

  // ── 6. choosing a style posts it to the host ─────────────────────────────
  requests.length = 0
  codexCard.props.onClick()
  await tick()
  assert.equal(requests.length, 1, 'choosing issues one host request')
  assert.equal(requests[0].init.method, 'POST')
  assert.equal(requests[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(requests[0].init.body), { style: 'codex' })
  console.log('ok  6. choosing a style posts it to the host route')

  // ── 7. the dialog reflects the new choice ────────────────────────────────
  react.__begin()
  rendered = dialogNode({ open: true, onClose: () => {} })
  const after = flatten(rendered.props.children)
  const afterCards = after.filter((node) => node.type === 'button')
  assert.ok(
    flatten(afterCards[1]).some((node) => typeof node.props?.children === 'string'
      && node.props.children.includes('выбран')),
    'the chosen style is marked',
  )
  const showButton = after.find((node) => node.type === 'Button'
    && node.props.children === 'Показать текст')
  assert.ok(showButton !== undefined, 'the dialog offers the text of the chosen style')
  assert.equal(showButton.props.disabled, false, 'and it is enabled once the style has text')
  showButton.props.onClick()
  react.__begin()
  rendered = dialogNode({ open: true, onClose: () => {} })
  const pre = flatten(rendered.props.children).find((node) => node.type === 'pre')
  assert.ok(pre !== undefined, 'the text can actually be shown')
  console.log('ok  7. the dialog marks the choice and shows its prompt text')

  console.log('\nPASS — browser bundle verified')
} finally {
  globalThis.window = previousWindow
}
