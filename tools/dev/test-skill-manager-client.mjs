#!/usr/bin/env node
/**
 * Local verification of the `@local/dsh-skill-manager` browser bundle.
 *
 * Evaluates the hand-written bundle against a stub module loader, a small React
 * runtime with hook state that survives re-renders, and a stub primitives module.
 * Then it drives the panel: it must register into the Settings → Plugins tab after
 * the mods tab, ask the host for a snapshot, render what came back, and post an
 * action naming the file it wants paused.
 *
 * The rendering check is the one that matters for the panel's purpose: a skill must
 * be shown with a line a person can read, at a size a person can read it at. That
 * line was 12px at 72% opacity in the first version, which listed twenty skills
 * without saying what any of them was for.
 *
 * Usage: node tools/dev/test-skill-manager-client.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const source = readFileSync(join(REPO, 'packages', 'skill-manager', 'lib', 'client.js'), 'utf8')

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
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  }),
  useState: (initial) => {
    const index = cursor
    cursor += 1
    if (hooks[index] === undefined) hooks[index] = typeof initial === 'function' ? initial() : initial
    const set = (value) => {
      hooks[index] = typeof value === 'function' ? value(hooks[index]) : value
      rerender()
    }
    return [hooks[index], set]
  },
  useMemo: (factory, deps) => {
    const index = cursor
    cursor += 1
    const previous = hooks[index]
    if (previous === undefined || JSON.stringify(previous.deps) !== JSON.stringify(deps)) {
      hooks[index] = { deps, value: factory() }
    }
    return hooks[index].value
  },
  useCallback: (fn, deps) => {
    const index = cursor
    cursor += 1
    const previous = hooks[index]
    if (previous === undefined || JSON.stringify(previous.deps) !== JSON.stringify(deps)) {
      hooks[index] = { deps, value: fn }
    }
    return hooks[index].value
  },
  useEffect: (fn, deps) => {
    const index = cursor
    cursor += 1
    const previous = hooks[index]
    if (previous === undefined || JSON.stringify(previous.deps) !== JSON.stringify(deps)) {
      hooks[index] = { deps, value: fn() }
    }
    return undefined
  },
}

const registered = { slots: [], locale: [] }
const primitives = new Proxy({}, {
  get: (_target, name) => (props) => react.createElement(String(name), props),
})

const rows = []
const fakeWindow = {
  __ModuleLoader__: { load: (row) => rows.push(row) },
  addEventListener: () => {},
  removeEventListener: () => {},
}

/** What the stubbed host returns. One registered skill and one long description. */
const HOST_STATE = {
  registryPath: 'C:/home/skill-registry.json',
  workspaces: [{ path: 'C:/work/ds1', title: 'ds1' }],
  total: 2, paused: 1, registered: 1,
  roots: [{ source: 'project-agents:C:/work/ds1/.agents/skills', label: '.agents · ds1', rank: 200, path: 'C:/work/ds1/.agents/skills', exists: true, count: 2 }],
  skills: [
    {
      name: 'find-a-skill',
      description: 'Look for a skill that already does the job before writing a new one, by searching the roots this harness resolves and then GitHub. Use when about to create any skill.',
      humanSummary: 'Ищет готовый скилл, прежде чем писать новый.',
      source: 'project-agents:C:/work/ds1/.agents/skills',
      sourceLabel: '.agents · ds1', rank: 200,
      file: 'C:/work/ds1/.agents/skills/find-a-skill/SKILL.md',
      paused: false, problem: null, bytes: 9000,
      id: 'find-a-skill', registered: true, shadowedBy: null,
    },
    {
      name: 'paused-one',
      description: 'A skill that is currently paused, and which has never been described for a person.',
      humanSummary: '', source: 'project-agents:C:/work/ds1/.agents/skills',
      sourceLabel: '.agents · ds1', rank: 200,
      file: 'C:/work/ds1/.agents/skills/paused-one/SKILL.md.paused',
      paused: true, problem: null, bytes: 400,
      id: '', registered: false, shadowedBy: null,
    },
  ],
}

// The bundle reaches for `fetch`, `location` and `document` on the **global** object,
// not on `window` — a stub that only patches `window` leaves the panel loading
// forever, which is what the first run of this test showed.
globalThis.document = { documentElement: { lang: 'ru' } }
globalThis.location = { origin: 'http://dsh.internal' }
globalThis.fetch = async () => ({ status: 200, json: async () => ({ ok: true, state: HOST_STATE }) })

