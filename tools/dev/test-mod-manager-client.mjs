#!/usr/bin/env node
/**
 * Local verification of the `@local/dsh-mod-manager` browser bundle.
 *
 * Evaluates the hand-written bundle against a stub module loader, a tiny React
 * runtime, and a stub primitives module, then drives the panel: it must register
 * into the Settings → Plugins tab, ask the host for a snapshot, render what the
 * host returned, and post actions that name the layer and the row.
 *
 * The React stub keeps hook state between renders so the loaded state can be
 * inspected, which a single-pass stub cannot show.
 *
 * Usage: node tools/dev/test-mod-manager-client.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const source = readFileSync(join(REPO, 'packages', 'mod-manager', 'lib', 'client.js'), 'utf8')

/** Rows the bundle registered through `window.__ModuleLoader__.load`. */
const rows = []
const fakeWindow = { __ModuleLoader__: { load: (row) => rows.push(row) } }
new Function('window', source)(fakeWindow)
assert.equal(rows.length, 1, 'the bundle registers exactly one module row')
const row = rows[0]
assert.equal(row.id, '@local/dsh-mod-manager', 'the row id is the package name')

// ── stubs ──────────────────────────────────────────────────────────────────
const VALID_PRIMITIVES = new Set(['Button', 'Modal', 'Switch', 'Tag', 'IconPersonalizationOutline16'])

/**
 * React stub that honours hook dependencies.
 *
 * Dependency handling is the point: a stub that re-runs every effect on every
 * render cannot see a render/effect loop, and an earlier version of the panel
 * had exactly that — a translator rebuilt each render made the loader effect
 * refetch forever. Comparing deps the way React does is what makes this test
 * able to fail.
 */
function makeReact() {
  const store = []
  let cursor = 0
  const same = (left, right) =>
    Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))
  const slotAt = (index) => {
    if (!(index in store)) store[index] = {}
    return store[index]
  }
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
      const slot = slotAt(index)
      if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
    },
    useEffect(callback, deps) {
      const slot = slotAt(cursor++)
      if ('deps' in slot && same(slot.deps, deps)) return
      slot.deps = deps
      callback()
    },
    useCallback(fn, deps) {
      const slot = slotAt(cursor++)
      if ('deps' in slot && same(slot.deps, deps)) return slot.value
      slot.deps = deps
      slot.value = fn
      return fn
    },
    useMemo(fn, deps) {
      const slot = slotAt(cursor++)
      if ('deps' in slot && same(slot.deps, deps)) return slot.value
      slot.deps = deps
      slot.value = fn()
      return slot.value
    },
    useRef(value) {
      const slot = slotAt(cursor++)
      if (!('value' in slot)) slot.value = { current: value }
      return slot.value
    },
    __reset() {
      cursor = 0
    },
  }
}

const SNAPSHOT = {
  ok: true,
  home: 'C:\\Users\\admin\\.dsh',
  selfPackage: '@local/dsh-mod-manager',
  managedPrefix: '@local/',
  backupRoot: 'C:\\Users\\admin\\.dsh\\mod-backups',
  layers: [
    {
      key: 'home',
      label: 'home (all profiles)',
      path: 'C:\\Users\\admin\\.dsh\\cordis.patch.yml',
      exists: true,
      rows: [],
    },
    {
      key: 'profile:web',
      label: 'profile web',
      path: 'C:\\Users\\admin\\.dsh\\profiles\\web\\cordis.patch.yml',
      exists: true,
      rows: [
        {
          id: 'locale-ru',
          name: '@local/dsh-locale-ru',
          managed: true,
          self: false,
          disabled: false,
          package: { directory: 'locale-ru', name: '@local/dsh-locale-ru', version: '0.1.0', bytes: 88000, files: 90 },
        },
        {
          id: 'ghost',
          name: '@local/dsh-ghost',
          managed: true,
          self: false,
          disabled: false,
          package: null,
        },
        {
          id: 'mods',
          name: '@local/dsh-mod-manager',
          managed: true,
          self: true,
          package: { directory: 'mod-manager', name: '@local/dsh-mod-manager', version: '0.1.0', bytes: 20000, files: 5 },
        },
        {
          id: 'old-mod',
          name: '@local/dsh-old-mod',
          managed: true,
          self: false,
          disabled: true,
          package: { directory: 'old-mod', name: '@local/dsh-old-mod', version: '0.1.0', bytes: 4096, files: 4 },
        },
      ],
    },
  ],
  orphans: [
    { directory: 'orphan-pkg', name: '@local/orphan-pkg', version: '0.1.0', bytes: 4096, files: 3 },
  ],
  disabled: [],
}

const requests = []
let respondWith = () => SNAPSHOT

