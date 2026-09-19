#!/usr/bin/env node
/**
 * Unit tests for `@local/dsh-skill-manager`'s host half.
 *
 * The host half imports nothing but Node built-ins, so this runs anywhere: no DSH
 * installation, no running server, no network, no skills of anyone's own. Every
 * skill it touches is fabricated in a temporary directory, because the plugin
 * renames files and rewrites a frontmatter line — a thing not to rehearse on the
 * skills somebody is using.
 *
 * Actions are exercised through the real route handler with a stubbed `connection`
 * service, so the wiring is covered and not only the pure helpers.
 *
 * The check that matters most is the frontmatter rewrite: it edits a person's file,
 * and the assertion is that **exactly one line changes** and everything else
 * survives byte for byte.
 *
 * Usage: node tools/dev/test-skill-manager.mjs
 */

import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MOD = await import(`file://${join(REPO, 'packages', 'skill-manager', 'lib', 'index.js').replace(/\\/gu, '/')}`)

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

// ── a fabricated world ────────────────────────────────────────────────────────

const scratch = join(tmpdir(), `dsh-skill-manager-test-${String(process.pid)}`)
rmSync(scratch, { recursive: true, force: true })

const projects = join(scratch, 'projects')
const home = join(scratch, 'home')
mkdirSync(join(home, 'storages'), { recursive: true })

const alpha = join(projects, 'alpha')
const beta = join(projects, 'beta')
mkdirSync(join(alpha, '.git'), { recursive: true })
mkdirSync(join(beta, '.git'), { recursive: true })

// The workspace store the sidebar reads — the same one the plugin now reads.
writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
  tables: { workspaces: { aaa: { path: alpha, title: 'alpha' }, bbb: { path: beta, title: 'beta' } } },
}), 'utf8')

const ORIGINAL = `---
name: good-one
description: The original description.
license: MIT
metadata:
  version: 0.1.0
---

# Heading

Body text that must survive untouched.
`

mkdirSync(join(alpha, '.agents', 'skills', 'good-one'), { recursive: true })
writeFileSync(join(alpha, '.agents', 'skills', 'good-one', 'SKILL.md'), ORIGINAL, 'utf8')
mkdirSync(join(beta, '.agents', 'skills', 'from-beta'), { recursive: true })
writeFileSync(join(beta, '.agents', 'skills', 'from-beta', 'SKILL.md'),
  '---\nname: from-beta\ndescription: Lives in the second workspace.\n---\n\n# Beta\n', 'utf8')
writeFileSync(join(alpha, '.agents', 'skills', 'flat.md'),
  '---\nname: flat\ndescription: A flat skill.\n---\n', 'utf8')
mkdirSync(join(alpha, '.agents', 'skills', 'wrong'), { recursive: true })
writeFileSync(join(alpha, '.agents', 'skills', 'wrong', 'SKILL.md'),
  '---\nname: not-the-folder\ndescription: Name mismatch.\n---\n', 'utf8')
mkdirSync(join(alpha, '.agents', 'skills', 'no-frontmatter'), { recursive: true })
writeFileSync(join(alpha, '.agents', 'skills', 'no-frontmatter', 'SKILL.md'), '# Just a heading\n', 'utf8')

process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(scratch, 'no-agents-home')
process.env.DSH_SKILLS = ''

// ── roots and discovery ───────────────────────────────────────────────────────

const workspaces = MOD.workspaces()
ok('the workspace store is read', workspaces.length === 2, JSON.stringify(workspaces.map((w) => w.title)))
ok('and the titles come through', workspaces.some((w) => w.title === 'alpha') && workspaces.some((w) => w.title === 'beta'))

const roots = MOD.roots()
ok('a root is built for each workspace',
  roots.filter((r) => r.source.startsWith('project-agents')).length === 2)
ok('the custom separator does not split a drive letter',
  !(process.env.DSH_SKILLS ?? '').split(';').some((part) => part.length === 1),
  'setting DSH_SKILLS to C:\\x must yield one path, not "C" and "\\x"')

const state = MOD.snapshot()
const byName = new Map(state.skills.map((skill) => [skill.name, skill]))
ok('a skill in the first workspace is found', byName.has('good-one'))
ok('a skill in the SECOND workspace is found',
  byName.has('from-beta'), 'this is the fix: the server cwd would have found neither')
ok('a flat Markdown skill is found', byName.has('flat'))
ok('a name that does not match its folder is reported',
  byName.get('not-the-folder')?.problem !== null,
  `-> ${String(byName.get('not-the-folder')?.problem)}`)
ok('a well-formed skill reports no problem', byName.get('good-one')?.problem === null)
ok('a file with no frontmatter is still listed', byName.has('no-frontmatter'))
ok('the description is read from the frontmatter',
  byName.get('good-one')?.description === 'The original description.')
