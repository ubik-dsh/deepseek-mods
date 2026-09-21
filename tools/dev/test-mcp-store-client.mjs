#!/usr/bin/env node
/**
 * Local verification of the `@local/dsh-mcp-store` browser bundle.
 *
 * Evaluates the hand-written bundle against a stub module loader, a small React runtime
 * whose hook state survives re-renders, and a stub primitives module. Then it drives the
 * panel: the tab must register after the skill Collection, render a table with the three
 * columns the operator named, show each row's status the way a mod or a skill shows its
 * own, and — expanded — offer the loader rows to paste and the destination file.
 *
 * The check that matters most is the **honest boundary**: the panel must show the config
 * snippet and the file it goes into, and must not present any control that would write
 * the harness's MCP configuration. A store that enabled its own entries would make every
 * row a decision nobody took.
 *
 * Usage: node tools/dev/test-mcp-store-client.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const source = readFileSync(join(REPO, 'packages', 'mcp-store', 'lib', 'client.js'), 'utf8')

let checks = 0
let failed = 0
const ok = (label, condition, detail) => {
  checks += 1
  if (condition) console.log(`ok ${String(checks).padStart(2)}. ${label}`)
  else {
    failed += 1
    console.log(`FAIL ${String(checks).padStart(2)}. ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// ── a React tiny enough to render once and report what it built ───────────────

const hooks = []
let cursor = 0
let rerender = () => {}
const react = {
  // Elements are plain objects with the component name as a string type, and a component
  // reference is turned into one eagerly. Calling the reference instead would drop the
  // props and children it was called with — a stub that does that cannot tell a real
  // `Tag` from a hand-rolled `<span>`.
  createElement: (type, props, ...children) => ({
    type: typeof type === 'function' ? String(type.name ?? 'anonymous') : type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  }),
  useState: (initial) => {
    const index = cursor++
    if (hooks[index] === undefined) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], (value) => {
      hooks[index] = typeof value === 'function' ? value(hooks[index]) : value
      rerender()
    }]
  },
  useMemo: (factory, deps) => {
    const index = cursor++
    const previous = hooks[index]
    if (previous === undefined || JSON.stringify(previous.deps) !== JSON.stringify(deps)) {
      hooks[index] = { deps, value: factory() }
    }
    return hooks[index].value
  },
  useCallback: (fn, deps) => {
    const index = cursor++
    const previous = hooks[index]
    if (previous === undefined || JSON.stringify(previous.deps) !== JSON.stringify(deps)) {
      hooks[index] = { deps, value: fn }
    }
    return hooks[index].value
  },
  useEffect: (fn, deps) => {
    const index = cursor++
    const previous = hooks[index]
    if (previous === undefined || JSON.stringify(previous.deps) !== JSON.stringify(deps)) {
      hooks[index] = { deps, value: fn() }
    }
  },
}

const registered = { slots: [], locale: [] }
// Every primitives property is a component reference named after itself, so the stub
// element carries the platform component's own name — the same shape the real module has,
// where `Tag` and `StateDot` are components and not strings.
const primitives = new Proxy({}, {
  get: (_t, name) => {
    const Component = () => undefined
    Object.defineProperty(Component, 'name', { value: String(name) })
    return Component
  },
})

const SNIPPET = [
  '- insert:',
  '    - id: mcp-vkusvill',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: vkusvill',
  '        transport: streamable-http',
  "        url: 'https://mcp001.vkusvill.ru/mcp'",
].join('\n')

const HOST_STATE = {
  storePath: 'C:/home/mcp-store.json',
  patchFile: 'C:/home/profiles/web/cordis.patch.yml',
  updated: '2026-09-21T15:00:00Z',
  seeded: true,
  softLimit: 200,
  proposed: 2,
  working: 0,
  refused: 0,
  tried: 0,
  transports: { stdio: 1, http: 1 },
  entries: [
    { id: 'vkusvill', name: 'vkusvill', transport: 'streamable-http',
      url: 'https://mcp001.vkusvill.ru/mcp', command: '', args: [],
      comment: 'ВкусВилл, свой MCP. Без ключей. Корзину собирает ссылкой.',
      description: 'Product lookup for VkusVill: search, details by id or barcode, analogs, discounts, shops, recipes, and a shareable cart link. Reach for it for what VkusVill sells or contains. It does not order.',
      status: 'proposed', source: 'https://mcp001.vkusvill.ru/mcp',
      addedAt: '2026-09-21T12:00:00Z', updatedAt: '2026-09-21T12:00:00Z',
      found: [{ at: '2026-09-21', fact: 'tools/list answered HTTP 200 with eight tools; tools/call answered 200 only after the full handshake.' }],
      observations: [],
      snippet: SNIPPET },
    { id: 'drawio', name: 'drawio', transport: 'streamable-http',
      url: 'https://mcp.draw.io/mcp', command: '', args: [],
      comment: 'draw.io, официальный.',
      description: 'The official draw.io MCP server: create_diagram renders draw.io XML inline, search_shapes finds the right style string.',
      status: 'working', source: 'https://github.com/jgraph/drawio-mcp',
      addedAt: '2026-09-21T12:00:00Z', updatedAt: '2026-09-21T12:00:00Z',
      found: [], observations: [],
      snippet: '- insert:\n    - id: mcp-drawio\n      name: \'@deepseek-ai/dsh-mcp-client\'\n      config:\n        serverName: drawio\n        transport: streamable-http\n        url: \'https://mcp.draw.io/mcp\'' },
  ],
}

const rows = []
const fakeWindow = { __ModuleLoader__: { load: (row) => rows.push(row) }, addEventListener: () => {}, removeEventListener: () => {} }
globalThis.document = { documentElement: { lang: 'ru' } }
globalThis.location = { origin: 'http://dsh.internal' }

/** Every POST the panel makes, so a test can prove no write ever happened. */
const posts = []
globalThis.fetch = async (url, init) => {
  if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)))
  return { status: 200, json: async () => ({ ok: true, state: HOST_STATE }) }
}

