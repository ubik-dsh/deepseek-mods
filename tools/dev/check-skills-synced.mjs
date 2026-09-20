#!/usr/bin/env node
/**
 * Does every installed copy of a skill match the repository that publishes it?
 *
 * This family's skills live in three places at once:
 *
 *   ../deepseek-harness-skills/skills   the source — versioned, published, the one to edit
 *   ../.agents/skills                   the live root this Harness resolves
 *   ./.agents/skills                    a committed copy, so this repository carries its tools
 *
 * Nothing kept them in step, and the first run of this check found it:  `manage-windows`
 * was installed **without** the `--pid` identity check and without `--point`, because the
 * fix was committed to the source and never copied out. The installed preflight still
 * matched a window by title alone, which is the exact failure the fix had removed. The
 * code worked, the panel looked the same, and the fifth check of a five-check tool was
 * absent on the machine that needed it.
 *
 * That is rule 5 of AGENTS.md — install what you commit, commit what you install — one
 * level up from the packages, and it had no check.
 *
 * A paused skill is not drift. DSH pauses by renaming `SKILL.md` to `SKILL.md.paused`, so
 * an installed copy without `SKILL.md` is read as paused and its paused file is compared
 * against the source instead. `--sync` writes back in the same form and never un-pauses.
 *
 * Usage:
 *   node tools/dev/check-skills-synced.mjs              # report drift, exit 1 on any
 *   node tools/dev/check-skills-synced.mjs route-a-task # one skill
 *   node tools/dev/check-skills-synced.mjs --sync       # copy source over every target
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKSPACE = join(REPO, '..')

const SOURCE = process.env.DSH_SKILLS_SOURCE ?? join(WORKSPACE, 'deepseek-harness-skills', 'skills')

const TARGETS = [
  { label: 'live .agents', root: join(WORKSPACE, '.agents', 'skills') },
  { label: 'dsh-mods', root: join(REPO, '.agents', 'skills') },
]

/** Files that belong to a build or an editor rather than to the skill. */
const IGNORED = new Set(['node_modules', '__pycache__', '.DS_Store', '.git'])

/** The name DSH reads, and the name a pause gives it. */
const SKILL = 'SKILL.md'
const PAUSED = 'SKILL.md.paused'

const args = process.argv.slice(2)
const sync = args.includes('--sync')
const only = args.find((one) => !one.startsWith('--'))

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)

/** Every file under a directory, as relative paths, skipping build artefacts. */
function walk(root) {
  const found = []
  if (!existsSync(root)) return found
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) found.push(relative(root, full))
    }
  }
  visit(root)
  return found.sort()
}

if (!existsSync(SOURCE)) {
  console.error(`cannot read the skills source: ${SOURCE}`)
  console.error('set DSH_SKILLS_SOURCE if it lives somewhere else')
  process.exit(2)
}

let skills
try {
  skills = readdirSync(SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(SOURCE, name, SKILL)))
    .filter((name) => only === undefined || name === only)
    .sort()
} catch {
  console.error(`cannot read ${SOURCE}`)
  process.exit(2)
}

if (skills.length === 0) {
  console.error(`no skill matched ${String(only)} under ${SOURCE}`)
  process.exit(2)
}

console.log(`  source:  ${SOURCE}`)
for (const target of TARGETS) console.log(`  target:  ${target.label}  ${target.root}`)
if (sync) console.log('  mode:    --sync, writing the source over every target')
console.log('')

let problems = 0
let copies = 0

for (const name of skills) {
  const source = join(SOURCE, name)
  const inSource = walk(source)

  for (const target of TARGETS) {
    const installed = join(target.root, name)
    const label = `${name} -> ${target.label}`

    if (!existsSync(installed)) {
      if (sync) {
        for (const file of inSource) {
          const to = join(installed, file)
          mkdirSync(dirname(to), { recursive: true })
          copyFileSync(join(source, file), to)
          copies += 1
        }
        console.log(`  copied    ${label}  (${String(inSource.length)} file(s), was absent)`)
      } else {
        console.log(`  MISSING   ${label}`)
        console.log(`            ${installed}`)
        console.log('            fix: node tools/dev/check-skills-synced.mjs --sync')
        problems += 1
      }
      continue
    }

    const paused = existsSync(join(installed, PAUSED)) && !existsSync(join(installed, SKILL))
    // A paused skill stores its body under the paused name, so that is the file to compare.
    const differences = []
    let copied = 0

    for (const file of inSource) {
      const wanted = file === SKILL && paused ? PAUSED : file
      const there = join(installed, wanted)
      if (!existsSync(there)) {
        differences.push(`missing: ${wanted}`)
        if (sync) {
          mkdirSync(dirname(there), { recursive: true })
          copyFileSync(join(source, file), there)
          copied += 1
        }
        continue
      }
      if (digest(join(source, file)) === digest(there)) continue
      differences.push(
        `differs: ${wanted} (source ${String(statSync(join(source, file)).size)} b, `
        + `installed ${String(statSync(there).size)} b)`)
      if (sync) {
        copyFileSync(join(source, file), there)
        copied += 1
      }
    }

    // An extra file is drift the copy cannot repair, so it is counted on both sides of the
    // branch and never deleted silently. The first version of this tool reported "1 file
    // rewritten" after rewriting three, because a difference it had just fixed was dropped
    // from the list it counted - a tool whose own report was wrong.
    const extras = walk(installed)
      .filter((file) => file !== PAUSED && !inSource.includes(file))
    for (const file of extras) differences.push(`only installed: ${file}`)

    copies += copied

    if (differences.length === 0) {
      const how = paused ? 'paused, and current' : 'identical'
      console.log(`  ok        ${label}  (${String(inSource.length)} file(s) ${how})`)
    } else if (sync) {
      console.log(`  synced    ${label}  (${String(copied)} rewritten, `
        + `${String(extras.length)} left alone)`)
      for (const file of extras) console.log(`            kept, not deleted: ${file}`)
    } else {
      console.log(`  DRIFT     ${label}`)
      for (const line of differences) console.log(`            ${line}`)
      problems += differences.length
    }
  }
}

console.log('')
if (sync) {
  console.log(`SYNCED — ${String(copies)} file(s) copied from the source into the installed trees`)
  console.log('         run without --sync to confirm, then commit the copies')
  process.exit(0)
}
if (problems === 0) {
  console.log(`PASS — every installed skill matches the source (${String(skills.length)} skill(s) × ${String(TARGETS.length)} tree(s))`)
  process.exit(0)
}
console.log(`FAIL — ${String(problems)} difference(s) between the source and the installed trees`)
console.log('       fix: node tools/dev/check-skills-synced.mjs --sync')
process.exit(1)