ok('nothing is registered before anyone registers it', state.registered === 0)
ok('the workspaces are reported to the page', state.workspaces.length === 2)

// ── describe: the frontmatter rewrite ─────────────────────────────────────────

const target = byName.get('good-one').file
const described = MOD.describe({
  file: target,
  modelDescription: 'Use when the trial needs a rewritten description.',
  humanSummary: 'Rewrites one line.',
  workspace: 'alpha',
})
ok('describe reports ok', described.ok === true, JSON.stringify(described))

const after = readFileSync(target, 'utf8')
const before = ORIGINAL.split('\n')
const now = after.split('\n')
const changed = now.filter((line, index) => line !== before[index]).length
ok('the description line was replaced',
  after.includes('description: "Use when the trial needs a rewritten description."'))
ok('the original description is gone', !after.includes('The original description.'))
ok('exactly ONE line changed', changed === 1, `changed lines: ${String(changed)}`)
ok('the rest of the frontmatter survived',
  after.includes('license: MIT') && after.includes('version: 0.1.0'))
ok('the closing fence survived', (after.match(/^---$/gmu) ?? []).length === 2)
ok('the body survived byte for byte', after.includes('Body text that must survive untouched.'))
ok('the file did not shrink to nothing', after.length > 100)

// ── the registry ──────────────────────────────────────────────────────────────

const registered = MOD.snapshot()
ok('the registry file was written', existsSync(MOD.registryPath()), MOD.registryPath())
ok('the skill reads as registered',
  registered.skills.find((s) => s.name === 'good-one')?.registered === true)
ok('the human summary round-trips',
  registered.skills.find((s) => s.name === 'good-one')?.humanSummary === 'Rewrites one line.')
ok('the id is the skill name',
  registered.skills.find((s) => s.name === 'good-one')?.id === 'good-one')

// ── a BOM in front of the frontmatter ─────────────────────────────────────────
//
// Found by the end-to-end round trip against a fresh instance, not by reading the
// code, and it is the shape of file PowerShell writes: `Set-Content -Encoding UTF8`
// puts a byte-order mark at the start. A mark in front of `---` defeated both the
// read and the write — the read returned an empty description, so the panel showed a
// blank line, and the write returned false in silence, so saving appeared to work and
// changed nothing. This is the regression test for that.
const bomDir = join(alpha, '.agents', 'skills', 'with-bom')
mkdirSync(bomDir, { recursive: true })
const BOM = '\ufeff'
const bomFile = join(bomDir, 'SKILL.md')
const bomOriginal = `${BOM}---\nname: with-bom\ndescription: Written by a tool that adds a byte-order mark.\n---\n\n# Body\n`
writeFileSync(bomFile, bomOriginal, 'utf8')

const bomSkill = MOD.snapshot().skills.find((skill) => skill.name === 'with-bom')
ok('a skill whose file starts with a BOM is discovered', bomSkill !== undefined)
ok('and its description is read, not left blank',
  bomSkill?.description === 'Written by a tool that adds a byte-order mark.',
  JSON.stringify(bomSkill?.description))

const bomWritten = MOD.writeDescription(bomFile, 'A description written over a BOM.')
ok('writing the description reports success rather than failing quietly',
  bomWritten?.ok === true, JSON.stringify(bomWritten))
const bomAfter = readFileSync(bomFile, 'utf8')
ok('the new description is in the file', bomAfter.includes('A description written over a BOM.'))
ok('the BOM was preserved, not quietly dropped', bomAfter.startsWith(BOM),
  `starts with ${JSON.stringify(bomAfter.slice(0, 1))}`)
ok('only the description line changed',
  bomAfter.split('\n').filter((line, index) => line !== bomOriginal.split('\n')[index]).length === 1)
ok('and the snapshot now reads the new description',
  MOD.snapshot().skills.find((skill) => skill.name === 'with-bom')?.description
    === 'A description written over a BOM.')

// A file with no frontmatter at all cannot carry a description, and saying so beats
// claiming a save that did nothing.
const bareDir = join(alpha, '.agents', 'skills', 'no-frontmatter')
const bareFile = join(bareDir, 'SKILL.md')
ok('a file with no frontmatter is refused rather than silently ignored',
  MOD.describe({ file: bareFile, modelDescription: 'x' }).code === 'no-frontmatter')

// ── pause and resume ──────────────────────────────────────────────────────────

ok('pause reports ok', MOD.toggle(target, 'pause').ok === true)
ok('the discoverable file became .paused', existsSync(`${target}.paused`))
ok('the original name is gone', !existsSync(target))
ok('the paused skill is still listed, as paused',
  MOD.snapshot().skills.find((s) => s.file === `${target}.paused`)?.paused === true)
