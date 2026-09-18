/**
 * Local verification of the `@local/dsh-system-prompt-mod` host half.
 *
 * Runs the real `renderPrompt` from `@deepseek-ai/dsh-system-prompt` against a
 * fake Cordis context, exercises the registered HTTP route end to end, and
 * asserts the section lifecycle (append / replace / disabled) plus persistence.
 *
 * Usage: node _dsh_mod/test-host.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// A dedicated home: this test wipes its state root, so it must never share one
// with a running DSH instance.
const home = join(here, '_testhome-host')

rmSync(home, { recursive: true, force: true })
process.env.DSH_HOME = home

const mod = await import('../../packages/system-prompt-mod/lib/index.js')

/** Registered prompt sections, mirroring the real registry's add/remove behavior. */
const sections = []
/** The exact Fetch route the plugin registered. */
let route = null
/** Disposers collected from `ctx.effect`. */
const effectDisposers = []
/** Log lines the plugin emitted. */
const logs = []
/** The last `assemble()` context the plugin asked for. */
let lastAssembleContext = null
/** When true, the fake assembly carries a variable no provider resolved. */
let injectUnresolved = false
/** The live agent the fake registry answers for `known-session`. */
const agentStub = { id: 'known-session' }

const BASE_SECTIONS = [
  { name: 'harness-identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
  { name: 'deployment:persona-prefix', text: 'You are a coding agent.' },
]

const ctx = {
  logger: { info: (line) => logs.push(line) },
  agents: {
    get(id) {
      return id === agentStub.id ? agentStub : undefined
    },
  },
  systemPrompt: {
    section(section) {
      sections.push(section)
      return () => {
        const index = sections.indexOf(section)
        if (index >= 0) sections.splice(index, 1)
      }
    },
    async assemble(context) {
      lastAssembleContext = context ?? null
      const resolved = sections.map((section) => ({
        name: section.name,
        text: typeof section.text === 'function' ? section.text({}) : section.text,
      }))
      // The real registry restores an effective `complete` section as the sole
      // prompt section after the assembly waterfall.
      const complete = resolved.filter((section) => {
        const source = sections.find((candidate) => candidate.name === section.name)
        return source?.complete === true && section.text !== ''
      })
      const base = injectUnresolved
        ? [...BASE_SECTIONS, { name: 'deployment:persona-suffix', text: 'Model: {{model}}.' }]
        : BASE_SECTIONS
      const assembled = complete.length > 0 ? [complete[0]] : [...base, ...resolved]
      return { sections: assembled, contexts: [], tools: [], variables: {} }
    },
  },
  connection: {
    fetch: {
      register(registered) {
        route = registered
        return async () => {
          route = null
        }
      },
    },
  },
  effect(callback) {
    effectDisposers.push(callback())
  },
}

mod.apply(ctx)

assert.equal(route?.path, '/api/system-prompt.mod', 'plugin registered its route')
assert.deepEqual(route.methods, ['GET', 'POST'], 'route owns GET and POST')
assert.equal(route.requestBody, 'buffered', 'route buffers its JSON body')
assert.equal(sections.length, 0, 'a fresh install registers no prompt section')
assert.equal(mod.statePath(), join(home, 'system-prompt-mod.json'), 'DSH_HOME is the state root')
assert.equal(existsSync(mod.statePath()), false, 'a fresh install writes no state file')

const url = 'http://dsh.internal/api/system-prompt.mod'
const get = (sessionId) => route.fetch(new Request(
  sessionId === undefined ? url : `${url}?sessionId=${encodeURIComponent(sessionId)}`,
  { method: 'GET' },
))
const post = (payload) => route.fetch(new Request(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
}))

// ── 1. initial read ────────────────────────────────────────────────────────
{
  const response = await get()
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.enabled, false)
  assert.equal(body.active, false)
  assert.equal(body.mode, 'append')
  assert.equal(body.baseAvailable, true, 'a disabled mod leaves the base available')
  assert.equal(
    body.effectivePrompt,
    'You are an AI agent powered by DeepSeek Harness.\n\nYou are a coding agent.',
    'effective prompt renders the untouched deployment prompt',
  )
  assert.equal(body.basePrompt, body.effectivePrompt)
  assert.equal(body.path, join(home, 'system-prompt-mod.json'))
  console.log('ok  1. GET on a fresh install returns the deployment prompt')
}

// ── 2. invalid variable group is rejected ──────────────────────────────────
{
  const response = await post({ enabled: true, mode: 'append', text: 'hello {{cwd}}' })
  assert.equal(response.status, 400, 'a {{variable}} group is refused')
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.match(body.error, /\{\{переменная\}\}/)
  assert.equal(sections.length, 0, 'a rejected edit never registers a section')
  console.log('ok  2. {{variable}} input is refused with an explanation')
}

// ── 3. empty text cannot be enabled ────────────────────────────────────────
{
  const response = await post({ enabled: true, mode: 'append', text: '   ' })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).ok, false)
  console.log('ok  3. enabling an empty override is refused')
}

