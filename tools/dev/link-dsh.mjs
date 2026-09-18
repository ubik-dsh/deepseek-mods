#!/usr/bin/env node
/**
 * Link this repository to a DSH installation so the unit tests can import
 * `@deepseek-ai/*`.
 *
 * Creates `node_modules` in the repository root pointing at the DSH profile's
 * `node_modules` (a junction on Windows, a symlink elsewhere). The link is
 * ignored by git.
 *
 * Usage: node tools/dev/link-dsh.mjs
 *
 * @module tools/dev/link-dsh
 */

import { existsSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const target = join(home, 'profiles', 'node_modules')
const link = join(repo, 'node_modules')

if (!existsSync(target)) {
  console.error(`no DSH profile modules at ${target}`)
  console.error('set DSH_HOME if your Harness home lives elsewhere, and run `dsh web` at least once.')
  process.exit(2)
}
if (existsSync(link)) {
  console.log(`node_modules already exists at ${link} — nothing to do`)
  process.exit(0)
}

// 'junction' keeps Windows happy without developer mode or admin rights.
symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
console.log(`linked ${link} -> ${target}`)
console.log('now run: node tools/dev/test-host.mjs')
