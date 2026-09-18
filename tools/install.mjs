#!/usr/bin/env node
/**
 * Install the DSH mods from this repository into a DeepSeek Harness home.
 *
 * Every directory under `packages/` that has a `package.json` is installed into
 * `<home>/profiles/node_modules/@local/`, and one loader row per package is
 * added to the profile's `cordis.patch.yml`. Existing patch content is kept.
 * The script is idempotent: running it again changes nothing.
 *
 * Usage (from anywhere):
 *   node tools/install.mjs                     # install into $DSH_HOME or ~/.dsh
 *   node tools/install.mjs --lang ru           # Russian output
 *   node tools/install.mjs --profile tui       # another profile (default: web)
 *   node tools/install.mjs --home-level        # rows also go to <home>/cordis.patch.yml
 *   node tools/install.mjs --backup-only       # snapshot the mod state only
 *   node tools/install.mjs --dry-run           # report, change nothing
 *   node tools/install.mjs --uninstall         # remove the packages and their rows
 *
 * @module tools/install
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const PACKAGES_DIR = join(REPO, 'packages')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const value = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}

const LANG = value('--lang', 'en') === 'ru' ? 'ru' : 'en'
const PROFILE = value('--profile', 'web')
const HOME_LEVEL = has('--home-level')
const BACKUP_ONLY = has('--backup-only')
const DRY_RUN = has('--dry-run')
const UNINSTALL = has('--uninstall')

const MESSAGES = {
  en: {
    home: 'DSH home',
    discovered: (count) => `discovered ${count} package(s) in packages/`,
    installed: (name, path) => `installed ${name} -> ${path}`,
    unchanged: (name) => `${name} is already up to date`,
    skipped: (name) => `SKIPPED ${name}: no package.json`,
    backupState: (path) => `backed up ${path}`,
    backupPackages: (path) => `backed up the packages -> ${path}`,
    backupEmpty: 'nothing to back up yet (the mods own no state on this machine)',
    backupNothingChanged: 'nothing to back up: the installed packages already match this checkout',
    rowsPresent: (label) => `${label}: every row is already present`,
    rowsAdded: (label, ids) => `${label}: added rows ${ids}`,
    dryRun: 'dry run: nothing was written',
    done: 'Done. Reload the Web GUI (F5) so the browser roster picks up the bundles.',
    backupDir: (path) => `Backups: ${path}`,
    removed: (name) => `removed ${name}`,
    rowsRemoved: (label, ids) => `${label}: removed rows ${ids}`,
    rowsKept: (label, ids) => `${label}: rows ${ids} have a different shape — remove them by hand`,
    uninstalled: 'Uninstalled. Reload the Web GUI (F5) to drop the bundles.',
  },
  ru: {
    home: 'Домашний каталог DSH',
    discovered: (count) => `найдено пакетов в packages/: ${count}`,
    installed: (name, path) => `установлен ${name} -> ${path}`,
    unchanged: (name) => `${name} уже актуален`,
    skipped: (name) => `ПРОПУЩЕН ${name}: нет package.json`,
    backupState: (path) => `сохранён в бэкап: ${path}`,
    backupPackages: (path) => `пакеты скопированы в бэкап -> ${path}`,
    backupEmpty: 'состояния модов пока нет — бэкапить нечего',
    backupNothingChanged: 'бэкапить нечего: установленные пакеты уже совпадают с этим репозиторием',
    rowsPresent: (label) => `${label}: все строки уже на месте`,
    rowsAdded: (label, ids) => `${label}: добавлены строки ${ids}`,
    dryRun: 'пробный запуск: ничего не записано',
    done: 'Готово. Обнови страницу Web-GUI (F5), чтобы браузерный ростер подхватил бандлы.',
    backupDir: (path) => `Бэкапы: ${path}`,
    removed: (name) => `удалён ${name}`,
    rowsRemoved: (label, ids) => `${label}: удалены строки ${ids}`,
    rowsKept: (label, ids) => `${label}: строки ${ids} записаны иначе — удали их вручную`,
    uninstalled: 'Удалено. Обнови страницу Web-GUI (F5), чтобы бандлы ушли из ростера.',
  },
}
const t = MESSAGES[LANG]
const say = (line) => console.log(line)

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')

const PATCH_HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
`
const PATCH_TEMPLATE = `${PATCH_HEADER}\n[]\n`

/** State files the mods own, plus the GUI settings the run depends on. */
const STATE_FILES = [
  join(home, 'system-prompt-mod.json'),
  join(home, 'settings.yaml'),
]

