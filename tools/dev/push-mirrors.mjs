#!/usr/bin/env node
/**
 * Push this repository to every mirror it is published to.
 *
 * Publishing to one host is a `git push`. Publishing to two is where copies
 * drift: one succeeds, the other is forgotten, and a reader of the second one
 * gets yesterday's code without any sign of it. This pushes to all of them and
 * says plainly which ones it did **not** reach.
 *
 * Tokens are read from files, never from arguments, and every line of git's
 * output is scrubbed of them before it is printed — so this can run in a
 * terminal that is being watched or recorded.
 *
 * Usage:
 *   node tools/dev/push-mirrors.mjs                 # push to every mirror
 *   node tools/dev/push-mirrors.mjs --dry-run       # report, write nothing
 *   node tools/dev/push-mirrors.mjs --branch main
 *
 * Token files, in order of precedence:
 *   $GITVERSE_TOKEN_FILE / $GITHUB_TOKEN_FILE, else ~/.dsh-mirror-tokens/<name>
 *
 * A mirror with no token is reported as skipped, and the summary then says the
 * copies are not in sync rather than claiming success.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const valueOf = (flag, fallback) => {
  const index = argv.indexOf(flag)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const BRANCH = valueOf('--branch', 'main')
const HOME_TOKENS = join(homedir(), '.dsh-mirror-tokens')

/**
 * The mirrors, and how each host wants its token presented.
 *
 * GitHub stopped accepting account passwords for git over HTTPS and expects the
 * token as the password of a Basic header — the shape `actions/checkout` uses.
 * GitVerse takes a plain bearer token.
 */
const MIRRORS = [
  {
    name: 'gitverse',
    remote: 'origin',
    tokenFile: process.env.GITVERSE_TOKEN_FILE ?? join(HOME_TOKENS, 'gitverse'),
    header: (token) => `http.extraHeader=Authorization: Bearer ${token}`,
  },
  {
    name: 'github',
    remote: 'github',
    tokenFile: process.env.GITHUB_TOKEN_FILE ?? join(HOME_TOKENS, 'github'),
    header: (token) =>
      `http.extraHeader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
  },
]

const git = (args) =>
  execFileSync('git', ['-C', REPO, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: 'pipe',
  })

/** Replace every secret with a marker before anything is printed. */
const scrub = (text, secrets) => {
  let out = String(text)
  for (const secret of secrets) {
    if (secret !== '') out = out.split(secret).join('<TOKEN>')
  }
  return out
}

const remotes = git(['remote']).split('\n').map((line) => line.trim()).filter(Boolean)
const head = git(['rev-parse', '--short', 'HEAD']).trim()
console.log(`repository: ${REPO}`)
console.log(`pushing ${BRANCH} @ ${head} to ${String(MIRRORS.length)} mirror(s)`)

const secrets = []
const pushed = []
const skipped = []
let failed = 0

for (const mirror of MIRRORS) {
  if (!remotes.includes(mirror.remote)) {
    console.log(`\n${mirror.name}: skipped — no \`${mirror.remote}\` remote configured`)
    skipped.push(`${mirror.name} (no remote)`)
    continue
  }
  let token = ''
  try {
    token = readFileSync(mirror.tokenFile, 'utf8').trim()
  } catch {
    console.log(`\n${mirror.name}: skipped — no token file at ${mirror.tokenFile}`)
    skipped.push(`${mirror.name} (no token)`)
    continue
  }
  if (token === '') {
    console.log(`\n${mirror.name}: skipped — the token file is empty`)
    skipped.push(`${mirror.name} (empty token)`)
    continue
  }
  secrets.push(token, Buffer.from(`x-access-token:${token}`).toString('base64'))

  if (DRY_RUN) {
    console.log(`\n${mirror.name}: would push to \`${mirror.remote}\` (token of ${String(token.length)} chars)`)
    pushed.push(`${mirror.name} (dry run)`)
    continue
  }

  try {
    const output = git(['-c', mirror.header(token), 'push', mirror.remote, `${BRANCH}:${BRANCH}`])
    console.log(`\n${mirror.name}: ok`)
    pushed.push(mirror.name)
    for (const line of scrub(output, secrets).split('\n').filter((l) => l.trim() !== '')) {
      console.log(`  ${line}`)
    }
  } catch (error) {
    failed += 1
    console.log(`\n${mirror.name}: FAILED`)
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`
    for (const line of scrub(detail, secrets).split('\n').filter((l) => l.trim() !== '').slice(0, 8)) {
      console.log(`  ${line}`)
    }
  }
}

console.log('')
console.log(`pushed:  ${pushed.length === 0 ? '(none)' : pushed.join(', ')}`)
console.log(`skipped: ${skipped.length === 0 ? '(none)' : skipped.join(', ')}`)
if (failed > 0) {
  console.log(`${String(failed)} mirror(s) FAILED — the copies are not in sync`)
  process.exit(1)
}
if (skipped.length > 0) {
  console.log('the copies are NOT in sync: a skipped mirror still holds an older commit')
  process.exit(0)
}
console.log('every configured mirror is up to date')