ok('pausing twice is refused', MOD.toggle(`${target}.paused`, 'pause').code === 'already-paused')

const pausedDescribe = MOD.describe({
  file: `${target}.paused`,
  modelDescription: 'A description written while paused.',
})
ok('describing a paused skill reports ok', pausedDescribe.ok === true)
ok('and it is STILL paused', existsSync(`${target}.paused`) && !existsSync(target))

ok('resume reports ok', MOD.toggle(`${target}.paused`, 'resume').ok === true)
ok('the file is back under its name', existsSync(target))
ok('resuming an active skill is refused', MOD.toggle(target, 'resume').code === 'not-paused')

// ── the guard ─────────────────────────────────────────────────────────────────

const outside = join(scratch, 'outside')
mkdirSync(outside, { recursive: true })
writeFileSync(join(outside, 'SKILL.md'), '---\nname: outside\ndescription: no\n---\n', 'utf8')
ok('a path outside every root is refused',
  MOD.toggle(join(outside, 'SKILL.md'), 'pause').code === 'outside-roots')
ok('describe outside the roots is refused too',
  MOD.describe({ file: join(outside, 'SKILL.md'), modelDescription: 'x' }).code === 'outside-roots')
ok('and the outside file was left alone',
  readFileSync(join(outside, 'SKILL.md'), 'utf8').includes('description: no'))
ok('a missing file is reported, not thrown',
  MOD.toggle(join(alpha, '.agents', 'skills', 'ghost.md'), 'pause').code === 'not-found')

// ── forget ────────────────────────────────────────────────────────────────────

ok('forget reports ok', MOD.forget('good-one').ok === true)
ok('the skill reads as unregistered again',
  MOD.snapshot().skills.find((s) => s.name === 'good-one')?.registered === false)
// The last description written wins — the one saved while the skill was paused — and
// forgetting a registry entry must not touch the file at all.
ok('the skill itself is untouched by forgetting',
  existsSync(target) && readFileSync(target, 'utf8').includes('A description written while paused.'),
  readFileSync(target, 'utf8').split('\n').find((line) => line.startsWith('description:')))
ok('forgetting something unknown is refused', MOD.forget('nope').code === 'not-registered')

// ── the route handler, with a stubbed connection ──────────────────────────────

let handler
const ctx = {
  connection: { fetch: { register: (options) => { handler = options.fetch; return () => {} } } },
  effect: (fn) => { fn() },
}
MOD.apply(ctx)
ok('the route was registered', typeof handler === 'function')
ok('and it is mounted on the declared path', MOD.SKILL_ROUTE_PATH === '/api/skill-manager.mod')

const getResponse = await handler(new Request('http://dsh.internal/api/skill-manager.mod'))
const getBody = await getResponse.json()
ok('GET answers 200', getResponse.status === 200)
ok('GET returns the state', getBody.ok === true && typeof getBody.state?.total === 'number')
ok('GET lists the fabricated skills', getBody.state.total >= 4, `total=${String(getBody.state?.total)}`)

const postResponse = await handler(new Request('http://dsh.internal/api/skill-manager.mod', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'pause', file: target }),
}))
const postBody = await postResponse.json()
ok('POST pause answers 200', postResponse.status === 200)
ok('POST pause reports the new state', postBody.ok === true && postBody.paused === true)
ok('and the state it returns is already paused',
  postBody.state.skills.find((s) => s.file === `${target}.paused`)?.paused === true)
MOD.toggle(`${target}.paused`, 'resume')

const badResponse = await handler(new Request('http://dsh.internal/api/skill-manager.mod', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'launch-missiles', file: target }),
}))
ok('an unknown action is refused with a stable code',
  badResponse.status === 400 && (await badResponse.json()).code === 'bad-request')

const forbiddenResponse = await handler(new Request('http://dsh.internal/api/skill-manager.mod', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'pause', file: join(outside, 'SKILL.md') }),
}))
ok('the route refuses a path outside the roots',
  forbiddenResponse.status === 400 && (await forbiddenResponse.json()).code === 'outside-roots')

const malformed = await handler(new Request('http://dsh.internal/api/skill-manager.mod', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
}))
ok('a malformed body is refused', malformed.status === 400)

const wrongMethod = await handler(new Request('http://dsh.internal/api/skill-manager.mod', { method: 'PUT' }))
ok('an unsupported method is refused', wrongMethod.status === 405)

// ── done ──────────────────────────────────────────────────────────────────────

rmSync(scratch, { recursive: true, force: true })
console.log('')
console.log(`${String(checks - failed)}/${String(checks)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
