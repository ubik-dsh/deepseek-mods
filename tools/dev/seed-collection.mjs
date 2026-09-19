#!/usr/bin/env node
/**
 * Put the three skills already judged into the collection of a running instance.
 *
 * These are real hearings, not fixtures: gateguard, delivery-gate and rules-distill,
 * all from affaan-m/ECC, all three rejected with something taken from each. The verdicts
 * and ratings are the ones recorded in judge-a-skill's references/three-hearings.md, so
 * this also checks that what a hearing produced is what the collection can hold.
 *
 * Usage: node tools/dev/seed-collection.mjs [base]
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { mintSessionCookie } from '../lib/session-cookie.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:3080'
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const cookie = mintSessionCookie(base, home)

const REPO = 'affaan-m/ECC'
const ENTRIES = [
  {
    name: 'gateguard',
    repo: REPO,
    path: 'skills/gateguard/SKILL.md',
    description: 'Fact-forcing gate that blocks Edit/Write/Bash and demands concrete investigation — importers, affected public surface, data schemas, and the user\'s instruction quoted verbatim — before allowing the action. Claims +2.25 points against ungated agents on two tasks.',
    stars: 262706,
    keep: 'no',
    runsHere: 'no',
    hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 3 },
    taken: [
      'state the facts before the first edit: importers, affected public surface, data schema, and the user\'s instruction verbatim',
      'a destructive-command gate naming the affected data and a one-line rollback',
    ],
    note: 'The number is the mean of two measurements with no rubric published, and the artefact is a Claude Code hook this harness cannot run. The mechanism is falsifiable here and worth a trial.',
  },
  {
    name: 'delivery-gate',
    repo: REPO,
    path: 'skills/delivery-gate/SKILL.md',
    description: 'Stop hook that will not let a session finish until quality checks pass: disk space, whether learning files were touched today, and rationalization patterns in the transcript. Deterministic checks only, no model inference.',
    stars: 262706,
    keep: 'no',
    runsHere: 'no',
    hearing: { prosecutor: 7, defence: 4, verdict: 'reject the skill, take these parts', cases: 3 },
    taken: [
      'a delivery gate on a deterministic fact — but pointed at a fact that correlates with the goal, not at a file having been touched',
    ],
    note: 'Its own limitations section says it enforces the habit of touching learning files and not the quality of what was recorded — the exact defect our reward rules name. It is a worked example of a rule we wrote for another reason.',
  },
  {
    name: 'rules-distill',
    repo: REPO,
    path: 'skills/rules-distill/SKILL.md',
    description: 'Scans installed skills, cross-reads them, and proposes promoting principles found in two or more of them into rule files. Scripts collect exhaustively; a model judges; the user approves each candidate.',
    stars: 262706,
    keep: 'no',
    runsHere: 'after porting',
    hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 3 },
    taken: [
      'the verdict vocabulary — Already Covered and Too Specific make doing nothing a named outcome rather than a silent omission',
      'the filter that rejects "X is important": a principle must be writable as do X or don\'t do Y',
    ],
    note: 'Assumes a global rules layer this family does not have, and promotes a principle found in two skills that often just means two skills quoting one source. Two pieces are better than what we had.',
  },
]

let failed = 0
for (const entry of ENTRIES) {
  const response = await fetch(`${base}/api/skill-scout.mod`, {
    method: 'POST',
    headers: { cookie, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'record', ...entry, url: `https://github.com/${REPO}` }),
  })
  const body = await response.json().catch(() => null)
  const item = body?.entry
  const ok = response.status === 200 && body?.ok === true
  if (!ok) failed += 1
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${entry.name.padEnd(15)} `
    + `${String(item?.hearing?.prosecutor)}/${String(item?.hearing?.defence)}  `
    + `${String(item?.keep)} · ${String(item?.runsHere)}  `
    + `taken ${String(item?.taken?.length ?? 0)}  added ${String(item?.addedAt ?? '').slice(0, 10)}`,
  )
}

const state = await (await fetch(`${base}/api/skill-scout.mod`, { headers: { cookie } })).json()
console.log('')
console.log(`  the collection now holds ${String(state?.state?.entries?.length ?? 0)} find(s)`)
for (const entry of state?.state?.entries ?? []) {
  console.log(`    ${entry.name.padEnd(15)} ${String(entry.hearing?.verdict).padEnd(38)} `
    + `${String(entry.hearing?.prosecutor)}/${String(entry.hearing?.defence)}`)
}
process.exit(failed === 0 ? 0 : 1)
