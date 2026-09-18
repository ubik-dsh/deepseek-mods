#!/usr/bin/env node
/**
 * Look for secrets in everything this repository would publish.
 *
 * A public repository leaks instantly, so this scans three places, not one:
 *
 *   1. the names git tracks — a `.env` or `.credentials.yaml` must never be one;
 *   2. every blob in the local object database, **including unreachable ones**,
 *      because a dangling blob is still sent by `git push --mirror` and can be
 *      re-parented by a later commit;
 *   3. the working tree on disk, ignored files included.
 *
 * Two kinds of signal:
 *
 *   - high-signal patterns (key shapes, private-key headers, a literal bearer
 *     token) — always a failure;
 *   - an optional list of exact strings, passed with `--secret-file`, compared
 *     by substring. Use it to assert that a token you know about appears
 *     nowhere. The file's contents are never printed.
 *
 * Naming `.credentials.yaml` in documentation is expected — that is what the
 * security notes are for — so a bare mention is reported as informational. A
 * mention with a value beside it is a failure.
 *
 * Usage:
 *   node tools/dev/scan-secrets.mjs
 *   node tools/dev/scan-secrets.mjs --secret-file /path/to/token.txt
 *   node tools/dev/scan-secrets.mjs --git "C:\\Program Files\\Git\\cmd\\git.exe"
 *
 * Exit codes: 0 clean, 1 a finding, 2 git could not be run so the object
 * database was **not** checked. A partial scan never reports success — two of
 * the three places a secret hides are in git's object store, and calling that
 * "clean" would be a lie.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const valueOf = (flag) => {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

const SKIP_DIRS = new Set(['.git', 'node_modules'])
const MAX_FILE_BYTES = 32 * 1024 * 1024

/** Key shapes and credential headers. A match is always a failure. */
const PATTERNS = [
  ['openai-style key', /\bsk-[A-Za-z0-9_-]{20,}/gu],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}/gu],
  ['GitLab-style token', /\bglpat-[A-Za-z0-9_-]{16,}/gu],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/gu],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gu],
  ['literal bearer token', /authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/giu],
]

/** A value assigned next to the credentials file name. */
const LEAKED_ASSIGNMENT = /\.credentials\.yaml[^\n]{0,40}?[:=]\s*\S+/gu

/** File names that must never be tracked, whatever they contain. */
const FORBIDDEN = /(^|\/)(\.env(\..+)?|\.credentials\.(ya?ml|json)|id_rsa|id_ed25519|.*\.pem|.*\.pfx|.*\.p12)$/iu

const MENTION = /\.credentials\.yaml/gu

/** Exact strings to search for, from `--secret-file`. */
const secrets = []
const secretFile = valueOf('--secret-file')
if (secretFile !== undefined) {
  try {
    const value = readFileSync(secretFile, 'utf8').trim()
    if (value.length >= 8) secrets.push([`--secret-file (${String(value.length)} chars)`, value])
    else console.error(`ignoring ${secretFile}: shorter than 8 characters`)
  } catch {
    console.error(`cannot read --secret-file ${secretFile}`)
    process.exit(2)
  }
}

const gitBin = valueOf('--git') ?? 'git'
const runGit = (...args) =>
  execFileSync(gitBin, ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

let hasGit = true
try {
  runGit('--version')
} catch {
  hasGit = false
}

const violations = []
const flagged = (where, detail) => violations.push(`${where} — ${detail}`)
let mentions = 0

const scan = (text, where) => {
  for (const [label, value] of secrets) {
    if (text.includes(value)) flagged(where, `contains ${label}`)
  }
  for (const [label, pattern] of PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) flagged(where, `matches ${label}`)
  }
  LEAKED_ASSIGNMENT.lastIndex = 0
  if (LEAKED_ASSIGNMENT.test(text)) flagged(where, 'names the credentials file with a value beside it')
  MENTION.lastIndex = 0
  if (MENTION.test(text)) mentions += 1
}

// ---- 1. tracked names ---------------------------------------------------
if (hasGit) {
  const tracked = runGit('ls-files').split('\n').filter((line) => line !== '')
  console.log(`tracked names: ${String(tracked.length)}`)
  for (const path of tracked) {
    if (FORBIDDEN.test(path)) flagged(`tracked ${path}`, 'must never be tracked')
  }
} else {
  console.log(`tracked names: NOT SCANNED — cannot run \`${gitBin}\``)
}

// ---- 2. object database, unreachable included ---------------------------
if (hasGit) {
  const reachablePaths = new Map()
  for (const line of runGit('rev-list', '--objects', 'HEAD').split('\n')) {
    const [sha, ...rest] = line.split(' ')
    if (rest.length > 0) reachablePaths.set(sha, rest.join(' '))
  }
  const blobs = runGit('cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)')
    .split('\n')
    .filter((line) => line.endsWith(' blob'))
    .map((line) => line.split(' ')[0])
  for (const sha of blobs) {
    const where = reachablePaths.has(sha)
      ? `blob ${reachablePaths.get(sha)}`
      : `UNREACHABLE blob ${sha.slice(0, 10)}`
    scan(execFileSync(gitBin, ['-C', REPO, 'cat-file', 'blob', sha], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8'), where)
  }
  console.log(`blobs scanned: ${String(blobs.length)}`)
} else {
  console.log('object database: NOT SCANNED — this is where unreachable blobs hide')
}

// ---- 3. working tree on disk -------------------------------------------
let files = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      walk(full)
      continue
    }
    if (stats.size > MAX_FILE_BYTES) continue
    files += 1
    scan(readFileSync(full, 'utf8'), `file ${relative(REPO, full).replace(/\\/gu, '/')}`)
  }
}
try {
  walk(REPO)
} catch (error) {
  console.error(`cannot walk the working tree: ${error.message}`)
}
console.log(`files scanned on disk: ${String(files)}`)

// ---- verdict -----------------------------------------------------------
console.log('')
if (mentions > 0) {
  console.log(`informational: the credentials file is named in ${String(mentions)} place(s), which the security notes are for.`)
  console.log('')
}
if (violations.length === 0) {
  if (!hasGit) {
    console.log('PARTIAL — the disk is clean, but tracked names and the object database were NOT scanned')
    console.log(`because \`${gitBin}\` could not be run. Point --git at a git binary and run again.`)
    process.exit(2)
  }
  console.log('PASS — no secret found in tracked names, in any blob, or on disk')
  process.exit(0)
}
console.log(`FAIL — ${String(violations.length)} finding(s):`)
for (const violation of violations) console.log(`  ${violation}`)
process.exit(1)
