/**
 * Restart the `dsh web` server that owns the configured port.
 *
 * Runs detached from the caller so it survives the very process it replaces:
 * it waits out the caller's turn (so the session log is flushed and the final
 * message is delivered), stops the listener, waits for the port to be
 * released, starts an equivalent server, and records everything in a log.
 *
 * Usage: node _dsh_mod/restart-web.mjs [delayMs] [port]
 */

import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, openSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const delayMs = Number(process.argv[2] ?? 35000)
const port = Number(process.argv[3] ?? 3080)

const LOG = join(here, 'restart-web.log')
const OUT = join(here, 'restart-web.out.log')
const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const BIN = 'C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\1e7f6d9597241db0\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
const CWD = 'C:\\Users\\admin\\Documents\\ds1'
const HOME = 'C:\\Users\\admin\\.dsh'

const log = (message) => {
  appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`)
  console.log(message)
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** PIDs currently LISTENING on the port. */
function listeners() {
  const listing = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
  const pids = new Set()
  for (const line of listing.split(/\r?\n/u)) {
    if (!line.includes(`:${String(port)}`) || !line.includes('LISTENING')) continue
    const parts = line.trim().split(/\s+/u)
    const pid = parts[parts.length - 1]
    if (/^\d+$/u.test(pid)) pids.add(pid)
  }
  return [...pids]
}

async function waitForPort(expectListening, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pids = listeners()
    if (expectListening ? pids.length > 0 : pids.length === 0) return pids
    await wait(1000)
  }
  return listeners()
}

log(`helper started; will restart port ${String(port)} in ${String(Math.round(delayMs / 1000))}s`)
await wait(delayMs)
log(`delay elapsed; listeners: ${JSON.stringify(listeners())}`)

// 1. stop the current server
for (const pid of listeners()) {
  try {
    process.kill(Number(pid))
    log(`sent termination to pid ${pid}`)
  } catch (error) {
    log(`termination of pid ${pid} failed: ${error.message}; trying taskkill`)
    try {
      execFileSync('taskkill', ['/PID', pid, '/F'], { encoding: 'utf8' })
      log(`taskkill stopped pid ${pid}`)
    } catch (inner) {
      log(`taskkill failed for pid ${pid}: ${inner.message}`)
    }
  }
}

const afterStop = await waitForPort(false, 20000)
if (afterStop.length > 0) {
  log(`ABORT: port ${String(port)} is still held by ${JSON.stringify(afterStop)}`)
  process.exit(1)
}
log(`port ${String(port)} released`)

// 2. start an equivalent server, detached from this helper
const out = openSync(OUT, 'a')
const child = spawn(NODE, [BIN, 'web', '--no-open', '--port', String(port)], {
  cwd: CWD,
  env: { ...process.env, DSH_HOME: HOME },
  detached: true,
  stdio: ['ignore', out, out],
  windowsHide: true,
})
child.unref()
log(`spawned replacement server pid ${String(child.pid)}`)

// 3. confirm it bound the port
const listening = await waitForPort(true, 60000)
if (listening.length === 0) {
  let tail = ''
  try {
    tail = readFileSync(OUT, 'utf8').split(/\r?\n/u).slice(-12).join(' | ')
  } catch {}
  log(`FAILED: nothing is listening on ${String(port)} after 60s; output tail: ${tail}`)
  process.exit(1)
}

let url = '(not captured)'
try {
  const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/u.exec(readFileSync(OUT, 'utf8'))
  if (match !== null) url = match[1]
} catch {}
log(`OK: server is listening on ${String(port)} (pids ${JSON.stringify(listening)}); url ${url}`)
