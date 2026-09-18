/**
 * Verify the Russian language pack in a real browser: open Settings, find the
 * language selector, switch to «Русский», and report the UI copy that follows.
 *
 * Usage: node _dsh_mod/ui-locale.mjs [base]
 */

import { createHash, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv[2] ?? 'http://127.0.0.1:3080'
const authority = new URL(base).host
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
// Screenshots land outside the checkout by default, so running a check never
// dirties the repository. Override with DSH_SHOTS to keep them where you like.
const shots = process.env.DSH_SHOTS ?? join(tmpdir(), 'dsh-mod-shots')
mkdirSync(shots, { recursive: true })

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9223
const PROFILE = join(here, '_edge-profile-locale')

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
const diagnostics = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ')
    diagnostics.push(`console.${String(message.params.type)}: ${text.slice(0, 300)}`)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    diagnostics.push(`exception: ${String(details.exception?.description ?? details.text).slice(0, 300)}`)
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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails !== undefined) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

async function shoot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`    screenshot: ${join(shots, `${name}.png`)}`)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Network.setCookie', { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true })

  console.log('[1] load the GUI')
  await send('Page.navigate', { url: `${base}/` })
  await wait(11000)
  const boot = await evaluate(`JSON.stringify(globalThis.__DSH_BOOT__ ?? null).includes('dsh-locale-ru')`)
  console.log(`    boot graph rosters the language pack: ${String(boot)}`)

  console.log('\n[2] open Settings and find the language selector')
  const opened = await clickAt(`[...document.querySelectorAll('button')].find((b) =>
    ['Settings', 'Настройки'].includes((b.getAttribute('aria-label') ?? '').trim())
    || ['Settings', 'Настройки'].includes((b.textContent ?? '').trim()))`)
  console.log(`    settings button: ${JSON.stringify(opened?.label ?? null)}`)
  await wait(4000)
  const inventory = await evaluate(`(() => {
    const selects = [...document.querySelectorAll('select')].map((s) => ({
      value: s.value,
      options: [...s.options].map((o) => ({ value: o.value, label: o.textContent.trim() })),
    }));
    const text = document.body.innerText.replace(/\\s+/g, ' ');
    const rows = [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && /^(Language|Язык)$/.test((el.textContent ?? '').trim()))
      .map((el) => el.tagName + ':' + (el.textContent ?? '').trim());
    return {
      selects,
      languageRow: rows,
      hasRussian: text.includes('Русский'),
      hasEnglish: /English|Английский/.test(text),
      hasChinese: text.includes('中文'),
      sample: text.slice(0, 300),
    };
  })()`)
  console.log(`    selects: ${JSON.stringify(inventory.selects)}`)
  console.log(`    "Русский" offered: ${String(inventory.hasRussian)}; English: ${String(inventory.hasEnglish)}; 中文: ${String(inventory.hasChinese)}`)
  console.log(`    language row labels: ${JSON.stringify(inventory.languageRow)}`)
  console.log(`    settings text: ${inventory.sample}`)
  await shoot('10-settings')

  console.log('\n[3] switch the language through the selector and back')
  const openSelector = () => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      /^(Русский|English|中文)/.test((b.textContent ?? '').trim()));
    if (button === undefined) return 'selector-not-found';
    button.click();
    return 'opened:' + (button.textContent ?? '').trim();
  })()`)
  const pickOption = (label) => evaluate(`(() => {
    const wanted = ${JSON.stringify(label)};
    const candidates = [...document.querySelectorAll('[role="menuitem"], [role="option"], button, li, div, span')]
      .filter((el) => (el.textContent ?? '').trim() === wanted);
    if (candidates.length === 0) {
      const menu = document.querySelector('[role="menu"], [role="listbox"]');
      return 'option-not-found:' + wanted + ' menu=' + (menu === null ? 'none' : menu.innerText.replace(/\\s+/g, '|'));
    }
    const target = candidates[candidates.length - 1];
    target.click();
    return 'picked:' + wanted + ' via ' + target.tagName;
  })()`)

  console.log(`    ${await openSelector()}`)
  await wait(1500)
  const options = await evaluate(`[...document.querySelectorAll('[role="option"], [role="menuitem"], li, button, div')]
    .filter((el) => el.children.length === 0 && ['Русский','English','中文'].includes((el.textContent ?? '').trim()))
    .map((el) => (el.textContent ?? '').trim())`)
  console.log(`    options offered: ${JSON.stringify([...new Set(options)])}`)
  console.log(`    ${await pickOption('English')}`)
  await wait(3500)
  const english = await evaluate(`({ lang: document.documentElement.lang, text: document.body.innerText.replace(/\\s+/g,' ').slice(0, 150) })`)
  console.log(`    <html lang> = ${english.lang}`)
  console.log(`    text: ${english.text}`)
  await shoot('12-english')

  console.log(`    ${await openSelector()}`)
  await wait(1500)
  console.log(`    ${await pickOption('Русский')}`)
  await wait(3500)
  await shoot('13-russian')

  const after = await evaluate(`(() => {
    const text = document.body.innerText.replace(/\\s+/g, ' ');
    return {
      cyrillicChars: (text.match(/[А-Яа-яЁё]/g) ?? []).length,
      sample: text.slice(0, 260),
      htmlLang: document.documentElement.lang,
    };
  })()`)
  console.log(`    <html lang> = ${after.htmlLang}`)
  console.log(`    Cyrillic characters on the page: ${String(after.cyrillicChars)}`)
  console.log(`    visible text: ${after.sample}`)
  console.log(`\n    page diagnostics: ${String(diagnostics.length)}`)
  for (const line of diagnostics.slice(-8)) console.log(`      ${line}`)
} finally {
  socket.close()
  edge.kill()
}
