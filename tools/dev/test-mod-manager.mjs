#!/usr/bin/env node
/**
 * Unit tests for `@local/dsh-mod-manager`'s host half.
 *
 * The host half imports nothing but Node built-ins, so this runs anywhere:
 * no DSH installation, no running server, no network. That is why it is in CI
 * while `test-host.mjs` is not.
 *
 * Actions are exercised through the real route handler with a stubbed
 * `connection` service, so the wiring is covered, not just the pure helpers.
 *
 * Usage: node tools/dev/test-mod-manager.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MOD = await import(`file://${join(REPO, 'packages', 'mod-manager', 'lib', 'index.js').replace(/\\/gu, '/')}`)

let checks = 0
let failed = 0
const ok = (label, condition, detail) => {
  checks += 1
  if (condition) {
    console.log(`ok ${String(checks).padStart(2)}. ${label}`)
  } else {
    failed += 1
    console.log(`FAIL ${String(checks).padStart(2)}. ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// ── fixture Harness home ───────────────────────────────────────────────────
const home = mkdtempSync(join(tmpdir(), 'mod-manager-test-'))
const patch = (profile) => join(home, 'profiles', profile, 'cordis.patch.yml')
const packageDir = (directory) => join(home, 'profiles', 'node_modules', '@local', directory)
process.env.DSH_HOME = home

const HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
`
const template = `${HEADER}\n[]\n`
const row = (id, name) => `- insert:\n    - id: ${id}\n      name: '${name}'`

mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
writeFileSync(join(home, 'cordis.patch.yml'), template, 'utf8')
writeFileSync(patch('web'), `${HEADER}\n${row('locale-ru', '@local/dsh-locale-ru')}\n\n${row('system-prompt-mod', '@local/dsh-system-prompt-mod')}\n`, 'utf8')

for (const [directory, name] of [
  ['locale-ru', '@local/dsh-locale-ru'],
  ['system-prompt-mod', '@local/dsh-system-prompt-mod'],
  ['orphan-pkg', '@local/orphan-pkg'],
  ['mod-manager', '@local/dsh-mod-manager'],
]) {
  mkdirSync(packageDir(directory), { recursive: true })
  writeFileSync(join(packageDir(directory), 'package.json'), JSON.stringify({ name, version: '0.1.0' }), 'utf8')
  writeFileSync(join(packageDir(directory), 'body.js'), 'x'.repeat(128), 'utf8')
}

// ── pure helpers ───────────────────────────────────────────────────────────
const parsed = MOD.parseRows(readFileSync(patch('web'), 'utf8'))
ok('parseRows reads both rows out of installer output',
  parsed.length === 2 && parsed[0].id === 'locale-ru' && parsed[0].name === '@local/dsh-locale-ru',
  JSON.stringify(parsed))

ok('parseRows tolerates double quotes and different indentation',
  MOD.parseRows('- insert:\n  - id: "a"\n    name: "@local/a"\n')[0]?.name === '@local/a')

ok('parseRows ignores comments and a name without an id',
  MOD.parseRows(`${HEADER}\nname: '@local/loose'\n`).length === 0)

const replaced = MOD.addRow(template, 'x', '@local/x')
ok('addRow replaces the empty [] document instead of appending to it',
  !/\[\]/u.test(replaced) && replaced.includes("- id: x") && replaced.includes("name: '@local/x'"),
  JSON.stringify(replaced))

const appended = MOD.addRow(`${HEADER}\n${row('a', '@local/a')}\n`, 'b', '@local/b')
ok('addRow appends to a non-empty document and keeps the existing row',
  MOD.parseRows(appended).length === 2 && MOD.parseRows(appended)[1].id === 'b')

const twoRows = `${HEADER}\n${row('a', '@local/a')}\n\n${row('b', '@local/b')}\n`
const oneLeft = MOD.removeRow(twoRows, 'a')
ok('removeRow drops only the named row',
  MOD.parseRows(oneLeft).length === 1 && MOD.parseRows(oneLeft)[0].id === 'b',
  JSON.stringify(MOD.parseRows(oneLeft)))

const noneLeft = MOD.removeRow(`${HEADER}\n${row('a', '@local/a')}\n`, 'a')
const noneMeaningful = noneLeft
  .split(/\r?\n/u)
  .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  .join('\n')
  .trim()
ok('removeRow restores the [] template when the last row goes',
  noneMeaningful === '[]',
  JSON.stringify(noneMeaningful))

// ── snapshot ───────────────────────────────────────────────────────────────
const view = MOD.snapshot()
const webLayer = view.layers.find((layer) => layer.key === 'profile:web')
ok('snapshot lists both layers',
  view.layers.length === 2 && view.layers.some((layer) => layer.key === 'home'),
  view.layers.map((layer) => layer.key).join(','))

ok('snapshot resolves a row to its package by package.json name, not by directory',
  webLayer.rows[0].package?.directory === 'locale-ru' && webLayer.rows[0].package?.name === '@local/dsh-locale-ru',
  JSON.stringify(webLayer.rows[0].package))

ok('snapshot reports a package with no row as an orphan',
  view.orphans.some((entry) => entry.name === '@local/orphan-pkg'),
  view.orphans.map((entry) => entry.name).join(','))

ok('snapshot measures the installed package',
  (webLayer.rows[0].package?.bytes ?? 0) > 0 && (webLayer.rows[0].package?.files ?? 0) === 2,
  JSON.stringify({ bytes: webLayer.rows[0].package?.bytes, files: webLayer.rows[0].package?.files }))

// ── actions through the real route handler ─────────────────────────────────
let handler = null
const ctx = {
  connection: { fetch: { register: (options) => { handler = options.fetch; return () => {} } } },
  effect: (fn) => { fn(); return () => {} },
}
MOD.apply(ctx)
ok('apply registers GET and POST on the documented path',
  handler !== null && MOD.MOD_ROUTE_PATH === '/api/mod-manager.mod')

const call = async (method, body) => {
  const init = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'content-type': 'application/json' }
  }
  const response = await handler(new Request(`http://127.0.0.1:3080${MOD.MOD_ROUTE_PATH}`, init))
  return { status: response.status, body: await response.json() }
}

const read = await call('GET')
ok('GET returns a snapshot with ok:true', read.status === 200 && read.body.ok === true)

const bad = await call('POST', { action: 'disable' })
ok('POST without a layer is refused as a bad request',
  bad.status === 400 && bad.body.code === 'bad-request', JSON.stringify(bad.body))

const forbidden = await call('POST', { action: 'disable', layer: 'profile:web', id: 'locale-ru-other' })
ok('POST for a row that is not there is refused as row-not-found',
  forbidden.body.code === 'row-not-found', JSON.stringify(forbidden.body))

// A row naming a shipped plugin must never be managed.
writeFileSync(patch('web'), `${HEADER}\n${row('locale-ru', '@local/dsh-locale-ru')}\n\n${row('shipped', '@deepseek-ai/dsh-client-ui-chat')}\n`, 'utf8')
const guarded = await call('POST', { action: 'disable', layer: 'profile:web', id: 'shipped' })
ok('a row naming a shipped plugin is refused',
  guarded.body.code === 'forbidden-package', JSON.stringify(guarded.body))

// The manager refuses to turn itself off.
writeFileSync(patch('web'), `${HEADER}\n${row('locale-ru', '@local/dsh-locale-ru')}\n\n${row('mods', '@local/dsh-mod-manager')}\n`, 'utf8')
const selfGuard = await call('POST', { action: 'disable', layer: 'profile:web', id: 'mods' })
ok('the manager refuses to disable itself',
  selfGuard.body.code === 'self-managed', JSON.stringify(selfGuard.body))

// disable: row goes, ledger records it, a snapshot of the patch is written.
writeFileSync(patch('web'), `${HEADER}\n${row('locale-ru', '@local/dsh-locale-ru')}\n\n${row('system-prompt-mod', '@local/dsh-system-prompt-mod')}\n`, 'utf8')
const disabled = await call('POST', { action: 'disable', layer: 'profile:web', id: 'locale-ru' })
const afterDisable = MOD.parseRows(readFileSync(patch('web'), 'utf8'))
ok('disable removes the row and leaves the other one',
  disabled.body.ok === true && afterDisable.length === 1 && afterDisable[0].id === 'system-prompt-mod',
  JSON.stringify(afterDisable))
ok('disable records the row in the ledger',
  MOD.readLedger().disabled.some((entry) => entry.id === 'locale-ru' && entry.name === '@local/dsh-locale-ru'),
  JSON.stringify(MOD.readLedger()))
const snapshots = existsSync(join(home, 'mod-backups')) ? readdirSync(join(home, 'mod-backups')) : []
ok('disable snapshots the patch file before writing',
  snapshots.length > 0 && readdirSync(join(home, 'mod-backups', snapshots[0])).some((f) => f.endsWith('.yml')),
  snapshots.join(','))

// enable: the row comes back and the ledger forgets it.
const enabled = await call('POST', { action: 'enable', layer: 'profile:web', id: 'locale-ru' })
ok('enable restores the row',
  enabled.body.ok === true && MOD.parseRows(readFileSync(patch('web'), 'utf8')).length === 2,
  readFileSync(patch('web'), 'utf8'))
ok('enable clears the ledger entry',
  !MOD.readLedger().disabled.some((entry) => entry.id === 'locale-ru'),
  JSON.stringify(MOD.readLedger()))

// enable refuses when the package is not on disk.
writeFileSync(patch('web'), `${HEADER}\n${row('ghost', '@local/ghost')}\n`, 'utf8')
const ghost = await call('POST', { action: 'enable', layer: 'profile:web', id: 'ghost' })
ok('enable refuses when the package is not installed',
  ghost.body.code === 'package-not-installed', JSON.stringify(ghost.body))

// uninstall: package removed, rows removed everywhere, package snapshotted.
writeFileSync(join(home, 'cordis.patch.yml'), `${HEADER}\n${row('locale-ru-home', '@local/dsh-locale-ru')}\n`, 'utf8')
writeFileSync(patch('web'), `${HEADER}\n${row('locale-ru', '@local/dsh-locale-ru')}\n\n${row('system-prompt-mod', '@local/dsh-system-prompt-mod')}\n`, 'utf8')
const removed = await call('POST', { action: 'uninstall', layer: 'profile:web', id: 'locale-ru' })
ok('uninstall deletes the package directory',
  !existsSync(packageDir('locale-ru')) && removed.body.ok === true)
ok('uninstall removes the row from every layer',
  MOD.parseRows(readFileSync(patch('web'), 'utf8')).length === 1
    && !readFileSync(join(home, 'cordis.patch.yml'), 'utf8').includes('locale-ru'),
  readFileSync(join(home, 'cordis.patch.yml'), 'utf8'))
const snapDirs = readdirSync(join(home, 'mod-backups')).sort()
const lastSnap = snapDirs[snapDirs.length - 1]
ok('uninstall snapshots the package before deleting it',
  existsSync(join(home, 'mod-backups', lastSnap, 'packages', 'locale-ru', 'package.json')),
  snapDirs.join(','))

ok('no file was written outside the Harness home',
  !existsSync(join(REPO, 'mod-backups')))

rmSync(home, { recursive: true, force: true })

console.log('')
if (failed === 0) {
  console.log(`PASS — mod-manager host half verified (${String(checks)} checks)`)
  process.exit(0)
}
console.log(`FAIL — ${String(failed)} of ${String(checks)} checks failed`)
process.exit(1)