// ── 4. append mode ─────────────────────────────────────────────────────────
{
  const response = await post({ enabled: true, mode: 'append', text: 'Always answer in Russian.' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.active, true)
  assert.equal(body.mode, 'append')
  assert.equal(sections.length, 1, 'append registers exactly one section')
  assert.equal(sections[0].name, 'mod:user-system-prompt')
  assert.equal(sections[0].order, 10300)
  assert.equal(sections[0].complete, false, 'append is not a complete section')
  assert.equal(
    body.effectivePrompt,
    'You are an AI agent powered by DeepSeek Harness.\n\nYou are a coding agent.\n\nAlways answer in Russian.',
    'the override is appended after the deployment prompt',
  )
  assert.equal(
    body.basePrompt,
    'You are an AI agent powered by DeepSeek Harness.\n\nYou are a coding agent.',
    'the base preview hides this plugin\'s own section',
  )
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'system-prompt-mod.json'), 'utf8')), {
    enabled: true,
    mode: 'append',
    text: 'Always answer in Russian.',
  }, 'state is persisted as JSON')
  console.log('ok  4. append mode appends, persists, and keeps the base visible')
}

// ── 5. a saved edit reaches the next assembly without re-registering ───────
{
  const before = sections[0]
  const response = await post({ text: 'Always answer in Russian, briefly.' })
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(sections.length, 1)
  assert.notEqual(sections[0], before, 'mode/enable sync re-registers the section')
  assert.equal(typeof sections[0].text, 'function', 'section text stays a live provider')
  assert.match(body.effectivePrompt, /briefly\.$/, 'the edit is visible immediately')
  console.log('ok  5. a saved edit changes the rendered prompt at once')
}

// ── 6. replace mode ────────────────────────────────────────────────────────
{
  const response = await post({ enabled: true, mode: 'replace', text: 'You are a terse assistant.' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(sections.length, 1)
  assert.equal(sections[0].complete, true, 'replace registers a complete section')
  assert.equal(body.effectivePrompt, 'You are a terse assistant.', 'replace owns the whole prompt')
  assert.equal(body.baseAvailable, false, 'replace leaves no base to show')
  assert.equal(body.basePrompt, null)
  console.log('ok  6. replace mode becomes the complete system prompt')
}

// ── 7. disabling restores the deployment prompt ────────────────────────────
{
  const response = await post({ enabled: false })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.active, false)
  assert.equal(sections.length, 0, 'disabling unregisters the section')
  assert.equal(
    body.effectivePrompt,
    'You are an AI agent powered by DeepSeek Harness.\n\nYou are a coding agent.',
    'the original prompt comes back',
  )
  assert.equal(body.text, 'You are a terse assistant.', 'the disabled text is kept for later')
  console.log('ok  7. disabling restores the deployment prompt and keeps the draft')
}

// ── 8. reload from disk ────────────────────────────────────────────────────
{
  const reloaded = mod.readState()
  assert.deepEqual(reloaded, { enabled: false, mode: 'replace', text: 'You are a terse assistant.' })
  assert.equal(mod.statePath(), join(home, 'system-prompt-mod.json'))
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['systemPrompt', 'connection', 'agents'])
  assert.equal(mod.name, 'system-prompt-mod')
  console.log('ok  8. persisted state round-trips and the plugin exports its contract')
}

// ── 9. a named session assembles in that live agent's scope ────────────────
{
  await post({ enabled: false })
  const unscoped = await (await get()).json()
  assert.deepEqual(lastAssembleContext, {}, 'without a session the assembly is scope-less')
  assert.equal(unscoped.scoped, false)
  assert.equal(unscoped.sessionId, null)

  const scoped = await (await get('known-session')).json()
  assert.equal(scoped.scoped, true, 'a live session is assembled through its agent')
  assert.equal(scoped.sessionId, 'known-session')
  assert.equal(lastAssembleContext.agent, agentStub, 'the agent is handed to the registry')
  assert.equal(lastAssembleContext.scope, agentStub, 'the scope key is the same agent')

  const unknown = await (await get('no-such-session')).json()
  assert.equal(unknown.scoped, false, 'an unknown session degrades to the global layer')
  console.log('ok  9. the preview follows the live agent scope of the named session')
}

// ── 10. an unresolvable variable degrades instead of failing ───────────────
{
  injectUnresolved = true
  try {
    const body = await (await get('known-session')).json()
    assert.equal(body.exact, false, 'the tolerant renderer reports itself')
    assert.match(body.error, /\{\{model\}\}/, 'the reason names the unresolved variable')
    assert.match(body.effectivePrompt, /Model: \{\{model\}\}\./, 'the literal reference is shown instead of nothing')
    assert.ok(body.effectivePrompt.startsWith('You are an AI agent'), 'the rest of the prompt still renders')
    assert.equal(body.baseAvailable, true)
  } finally {
    injectUnresolved = false
  }
  const exact = await (await get('known-session')).json()
  assert.equal(exact.exact, true, 'a resolvable assembly renders exactly')
  assert.equal(exact.error, null)
  console.log('ok 10. an unresolved variable degrades the preview, never the editor')
}

// ── 11. lifecycle disposal ─────────────────────────────────────────────────
{
  await post({ enabled: true, mode: 'append', text: 'live' })
  assert.equal(sections.length, 1)
  for (const dispose of effectDisposers) await dispose()
  assert.equal(sections.length, 0, 'disposing the plugin removes its section')
  assert.equal(route, null, 'disposing the plugin removes its route')
  console.log('ok 11. plugin disposal unregisters the section and the route')
}

console.log(`\nPASS — host half verified (${String(logs.length)} log lines)`)
