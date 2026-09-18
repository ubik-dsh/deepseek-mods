/**
 * `@local/dsh-mod-manager` — host half.
 *
 * Answers what is actually installed in this Harness home and lets the browser
 * half change it, over `/api/mod-manager.mod`:
 *
 * - every loader row in every patch layer, and whether the package it names is
 *   on disk;
 * - packages under `profiles/node_modules/@local/` that no row references;
 * - turning a mod off and on again by removing and restoring its row — both were
 *   measured to take effect in a running server without a restart;
 * - uninstalling a mod, with a snapshot of the package taken first.
 *
 * Scope is deliberately narrow: only `@local/*` packages are managed, only paths
 * under the Harness home are written, and the manager refuses to act on itself,
 * because removing its own row would take away the panel doing the removing.
 * Shipped `@deepseek-ai/*` plugins are never touched.
 *
 * Errors are returned as stable codes, not sentences, so the browser half can
 * phrase them in the reader's language.
 *
 * @module @local/dsh-mod-manager
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

/** Cordis plugin name. */
export const name = 'mod-manager'

/** Required services: the authenticated Web transport. */
export const inject = ['connection']

/** Exact route below `/api` owned by this plugin. */
export const MOD_ROUTE_PATH = '/api/mod-manager.mod'

/** Package prefix this plugin is willing to touch. */
export const MANAGED_PREFIX = '@local/'

/** This plugin's own package name; never disabled or removed through itself. */
export const SELF_PACKAGE = '@local/dsh-mod-manager'

/** Directory, under the Harness home, where snapshots are written. */
const BACKUP_ROOT = 'mod-backups'

