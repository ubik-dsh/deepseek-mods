/**
 * Render the real Web GUI in a headless Edge and report what is actually on
 * screen: the chat-page control this mod registers and the editor window it
 * opens.
 *
 * Node 24 ships a global WebSocket, so this drives the Chrome DevTools
 * Protocol directly — no puppeteer/playwright install needed.
 *
 * Usage: node _dsh_mod/ui-check.mjs <base> <launchToken>
 */

import { createHash, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv[2] ?? 'http://127.0.0.1:3080'
const launchToken = process.argv[3] === undefined || process.argv[3] === 'none' ? undefined : process.argv[3]
const sessionTitle = process.argv[4] ?? 'привет'
const shouldCreate = process.argv[5] !== 'no-create'

const authority = new URL(base).host
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
// Screenshots land outside the checkout by default, so running a check never
// dirties the repository. Override with DSH_SHOTS to keep them where you like.
const shots = process.env.DSH_SHOTS ?? join(tmpdir(), 'dsh-mod-shots')
mkdirSync(shots, { recursive: true })

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const PROFILE = join(here, '_edge-profile')

// ── host API helpers ───────────────────────────────────────────────────────
function readSecret() {
  const text = readFileSync(join(home, '.credentials.yaml'), 'utf8')
  const block = text.slice(text.indexOf('client-connection/browser-session:'))
  const match = /^\s*secret:\s*(\S+)\s*$/mu.exec(block)
  if (match === null) throw new Error('browser-session secret not found')
  return Buffer.from(match[1], 'base64url')
}

function mintCookie() {
  const issuedAt = Date.now()
  const body = Buffer.from(JSON.stringify({
    version: 1,
    authority,
    issuedAt,
    expiresAt: issuedAt + 3600_000,
  })).toString('base64url')
  const signature = createHmac('sha256', readSecret()).update(body).digest('base64url')
  const name = `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`
  return { name, value: `v1.${body}.${signature}` }
}

const cookie = mintCookie()

/** Create a blank session through the compiled Session RPC. */
async function createSession() {
  const response = await fetch(`${base}/api/session/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `${cookie.name}=${cookie.value}` },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: 'session/create',
      // Derived from this script's location, not written down: a literal user
      // directory in a public repository names the machine's account.
      payload: { args: { request: { cwd: process.env.DSH_CWD ?? resolve(here, '..', '..', '..') } } },
    }),
  })
  const body = await response.json()
  if (body.result?.ok !== true) throw new Error(`session/create failed: ${JSON.stringify(body)}`)
  return body.result.value.sessionId
}

const sessionId = shouldCreate ? await createSession() : '(not created)'
console.log(`session: ${sessionId}`)

// ── headless Edge over CDP ─────────────────────────────────────────────────
rmSync(PROFILE, { recursive: true, force: true })
const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${String(PORT)}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore' })

async function targetUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      const page = list.find((entry) => entry.type === 'page')
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Edge did not expose a page target')
}

const socket = new WebSocket(await targetUrl())
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
/** Console output and page errors the browser reported. */
const diagnostics = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ')
    diagnostics.push(`console.${String(message.params.type)}: ${text.slice(0, 300)}`)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    diagnostics.push(`exception: ${String(details.exception?.description ?? details.text).slice(0, 400)}`)
  }
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  }
})

function send(method, params = {}) {
  nextId += 1
  const id = nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

/** Evaluate an expression in the page and return its JSON value. */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails !== undefined) {
    throw new Error(`page evaluation failed: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result.result.value
}

async function shoot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const file = join(shots, `${name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`    screenshot: ${file}`)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Click like a user: resolve the element's box, then dispatch real mouse
 * events. React handlers on ancestor rows only respond to genuine events.
 */
async function clickAt(finder) {
  const point = await evaluate(`(() => {
    const element = ${finder};
    if (element === null || element === undefined) return null;
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, label: (element.textContent ?? '').trim().slice(0, 40) };
  })()`)
  if (point === null) return null
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    })
  }
  return point
}

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Network.setCookie', {
    name: cookie.name,
    value: cookie.value,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
  })

  console.log('\n[1] load the GUI')
  const url = launchToken === undefined ? `${base}/` : `${base}/?token=${launchToken}`
  await send('Page.navigate', { url })
  await wait(11000)
  console.log(`    url: ${await evaluate('location.href')}`)
  console.log(`    title: ${await evaluate('document.title')}`)

  console.log('\n[2] clear the first-run dialogs')
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dismissed = await evaluate(`(() => {
      const modal = document.querySelector('[role="dialog"]');
      if (modal === null) return 'none';
      const label = (modal.querySelector('h2')?.textContent ?? '').trim();
      const button = [...modal.querySelectorAll('button')].find((b) =>
        ['Continue', 'Configure later', 'Close'].includes((b.textContent ?? '').trim()));
      if (button === undefined) return 'stuck:' + label;
      button.click();
      return 'dismissed:' + label;
    })()`)
    console.log(`    ${dismissed}`)
    if (dismissed === 'none') break
    await wait(2500)
  }

  console.log('\n[3] open an existing session from the sidebar')
  await clickAt(`document.querySelector('button[aria-label="Open sidebar"]')`)
  await wait(2000)
  const opened = await clickAt(`(() => {
    const wanted = ${JSON.stringify(sessionTitle)};
    const leaves = [...document.querySelectorAll('span, div, p, a')]
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() === wanted);
    return leaves.length === 0 ? null : leaves[0];
  })()`)
  console.log(`    clicked: ${opened === null ? 'session-not-found' : JSON.stringify(opened.label)}`)
  await wait(8000)
  await shoot('03-session')

  const controls = await evaluate(`[...document.querySelectorAll('button')].map((b) => ({
    text: (b.textContent ?? '').trim().slice(0, 40),
    aria: b.getAttribute('aria-label'),
    title: b.getAttribute('title'),
  }))`)
  console.log(`    buttons after opening: ${JSON.stringify(controls.map((b) => b.text || b.aria))}`)
  const hasControl = controls.some((button) => button.text === 'Промпт' || button.aria === 'Системный промпт')
  console.log(`    mod control present: ${String(hasControl)}`)

  console.log('\n[4] click the mod control')
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').trim() === 'Промпт' || b.getAttribute('aria-label') === 'Системный промпт');
    if (button === undefined) return 'control-not-found';
    button.click();
    return 'clicked';
  })()`)
  console.log(`    ${clicked}`)
  await wait(4000)
  await shoot('03-dialog')

  const dialog = await evaluate(`(() => {
    const modal = document.querySelector('[role="dialog"]');
    if (modal === null) return { open: false };
    return {
      widthPx: Math.round(modal.getBoundingClientRect().width),
      open: true,
      title: (modal.querySelector('h2')?.textContent ?? '').trim(),
      hasTextarea: modal.querySelector('textarea') !== null,
      textareaLength: modal.querySelector('textarea')?.value?.length ?? 0,
      buttons: [...modal.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter((t) => t !== ''),
      text: (modal.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 700),
    };
  })()`)
  console.log(`    dialog: ${JSON.stringify(dialog, null, 2).split('\n').join('\n    ')}`)

  console.log('\n[5] "Взять текущий" fills the editor from the live prompt')
  const loaded = await evaluate(`(() => {
    const modal = document.querySelector('[role="dialog"]');
    if (modal === null) return { ok: false, reason: 'dialog closed' };
    const button = [...modal.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Взять текущий');
    if (button === undefined) return { ok: false, reason: 'button missing' };
    button.click();
    return { ok: true, disabled: button.disabled };
  })()`)
  await wait(2500)
  await shoot('04-loaded')
  const editor = await evaluate(`(() => {
    const modal = document.querySelector('[role="dialog"]');
    const area = modal?.querySelector('textarea');
    return { length: area?.value?.length ?? 0, head: (area?.value ?? '').slice(0, 120).replace(/\\s+/g, ' ') };
  })()`)
  console.log(`    click: ${JSON.stringify(loaded)}`)
  console.log(`    editor now holds ${String(editor.length)} characters: ${editor.head}`)

  console.log('\n[6] module diagnostics')
  const moduleState = await evaluate(`(() => {
    const boot = JSON.stringify(globalThis.__DSH_BOOT__ ?? null);
    const styles = [...document.querySelectorAll('style[data-plugin]')]
      .map((s) => s.getAttribute('data-plugin'));
    const loader = globalThis.__ModuleLoader__;
    return {
      bootMentionsMod: boot.includes('dsh-system-prompt-mod'),
      bootRows: (globalThis.__DSH_BOOT__?.plugins ?? globalThis.__DSH_BOOT__?.entries ?? []).length,
      pluginStyles: styles.filter((s) => (s ?? '').includes('system-prompt-mod')),
      loaderKeys: loader === undefined ? null : Object.keys(loader),
      headerPresent: document.querySelector('[class*="header" i]') !== null,
    };
  })()`)
  console.log(`    ${JSON.stringify(moduleState)}`)
  console.log(`    page diagnostics (${String(diagnostics.length)}):`)
  for (const line of diagnostics.slice(-25)) console.log(`      ${line}`)

  console.log('\nRESULT')
  console.log(`  control rendered: ${String(hasControl)}`)
  console.log(`  dialog opened:    ${String(dialog.open)}`)
  console.log(`  editor present:   ${String(dialog.hasTextarea)}`)
} finally {
  socket.close()
  edge.kill()
}
