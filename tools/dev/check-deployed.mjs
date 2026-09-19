#!/usr/bin/env node
/**
 * Does what is deployed match what this repository ships?
 *
 * A mod is installed by copying `packages/<folder>/` into
 * `$DSH_HOME/profiles/node_modules/@local/<name>/`, and nothing keeps the two in
 * step afterwards. So a fix can land in the repository and never reach the running
 * instance, or reach it and never be committed — and both are invisible, because the
 * code keeps working and the panel looks the same.
 *
 * That is not hypothetical. The first run of this check found `skill-manager` with a
 * README missing from the deployment and another one two commits stale, while every
 * source file matched. Nothing was broken; the deployment had simply drifted.
 *
 * It compares **content**, by digest, and reports a file that is present on one side
 * and not the other in either direction — an extra file in the deployment is drift
 * too, and the thing most likely to be forgotten.
 *
 * Usage:
 *   node tools/dev/check-deployed.mjs            # every package
 *   node tools/dev/check-deployed.mjs mod-manager
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKAGES = join(REPO, 'packages')
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const INSTALLED = join(HOME, 'profiles', 'node_modules', '@local')

/** Files that belong to a build rather than to the source. */
const IGNORED = new Set(['node_modules', '__pycache__', '.DS_Store'])

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

const only = process.argv[2]
let packages
try {
  packages = readdirSync(PACKAGES)
    .filter((name) => existsSync(join(PACKAGES, name, 'package.json')))
    .filter((name) => only === undefined || name === only)
} catch {
  console.error(`cannot read ${PACKAGES}`)
  process.exit(2)
}

if (packages.length === 0) {
  console.error(`no package matched ${String(only)} under ${PACKAGES}`)
  process.exit(2)
}

console.log(`  Harness home: ${HOME}`)
console.log('')

let problems = 0
for (const folder of packages) {
  const source = join(PACKAGES, folder)
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  // The loader resolves the row's `name` to a directory of that same name, so the
  // deployment lands in the last segment of the package's own name.
  const deployed = join(INSTALLED, String(manifest.name).split('/').pop())

  if (!existsSync(deployed)) {
    console.log(`  MISSING   ${manifest.name} — not deployed at all`)
    console.log(`            ${deployed}`)
    problems += 1
    continue
  }

  const inSource = walk(source)
  const inDeployed = walk(deployed)
  const differences = []

  for (const file of inSource) {
    const target = join(deployed, file)
    if (!existsSync(target)) differences.push(`missing in deployment: ${file}`)
    else if (digest(join(source, file)) !== digest(target)) {
      differences.push(
        `differs: ${file} (repo ${String(statSync(join(source, file)).size)} b, `
        + `deployed ${String(statSync(target).size)} b)`)
    }
  }
  for (const file of inDeployed) {
    if (!inSource.includes(file)) differences.push(`only in deployment: ${file}`)
  }

  if (differences.length === 0) {
    console.log(`  ok        ${manifest.name}  (${String(inSource.length)} file(s) identical)`)
  } else {
    console.log(`  DRIFT     ${manifest.name}`)
    for (const line of differences) console.log(`            ${line}`)
    console.log('            fix: node tools/install.mjs')
    problems += differences.length
  }
}

console.log('')
if (problems === 0) {
  console.log(`PASS — what is deployed matches what this repository ships (${String(packages.length)} package(s))`)
  process.exit(0)
}
console.log(`FAIL — ${String(problems)} difference(s) between the repository and the deployment`)
console.log('       install the current source, or commit what is deployed')
process.exit(1)
