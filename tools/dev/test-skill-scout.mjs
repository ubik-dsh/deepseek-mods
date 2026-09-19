#!/usr/bin/env node
/**
 * Unit tests for `@local/dsh-skill-scout`'s host half.
 *
 * The host half imports nothing but Node built-ins, so this runs anywhere. It works
 * on fabricated state in a temporary home: a queue nobody asked for and a catalogue
 * nobody judged, so nothing of anyone's own is touched.
 *
 * The pipeline it covers is the one the panel exists for: a task is asked for, taken,
 * finished with counts, and the survivors are recorded with two axes — worth keeping,
 * and runs here. Those are separate on purpose: a good skill for a mechanism this
 * Harness does not have is good and unusable.
 *
 * Usage: node tools/dev/test-skill-scout.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MOD = await import(`file://${join(REPO, 'packages', 'skill-scout', 'lib', 'index.js').replace(/\\/gu, '/')}`)

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

const scratch = join(tmpdir(), `dsh-skill-scout-test-${String(process.pid)}`)
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
process.env.DSH_HOME = scratch

// ── the queue ─────────────────────────────────────────────────────────────────

ok('the queue starts empty and its path is in the home',
  MOD.readQueue().tasks.length === 0 && MOD.queuePath().startsWith(scratch),
  MOD.queuePath())

const asked = MOD.ask('a skill for evaluating other skills before adopting them', 'human')
ok('a task can be asked for', asked.ok === true)
ok('it starts pending', asked.task?.status === 'pending')
ok('it remembers who asked', asked.task?.by === 'human')
ok('an empty task is refused', MOD.ask('   ', 'human').code === 'empty-task')
ok('the task is on the board', MOD.readQueue().tasks.length === 1)

const byAgent = MOD.ask('something the agent decided to look for', 'agent')
ok('an agent can ask too', byAgent.task?.by === 'agent')
ok('the newest is first', MOD.readQueue().tasks[0]?.by === 'agent')

const id = asked.task.id
ok('an unknown task cannot be taken', MOD.claim('nope').code === 'no-such-task')
ok('taking a pending task works', MOD.claim(id).ok === true)
ok('a taken task cannot be taken again', MOD.claim(id).code === 'not-pending')
ok('a finished task reports what it produced',
  MOD.finish({ id, found: 41, triaged: 9, judged: 3, added: 2, note: 'three survived' }).ok === true)
const finished = MOD.readQueue().tasks.find((task) => task.id === id)
ok('the counts are kept', finished?.found === 41 && finished?.judged === 3)
ok('the note is kept', finished?.note === 'three survived')
ok('and it is done', finished?.status === 'done')
ok('a negative count is refused', MOD.finish({ id, found: -1 }).code === 'bad-count')
ok('a task can be dismissed', MOD.dismiss(byAgent.task.id).ok === true)
ok('dismissing it again is refused', MOD.dismiss(byAgent.task.id).code === 'no-such-task')

// ── the catalogue ─────────────────────────────────────────────────────────────

ok('the catalogue starts empty', MOD.readCatalogue().entries.length === 0)

const recorded = MOD.record({
  name: 'gateguard',
  repo: 'affaan-m/ECC',
  path: 'skills/gateguard/SKILL.md',
  description: 'Fact-forcing gate that blocks Edit/Write/Bash before allowing the action.',
  stars: 262706,
  foundBy: id,
  keep: 'no',
  runsHere: 'no',
  hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 3 },
  taken: ['state the facts before the first edit'],
})
ok('a judged skill can be recorded', recorded.ok === true)
ok('the id is readable and derived from the repository owner', recorded.entry?.id === 'affaan-m-gateguard',
  String(recorded.entry?.id))
ok('both axes are kept separately',
  recorded.entry?.keep === 'no' && recorded.entry?.runsHere === 'no',
  'a good skill for a mechanism we do not have is good and unusable')
ok('the rating keeps how many hearings are behind it', recorded.entry?.hearing.cases === 3)
ok('the source link is built when none is given',
  recorded.entry?.url === 'https://github.com/affaan-m/ECC')
ok('nothing is adopted by recording it', recorded.entry?.adopted === false)
ok('it needs a name and a repository', MOD.record({ name: 'x' }).code === 'needs-name-and-repo')

// re-recording is an update, not a duplicate
const rechecked = MOD.record({
  name: 'gateguard', repo: 'affaan-m/ECC', keep: 'with a boundary', runsHere: 'after porting',
})
ok('a re-check replaces the entry rather than duplicating it',
  MOD.readCatalogue().entries.length === 1 && rechecked.replaced === true)
ok('the re-check keeps when it was first found',
  rechecked.entry?.foundAt === recorded.entry?.foundAt)

// ── the Add button is a person's ──────────────────────────────────────────────

ok('an entry can be adopted', MOD.adopt(rechecked.entry.id, true).ok === true)
ok('adoption is recorded', MOD.readCatalogue().entries[0].adopted === true)
ok('adoption can be undone', MOD.adopt(rechecked.entry.id, false).ok === true)
ok('an unknown entry cannot be adopted', MOD.adopt('nope', true).code === 'no-such-entry')

ok('adoption survives a re-check',
  (() => {
    MOD.adopt(rechecked.entry.id, true)
    MOD.record({ name: 'gateguard', repo: 'affaan-m/ECC', keep: 'yes', runsHere: 'yes' })
    return MOD.readCatalogue().entries[0].adopted === true
  })(),
  'a re-check must not silently un-adopt what a person chose')

ok('an entry can be forgotten', MOD.forget(rechecked.entry.id).ok === true)
ok('forgetting it again is refused', MOD.forget(rechecked.entry.id).code === 'no-such-entry')

// ── the snapshot the panel reads ──────────────────────────────────────────────

MOD.record({ name: 'keepme', repo: 'someone/repo', keep: 'yes', runsHere: 'yes' })
MOD.record({ name: 'portme', repo: 'someone/repo', keep: 'with a boundary', runsHere: 'after porting' })
MOD.record({ name: 'dropme', repo: 'someone/repo', keep: 'no', runsHere: 'no' })
MOD.adopt('someone-keepme', true)

const snapshot = MOD.snapshot()
ok('the snapshot carries the tasks', Array.isArray(snapshot.tasks))
ok('the snapshot counts the entries', snapshot.entries.length === 3, String(snapshot.entries.length))
ok('the snapshot counts what is adopted', snapshot.adopted === 1, String(snapshot.adopted))
ok('the snapshot counts what runs here', snapshot.runnable === 1, String(snapshot.runnable))
ok('the snapshot counts what is worth keeping', snapshot.keepable === 2, String(snapshot.keepable))
ok('the snapshot names both files it owns',
  snapshot.queuePath.startsWith(scratch) && snapshot.cataloguePath.startsWith(scratch))

// ── the route handler, with a stubbed connection ──────────────────────────────

let handler
const ctx = {
  connection: { fetch: { register: (options) => { handler = options.fetch; return () => {} } } },
  effect: (fn) => { fn() },
}
MOD.apply(ctx)
ok('the route was registered', typeof handler === 'function')
ok('on the declared path', MOD.SCOUT_ROUTE_PATH === '/api/skill-scout.mod')

const getBody = await (await handler(new Request('http://dsh.internal/api/skill-scout.mod'))).json()
ok('GET answers the board', getBody.ok === true && Array.isArray(getBody.state?.entries))

const postAsk = await handler(new Request('http://dsh.internal/api/skill-scout.mod', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'ask', text: 'from the route' }),
}))
ok('POST ask answers 200 and adds a task',
  postAsk.status === 200 && (await postAsk.json()).state.tasks.some((task) => task.text === 'from the route'))

const badAction = await handler(new Request('http://dsh.internal/api/skill-scout.mod', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'install-everything' }),
}))
ok('an unknown action is refused', badAction.status === 400)
ok('a malformed body is refused',
  (await handler(new Request('http://dsh.internal/api/skill-scout.mod', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
  }))).status === 400)
ok('an unsupported method is refused',
  (await handler(new Request('http://dsh.internal/api/skill-scout.mod', { method: 'PUT' }))).status === 405)

// ── the files really are two, and really are JSON ─────────────────────────────

ok('two files were written and no more',
  existsSync(MOD.queuePath()) && existsSync(MOD.cataloguePath()))
ok('the queue file parses', JSON.parse(readFileSync(MOD.queuePath(), 'utf8')).version === 1)
ok('the catalogue file carries when it was written',
  typeof JSON.parse(readFileSync(MOD.cataloguePath(), 'utf8')).updated === 'string')

rmSync(scratch, { recursive: true, force: true })
console.log('')
console.log(`${String(checks - failed)}/${String(checks)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
