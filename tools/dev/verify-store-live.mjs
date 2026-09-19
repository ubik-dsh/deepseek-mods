/**
 * The store of finds, exercised end to end against a running empty instance.
 *
 * The unit tests run against a temporary home and a stubbed connection. This runs
 * against a real `dsh web` in a real fresh home, so it also proves the route is mounted
 * and the file paths land where the home says they should.
 *
 * Usage: node tools/dev/verify-store-live.mjs [base]
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mintSessionCookie } from '../lib/session-cookie.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:3080'
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const cookie = mintSessionCookie(base, home)

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

const call = async (payload) => {
  const init = { method: payload === undefined ? 'GET' : 'POST', headers: { cookie, accept: 'application/json' } }
  if (payload !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(payload)
  }
  const response = await fetch(`${base}/api/skill-scout.mod`, init)
  let body = null
  try {
    body = await response.json()
  } catch {}
  return { status: response.status, body }
}

console.log(`  store of finds at ${base}, home ${home}`)
console.log('')

const start = await call()
ok('the store answers', start.status === 200 && start.body?.ok === true)
const catalogueFile = start.body?.state?.cataloguePath
ok('and names the file it owns, inside this home',
  typeof catalogueFile === 'string' && catalogueFile.startsWith(home), String(catalogueFile))
const queueFile = start.body?.state?.queuePath
ok('and the queue beside it', typeof queueFile === 'string' && queueFile.startsWith(home), String(queueFile))

// a task, the way the panel writes one
const asked = await call({ action: 'ask', text: 'a skill for evaluating other skills', by: 'human' })
ok('a task can be asked for from the panel', asked.body?.ok === true)
ok('and it is on the board', asked.body?.state?.tasks?.length >= 1)

// the verdict gate, against a live instance
const noVerdict = await call({ action: 'record', name: 'unjudged', repo: 'someone/repo', keep: 'yes' })
ok('a skill with no verdict is REFUSED by the live route',
  noVerdict.status === 400 && noVerdict.body?.code === 'needs-verdict', JSON.stringify(noVerdict.body))
ok('and nothing was written', (noVerdict.body?.state?.entries ?? []).length === 0)

const noAxis = await call({ action: 'record', name: 'unjudged', repo: 'someone/repo', hearing: { verdict: 'acquit' } })
ok('and one with no worth-keeping axis is refused too', noAxis.body?.code === 'needs-verdict')

// a judged skill
const filed = await call({
  action: 'record',
  name: 'gateguard',
  repo: 'affaan-m/ECC',
  path: 'skills/gateguard/SKILL.md',
  description: 'Fact-forcing gate that blocks Edit/Write/Bash before allowing the action.',
  stars: 262706,
  keep: 'no',
  runsHere: 'no',
  hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 3 },
  taken: ['state the facts before the first edit'],
})
ok('a judged skill enters the store', filed.body?.ok === true)
const entry = filed.body?.entry
ok('it is stamped with the date it entered', typeof entry?.addedAt === 'string', String(entry?.addedAt))
ok('the date is today', (entry?.addedAt ?? '').slice(0, 10) === new Date().toISOString().slice(0, 10))
ok('both axes are kept separately', entry?.keep === 'no' && entry?.runsHere === 'no')
ok('the rating keeps its case count', entry?.hearing?.cases === 3)
ok('nothing is adopted on entry', entry?.adopted === false)

// the two buttons
const discussed = await call({ action: 'discuss', id: entry.id })
ok('the entry can be raised in the chat', discussed.body?.ok === true)
ok('and that is recorded', typeof discussed.body?.entry?.discussedAt === 'string')
ok('with a count, so a second raising is visible', discussed.body?.entry?.discussions === 1)

const adopted = await call({ action: 'adopt', id: entry.id, adopted: true })
ok('a person can still adopt it', adopted.body?.state?.adopted === 1)

// the file really is where it said
ok('the catalogue file exists on disk', existsSync(catalogueFile))
const onDisk = JSON.parse(readFileSync(catalogueFile, 'utf8'))
ok('and it holds the entry', onDisk.entries?.some((item) => item.name === 'gateguard'))

const removed = await call({ action: 'forget', id: entry.id })
ok('and it can be removed from the list', removed.body?.ok === true)
ok('leaving the store empty again', (removed.body?.state?.entries ?? []).length === 0)

// tidy the board
for (const task of (await call()).body?.state?.tasks ?? []) {
  await call({ action: 'dismiss', id: task.id })
}
ok('the board was tidied', ((await call()).body?.state?.tasks ?? []).length === 0)

console.log('')
const verdict = failed === 0
  ? `PASS — all ${String(checks)} store checks passed against ${base}`
  : `FAIL — ${String(failed)} of ${String(checks)} store checks failed against ${base}`
console.log(verdict)
process.exit(failed === 0 ? 0 : 1)