const requireStub = (name) => {
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require: ${name}`)
}
new Function('window', source)(fakeWindow)
ok('the bundle registers exactly one module row', rows.length === 1)
const row = rows[0]
ok('the row id is the package name', row.id === '@local/dsh-mcp-store', row.id)
const moduleExports = row.factory(requireStub)
ok('it exports apply', typeof moduleExports.apply === 'function')
ok('it injects only the registries',
  JSON.stringify(moduleExports.inject) === JSON.stringify(['slots', 'locale']),
  JSON.stringify(moduleExports.inject))

// ── apply ─────────────────────────────────────────────────────────────────────

const ctx = {
  effect: (fn) => { fn() },
  locale: { register: (ns, dictionaries) => { registered.locale.push({ ns, dictionaries }) } },
  slots: {
    inject: (name, fn) => { registered.slots.push({ name, kind: 'inject' }); fn() },
    register: (options, component) => { registered.slots.push({ name: options.name, options, component }) },
  },
}
moduleExports.apply(ctx)

ok('the dictionaries are registered', registered.locale.length === 1)
ok('under this plugin\'s own namespace', registered.locale[0]?.ns === 'mcp-store')
const en = registered.locale[0]?.dictionaries?.en
const ru = registered.locale[0]?.dictionaries?.ru
ok('both languages are present', en !== undefined && ru !== undefined)
ok('the translations cover the same keys',
  JSON.stringify(Object.keys(en).sort()) === JSON.stringify(Object.keys(ru).sort()),
  'a key in one and not the other reads as a raw key')
ok('the three column names exist in both',
  typeof en.colServer === 'string' && typeof en.colComment === 'string'
  && typeof en.colDescription === 'string' && typeof ru.colDescription === 'string')

const tab = registered.slots.find((entry) => entry.options !== undefined)
ok('the tab targets the Plugins settings slot', tab?.name === 'settings.plugins.tab')
ok('it has its own id', tab?.options?.id === 'mcp-store', String(tab?.options?.id))
ok('it sorts after the skill Collection tab', tab?.options?.order === 32, String(tab?.options?.order))
ok('the label resolves in Russian from the DOM language', tab?.options?.label() === 'Хранилище MCP',
  String(tab?.options?.label()))

// ── render ────────────────────────────────────────────────────────────────────

const collect = (node, out = []) => {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) { for (const child of node) collect(child, out); return out }
  out.push(node)
  if (node?.props?.children !== undefined) collect(node.props.children, out)
  return out
}

let tree
rerender = () => { cursor = 0; tree = tab.component({ t: (key) => ru[key] ?? key }) }
rerender()
await new Promise((resolve) => { setTimeout(resolve, 20) })
cursor = 0
tree = tab.component({ t: (key) => ru[key] ?? key })

const nodes = collect(tree)
const textOf = (node) => (typeof node?.props?.children === 'string' ? node.props.children : undefined)
const texts = nodes.map(textOf).filter((value) => value !== undefined)
/** Every string anywhere in the tree, including inside an array of children. */
const stringsIn = (node, out = []) => {
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const one of node) stringsIn(one, out); return out }
  if (node !== null && typeof node === 'object') stringsIn(node.props?.children, out)
  return out
}
const allStrings = stringsIn(tree)

ok('the panel rendered', nodes.length > 20, `${String(nodes.length)} nodes`)

ok('the title says what it is', texts.includes('Хранилище MCP-серверов'))
// The three columns the operator named, in his order, as header cells.
ok('the server column is labelled', texts.includes('Сервер'))
ok('the comment column is labelled', texts.includes('Комментарий'))
ok('the agent-description column is labelled', texts.includes('Мини-описание для агента'))
ok('both entries are rows of it', texts.includes('vkusvill') && texts.includes('drawio'))
ok('the comment column carries the operator\'s own text',
  texts.some((value) => value.includes('ВкусВилл, свой MCP')))
ok('the agent column carries the agent-facing description',
  allStrings.some((value) => value.includes('Product lookup for VkusVill')),
  allStrings.find((value) => value.includes('Product')) ?? 'not found')
ok('the status reads as a tag, in the interface language',
  allStrings.includes('предложен') && allStrings.includes('работает'))
// The dot and the tag are the platform's own, exactly as a mod and a skill show their
// state: the row state must read the way every other state in this harness reads. A
// lookalike would make the same state look like a different one.
const usedPlatform = (componentName) => nodes.some(
  (node) => String(node.type).includes(componentName))
ok('the row state is drawn with the platform StateDot', usedPlatform('StateDot'))
ok('and with the platform Tag', usedPlatform('Tag'))
ok('the chevron is the platform icon', usedPlatform('IconChevronDownOutline14'))
ok('the buttons are the platform Button', usedPlatform('Button'))
ok('the transport is visible on the row itself',
  allStrings.filter((value) => value === 'streamable-http').length >= 2,
  'the table must not need an expansion to say how a server connects')

// Every row is a click target with a chevron, the same shape a mod card uses.
const rowHeader = nodes.find((node) => typeof node?.props?.onClick === 'function'
  && collect(node).some((child) => textOf(child) === 'vkusvill'))
ok('a row can be expanded', rowHeader !== undefined)
ok('an unexpanded row shows no paste box',
  !texts.includes('Вставь это в харнесс, чтобы он действительно загрузил сервер'))

rowHeader?.props?.onClick()

// Read the expanded tree back. The card is a detail of the row it belongs to.
const expandedTree = (() => {
  cursor = 0
  return tab.component({ t: (key) => ru[key] ?? key })
})()
const expandedNodes = collect(expandedTree)
const expandedTexts = expandedNodes.map(textOf).filter((value) => value !== undefined)

ok('the expansion carries the connection detail',
  expandedTexts.includes('streamable-http'))
ok('the endpoint is shown', expandedTexts.some((value) => value.includes('mcp001.vkusvill.ru/mcp')))
ok('and what was measured against it',
  expandedTexts.some((value) => value.includes('tools/list answered HTTP 200')),
  expandedTexts.find((value) => value.includes('HTTP')) ?? 'not found')

// ── the honest boundary ───────────────────────────────────────────────────────
//
// This is the check the whole panel exists for. The store records; it does not enable.
// The operator must be able to SEE the loader rows and WHERE they go, and nothing here
// may write the harness's MCP configuration on his behalf.

const pasteBoxes = expandedNodes.filter((node) => node.type === 'textarea')
ok('the snippet and the chat sentence are both in read-only boxes',
  pasteBoxes.length === 2 && pasteBoxes.every((node) => node.props.readOnly === true),
  `${String(pasteBoxes.length)} textarea(s)`)
// The snippet is a textarea's value, not a text child — so it is read from there. A check
// that looked for it among the text nodes passed on an empty box, which is how this
// assertion was wrong the first time.
ok('the loader rows to paste are in the box',
  pasteBoxes.some((node) => String(node.props.value).includes("name: '@deepseek-ai/dsh-mcp-client'")),
  'the snippet must be visible, not merely computed')
ok('the line an agent needs is inside the snippet',
  pasteBoxes.some((node) => String(node.props.value).includes('serverName: vkusvill')))
ok('one of them is the loader rows',
  pasteBoxes.some((node) => String(node.props.value).includes('mcp-vkusvill')))
ok('and the other is the sentence for the chat',
  pasteBoxes.some((node) => String(node.props.value).includes('Хранилище MCP: посмотрим на')))
ok('the destination file is named, not guessed at',
  expandedTexts.some((value) => value.includes('cordis.patch.yml')),
  expandedTexts.find((value) => value.includes('patch')) ?? 'not found')
ok('the panel says out loud that it enables nothing',
  texts.some((value) => value.includes('Хранилище ничего не включает'))
  || expandedTexts.some((value) => value.includes('Хранилище ничего не включает')))
ok('and explains why the paste is manual',
  expandedTexts.some((value) => value.includes('поэтому её вставляешь ты, руками')))

// A control that wrote the config would have to post something. Nothing has.
ok('no write was sent to the host by expanding', posts.length === 0, JSON.stringify(posts))
ok('there is no enable/install control',
  !allStrings.includes('Включить') && !allStrings.includes('Установить'))

// The action has to be found inside a platform `Button`, not merely somewhere in the row:
// a `span` with a click handler would look the same in a screenshot and behave differently.
const forget = expandedNodes.find((node) => String(node.type) === 'Button'
  && stringsIn(node).some((value) => value.includes('Убрать')))
ok('the only action offered is removing the row', forget !== undefined,
  expandedNodes.filter((node) => String(node.type) === 'Button')
    .map((node) => stringsIn(node).join('/')).join(' | ') || 'no Button rendered')
forget?.props?.onClick?.({ stopPropagation: () => {} })
await new Promise((resolve) => { setTimeout(resolve, 20) })
ok('and it writes to the store and nowhere else',
  posts.length === 1 && posts[0]?.action === 'forget' && posts[0]?.id === 'vkusvill',
  JSON.stringify(posts))
ok('no request carries a server configuration to be enabled',
  !posts.some((payload) => 'entry' in payload || 'snippet' in payload || 'enable' in payload))

ok('the notes say the agent reaches the store with its own tools',
  texts.some((value) => value.includes('mcp_store_add')))
ok('and that the third column is written for a machine',
  texts.some((value) => value.includes('Пиши для машины')))
ok('and that the comment is never rewritten',
  texts.some((value) => value.includes('ничто его не переводит')))

// ── the language, with a platform translator that answers in English ──────────
//
// The regression this pins, same as the sibling panels: the tab label was Russian and
// everything inside it was English. The label is built with no platform translator and
// read the active language correctly; the panel is handed the platform translator, which
// answers for its own namespace, falls back to English for keys it does not own, and was
// consulted first.

// It answers for EVERY key, not just the ones the label asks for. A fake that only
// answered for `tab` never reached the render, and the test passed against the broken
// order — which is how it was caught in the sibling.
const englishPlatformT = (key) => `EN:${key}`
const withPlatform = (() => {
  // Clear the hooks, not just the cursor: `useMemo` caches by comparing JSON.stringify of
  // its dependencies, and a function stringifies to null — so a re-render with a different
  // translator compared equal and the component kept the first one it was ever given.
  hooks.length = 0
  cursor = 0
  return tab.component({ t: englishPlatformT })
})()
const platformTexts = collect(withPlatform).map(textOf).filter((value) => value !== undefined)
ok('a platform translator answering for every key does not override our dictionary',
  !platformTexts.some((value) => value.startsWith('EN:')),
  platformTexts.find((value) => value.startsWith('EN:')) ?? 'none')
ok('and the panel is in Russian, not English',
  platformTexts.some((value) => value.includes('Сервер')) || platformTexts.some((value) => value.includes('Хранилище')),
  platformTexts.slice(0, 4).join(' | '))

console.log('')
console.log(`${String(checks - failed)}/${String(checks)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
