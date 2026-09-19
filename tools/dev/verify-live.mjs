#!/usr/bin/env node
/**
 * Verify a running DSH Web GUI, end to end, over HTTP alone.
 *
 * `tools/boot-check.mjs` answers one question — is each mod in the served boot
 * graph. This asks the rest of what the prompts mod and the language pack are
 * supposed to do on a live instance:
 *
 *   1. the GUI answers at all;
 *   2. both mods are in the boot graph;
 *   3. the browser bundle the server actually serves carries the language pack's
 *      translations, not merely its name;
 *   4. the prompt mod's `/api/system-prompt.mod` route answers with the shape its
 *      README documents.
 *
 * It runs from a fresh clone with Node alone: no browser, no DSH installation.
 * The instance does have to be running, and the browser-session secret is read
 * from `$DSH_HOME` (default `~/.dsh`) and never printed.
 *
 * Usage:
 *   node tools/dev/verify-live.mjs                     # http://127.0.0.1:3080
 *   node tools/dev/verify-live.mjs http://127.0.0.1:3088
 *
 * Exit code 0 when every check passes, 1 on a failed check, 2 when the instance
 * cannot be reached or authenticated.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mintSessionCookie } from '../lib/session-cookie.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:3080'
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(results.length)}. ${name} — ${detail}`)
}

let cookie
try {
  cookie = mintSessionCookie(base, home)
} catch {
  console.error(`cannot read the browser-session secret from ${join(home, '.credentials.yaml')}`)
  console.error('set DSH_HOME to the home the running instance uses')
  process.exit(2)
}

const get = async (path) => {
  try {
    return await fetch(`${base}${path}`, { headers: { cookie } })
  } catch (error) {
    console.error(`cannot reach ${base}: ${error.message}`)
    console.error('is `dsh web` running?')
    process.exit(2)
  }
}

// 1. the GUI answers
const page = await get('/')
const html = await page.text()
if (page.status !== 200) {
  console.error(`GET / -> ${String(page.status)}; the derived cookie was refused`)
  console.error('boot-check mints a cookie for the instance it is pointed at, so DSH_HOME must match it')
  process.exit(2)
}
record('the GUI answers', true, `GET / -> 200 (${String(html.length)} bytes)`)

// 2. both mods are in the boot graph
const rows = (html.match(/\/client\.js/gu) ?? []).length
for (const name of ['dsh-system-prompt-mod', 'dsh-locale-ru']) {
  const present = html.includes(`@local/${name}`)
  record(`${name} is in the boot graph`, present, `${String(rows)} client rows served, package listed: ${String(present)}`)
}

// 3. the served bundle actually carries the translations
const bundleUrls = [...html.matchAll(/\/plugins\/\?\?[^"']+/gu)]
  .map((match) => match[0].replace(/&amp;/g, '&'))
  .filter((url) => url.includes('@local/dsh-locale-ru/client.js'))
if (bundleUrls.length === 0) {
  record('the language pack ships translations', false, 'no served bundle request includes @local/dsh-locale-ru/client.js')
} else {
  const bundle = await (await get(bundleUrls[0])).text()
  const cyrillic = (bundle.match(/[\u0400-\u04FF]/gu) ?? []).length
  record(
    'the language pack ships translations',
    bundle.includes('@local/dsh-locale-ru') && cyrillic > 1000,
    `${String(bundle.length)} bytes served, ${String(cyrillic)} Cyrillic characters`,
  )
}

// 4. the prompt mod's route answers with its documented shape
const route = await get('/api/system-prompt.mod')
let body = null
try {
  body = await route.json()
} catch {}
const documented = ['ok', 'enabled', 'mode', 'text', 'effectivePrompt', 'section', 'order']
const missing = documented.filter((key) => body === null || !(key in body))
const sectionOk = body?.section === 'mod:user-system-prompt'
record(
  'the prompt route answers with its documented shape',
  route.status === 200 && missing.length === 0 && sectionOk,
  route.status === 200
    ? `HTTP 200, section=${String(body?.section)}, order=${String(body?.order)}, mode=${String(body?.mode)}, missing keys: ${missing.length === 0 ? 'none' : missing.join(', ')}`
    : `HTTP ${String(route.status)}`,
)

// 5. the mod manager's route answers and describes this home
const managerRoute = await get('/api/mod-manager.mod')
let managerBody = null
try {
  managerBody = await managerRoute.json()
} catch {}
const layersShaped = Array.isArray(managerBody?.layers)
  && managerBody.layers.every((layer) => typeof layer.key === 'string' && Array.isArray(layer.rows))
record(
  'the mod manager route answers and describes this home',
  managerRoute.status === 200 && managerBody?.ok === true && layersShaped,
  managerRoute.status === 200
    ? `HTTP 200, ${String(managerBody?.layers?.length ?? 0)} layer(s), ${String(
      (managerBody?.layers ?? []).reduce((total, layer) => total + layer.rows.length, 0),
    )} row(s), home=${String(managerBody?.home)}`
    : `HTTP ${String(managerRoute.status)} — the row is not mounted; restart \`dsh web\` if it was added while the server was running after a failed import`,
)

// 6. the skill manager's route answers and describes the same home
//
// The skills themselves depend on which workspaces this machine has, so the check
// asserts the shape a page needs — a list and the roots it came from — rather than a
// count that would differ on every machine. A route that mounts but finds no roots
// answers 200 with total 0, which is exactly the failure this check exists to catch:
// the first version resolved the project from the server's working directory instead
// of from the workspace store, and the panel came up empty in a live session.
const skillRoute = await get('/api/skill-manager.mod')
let skillBody = null
try {
  skillBody = await skillRoute.json()
} catch {}
const skillState = skillBody?.state
const skillShaped = skillState !== undefined
  && typeof skillState.total === 'number'
  && Array.isArray(skillState.skills)
  && Array.isArray(skillState.roots)
  && Array.isArray(skillState.workspaces)
record(
  'the skill manager route answers and lists roots',
  skillRoute.status === 200 && skillBody?.ok === true && skillShaped,
  skillRoute.status === 200
    ? `HTTP 200, ${String(skillState?.total ?? 0)} skill(s) from ${String(
      (skillState?.roots ?? []).filter((root) => root.exists).length,
    )} existing root(s), ${String(skillState?.paused ?? 0)} paused, workspace(s): ${
      (skillState?.workspaces ?? []).map((space) => space.title).join(', ') || 'none'}`
    : `HTTP ${String(skillRoute.status)} — the row is not mounted; restart \`dsh web\` if it was added while the server was running after a failed import`,
)

// 8. the store of finds. Nothing enters it without a verdict, so a store this
//    young being empty is the correct answer rather than a failure.
const scoutRoute = await fetch(`${base}/api/skill-scout.mod`, {
  headers: { cookie, accept: 'application/json' },
}).catch(() => null)
let scoutBody = null
try {
  scoutBody = await scoutRoute?.json()
} catch {}
const scoutState = scoutBody?.state
const scoutShaped = scoutState !== undefined
  && Array.isArray(scoutState.tasks)
  && Array.isArray(scoutState.entries)
  && typeof scoutState.cataloguePath === 'string'
record(
  'the store of finds answers with its queue and catalogue',
  scoutRoute?.status === 200 && scoutBody?.ok === true && scoutShaped,
  scoutRoute?.status === 200
    ? `HTTP 200, ${String(scoutState?.entries?.length ?? 0)} find(s), `
      + `${String(scoutState?.tasks?.length ?? 0)} task(s), `
      + `${String(scoutState?.adopted ?? 0)} adopted`
    : `HTTP ${String(scoutRoute?.status)} - the row is not mounted; restart `
      + '`dsh web` if it was installed while the server was running',
)

// verdict
const failed = results.filter((result) => !result.ok)
console.log('')
if (failed.length === 0) {
  console.log(`PASS — all ${String(results.length)} live checks passed against ${base}`)
  process.exit(0)
}
console.log(`FAIL — ${String(failed.length)} of ${String(results.length)} live checks failed against ${base}`)
process.exit(1)
