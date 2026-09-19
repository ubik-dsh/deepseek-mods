#!/usr/bin/env node
/**
 * Put every skill this family has actually judged into the collection of a running
 * instance.
 *
 * Six real hearings, not fixtures: three from affaan-m/ECC and three from
 * wshobson/agents. The verdicts and ratings are the ones the hearings produced, so this
 * also checks that what a hearing decides is what the collection can hold — two axes, a
 * rating with its case count, the date, and the parts worth taking.
 *
 * Idempotent: a re-run updates rather than duplicates, and the date it entered survives.
 *
 * Usage: node tools/dev/seed-collection.mjs [base]
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { mintSessionCookie } from '../lib/session-cookie.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:3080'
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const cookie = mintSessionCookie(base, home)

const ECC = 'affaan-m/ECC'
const WA = 'wshobson/agents'

const ENTRIES = [
  // ── affaan-m/ECC, 880 SKILL.md, 262 706 stars ───────────────────────────────
  {
    name: 'gateguard',
    repo: ECC,
    path: 'skills/gateguard/SKILL.md',
    stars: 262706,
    description: 'Fact-forcing gate that blocks Edit/Write/Bash and demands concrete investigation — importers, affected public surface, data schemas, and the user\'s instruction quoted verbatim — before allowing the action. Claims +2.25 points against ungated agents on two tasks.',
    keep: 'no',
    runsHere: 'no',
    hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 6 },
    taken: [
      'state the facts before the first edit: importers, affected public surface, data schema, and the user\'s instruction verbatim',
      'a destructive-command gate naming the affected data and a one-line rollback',
    ],
    note: 'The number is the mean of two measurements with no rubric published, and the artefact is a Claude Code hook this harness cannot run. The mechanism is falsifiable here and worth a trial.',
  },
  {
    name: 'delivery-gate',
    repo: ECC,
    path: 'skills/delivery-gate/SKILL.md',
    stars: 262706,
    description: 'Stop hook that will not let a session finish until quality checks pass: disk space, whether learning files were touched today, and rationalization patterns in the transcript. Deterministic checks only, no model inference.',
    keep: 'no',
    runsHere: 'no',
    hearing: { prosecutor: 7, defence: 4, verdict: 'reject the skill, take these parts', cases: 6 },
    taken: ['a delivery gate on a deterministic fact — but pointed at a fact that correlates with the goal, not at a file having been touched'],
    note: 'Its own limitations section says it enforces the habit of touching learning files and not the quality of what was recorded — the exact defect our reward rules name. A worked example of a rule we wrote for another reason.',
  },
  {
    name: 'rules-distill',
    repo: ECC,
    path: 'skills/rules-distill/SKILL.md',
    stars: 262706,
    description: 'Scans installed skills, cross-reads them, and proposes promoting principles found in two or more of them into rule files. Scripts collect exhaustively; a model judges; the user approves each candidate.',
    keep: 'no',
    runsHere: 'after porting',
    hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 6 },
    taken: [
      'the verdict vocabulary — Already Covered and Too Specific make doing nothing a named outcome rather than a silent omission',
      'the filter that rejects "X is important": a principle must be writable as do X or don\'t do Y',
    ],
    note: 'Assumes a global rules layer this family does not have, and promotes a principle found in two skills that often just means two skills quoting one source. Two pieces are better than what we had.',
  },

  // ── wshobson/agents, 183 SKILL.md ───────────────────────────────────────────
  {
    name: 'before-you-build',
    repo: WA,
    path: 'plugins/before-you-build/skills/before-you-build/SKILL.md',
    description: 'A pre-mortem before implementation for founders and product builders: demand, positioning, monetization, retention, trust, distribution and feature adoption. Outputs a risk verdict, the assumption most likely to break, the smallest useful signal to find first, and what to delay.',
    keep: 'no',
    runsHere: 'yes',
    hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 6 },
    taken: [
      'name the missing evidence instead of inventing market claims — the rule that a claim whose measurement is absent is not a finding',
      'the output shape: main assumption, evidence to find first, and what to delay',
    ],
    note: 'Its own first line says the goal is not to block building, so it labels rather than decides, and it asks for market evidence an agent cannot obtain. The honesty clause about missing facts is the sharpest line in it, and it is a rule we already keep.',
  },
  {
    name: 'multi-reviewer-patterns',
    repo: WA,
    path: 'plugins/agent-teams/skills/multi-reviewer-patterns/SKILL.md',
    description: 'Coordinates parallel code reviews across security, performance, architecture, testing and accessibility: which dimensions to assign to which change, how to deduplicate findings across reviewers, how to calibrate severity, and a consolidated report template.',
    keep: 'no',
    runsHere: 'yes',
    hearing: { prosecutor: 7, defence: 4, verdict: 'reject the skill, take these parts', cases: 6 },
    taken: [
      'the severity floors that are checkable — exploitable from outside is at least High, style with no functional impact is Low — which stop a review inflating until it means nothing',
      'conflicting recommendations: keep both, with attribution',
    ],
    note: 'Its merge rule takes the higher severity when two reviewers disagree, which manufactures severity, and it destroys the disagreement that is the signal — the opposite of the panel rule we keep. The dimension table is asserted, never measured.',
  },
  {
    name: 'team-communication-protocols',
    repo: WA,
    path: 'plugins/agent-teams/skills/team-communication-protocols/SKILL.md',
    description: 'Message types and etiquette for a team of agents: direct messages, sparing broadcasts, shutdown requests, a plan-approval workflow, and a table of communication anti-patterns with the cost of each.',
    keep: 'no',
    runsHere: 'after porting',
    hearing: { prosecutor: 7, defence: 4, verdict: 'reject the skill, take these parts', cases: 6 },
    taken: [
      'the anti-pattern rows that are general — check in at milestones and not every step, never broadcast a routine update, use names and not identifiers',
      'approve with a reason and reject with feedback, as a required shape rather than a courtesy',
    ],
    note: 'The message schema names a tool surface this harness does not have, so most of it is a transcript of one product rather than a protocol — and it recommends JSON status messages while its own anti-pattern table forbids them.',
  },
]

let failed = 0
for (const entry of ENTRIES) {
  const response = await fetch(`${base}/api/skill-scout.mod`, {
    method: 'POST',
    headers: { cookie, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'record', ...entry, url: `https://github.com/${entry.repo}` }),
  })
  const body = await response.json().catch(() => null)
  const item = body?.entry
  const ok = response.status === 200 && body?.ok === true
  if (!ok) failed += 1
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${entry.name.padEnd(29)} `
    + `${String(item?.hearing?.prosecutor)}/${String(item?.hearing?.defence)}  `
    + `${String(item?.keep)} · ${String(item?.runsHere).padEnd(14)} taken ${String(item?.taken?.length ?? 0)}`,
  )
}

const state = await (await fetch(`${base}/api/skill-scout.mod`, { headers: { cookie } })).json()
const entries = state?.state?.entries ?? []
console.log('')
console.log(`  the collection holds ${String(entries.length)} find(s), `
  + `${String(state?.state?.adopted ?? 0)} adopted, ${String(state?.state?.runnable ?? 0)} runnable here`)
for (const entry of entries) {
  console.log(`    ${entry.name.padEnd(30)} ${String(entry.hearing?.prosecutor)}/${String(entry.hearing?.defence)}`
    + `  ${String(entry.runsHere).padEnd(14)} ${String(entry.addedAt ?? '').slice(0, 10)}`)
}
process.exit(failed === 0 ? 0 : 1)