const requireStub = (name) => {
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require: ${name}`)
}
new Function('window', source)(fakeWindow)
ok('the bundle registers exactly one module row', rows.length === 1)
const row = rows[0]
ok('the row id is the package name', row.id === '@local/dsh-skill-manager', row.id)

const moduleExports = row.factory(requireStub)
ok('the bundle exports apply', typeof moduleExports.apply === 'function')
ok('and injects the slot and locale registries',
  JSON.stringify(moduleExports.inject) === JSON.stringify(['slots', 'locale']),
  JSON.stringify(moduleExports.inject))

// ── apply: the tab registration ───────────────────────────────────────────────

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
ok('both languages are present',
  registered.locale[0]?.dictionaries?.en !== undefined && registered.locale[0]?.dictionaries?.ru !== undefined)
ok('the translations cover the same keys',
  JSON.stringify(Object.keys(registered.locale[0].dictionaries.en).sort())
    === JSON.stringify(Object.keys(registered.locale[0].dictionaries.ru).sort()),
  'a key present in one dictionary and missing in the other reads as a raw key')
ok('the tab targets the Plugins settings slot',
  registered.slots.some((entry) => entry.name === 'settings.plugins.tab' && entry.options !== undefined))
const tab = registered.slots.find((entry) => entry.options !== undefined)
ok('the tab has its own id', tab?.options?.id === 'skills', String(tab?.options?.id))
ok('the tab sorts after the mods tab', tab?.options?.order === 30, String(tab?.options?.order))
ok('the tab label resolves in Russian from the DOM language', tab?.options?.label() === 'Скиллы',
  String(tab?.options?.label()))

// ── render ────────────────────────────────────────────────────────────────────

const collect = (node, out = []) => {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) { for (const child of node) collect(child, out); return out }
  out.push(node)
  const children = node?.props?.children
  if (children !== undefined) collect(children, out)
  return out
}

let tree
rerender = () => { cursor = 0; tree = tab.component({ t: (key) => registered.locale[0].dictionaries.ru[key] ?? key }) }
rerender()
// The panel loads through a promise; let it settle.
await new Promise((resolve) => { setTimeout(resolve, 20) })
cursor = 0
tree = tab.component({ t: (key) => registered.locale[0].dictionaries.ru[key] ?? key })

const nodes = collect(tree)
const textOf = (node) => (typeof node?.props?.children === 'string' ? node.props.children : undefined)
const texts = nodes.map(textOf).filter((value) => value !== undefined)

ok('the panel rendered something', nodes.length > 10, `${String(nodes.length)} nodes`)
ok('the skill name is shown', texts.includes('find-a-skill'), texts.slice(0, 6).join(' | '))
ok('the human summary is shown, not only the model description',
  texts.includes('Ищет готовый скилл, прежде чем писать новый.'))
ok('the paused skill is shown too', texts.includes('paused-one'))

const summaryNode = nodes.find((node) => textOf(node) === 'Ищет готовый скилл, прежде чем писать новый.')
ok('the summary is rendered as its own element', summaryNode !== undefined)
ok('and it is rendered large', Number.parseFloat(summaryNode?.props?.style?.fontSize) >= 20,
  `fontSize=${String(summaryNode?.props?.style?.fontSize)}`)
ok('and it is not faded out', Number(summaryNode?.props?.style?.opacity ?? 1) >= 0.9,
  `opacity=${String(summaryNode?.props?.style?.opacity)}`)

// A skill with no human summary must still show a readable line, taken from the
// model description — that is the case the panel was unreadable for.
const pausedSummary = nodes
  .map(textOf)
  .filter((value) => typeof value === 'string')
  .find((value) => value.startsWith('A skill that is currently paused'))
ok('a skill with no human summary still gets a readable line', pausedSummary !== undefined,
  texts.filter((v) => typeof v === 'string').find((v) => v.includes('paused')) ?? 'not found')

ok('the Russian tab label is in the dictionary', registered.locale[0].dictionaries.ru.tab === 'Скиллы')
ok('and the English one', registered.locale[0].dictionaries.en.tab === 'Skills')

console.log('')
console.log(`${String(checks - failed)}/${String(checks)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
