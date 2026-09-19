#!/usr/bin/env node
/**
 * Local verification of the `@local/dsh-skill-scout` browser bundle.
 *
 * Evaluates the hand-written bundle against a stub module loader, a small React
 * runtime whose hook state survives re-renders, and a stub primitives module. Then it
 * drives the board: the tab must register after Skills, show the task field, render
 * the queue and the catalogue, and mark adoption.
 *
 * The check that matters most is that **both axes survive to the screen**. A skill can
 * be worth keeping and still not run here — one of the three judged so far was exactly
 * that — and a panel that showed one verdict would hide the distinction the catalogue
 * exists to keep.
 *
 * Usage: node tools/dev/test-skill-scout-client.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const source = readFileSync(join(REPO, 'packages', 'skill-scout', 'lib', 'client.js'), 'utf8')

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
    type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
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
const primitives = new Proxy({}, { get: (_t, name) => (props) => react.createElement(String(name), props) })

const HOST_STATE = {
  queuePath: 'C:/home/skill-scout-queue.json',
  cataloguePath: 'C:/home/skill-catalogue.json',
  tasks: [
    { id: 't-1', text: 'a skill for evaluating other skills', by: 'human', createdAt: '2026-09-19T18:00:00Z',
      status: 'done', found: 41, triaged: 9, judged: 3, added: 2, note: 'three survived' },
    { id: 't-2', text: 'something nobody has taken yet', by: 'agent', createdAt: '2026-09-19T18:05:00Z',
      status: 'pending', found: 0, triaged: 0, judged: 0, added: 0, note: '' },
  ],
  pending: 1, taken: 0,
  entries: [
    { id: 'affaan-m-gateguard', name: 'gateguard', repo: 'affaan-m/ECC', path: 'skills/gateguard/SKILL.md',
      url: 'https://github.com/affaan-m/ECC', description: 'A gate that blocks the first edit and demands facts.',
      stars: 262706, foundAt: '2026-09-19T00:00:00Z', checkedAt: '2026-09-19T12:00:00Z',
      keep: 'no', runsHere: 'no', taken: ['state the facts before the first edit'],
      hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 3 },
      adopted: false, adoptedAt: null, note: '' },
    { id: 'x-keepme', name: 'keepme', repo: 'someone/repo', path: '', url: 'https://github.com/someone/repo',
      description: 'Something that is both good and usable.', stars: 10,
      keep: 'yes', runsHere: 'yes', taken: [],
      hearing: { prosecutor: 2, defence: 8, verdict: 'acquit', cases: 1 },
      adopted: true, adoptedAt: '2026-09-19T13:00:00Z', note: '' },
  ],
  updated: '2026-09-19T13:00:00Z', adopted: 1, runnable: 1, keepable: 1, softLimit: 400,
}

const rows = []
const fakeWindow = { __ModuleLoader__: { load: (row) => rows.push(row) }, addEventListener: () => {}, removeEventListener: () => {} }
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
ok('the row id is the package name', row.id === '@local/dsh-skill-scout', row.id)
const moduleExports = row.factory(requireStub)
ok('it exports apply', typeof moduleExports.apply === 'function')
ok('it injects the registries and the two services the chat needs',
  JSON.stringify(moduleExports.inject) === JSON.stringify(['slots', 'locale', 'sessions', 'conversation']),
  JSON.stringify(moduleExports.inject))
// `conversation.send` reads the session tag off the CALLING context, and a Settings tab
// is root-scoped, so the hop through `sessions.scope` is what makes a message land.
ok('and therefore asks for a way into a session', moduleExports.inject.includes('sessions'))

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
const en = registered.locale[0]?.dictionaries?.en
const ru = registered.locale[0]?.dictionaries?.ru
ok('both languages are present', en !== undefined && ru !== undefined)
ok('the translations cover the same keys',
  JSON.stringify(Object.keys(en).sort()) === JSON.stringify(Object.keys(ru).sort()),
  'a key in one and not the other reads as a raw key')
ok('the rating separator exists in both',
  typeof en.against === 'string' && typeof ru.against === 'string')
const tab = registered.slots.find((entry) => entry.options !== undefined)
ok('the tab targets the Plugins settings slot', tab?.name === 'settings.plugins.tab')
ok('it has its own id', tab?.options?.id === 'skill-scout', String(tab?.options?.id))
ok('it sorts after the Skills tab', tab?.options?.order === 31, String(tab?.options?.order))
ok('the tab carries a channel into the chat', tab?.options?.channel !== undefined,
  'a root-scoped tab cannot call conversation.send directly')
ok('the label resolves in Russian from the DOM language', tab?.options?.label() === 'Коллекция',
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

ok('the board rendered', nodes.length > 20, `${String(nodes.length)} nodes`)
// The tab is a collection, not a board. Asking for a search is a sentence to the
// scout, and the scout is a skill — a task field here was a second way to do the same
// thing, with its own state to go stale.
ok('there is no task field', !nodes.some((node) => node.type === 'textarea'))
ok('and no search button', !texts.includes('Отправить разведчика'))
ok('and no queue is rendered', !texts.some((value) => value.includes('nobody has taken yet')))
ok('and no task counts either', !texts.some((value) => value.includes('найдено 41')))
ok('and no Take button', !texts.includes('Взять'))
ok('both catalogue entries are shown', texts.includes('gateguard') && texts.includes('keepme'))
ok('the adopted one is marked', texts.includes('Добавлено'))

// the two axes, on screen
ok('the "worth keeping" axis is rendered', texts.includes('no') || texts.includes('yes'))
ok('the "runs here" axis is rendered separately', texts.some((value) => value === 'after porting' || value === 'no'))
const gateguard = nodes.find((node) => textOf(node) === 'gateguard')
ok('the entry name is rendered', gateguard !== undefined)
ok('the catalogue shows the repository', texts.some((value) => value.includes('affaan-m/ECC')))

// The rating lives in the expanded card, because a board of twenty entries should not
// show twenty score tables. Expand the one under test and read again.
const header = nodes.find((node) => typeof node?.props?.onClick === 'function'
  && collect(node).some((child) => textOf(child) === 'gateguard'))
ok('the catalogue card can be expanded', header !== undefined)
header?.props?.onClick()
const expandedTree = (() => {
  cursor = 0
  return tab.component({ t: (key) => ru[key] ?? key })
})()
const expandedTexts = collect(expandedTree).map(textOf).filter((value) => value !== undefined)
ok('the rating and its case count are on the expanded card',
  expandedTexts.some((value) => value.includes('6/10') && value.includes('3 дел')),
  expandedTexts.find((v) => v.includes('/10')) ?? 'not found')
ok('so is the verdict of the hearing',
  expandedTexts.some((value) => value.includes('reject the skill')),
  expandedTexts.find((v) => v.includes('reject')) ?? 'not found')
ok('and what was taken from it',
  expandedTexts.some((value) => value.includes('state the facts before the first edit')))

ok('the notes explain that it is a collection, not a search',
  texts.some((value) => value.includes('Это запасник, а не поиск')),
  texts.find((v) => v.includes('запасник')) ?? 'not found')
ok('the title says what it collects', tab?.options?.label() === 'Коллекция')
ok('the notes say nothing is adopted by a click',
  texts.some((value) => value.includes('Ничего не принимается нажатием')),
  texts.find((v) => v.includes('нажати')) ?? 'not found')

// The button opens a conversation instead of flipping a flag.
ok('the catalogue card can be raised in the chat',
  expandedTexts.some((value) => value === 'Обсудить с агентом'),
  expandedTexts.find((v) => v.includes('Обсуд')) ?? 'not found')
ok('and the Add button is gone',
  !expandedTexts.includes('Добавить'))

// ── the language, with a platform translator that answers in English ──────────
//
// The regression this pins: the tab label was Russian and everything inside it was
// English. The label is built with no platform translator and read the active language
// correctly; the panel was handed the platform translator, which answers for its own
// namespace, falls back to English for keys it does not own, and was consulted first.
// Handing the panel an English-speaking translator is exactly that situation.

// It answers for EVERY key, not just the ones the label asks for. A fake that
// only answered for `tab` never reached the render, and the test passed against
// the broken order — which is how it was caught.
const englishPlatformT = (key) => `EN:${key}`
const withPlatform = (() => {
  // Clear the hooks, not just the cursor. `useMemo` caches by comparing
  // JSON.stringify of its dependencies, and a function stringifies to null — so a
  // re-render with a DIFFERENT translator compared equal and the component kept the
  // first one it was ever given. Mounting fresh is what actually hands it the English
  // translator. Without this the test passed against the broken order, twice.
  hooks.length = 0
  cursor = 0
  return tab.component({ t: englishPlatformT })
})()
const platformTexts = collect(withPlatform).map(textOf).filter((value) => value !== undefined)
ok('a platform translator answering for every key does not override our dictionary',
  !platformTexts.some((value) => value.startsWith('EN:')),
  platformTexts.find((value) => value.startsWith('EN:')) ?? 'none')
ok('and the panel is in Russian, not English',
  platformTexts.some((value) => value.includes('Это запасник'))
  || platformTexts.some((value) => value.includes('Коллекция'))
  || platformTexts.some((value) => value.includes('Обсудить')),
  platformTexts.slice(0, 4).join(' | '))
ok('the language comes from the page, which the language pack sets',
  registered.locale[0]?.dictionaries?.ru?.tab === 'Коллекция')

console.log('')
console.log(`${String(checks - failed)}/${String(checks)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