/** Every installable package in this repository. */
function discoverPackages() {
  if (!existsSync(PACKAGES_DIR)) throw new Error(`${PACKAGES_DIR} does not exist`)
  return readdirSync(PACKAGES_DIR)
    .filter((name) => existsSync(join(PACKAGES_DIR, name, 'package.json')))
    .map((directory) => {
      const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, directory, 'package.json'), 'utf8'))
      return { directory, id: directory, package: manifest.name, client: manifest.dsh?.client !== undefined }
    })
}

const packages = discoverPackages()

/**
 * Content digest of every file under `dir`, so that two trees can be compared
 * without trusting timestamps or sizes alone.
 * @param dir - directory to digest.
 * @returns one hex digest covering every relative path and file content.
 */
function treeDigest(dir) {
  const entries = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const full = join(current, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(full, relative)
      else if (entry.isFile()) {
        entries.push(`${relative}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`)
      }
    }
  }
  walk(dir, '')
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

/** Whether an installed package already matches the one in the repository. */
function sameTree(left, right) {
  try {
    return treeDigest(left) === treeDigest(right)
  } catch {
    return false
  }
}

say(`${t.home}: ${home}`)
say(t.discovered(packages.length))
for (const entry of packages) say(`  - ${entry.package} (row id: ${entry.id})`)

// ── 0. uninstall: remove the packages and the rows this script writes ──────
if (UNINSTALL) {
  const ROW = (mod) => `- insert:\n    - id: ${mod.id}\n      name: '${mod.package}'`
  const strip = (patchPath, label) => {
    if (!existsSync(patchPath)) return
    let text = readFileSync(patchPath, 'utf8')
    const removed = []
    const kept = []
    for (const entry of packages) {
      const row = ROW(entry)
      if (text.includes(row)) {
        text = text.replace(`${row}\n\n`, '').replace(row, '')
        removed.push(entry.id)
      } else if (new RegExp(`(^|\\s)id:\\s*${entry.id}\\s*$`, 'mu').test(text)) {
        kept.push(entry.id)
      }
    }
    text = `${text.replace(/\s*$/u, '')}\n`
    // A comments-only document parses as YAML null, not as an empty list, so
    // the shipped `[]` document is restored when nothing is left.
    const meaningful = text
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
      .join('\n')
      .trim()
    if (meaningful === '') text = PATCH_TEMPLATE
    if (!DRY_RUN) writeFileSync(patchPath, text, 'utf8')
    if (removed.length > 0) say(t.rowsRemoved(label, removed.join(', ')))
    if (kept.length > 0) say(t.rowsKept(label, kept.join(', ')))
  }
  for (const entry of packages) {
    const destination = join(home, 'profiles', 'node_modules', '@local', entry.directory)
    if (!existsSync(destination)) continue
    if (!DRY_RUN) rmSync(destination, { recursive: true, force: true })
    say(t.removed(entry.package))
  }
  strip(join(home, 'profiles', PROFILE, 'cordis.patch.yml'), `profile ${PROFILE}`)
  strip(join(home, 'cordis.patch.yml'), 'home layer (all profiles)')
  const localDir = join(home, 'profiles', 'node_modules', '@local')
  try {
    if (!DRY_RUN && readdirSync(localDir).length === 0) rmSync(localDir, { recursive: true, force: true })
  } catch {}
  say('')
  say(t.uninstalled)
  process.exit(0)
}

