/**
 * Local verification of the `@local/dsh-style-switch` host half.
 *
 * Drives the plugin with a fake Cordis context: it proves the Cordis contract,
 * that the DEFAULT style contributes nothing at all (no prompt section), that
 * choosing КОДЕКС registers exactly one section whose text provider is live,
 * that going back to DSH disposes it, and that the route rejects what it should.
 *
 * The state file is written into a temporary DSH home, so this never touches the
 * user's real `~/.dsh/style-switch.json`.
 *
 * Usage: node tools/dev/test-style-switch.mjs
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-style-switch-'))
process.env.DSH_HOME = home

const plugin = await import('../../packages/style-switch/lib/index.js')

/** A fake host context recording what the plugin registers. */
function makeContext() {
  const sections = []
  let route = null
  const effects = []
  const ctx = {
    systemPrompt: {
      section(options) {
        const entry = { options, disposed: false }
        sections.push(entry)
        return () => {
          entry.disposed = true
        }
      },
    },
    connection: {
      fetch: {
        register(options) {
          route = options
          return () => {}
        },
      },
    },
    logger: { info() {} },
    effect(callback, label) {
      effects.push({ label, dispose: callback() })
    },
  }
  return { ctx, sections, effects, routeOf: () => route }
}

const post = (route, body) => route.fetch(new Request('http://dsh.internal/api/style-switch.mod', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))
const get = (route) => route.fetch(new Request('http://dsh.internal/api/style-switch.mod', { method: 'GET' }))

try {
  // ── 1. Cordis contract ───────────────────────────────────────────────────
  assert.equal(plugin.name, 'style-switch')
  assert.deepEqual(plugin.inject, ['systemPrompt', 'connection'])
  console.log('ok  1. exports the Cordis contract (name, inject, apply)')

  // ── 2. the default style contributes nothing ─────────────────────────────
  const first = makeContext()
  plugin.apply(first.ctx)
  assert.equal(plugin.DEFAULT_STYLE, 'dsh')
  assert.equal(first.sections.length, 0, 'DSH registers no prompt section: the shipped prompt stays untouched')
  assert.equal(first.effects.length, 2, 'both lifecycles are bound to the plugin effect')
  console.log('ok  2. default style DSH contributes nothing to the prompt')

  // ── 3. the route describes the choice ────────────────────────────────────
  const route = first.routeOf()
  assert.equal(route.path, '/api/style-switch.mod')
  assert.deepEqual(route.methods, ['GET', 'POST'])
  const initial = await (await get(route)).json()
  assert.equal(initial.style, 'dsh')
  assert.equal(initial.contributes, false)
  assert.deepEqual(initial.styles.map((style) => style.id), ['dsh', 'codex'])
  assert.ok(initial.styles[0].length === 0, 'DSH carries no text')
  assert.ok(initial.styles[1].length > 200, 'КОДЕКС carries the real style text')
  console.log('ok  3. GET reports the current style and both options')

  // ── 4. choosing КОДЕКС registers one live section ────────────────────────
  const chosen = await (await post(route, { style: 'codex' })).json()
  assert.equal(chosen.style, 'codex')
  assert.equal(chosen.contributes, true)
  assert.equal(first.sections.length, 1, 'exactly one section is registered')
  const section = first.sections[0].options
  assert.equal(section.name, 'mod:style-switch')
  assert.equal(section.order, 10350, 'the style block sits after the shipped sections')
  assert.equal(section.complete, false, 'the style adds to the prompt, it does not replace it')
  const text = section.text()
  assert.match(text, /СТИЛЬ РАБОТЫ: КОДЕКС/)
  assert.match(text, /ветвями случаев/)
  assert.ok(!text.includes('{{'), 'no {{variable}} groups: renderPrompt interpolates them strictly')
  console.log('ok  4. choosing КОДЕКС registers one section with the style text')

  // ── 5. the state survives a reload ───────────────────────────────────────
  const stored = JSON.parse(readFileSync(join(home, 'style-switch.json'), 'utf8'))
  assert.deepEqual(stored, { style: 'codex' })
  assert.equal(plugin.readState().style, 'codex', 'state is read back from disk')
  console.log('ok  5. the choice is persisted and read back')

  // ── 6. going back to DSH disposes the section ────────────────────────────
  const back = await (await post(route, { style: 'dsh' })).json()
  assert.equal(back.contributes, false)
  assert.equal(first.sections[0].disposed, true, 'the section is disposed, not left empty')
  assert.equal(first.sections.length, 1, 'and no second one is registered')
  console.log('ok  6. returning to DSH disposes the section')

  // ── 7. refusals ──────────────────────────────────────────────────────────
  const unknown = await post(route, { style: 'nope' })
  assert.equal(unknown.status, 400)
  assert.match((await unknown.json()).error, /unknown style/)
  const missing = await post(route, {})
  assert.equal(missing.status, 400)
  const badJson = await route.fetch(new Request('http://dsh.internal/api/style-switch.mod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json',
  }))
  assert.equal(badJson.status, 400)
  assert.equal(plugin.readState().style, 'dsh', 'a refused request changes nothing')
  console.log('ok  7. unknown style, missing field and broken JSON are refused')

  // ── 8. a corrupt state file costs the preference, not the plugin ─────────
  const second = makeContext()
  plugin.writeState({ style: 'nonsense' })
  assert.equal(plugin.readState().style, 'dsh', 'an unknown stored id falls back to the default')
  plugin.apply(second.ctx)
  assert.equal(second.sections.length, 0)
  console.log('ok  8. an unreadable choice falls back to DSH')

  console.log('\nPASS — host half verified')
} finally {
  rmSync(home, { recursive: true, force: true })
}