const react = makeReact()
const primitives = Object.fromEntries([...VALID_PRIMITIVES].map((key) => [key, key]))
const requireStub = (specifier) => {
  if (specifier === 'react') return react
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require(${specifier})`)
}

const previousWindow = globalThis.window
globalThis.window = fakeWindow
globalThis.location = { origin: 'http://127.0.0.1:3080' }
globalThis.confirm = () => true
globalThis.document = {
  documentElement: { lang: 'ru' },
  querySelectorAll: () => [{
    getAttribute: () => '/plugins/??@local/dsh-locale-ru/client.js,@local/dsh-mod-manager/client.js&rev=abc',
  }],
}
globalThis.performance = { getEntriesByType: () => [] }
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init })
  const body = respondWith()
  return { ok: true, status: 200, json: async () => body }
}

/** Every string in a rendered tree, for assertions that do not care where. */
const stringsOf = (node, out = []) => {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) stringsOf(child, out)
    return out
  }
  if (typeof node === 'object' && node.props !== undefined) {
    stringsOf(node.props.children, out)
  }
  return out
}

/** Buttons in a rendered tree, by their label. */
const buttonsOf = (node, out = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) buttonsOf(child, out)
    return out
  }
  if (node.type === 'Button') out.push(node)
  if (node.props !== undefined) buttonsOf(node.props.children, out)
  return out
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

try {
  const plugin = row.factory(requireStub)

  // 1. exports
  assert.equal(typeof plugin.apply, 'function', 'apply is exported')
  assert.deepEqual(plugin.inject, ['slots', 'locale'], 'the plugin injects the slot and locale registries')
  console.log('ok  1. bundle exports apply/inject')

  // 2. registration
  const injections = []
  const dictionaries = []
  let registered = null
  const ctx = {
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale: {
      register(namespace, dict) {
        dictionaries.push({ namespace, dict })
        return () => {}
      },
    },
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
  assert.deepEqual(injections, ['settings.plugins.tab'], 'targets the Plugins settings tab slot')
  assert.equal(registered.options.name, 'settings.plugins.tab')
  assert.equal(registered.options.id, 'mods', 'list slots require an id')
  assert.equal(registered.options.locale, 'mod-manager')
  assert.equal(typeof registered.options.label, 'function', 'the tab label is resolved live')
  assert.equal(registered.options.label(), 'Моды', 'the label follows the document language')
  console.log('ok  2. registers one tab into Settings → Plugins')

  // 3. dictionaries
  assert.equal(dictionaries.length, 1, 'registers exactly one dictionary namespace')
  assert.deepEqual(Object.keys(dictionaries[0].dict).sort(), ['en', 'ru'], 'both languages are registered')
  assert.equal(dictionaries[0].dict.ru.tab, 'Моды')
  assert.equal(dictionaries[0].dict.en.tab, 'Mods')
  console.log('ok  3. registers the en and ru dictionaries')

  // 4. mount issues one host read
  requests.length = 0
  react.__reset()
  let tree = registered.component({})
  await tick()
  assert.equal(requests.length, 1, 'mounting issues exactly one host request')
  assert.equal(requests[0].url, 'http://127.0.0.1:3080/api/mod-manager.mod', 'it calls the documented route')
  assert.equal(requests[0].init.method, 'GET')
  // Re-rendering must not start another read: a fresh translator per render
  // would do exactly that, forever.
  react.__reset()
  registered.component({})
  await tick()
  assert.equal(requests.length, 1, 'a re-render does not fetch again')
  console.log('ok  4. the panel reads the host snapshot once on mount')

  // 5. the loaded state renders
  react.__reset()
  tree = registered.component({})
  const text = stringsOf(tree).join(' | ')
  assert.ok(text.includes('Установленные моды'), 'the panel renders its heading in Russian')
  assert.ok(text.includes('@local/dsh-locale-ru'), 'it lists the installed mod')
  assert.ok(text.includes('profile web'), 'it lists each patch layer')
  assert.ok(text.includes('id: locale-ru'), 'it shows the row id')
  console.log('ok  5. renders the mods and layers from the host snapshot')

  // 6. the two facts are kept apart
  assert.ok(text.includes('на диске'), 'an installed package is marked as on disk')
  assert.ok(text.includes('нет на диске'), 'a row without a package is marked as missing')
  assert.ok(text.includes('отдан этой странице'), 'it reports what the page was served')
  console.log('ok  6. shows on-disk and served state separately')

  // 7. served detection follows what the page actually requested
  const renderText = () => {
    react.__reset()
    return stringsOf(registered.component({})).join(' | ')
  }
  // a) the DOM carries the boot-graph request
  assert.ok(renderText().includes('отдан этой странице'), 'a mod in the script tag reads as served')
  // b) the request has left the DOM but is still in the resource timeline
  globalThis.document = { documentElement: { lang: 'ru' }, querySelectorAll: () => [] }
  globalThis.performance = {
    getEntriesByType: () => [{ name: 'http://127.0.0.1:3080/plugins/??@local/dsh-locale-ru/client.js&rev=abc' }],
  }
  const viaTimeline = renderText()
  assert.ok(viaTimeline.includes('отдан этой странице'), 'the resource timeline alone is enough to read as served')
  // c) neither source mentions it
  globalThis.performance = { getEntriesByType: () => [] }
  assert.ok(renderText().includes('не отдан здесь'), 'with no boot graph at all, nothing reads as served')
  // back to the normal state
  globalThis.document = {
    documentElement: { lang: 'ru' },
    querySelectorAll: () => [{
      getAttribute: () => '/plugins/??@local/dsh-locale-ru/client.js,@local/dsh-mod-manager/client.js&rev=abc',
    }],
  }
  console.log('ok  7. served state comes from the boot graph the page requested')

  // 8. action set follows the row's real state
  react.__reset()
  tree = registered.component({})
  const turnOff = buttonsOf(tree).filter((node) => node.props.children === 'Выключить')
  const turnOn = buttonsOf(tree).filter((node) => node.props.children === 'Включить')
  assert.equal(turnOff.length, 2, 'both rows present in the patch file offer Turn off, including the one missing on disk')
  assert.equal(turnOn.length, 1, 'the turned-off row is still listed, and offers Turn on')
  assert.ok(stringsOf(tree).join(' | ').includes('выключен'), 'a turned-off row is marked as such')
  assert.ok(!stringsOf(tree).join(' | ').includes('@local/dsh-mod-manager | id: mods | эта панель | не управляется'), 'the manager row carries no actions')
  console.log('ok  8. the panel offers Turn off, Turn on and no self-management by row state')

  // 9. turning a mod off posts the layer and the row
  requests.length = 0
  const [firstDisable] = turnOff
  firstDisable.props.onClick()
  await tick()
  assert.equal(requests.length, 1, 'turning off issues one host request')
  assert.equal(requests[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    action: 'disable',
    layer: 'profile:web',
    id: 'locale-ru',
  }, 'the action names the layer and the row')
  console.log('ok  9. Turn off posts the action with its layer and row id')

  // 10. turning a mod back on posts enable
  requests.length = 0
  const [firstEnable] = turnOn
  firstEnable.props.onClick()
  await tick()
  assert.equal(requests.length, 1, 'turning on issues one host request')
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    action: 'enable',
    layer: 'profile:web',
    id: 'old-mod',
  }, 'enable names the turned-off row')
  console.log('ok 10. Turn on posts the action for the turned-off row')

  // 11. a host error code is translated, never shown raw
  respondWith = () => ({ ok: false, code: 'self-managed' })
  react.__reset()
  tree = registered.component({})
  const refresh = buttonsOf(tree).find((node) => node.props.children === 'Обновить')
  assert.ok(refresh !== undefined, 'the panel offers a refresh action')
  requests.length = 0
  refresh.props.onClick()
  await tick()
  react.__reset()
  tree = registered.component({})
  const afterError = stringsOf(tree).join(' | ')
  assert.ok(afterError.includes('не может выключить саму себя'), 'the code is translated')
  assert.ok(!afterError.includes('self-managed'), 'the raw code is not shown')
  console.log('ok 11. host error codes are translated, not displayed raw')

  // 12. uninstall asks first, then posts
  respondWith = () => SNAPSHOT
  react.__reset()
  tree = registered.component({})
  const removeButton = buttonsOf(tree).find((node) => node.props.children === 'Удалить')
  assert.ok(removeButton !== undefined, 'a manageable installed mod offers Remove')
  // Count only what the click causes: rendering above already issued its read.
  requests.length = 0
  removeButton.props.onClick()
  await tick()
  assert.equal(requests.length, 1, 'removing issues one host request')
  assert.equal(JSON.parse(requests[0].init.body).action, 'uninstall')
  console.log('ok 12. Remove confirms first, then posts the action')

  // 13. the dictionary answers when the platform supplies no translator
  globalThis.document = { documentElement: { lang: 'en' }, querySelectorAll: () => [] }
  react.__reset()
  const english = stringsOf(registered.component({})).join(' | ')
  assert.ok(english.includes('Installed mods'), 'the English dictionary answers for an English document')
  assert.ok(english.includes('missing on disk'), 'and its own wording for a missing package')
  console.log('ok 13. falls back to its own dictionary per document language')

  console.log('')
  console.log('PASS — mod-manager browser bundle verified')
} finally {
  globalThis.window = previousWindow
}
