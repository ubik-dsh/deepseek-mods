#!/usr/bin/env node
/**
 * Report which client rows a running DSH Web GUI actually serves.
 *
 * `dsh web` authenticates browsers with an authority-bound signed cookie whose
 * secret is a durable credential of the Harness home, so this probe can verify
 * an installation without a browser. It reads that secret locally and never
 * prints it.
 *
 * Usage:
 *   node tools/boot-check.mjs                       # http://127.0.0.1:3080
 *   node tools/boot-check.mjs http://127.0.0.1:3080 dsh-locale-ru
 *
 * @module tools/boot-check
 */

import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:3080'
const names = process.argv.slice(3)
const authority = new URL(base).host
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')

const credentials = join(home, '.credentials.yaml')
let secret
try {
  const text = readFileSync(credentials, 'utf8')
  const block = text.slice(text.indexOf('client-connection/browser-session:'))
  secret = Buffer.from(/^\s*secret:\s*(\S+)\s*$/mu.exec(block)[1], 'base64url')
} catch {
  console.error(`cannot read the browser-session secret from ${credentials}`)
  process.exit(2)
}

const issuedAt = Date.now()
const body = Buffer.from(JSON.stringify({
  version: 1,
  authority,
  issuedAt,
  expiresAt: issuedAt + 3600_000,
})).toString('base64url')
const signature = createHmac('sha256', secret).update(body).digest('base64url')
const cookie = `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}=v1.${body}.${signature}`

let response
try {
  response = await fetch(`${base}/`, { headers: { cookie } })
} catch (error) {
  console.error(`cannot reach ${base}: ${error.message}`)
  console.error('is `dsh web` running?')
  process.exit(2)
}
const html = await response.text()
if (response.status !== 200) {
  console.error(`GET / -> ${String(response.status)}; the derived cookie was refused`)
  process.exit(2)
}

console.log(`GET / -> 200 (${String(html.length)} bytes)`)
console.log(`boot rows referencing /client.js: ${String((html.match(/\/client\.js/gu) ?? []).length)}`)
const wanted = names.length > 0 ? names : ['dsh-system-prompt-mod', 'dsh-locale-ru']
let failed = 0
for (const name of wanted) {
  const present = html.includes(name)
  if (!present) failed += 1
  console.log(`  ${present ? 'OK  ' : 'MISS'} ${name}`)
}
process.exit(failed === 0 ? 0 : 1)