/** The shipped patch template, reproduced so a row can be restored verbatim. */
const PATCH_HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
`

/** Resolve this Harness home. */
export function harnessHome() {
  const value = process.env.DSH_HOME
  return value !== undefined && value.trim() !== '' ? value : join(homedir(), '.dsh')
}

/** State file recording which rows this plugin removed. */
export function statePath() {
  return join(harnessHome(), 'mod-manager.json')
}

/**
 * Guard every path this plugin writes.
 * @param candidate - an absolute path.
 * @returns the path, when it is inside the Harness home.
 * @throws when it is not.
 */
function insideHome(candidate) {
  const home = resolve(harnessHome())
  const target = resolve(candidate)
  if (target !== home && !target.startsWith(home + sep)) {
    throw new Error(`refusing to write outside the Harness home: ${target}`)
  }
  return target
}

/** Read the disabled-row ledger; anything unreadable counts as empty. */
export function readLedger() {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    const list = Array.isArray(raw?.disabled) ? raw.disabled : []
    return {
      disabled: list
        .filter((entry) => entry !== null && typeof entry === 'object')
        .map((entry) => ({
          layer: String(entry.layer ?? ''),
          id: String(entry.id ?? ''),
          name: String(entry.name ?? ''),
        })),
    }
  } catch {
    return { disabled: [] }
  }
}

/** Persist the disabled-row ledger. */
export function writeLedger(ledger) {
  const path = insideHome(statePath())
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
}

/**
 * Every patch layer in this home: the home-wide file, then one per profile.
 * @returns layer descriptors, existing or not.
 */
export function layers() {
  const home = harnessHome()
  const found = [{ key: 'home', label: 'home (all profiles)', path: join(home, 'cordis.patch.yml') }]
  let profiles = []
  try {
    profiles = readdirSync(join(home, 'profiles'), { withFileTypes: true })
      // `profiles/node_modules` is where packages live, not a profile: counting
      // it would offer the reader a layer that can never hold rows.
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => entry.name)
      .sort()
  } catch {
    profiles = []
  }
  for (const profile of profiles) {
    found.push({
      key: `profile:${profile}`,
      label: `profile ${profile}`,
      path: join(home, 'profiles', profile, 'cordis.patch.yml'),
    })
  }
  return found
}

/**
 * Parse loader rows out of a patch document.
 *
 * Deliberately tolerant: it pairs an `id:` line with the `name:` line that
 * follows it, so a hand-edited patch with different indentation still reads.
 * Only `insert` rows carry both keys, which is exactly what is wanted here.
 *
 * @param text - the patch document.
 * @returns rows in document order.
 */
export function parseRows(text) {
  const rows = []
  let id = null
  for (const line of text.split(/\r?\n/u)) {
    const bare = line.trim()
    if (bare === '' || bare.startsWith('#')) continue
    const idMatch = /^(?:-\s*)?id:\s*(.+?)\s*$/u.exec(bare)
    if (idMatch !== null && !bare.startsWith('name:')) {
      id = idMatch[1].replace(/^['"]|['"]$/gu, '')
      continue
    }
    const nameMatch = /^name:\s*(.+?)\s*$/u.exec(bare)
    if (nameMatch !== null && id !== null) {
      rows.push({ id, name: nameMatch[1].replace(/^['"]|['"]$/gu, '') })
      id = null
    }
  }
  return rows
}

/** Whether a patch document still carries a row for this id. */
export function hasRow(text, id) {
  return new RegExp(`(^|\\s)id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*$`, 'mu').test(text)
}

/**
 * Remove the row for one id, leaving the rest of the document intact.
 *
 * When the last row goes, the shipped template is restored rather than leaving a
 * comments-only document: that parses as YAML null, not as an empty list, and the
 * installer takes the same care for the same reason.
 *
 * @param text - the patch document.
 * @param id - the row id to drop.
 * @returns the document without that row.
 */
export function removeRow(text, id) {
  const lines = text.split(/\r?\n/u)
  const kept = []
  for (let index = 0; index < lines.length; index += 1) {
    const bare = lines[index].trim()
    const idMatch = /^(?:-\s*)?id:\s*(.+?)\s*$/u.exec(bare)
    const matches = idMatch !== null && idMatch[1].replace(/^['"]|['"]$/gu, '') === id
    if (!matches) {
      kept.push(lines[index])
      continue
    }
    // Drop the id line, the name line that belongs to it, and an `insert:` line
    // directly above that would otherwise be left holding nothing.
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
    if (kept.length > 0 && /^-\s*insert:\s*$/u.test(kept[kept.length - 1].trim())) kept.pop()
    if (index + 1 < lines.length && /^name:\s*/u.test(lines[index + 1].trim())) index += 1
    // Blank line that separated this row from the next one.
    if (index + 1 < lines.length && lines[index + 1].trim() === '') index += 1
  }
  const rest = `${kept.join('\n').replace(/\s*$/u, '')}\n`
  const meaningful = rest
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('\n')
    .trim()
  return meaningful === '' ? `${PATCH_HEADER}\n[]\n` : rest
}

/**
 * Add one row to a patch document, reusing the installer's rule for the empty
 * `[]` template, which cannot simply be appended to: that would leave two YAML
 * root nodes in one document.
 *
 * @param text - the patch document.
 * @param id - row id.
 * @param packageName - package the row mounts.
 * @returns the document with the row present.
 */
export function addRow(text, id, packageName) {
  const entry = `- insert:\n    - id: ${id}\n      name: '${packageName}'`
  const meaningful = text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('\n')
    .trim()
  return meaningful === '[]' || meaningful === ''
    ? `${PATCH_HEADER}\n${entry}\n`
    : `${text.replace(/\s*$/u, '')}\n\n${entry}\n`
}

/** Summarise a directory: bytes and file count, without following links. */
export function measure(dir) {
  let bytes = 0
  let files = 0
  const walk = (current, depth) => {
    if (depth > 12 || files > 20000) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      try {
        if (entry.isDirectory()) {
          walk(full, depth + 1)
        } else if (entry.isFile()) {
          bytes += statSync(full).size
          files += 1
        }
      } catch {}
    }
  }
  try {
    walk(dir, 0)
  } catch {}
  return { bytes, files }
}

/**
 * Every package installed under `profiles/node_modules/@local/`, keyed by the
 * name in its own `package.json` rather than by directory, because the two
 * differ: the directory for `@local/dsh-locale-ru` is `locale-ru`.
 *
 * @returns installed package descriptors.
 */
export function installedPackages() {
  const root = join(harnessHome(), 'profiles', 'node_modules', '@local')
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
  return entries.map((directory) => {
    const full = join(root, directory)
    let manifest = {}
    try {
      manifest = JSON.parse(readFileSync(join(full, 'package.json'), 'utf8'))
    } catch {}
    let modifiedAt = null
    try {
      modifiedAt = statSync(full).mtime.toISOString()
    } catch {}
    const { bytes, files } = measure(full)
    return {
      directory,
      name: typeof manifest.name === 'string' ? manifest.name : `@local/${directory}`,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      description: typeof manifest.description === 'string' ? manifest.description : null,
      bytes,
      files,
      modifiedAt,
    }
  })
}

/** Snapshot of everything the panel shows. */
export function snapshot() {
  const ledger = readLedger()
  const installed = installedPackages()
  const byName = new Map(installed.map((entry) => [entry.name, entry]))
  const referenced = new Set()

  const layerViews = layers().map((layer) => {
    let text = null
    try {
      text = readFileSync(layer.path, 'utf8')
    } catch {}
    const rows = text === null ? [] : parseRows(text)
    for (const row of rows) referenced.add(row.name)
    const inFile = new Set(rows.map((row) => row.id))
    // A row this panel turned off is gone from the file by design, so it is
    // reconstructed from the ledger. Without it the panel would offer no way
    // back on for the very state the panel creates.
    const off = ledger.disabled
      .filter((entry) => entry.layer === layer.key && !inFile.has(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name, disabled: true }))
    for (const entry of off) referenced.add(entry.name)
    return {
      key: layer.key,
      label: layer.label,
      path: layer.path,
      exists: text !== null,
      rows: [...rows.map((row) => ({ ...row, disabled: false })), ...off].map((row) => ({
        id: row.id,
        name: row.name,
        disabled: row.disabled,
        managed: row.name.startsWith(MANAGED_PREFIX),
        self: row.name === SELF_PACKAGE,
        package: byName.get(row.name) ?? null,
      })),
    }
  })

  const orphans = installed
    .filter((entry) => !referenced.has(entry.name))
    .map((entry) => ({ ...entry, self: entry.name === SELF_PACKAGE }))

  return {
    ok: true,
    home: harnessHome(),
    selfPackage: SELF_PACKAGE,
    managedPrefix: MANAGED_PREFIX,
    backupRoot: join(harnessHome(), BACKUP_ROOT),
    layers: layerViews,
    orphans,
    disabled: ledger.disabled,
  }
}

/** Timestamped snapshot directory, matching the installer's naming. */
function backupDir() {
  return insideHome(join(
    harnessHome(),
    BACKUP_ROOT,
    new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19),
  ))
}

/** Copy one file into a snapshot, if it exists. */
function snapshotFile(file, destination, suffix) {
  if (!existsSync(file)) return false
  mkdirSync(destination, { recursive: true })
  cpSync(file, join(destination, suffix))
  return true
}

/** JSON response helper. */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Reject with a stable code the browser half can translate. */
const fail = (code, status = 400, detail) =>
  json(detail === undefined ? { ok: false, code } : { ok: false, code, detail }, status)

/**
 * Resolve what an action is aimed at.
 *
 * A row that was turned off is gone from the patch file by design, so its
 * identity has to survive in the ledger — otherwise "turn it back on" and
 * "remove it" would both fail on the very state this panel creates.
 *
 * @param layerKey - the patch layer the action names.
 * @param id - the row id.
 * @param ledger - the disabled-row ledger.
 * @returns the layer, its text, the resolved package name, and whether the row
 *   is currently in the file.
 */
function resolveTarget(layerKey, id, ledger) {
  const layer = layers().find((candidate) => candidate.key === layerKey)
  if (layer === undefined) return { error: 'unknown-layer' }
  let text = ''
  try {
    text = readFileSync(layer.path, 'utf8')
  } catch {
    text = ''
  }
  const row = parseRows(text).find((candidate) => candidate.id === id)
  const remembered = ledger.disabled.find((entry) => entry.layer === layerKey && entry.id === id)
  if (row === undefined && remembered === undefined) return { error: 'row-not-found' }
  return { layer, text, id, name: row?.name ?? remembered.name, inFile: row !== undefined }
}

/**
 * Apply one action.
 * @param payload - `{action, layer, id}` from the browser half.
 * @returns a response describing the outcome.
 */
function act(payload) {
  const action = typeof payload.action === 'string' ? payload.action : ''
  const layerKey = typeof payload.layer === 'string' ? payload.layer : ''
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (action === '' || layerKey === '' || id === '') return fail('bad-request')

  const ledger = readLedger()
  const target = resolveTarget(layerKey, id, ledger)
  if (target.error !== undefined) return fail(target.error)
  const { layer, text, name, inFile } = target

  // Only this project's own namespace is managed, and the manager never takes
  // away its own row: that would unmount the panel doing the removing.
  if (!name.startsWith(MANAGED_PREFIX)) return fail('forbidden-package')
  if (action !== 'enable' && name === SELF_PACKAGE) return fail('self-managed')

  const forget = () => {
    ledger.disabled = ledger.disabled.filter(
      (entry) => !(entry.layer === layer.key && entry.id === id),
    )
  }
  const write = (next) => {
    try {
      writeFileSync(insideHome(layer.path), next, 'utf8')
      return null
    } catch (error) {
      return fail('write-failed', 500, String(error?.message ?? error))
    }
  }

  if (action === 'disable') {
    if (!inFile) return fail('row-not-found')
    const snapshotDir = backupDir()
    snapshotFile(layer.path, snapshotDir, `${layer.key.replace(/[:\\/]/gu, '_')}.cordis.patch.yml`)
    const problem = write(removeRow(text, id))
    if (problem !== null) return problem
    if (!ledger.disabled.some((entry) => entry.layer === layer.key && entry.id === id)) {
      ledger.disabled.push({ layer: layer.key, id, name })
    }
    writeLedger(ledger)
    return json({ ok: true, note: 'disabled', snapshot: true, state: snapshot() })
  }

  if (action === 'enable') {
    if (!installedPackages().some((entry) => entry.name === name)) return fail('package-not-installed')
    if (inFile) return json({ ok: true, note: 'enabled', state: snapshot() })
    const problem = write(addRow(text, id, name))
    if (problem !== null) return problem
    forget()
    writeLedger(ledger)
    return json({ ok: true, note: 'enabled', state: snapshot() })
  }

  if (action === 'uninstall') {
    const installed = installedPackages().find((entry) => entry.name === name)
    if (installed === undefined) return fail('package-not-installed')
    const snapshotDir = backupDir()
    try {
      mkdirSync(join(snapshotDir, 'packages'), { recursive: true })
      cpSync(
        insideHome(join(harnessHome(), 'profiles', 'node_modules', '@local', installed.directory)),
        join(snapshotDir, 'packages', installed.directory),
        { recursive: true },
      )
      // Rows naming this package can sit in any layer, including ones the user
      // is not looking at, so every layer is swept.
      for (const candidate of layers()) {
        let current
        try {
          current = readFileSync(candidate.path, 'utf8')
        } catch {
          continue
        }
        const rows = parseRows(current).filter((entry) => entry.name === name)
        if (rows.length === 0) continue
        let next = current
        for (const entry of rows) next = removeRow(next, entry.id)
        snapshotFile(candidate.path, snapshotDir, `${candidate.key.replace(/[:\\/]/gu, '_')}.cordis.patch.yml`)
        writeFileSync(insideHome(candidate.path), next, 'utf8')
      }
      rmSync(
        insideHome(join(harnessHome(), 'profiles', 'node_modules', '@local', installed.directory)),
        { recursive: true, force: true },
      )
    } catch (error) {
      return fail('write-failed', 500, String(error?.message ?? error))
    }
    ledger.disabled = ledger.disabled.filter((entry) => entry.name !== name)
    writeLedger(ledger)
    return json({ ok: true, note: 'uninstalled', snapshot: true, state: snapshot() })
  }

  return fail('bad-request')
}

/**
 * Mount the management route.
 * @param ctx - host context carrying `connection`.
 */
export function apply(ctx) {
  const disposeRoute = ctx.connection.fetch.register({
    path: MOD_ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') {
        try {
          return json(snapshot())
        } catch (error) {
          return fail('read-failed', 500, String(error?.message ?? error))
        }
      }
      if (request.method !== 'POST') return fail('method-not-allowed', 405)
      let payload
      try {
        payload = await request.json()
      } catch {
        return fail('bad-request')
      }
      try {
        return act(payload)
      } catch (error) {
        return fail('write-failed', 500, String(error?.message ?? error))
      }
    },
  })
  ctx.effect(() => () => {
    void disposeRoute()
  }, 'mod-manager: route lifecycle')
}

export default { name, inject, apply }
