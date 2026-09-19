#!/usr/bin/env node
/**
 * End-to-end round trip of the skill manager against a running DSH.
 *
 * `verify-live.mjs` asks whether the route answers. This asks whether the thing the
 * panel promises actually happens: that pausing a skill through the route renames the
 * file on disk, that the skill then stops being offered, that describing it rewrites
 * exactly one line of the frontmatter, and that resuming puts everything back.
 *
 * **It renames a real file, so it demands to be told which one.** With no `--skill`
 * it does nothing at all. It restores the state it found before it exits, including
 * when a step fails, because leaving a skill paused is a silent way to break someone's
 * setup.
 *
 * Usage:
 *   node tools/dev/verify-skill-manager-roundtrip.mjs --skill <name> [base]
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mintSessionCookie } from '../lib/session-cookie.mjs'

const args = process.argv.slice(2)
const skillIndex = args.indexOf('--skill')
const skillName = skillIndex >= 0 ? args[skillIndex + 1] : undefined
const base = args.find((value, index) => !value.startsWith('--') && index !== skillIndex + 1)
  ?? 'http://127.0.0.1:3080'
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(results.length)}. ${name} — ${detail}`)
}

if (skillName === undefined || skillName === '') {
  console.log('  nothing to do: pass --skill <name> naming a skill this instance can see.')
  console.log('  This tool renames a file, so it will not pick one for you.')
  console.log('  List them first:  curl -s <base>/api/skill-manager.mod  (with a session cookie)')
  process.exit(2)
}

const cookie = mintSessionCookie(base, home)
const call = async (method, payload) => {
  const init = { method, headers: { cookie, accept: 'application/json' } }
  if (payload !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(payload)
  }
  const response = await fetch(`${base}/api/skill-manager.mod`, init)
  let body = null
  try {
    body = await response.json()
  } catch { /* left null */ }
  return { status: response.status, body }
}

const find = (state) => (state?.skills ?? []).find((skill) => skill.name === skillName)

const first = await call('GET')
if (first.status !== 200 || first.body?.ok !== true) {
  console.log(`  the route did not answer: HTTP ${String(first.status)}`)
  process.exit(2)
}

const skill = find(first.body.state)
if (skill === undefined) {
  console.log(`  '${skillName}' is not among the ${String(first.body.state.total)} skills this instance sees.`)
  console.log(`  available: ${first.body.state.skills.map((entry) => entry.name).join(', ')}`)
  process.exit(2)
}

const activePath = skill.file
const pausedPath = `${activePath}.paused`
const startedPaused = skill.paused
const startedRegistered = skill.registered === true
const originalBytes = existsSync(activePath) ? readFileSync(activePath, 'utf8') : null
console.log(`  testing '${skillName}', currently ${startedPaused ? 'paused' : 'active'}${startedRegistered ? ', registered' : ''}`)
console.log(`    ${activePath}`)
console.log('')

/**
 * Put the skill back the way it was found, whatever happened.
 *
 * The first version of this restored the file and the pause state and stopped there,
 * which left something behind: describing a skill writes a **registry entry**, and a
 * skill that was not registered before the run was left registered after it. A stale
 * entry naming a skill that no longer exists is invisible in the panel and still
 * wrong, and "restores what it changed" is not true if it only restores two of the
 * three things.
 */
const restore = async () => {
  const now = await call('GET')
  const current = find(now.body?.state)
  if (current === undefined) return
  if (current.paused !== startedPaused) {
    await call('POST', { action: current.paused ? 'resume' : 'pause', file: current.file })
  }
  if (originalBytes !== null && existsSync(activePath)) {
    const after = readFileSync(activePath, 'utf8')
    if (after !== originalBytes) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(activePath, originalBytes, 'utf8')
      console.log('  (the frontmatter was put back to the bytes it started with)')
    }
  }
  if (!startedRegistered) {
    const forgotten = await call('POST', { action: 'forget', id: skillName })
    if (forgotten.body?.ok === true) {
      console.log('  (the registry entry this run created was removed)')
    }
  }
}

try {
  // ── pause ───────────────────────────────────────────────────────────────
  if (!startedPaused) {
    const paused = await call('POST', { action: 'pause', file: activePath })
    record('pausing through the route answers ok', paused.body?.ok === true, `HTTP ${String(paused.status)}`)
    record('the file on disk was renamed', existsSync(pausedPath) && !existsSync(activePath),
      `${existsSync(pausedPath) ? 'SKILL.md.paused exists' : 'no .paused file'}`)
    record('the route reports it as paused',
      find(paused.body?.state)?.paused === true)
    const after = await call('GET')
    record('and a fresh read agrees', find(after.body?.state)?.paused === true)
  } else {
    console.log('  (it started paused, so the pause step is skipped)')
  }

  // ── describe, while paused ──────────────────────────────────────────────
  const marker = 'Rewritten by the round-trip check.'
  const described = await call('POST', {
    action: 'describe',
    file: existsSync(pausedPath) ? pausedPath : activePath,
    modelDescription: marker,
    humanSummary: 'Написано проверкой кругового прогона.',
  })
  record('describing through the route answers ok', described.body?.ok === true,
    `HTTP ${String(described.status)}`)
  const onDisk = readFileSync(existsSync(pausedPath) ? pausedPath : activePath, 'utf8')
  record('the frontmatter now carries the new description', onDisk.includes(marker))
  record('the rest of the file survived', onDisk.includes('# '),
    'the body heading is still there')
  record('describing did not resume it', existsSync(pausedPath) && !existsSync(activePath),
    'a paused skill stays paused')

  // ── resume ──────────────────────────────────────────────────────────────
  const resumed = await call('POST', {
    action: 'resume',
    file: existsSync(pausedPath) ? pausedPath : activePath,
  })
  record('resuming through the route answers ok', resumed.body?.ok === true,
    `HTTP ${String(resumed.status)}`)
  record('the file is back under its own name', existsSync(activePath) && !existsSync(pausedPath))
  record('the route reports it as active', find(resumed.body?.state)?.paused === false)

  // ── the guard, against a live instance ──────────────────────────────────
  const refused = await call('POST', { action: 'pause', file: join(home, '.credentials.yaml') })
  record('a path outside every root is refused', refused.status === 400
    && refused.body?.code === 'outside-roots', JSON.stringify(refused.body))
  record('and that file is still where it was', existsSync(join(home, '.credentials.yaml')))
} finally {
  await restore()
}

const stillPaused = find((await call('GET')).body?.state)?.paused
record('the skill was left as it was found', stillPaused === startedPaused,
  `started ${startedPaused ? 'paused' : 'active'}, ended ${stillPaused ? 'paused' : 'active'}`)
const stillRegistered = find((await call('GET')).body?.state)?.registered === true
record('and its registry entry was left as it was found',
  stillRegistered === startedRegistered,
  `started ${startedRegistered ? 'registered' : 'unregistered'}, ended ${stillRegistered ? 'registered' : 'unregistered'}`)

const failed = results.filter((result) => !result.ok)
console.log('')
if (failed.length === 0) {
  console.log(`PASS — all ${String(results.length)} round-trip checks passed against ${base}`)
  process.exit(0)
}
console.log(`FAIL — ${String(failed.length)} of ${String(results.length)} checks failed against ${base}`)
process.exit(1)