// ── 1. work out what actually changes, and back up what that would destroy ─
//
// Re-running must be a true no-op: a package whose installed copy is
// byte-identical to the one in the repository is left alone, and nothing is
// snapshotted. Only a package that is absent or *different* is installed, and
// only a different one has a previous state worth preserving.
const target = join(home, 'profiles', 'node_modules', '@local')
const installed = packages.filter((entry) => existsSync(join(target, entry.directory)))
const unchanged = installed.filter((entry) => sameTree(join(target, entry.directory), join(PACKAGES_DIR, entry.directory)))
const stale = installed.filter((entry) => !unchanged.includes(entry))
const toInstall = packages.filter((entry) => !unchanged.includes(entry))

const backupDir = join(home, 'mod-backups', new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19))
const backedUp = !DRY_RUN && stale.length > 0
if (backedUp) {
  mkdirSync(backupDir, { recursive: true })
  for (const file of STATE_FILES) {
    if (!existsSync(file)) continue
    cpSync(file, join(backupDir, file.split(/[\\/]/u).pop()))
    say(t.backupState(file))
  }
  for (const entry of stale) {
    // The installed copy is what the next step overwrites.
    cpSync(join(target, entry.directory), join(backupDir, 'packages', entry.directory), { recursive: true })
  }
  say(t.backupPackages(join(backupDir, 'packages')))
} else if (!DRY_RUN) {
  say(stale.length === 0 && unchanged.length > 0 ? t.backupNothingChanged : t.backupEmpty)
}

if (BACKUP_ONLY) {
  say(t.backupDir(backupDir))
  process.exit(0)
}

// ── 2. install the packages into the profile's node_modules ────────────────
if (!DRY_RUN) mkdirSync(target, { recursive: true })
for (const entry of packages) {
  const source = join(PACKAGES_DIR, entry.directory)
  if (!existsSync(join(source, 'package.json'))) {
    say(t.skipped(entry.package))
    continue
  }
  const destination = join(target, entry.directory)
  if (!toInstall.includes(entry)) {
    say(t.unchanged(entry.package))
    continue
  }
  if (DRY_RUN) {
    say(t.installed(entry.package, destination))
    continue
  }
  // Replace rather than merge, so a stale file from an older build cannot stay.
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, { recursive: true })
  say(t.installed(entry.package, destination))
}

// ── 3. make sure every loader row exists ───────────────────────────────────
/** Add the missing rows of `packages` to one patch file, leaving it intact. */
function ensureRows(patchPath, label) {
  let text = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : PATCH_TEMPLATE
  const missing = packages.filter((entry) => !new RegExp(`(^|\\s)id:\\s*${entry.id}\\s*$`, 'mu').test(text))
  if (missing.length === 0) {
    say(t.rowsPresent(label))
    return
  }
  const entry = missing
    .map((mod) => `- insert:\n    - id: ${mod.id}\n      name: '${mod.package}'`)
    .join('\n\n')
  // The shipped template is comments plus a bare `[]`; appending after it would
  // produce two YAML root nodes, so the empty document is replaced outright.
  const meaningful = text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('\n')
    .trim()
  text = meaningful === '[]' || meaningful === ''
    ? `${PATCH_HEADER}\n${entry}\n`
    : `${text.replace(/\s*$/u, '')}\n\n${entry}\n`
  if (!DRY_RUN) {
    mkdirSync(dirname(patchPath), { recursive: true })
    writeFileSync(patchPath, text, 'utf8')
  }
  say(t.rowsAdded(label, missing.map((mod) => mod.id).join(', ')))
}

ensureRows(join(home, 'profiles', PROFILE, 'cordis.patch.yml'), `profile ${PROFILE}`)
if (HOME_LEVEL) ensureRows(join(home, 'cordis.patch.yml'), 'home layer (all profiles)')

say('')
if (DRY_RUN) say(t.dryRun)
say(t.done)
if (backedUp) say(t.backupDir(backupDir))
