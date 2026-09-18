/**
 * Mint the browser-session cookie a `dsh web` instance expects.
 *
 * The Web GUI authenticates browsers with an authority-bound signed cookie. Its
 * secret is a durable credential of the Harness home, so a Node script can talk
 * to the authenticated `/api` channel without a browser. The secret is read
 * locally and never printed.
 *
 * Shared by `tools/boot-check.mjs` and `tools/dev/verify-live.mjs` so that the
 * one piece of credential-handling code in this repository has a single source
 * of truth.
 *
 * @module tools/lib/session-cookie
 */

import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Read the browser-session signing secret from a Harness home.
 *
 * @param {string} home Harness home directory.
 * @returns {Buffer} the secret, decoded from base64url.
 * @throws {Error} when the credentials file is missing or has no such block.
 */
export const readSessionSecret = (home) => {
  const credentials = join(home, '.credentials.yaml')
  const text = readFileSync(credentials, 'utf8')
  const block = text.slice(text.indexOf('client-connection/browser-session:'))
  const match = /^\s*secret:\s*(\S+)\s*$/mu.exec(block)
  if (match === null) throw new Error(`no browser-session secret in ${credentials}`)
  return Buffer.from(match[1], 'base64url')
}

/**
 * Build the `Cookie` header value for one authority.
 *
 * @param {string} base Base URL of the running instance, e.g. `http://127.0.0.1:3080`.
 * @param {string} [home] Harness home; defaults to `$DSH_HOME` or `~/.dsh`.
 * @returns {string} a `name=value` pair suitable for a `cookie` header.
 */
export const mintSessionCookie = (base, home = process.env.DSH_HOME ?? join(homedir(), '.dsh')) => {
  const authority = new URL(base).host
  const secret = readSessionSecret(home)
  const issuedAt = Date.now()
  const body = Buffer.from(JSON.stringify({
    version: 1,
    authority,
    issuedAt,
    expiresAt: issuedAt + 3600_000,
  })).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  const name = `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`
  return `${name}=v1.${body}.${signature}`
}
