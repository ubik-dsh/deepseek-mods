/**
 * Verify the generated `@local/dsh-locale-ru` browser bundle.
 *
 * Evaluates the bundle against a stub module loader and a stub locale service:
 * it proves the row id, the Cordis contract, the language definition, and that
 * every translated namespace registers with exactly the English key set.
 *
 * Usage: node _dsh_mod/test-locale-ru.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..', '..', 'packages', 'locale-ru')
const source = readFileSync(join(pkg, 'lib', 'client.js'), 'utf8')

const rows = []
new Function('window', source)({ __ModuleLoader__: { load: (row) => rows.push(row) } })

assert.equal(rows.length, 1, 'the bundle registers exactly one module row')
assert.equal(rows[0].id, '@local/dsh-locale-ru', 'the row id is the package name')
assert.equal(typeof rows[0].factory, 'function')

const plugin = rows[0].factory((specifier) => {
  throw new Error(`unexpected require(${specifier})`)
})
assert.equal(typeof plugin.apply, 'function', 'apply is exported')
assert.deepEqual(plugin.inject, ['locale'], 'the plugin injects the locale registry')
console.log('ok  1. bundle exports the Cordis contract for the locale registry')

const languages = []
const registered = new Map()
const ctx = {
  effect(callback) {
    callback()
  },
  locale: {
    addLanguage(definition) {
      languages.push(definition)
      return () => {}
    },
    register(namespace, locale, dictionary) {
      registered.set(namespace, { locale, dictionary })
      return () => {}
    },
  },
}

plugin.apply(ctx)

assert.equal(languages.length, 1, 'exactly one language is defined')
assert.deepEqual(languages[0], { id: 'ru', label: 'Русский', fallback: 'en' }, 'the language is ru with an en fallback')
console.log('ok  2. registers the ru language with an English fallback chain')

const enDir = join(pkg, 'i18n', 'en')
const expected = readdirSync(enDir).filter((name) => name.endsWith('.json'))
assert.equal(registered.size, expected.length, `registers every namespace (${String(expected.length)})`)
for (const name of expected) {
  const namespace = name.slice(0, -'.json'.length)
  const entry = registered.get(namespace)
  assert.ok(entry !== undefined, `namespace ${namespace} is registered`)
  assert.equal(entry.locale, 'ru')
  const en = JSON.parse(readFileSync(join(enDir, name), 'utf8'))
  const ruKeys = Object.keys(entry.dictionary)
  const missing = Object.keys(en).filter((key) => !ruKeys.includes(key))
  assert.deepEqual(missing, [], `${namespace} covers every English key`)
  for (const [key, value] of Object.entries(entry.dictionary)) {
    assert.equal(typeof value, 'string', `${namespace}.${key} is a string`)
    assert.notEqual(value, '', `${namespace}.${key} is not empty`)
  }
}
console.log(`ok  3. all ${String(registered.size)} namespaces register with full key coverage`)

const totalKeys = [...registered.values()].reduce((sum, entry) => sum + Object.keys(entry.dictionary).length, 0)
const cyrillic = [...registered.values()]
  .flatMap((entry) => Object.values(entry.dictionary))
  .filter((value) => /[А-Яа-яЁё]/u.test(value)).length
console.log(`ok  4. ${String(totalKeys)} keys loaded, ${String(cyrillic)} of them contain Cyrillic`)

console.log('\nPASS — Russian language pack verified')
