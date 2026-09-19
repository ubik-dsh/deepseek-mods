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

/**
 * Where each taken part should live, and what makes it fire.
 *
 * The verdict said what to take and nothing about where it goes, so twenty parts sat in
 * a list being counted as gains. A part is a gain when it has a home: a checklist line
 * fires on a situation, a script needs an environment, a rule applies always.
 *
 * `needs` is what the part requires to run at all — and it is the field that separates
 * "state the facts before the first edit", which needs nothing, from "match the Git
 * branch against the base list", which needs 1C installed and a project file to read.
 */
const DISPOSITION = [
  ['state the facts before the first edit', 'checklist', 'before the first edit to a file', 'nothing'],
  ['a destructive-command gate', 'rule', 'before a command that deletes or overwrites', 'the command text'],
  ['a delivery gate on a deterministic fact', 'rule', 'before declaring work finished', 'a fact that correlates with the goal, not a file mtime'],
  ['the verdict vocabulary', 'checklist', 'when deciding whether to adopt anything', 'nothing'],
  ['the filter that rejects "X is important"', 'rule', 'when writing advice into a skill', 'nothing'],
  ['name the missing evidence', 'rule', 'whenever a claim has no measurement behind it', 'nothing'],
  ['the output shape: main assumption', 'checklist', 'before starting work whose value is unproven', 'nothing'],
  ['the severity floors that are checkable', 'rule', 'when assigning severity in any review', 'nothing'],
  ['conflicting recommendations: keep both', 'rule', 'when two reviewers disagree', 'nothing'],
  ['the anti-pattern rows that are general', 'checklist', 'when coordinating more than one agent', 'more than one agent running'],
  ['approve with a reason', 'rule', 'when a plan needs approving', 'a plan and a decider'],
  ['the rule and its reason', 'rule', 'always, for any agent touching 1C data', 'a 1C system'],
  ['the reflex of answering with an alternative', 'rule', 'when refusing a request', 'nothing'],
  ['the narrow read-only exception', 'rule', 'when a task is genuinely about performance', 'the user\'s agreement'],
  ['verify metadata before composing a query', 'checklist', 'before writing a query against an unknown schema', 'a way to read the schema'],
  ['the 1C traps that the documentation buries', 'checklist', 'when writing a 1C query with compound types', 'a 1C system'],
  ['the base-selection order', 'script', 'when a 1C base has to be chosen', '1C installed and a project file'],
  ['the two parameters that drive 1C', 'script', 'when an agent must operate 1C, not merely open it', '1C installed'],
]

/** Attach a home and a trigger, or leave the part honestly homeless. */
function dispose(part) {
  const body = typeof part === 'string' ? part : part.part
  const found = DISPOSITION.find(([needle]) => body.includes(needle))
  if (found === undefined) {
    return { part: body, home: '', trigger: '', needs: '', state: 'recorded' }
  }
  return { part: body, home: found[1], trigger: found[2], needs: found[3], state: 'recorded' }
}

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
  // ── 1C:Enterprise. 159 repositories carry a SKILL.md for it, and the same skill
  //    names recur across a dozen of them, so these are three different authors and
  //    three different kinds of thing: an invariant, a reference, and a wrapper.
  {
    name: 'no-direct-db-access',
    repo: 'SteelMorgan/1c-agent-based-dev-framework',
    path: 'framework/rules/no-direct-db-access/SKILL.md',
    description: 'A global rule forbidding every agent from touching the 1C database directly: no INSERT, UPDATE, DELETE or DDL, no SQL scripts proposed, no bypass of platform mechanisms. Reads through the DBMS are allowed only with the user\'s agreement, and read-only diagnostics only for performance work.',
    keep: 'no',
    runsHere: 'after porting',
    hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 9 },
    taken: [
      'the rule and its reason — the platform is the only legitimate layer, because going under it bypasses business logic and breaks integrity — since a prohibition with a reason survives paraphrase and a bare one does not',
      'the reflex of answering with an alternative rather than a refusal: not "no", but "no, here is the platform way"',
      'the narrow read-only exception for performance diagnostics, bounded to EXPLAIN and system views and stated twice as read-only',
    ],
    note: 'Written for a framework with a shared context file and a clarification mechanism of its own, so two of its four response steps cannot be followed elsewhere, and its exception is self-authorising: the agent decides whether a task counts as a performance task. The substance is portable even where the plumbing is not.',
  },
  {
    name: 'composing-1c-queries',
    repo: 'ROCTUP/1c-mcp-toolkit',
    path: 'skills/composing-1c-queries/SKILL.md',
    description: 'How to write correct 1C query-language queries: clause structure, table naming for catalogs, documents, registers and their virtual tables, field selection, compound-type dereferencing, NULL handling, joins, grouping, totals, temporary tables and parameters.',
    keep: 'no',
    runsHere: 'after porting',
    hearing: { prosecutor: 6, defence: 5, verdict: 'reject the skill, take these parts', cases: 9 },
    taken: [
      'verify metadata before composing a query, with the cost argument attached — one call to retrieve names is cheaper than debugging a failed query — which is the same shape as stating the facts before the first edit',
      'the 1C traps that the documentation buries: compound-type field dereferencing, and NULL in virtual tables',
    ],
    note: 'The most useful sentence is the first — never invent metadata names — and the remaining 440 lines are platform reference that documents better and goes stale. It also promotes a transport limit to a rule about the language: write every query on a single line, with no reason given.',
  },
  {
    name: 'db-run',
    repo: 'Nikolay-Shirokov/cc-1c-skills',
    path: '.claude/skills/db-run/SKILL.md',
    description: 'Launches a 1C information base in user mode. Resolves which base from an explicit parameter, a name, or the current Git branch, then calls a PowerShell script with the platform path, credentials and any external data processor or navigational link to open.',
    keep: 'no',
    runsHere: 'after porting',
    hearing: { prosecutor: 7, defence: 4, verdict: 'reject the skill, take these parts', cases: 9 },
    taken: [
      'the base-selection order, and above all matching the current Git branch against the base list — the branch chooses the database, which is a decision procedure rather than a mechanic',
      'the two parameters that drive 1C rather than merely open it: run an external data processor, and open a navigational link straight to an object',
    ],
    note: 'It is a README for one PowerShell file: every rule lives in the script, and the body only resolves arguments. It also passes a password as a command-line argument, which is readable by other processes, and it returns control before knowing whether 1C started — so the agent cannot tell success from silence.',
  },

]

let failed = 0
for (const entry of ENTRIES) {
  const response = await fetch(`${base}/api/skill-scout.mod`, {
    method: 'POST',
    headers: { cookie, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'record', ...entry,
      taken: (entry.taken ?? []).map(dispose),
      url: `https://github.com/${entry.repo}`,
    }),
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
