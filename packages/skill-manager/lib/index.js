/**
 * `@local/dsh-skill-manager` — host half.
 *
 * Serves one route that lists every skill this Harness resolves, lets each one be
 * given a model-facing description and a one-line human summary, and pauses or
 * resumes it. Modelled on `@local/dsh-mod-manager`, which does the same job for
 * loader rows.
 *
 * ## Where the project roots come from
 *
 * **Not from `process.cwd()`.** The first version did, and the panel came up empty
 * in a live session: the server's working directory is not the project the page is
 * open on, so the project roots resolved somewhere else and found nothing. The
 * workspaces the GUI itself uses are recorded in
 * `$DSH_HOME/storages/workspace.json`, and that is the source read here — the same
 * one the sidebar is built from. `process.cwd()` remains only as a last resort.
 *
 * ## How a skill is paused
 *
 * Not by a flag, and not by a state file: the discovery rule in
 * `@deepseek-ai/dsh-skill-filesystem` looks at **one level of the root** and accepts
 * exactly two shapes,
 *
 *     <root>/<name>/SKILL.md      a directory bundle
 *     <root>/<name>.md            a flat file
 *
 * so a skill is paused by **renaming the file that makes it discoverable**:
 * `SKILL.md` becomes `SKILL.md.paused`, and `name.md` becomes `name.md.paused`.
 * Nothing is deleted, nothing is edited, and the paused state *is* the filename.
 *
 * The provider watches its roots and invalidates the catalogue when a path shaped
 * like a skill changes, so the model stops being offered a paused skill on its next
 * look at the list. The unlink half of the rename is what triggers it.
 *
 * ## The registry
 *
 * A paused flag and a directory are not enough to run a shelf of skills. The registry
 * at `$DSH_HOME/skill-registry.json` holds, per skill: a stable `id`, the path, a
 * **model-facing description** — mirrored into the `SKILL.md` frontmatter, because
 * that is the text DSH actually matches on — and a **human summary**, which stays
 * here. A skill that has never been described is still listed: the registry is an
 * addition, not a gate.
 *
 * Writes are confined to the roots this module scans. A request naming a path
 * outside them is refused, because the route is reachable from the page.
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

export const name = 'skill-manager'

/** The host service the route needs. */
export const inject = ['connection']

/** Exact route below `/api` owned by this plugin. */
export const SKILL_ROUTE_PATH = '/api/skill-manager.mod'

/** Appended to the discoverable file's name to take a skill out of the catalogue. */
export const PAUSED_SUFFIX = '.paused'

/** Ranks mirror `@deepseek-ai/dsh-skill-filesystem`; lower wins. */
const RANKS = { projectDsh: 100, projectAgents: 200, custom: 300, userDsh: 400, userAgents: 500 }

/** The Harness home, honouring the same override the rest of DSH uses. */
export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Every workspace the GUI knows about.
 *
 * `workspace.json` is the store the sidebar reads, so a project open in the app is a
 * project this panel can see. A server launched from an unrelated directory would
 * otherwise show nothing at all, which is exactly what happened first.
 */
export function workspaces() {
  const file = join(dshHome(), 'storages', 'workspace.json')
  const found = []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    for (const entry of Object.values(parsed?.tables?.workspaces ?? {})) {
      if (typeof entry?.path === 'string' && entry.path !== '') {
        found.push({ path: resolve(entry.path), title: entry.title ?? entry.path })
      }
    }
  } catch { /* absent or unreadable: fall through to the cwd */ }
  if (found.length === 0) found.push({ path: resolve(process.cwd()), title: 'текущий каталог' })
  return found
}

/** Walk up from a directory to the project that owns it. */
export function projectRoot(from) {
  let current = resolve(from)
  for (;;) {
    for (const marker of ['.git', '.dsh', '.agents']) {
      if (existsSync(join(current, marker))) return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(from)
    current = parent
  }
}

/** Every root this Harness would resolve, in rank order. */
export function roots() {
  const home = homedir()
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(home, '.agents')
  const list = []
  const seen = new Set()
  for (const space of workspaces()) {
    const project = projectRoot(space.path)
    for (const entry of [
      [RANKS.projectDsh, '.dsh', 'project-dsh', `.dsh · ${space.title}`],
      [RANKS.projectAgents, '.agents', 'project-agents', `.agents · ${space.title}`],
    ]) {
      const [rank, folder, source, label] = entry
      const path = join(project, folder, 'skills')
      if (seen.has(path)) continue
      seen.add(path)
      list.push({ rank, source: `${source}:${path}`, label, path, project })
    }
  }
  // The separator is platform-specific on purpose. Splitting on `:` as well as `;`
  // is not harmless: on Windows every absolute path begins with a drive letter and a
  // colon, so `C:\skills` became two entries, `C` and `\skills`.
  const separator = process.platform === 'win32' ? ';' : ':'
  for (const extra of (process.env.DSH_SKILLS ?? '').split(separator).filter(Boolean)) {
    const path = resolve(extra)
    if (seen.has(path)) continue
    seen.add(path)
    list.push({ rank: RANKS.custom, source: `custom:${path}`, label: 'Свои каталоги', path })
  }
  list.push(
    { rank: RANKS.userDsh, source: 'user-dsh', label: 'DSH_HOME', path: join(dshHome(), 'skills') },
    { rank: RANKS.userAgents, source: 'user-agents', label: 'DSH_AGENTS_HOME', path: join(agentsHome, 'skills') },
  )
  return list
}

/** The frontmatter fields that decide whether a skill is registered at all. */
export function readFrontmatter(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text)
  if (match === null) return { name: '', description: '', hasFrontmatter: false }
  const lines = match[2].split(/\r?\n/)
  const fields = {}
  for (let index = 0; index < lines.length; index += 1) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[index])
    if (field === null) continue
    const key = field[1]
    let value = field[2].trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block = []
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
        block.push(lines[index + 1].trim())
        index += 1
      }
      value = block.join(' ')
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    fields[key] = value
  }
  return { name: fields.name ?? '', description: fields.description ?? '', hasFrontmatter: true }
}

/**
 * Rewrite only the `description:` line of the frontmatter.
 *
 * A skill's model-facing text **is** this line — it is what DSH matches a request
 * against — so a description edited anywhere else would be a description the model
 * never reads. Everything outside that one line is preserved byte for byte: the rest
 * of the frontmatter, the closing fence, the body.
 */
export function writeDescription(file, description) {
  const text = readFileSync(file, 'utf8')
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text)
  if (match === null) return false
  const newline = match[1].endsWith('\r\n') ? '\r\n' : '\n'
  const body = match[2]
  const line = `description: ${JSON.stringify(description)}`
  const rewritten = /^description:.*$/m.test(body)
    ? body.replace(/^description:.*$/m, line)
    : `${body}${newline}${line}`
  const before = text.slice(0, match.index)
  const after = text.slice(match.index + match[1].length + body.length)
  writeFileSync(file, before + match[1] + rewritten + after, 'utf8')
  return true
}

/** The name rule DSH applies; a skill failing it is silently not registered. */
export function nameProblem(skillName, stem) {
  if (skillName === '') return 'нет поля name'
  if (skillName.length > 64) return 'name длиннее 64 символов'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) return 'name не в kebab-case'
  if (stem !== undefined && skillName !== stem) return `name не совпадает с папкой «${stem}»`
  return null
}

/** Every skill in one root, paused ones included. */
export function scanRoot(root) {
  const found = []
  let entries
  try {
    entries = readdirSync(root.path, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name === '.system') continue
    let file = null
    let stem = null
    let paused = false
    if (entry.isDirectory()) {
      const active = join(root.path, entry.name, 'SKILL.md')
      const dormant = active + PAUSED_SUFFIX
      if (existsSync(active)) file = active
      else if (existsSync(dormant)) { file = dormant; paused = true }
      stem = entry.name
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      file = join(root.path, entry.name)
      stem = entry.name.slice(0, -3)
    } else if (entry.isFile() && entry.name.endsWith('.md' + PAUSED_SUFFIX)) {
      file = join(root.path, entry.name)
      paused = true
      stem = entry.name.slice(0, -(3 + PAUSED_SUFFIX.length))
    } else {
      continue
    }
    const front = readFrontmatter(file)
    if (front === null) continue
    const skillName = front.name === '' ? stem : front.name
    let bytes = 0
    try { bytes = statSync(file).size } catch { bytes = 0 }
    found.push({
      name: skillName,
      description: front.description,
      source: root.source,
      sourceLabel: root.label,
      rank: root.rank,
      file,
      directory: entry.isDirectory() ? join(root.path, entry.name) : root.path,
      paused,
      problem: nameProblem(skillName, stem),
      bytes,
    })
  }
  return found
}

// ── the registry ─────────────────────────────────────────────────────────────

/** Path of the registry file. */
export function registryPath() {
  return join(dshHome(), 'skill-registry.json')
}

/** Read the registry; an absent or broken file reads as empty rather than fatal. */
export function readRegistry() {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(), 'utf8'))
    return { version: 1, skills: parsed?.skills ?? {} }
  } catch {
    return { version: 1, skills: {} }
  }
}

/** Write the registry, creating the home directory when it is missing. */
export function writeRegistry(registry) {
  const file = registryPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ version: 1, skills: registry.skills }, null, 2)}\n`, 'utf8')
}

/** Every skill in every root, with the registry applied. */
export function snapshot() {
  const scanned = []
  for (const root of roots()) for (const skill of scanRoot(root)) scanned.push(skill)
  const registry = readRegistry()

  // A name found in more than one root is served from the lowest rank, so mark the
  // shadowed copies rather than leaving two identical entries looking equivalent.
  const best = new Map()
  for (const skill of scanned) {
    const held = best.get(skill.name)
    if (held === undefined || skill.rank < held.rank) best.set(skill.name, skill)
  }
  for (const skill of scanned) {
    skill.shadowedBy = best.get(skill.name) !== skill ? best.get(skill.name).sourceLabel : null
    const entry = registry.skills[skill.name]
    skill.id = entry?.id ?? skill.name
    skill.humanSummary = entry?.humanSummary ?? ''
    skill.registered = entry !== undefined
    skill.registeredAt = entry?.registeredAt ?? null
  }
  scanned.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))

  return {
    registryPath: registryPath(),
    workspaces: workspaces().map((space) => ({ path: space.path, title: space.title })),
    total: scanned.length,
    paused: scanned.filter((skill) => skill.paused).length,
    registered: scanned.filter((skill) => skill.registered).length,
    roots: roots().map((root) => ({
      source: root.source,
      label: root.label,
      rank: root.rank,
      path: root.path,
      exists: existsSync(root.path),
      count: scanned.filter((skill) => skill.source === root.source).length,
    })),
    skills: scanned,
  }
}

/** Refuse any path that is not one this module scanned. */
function insideRoots(candidate) {
  const target = resolve(candidate)
  return roots().some((root) => {
    const base = resolve(root.path)
    return target === base || target.startsWith(base + sep)
  })
}

/** Pause or resume one skill by renaming the file that makes it discoverable. */
export function toggle(target, action) {
  if (typeof target !== 'string' || target === '') return { code: 'bad-request' }
  if (!insideRoots(target)) return { code: 'outside-roots' }
  const path = resolve(target)
  if (!existsSync(path)) return { code: 'not-found' }
  if (action === 'pause') {
    if (path.endsWith(PAUSED_SUFFIX)) return { code: 'already-paused' }
    const dormant = path + PAUSED_SUFFIX
    if (existsSync(dormant)) return { code: 'target-exists' }
    renameSync(path, dormant)
    return { ok: true, file: dormant, paused: true }
  }
  if (action === 'resume') {
    if (!path.endsWith(PAUSED_SUFFIX)) return { code: 'not-paused' }
    const active = path.slice(0, -PAUSED_SUFFIX.length)
    if (existsSync(active)) return { code: 'target-exists' }
    renameSync(path, active)
    return { ok: true, file: active, paused: false }
  }
  return { code: 'bad-request' }
}

/**
 * Register a skill, or update the two descriptions that belong to it.
 *
 * The model-facing description is written into the `SKILL.md` frontmatter because
 * that is the text DSH matches on; the human summary stays in this registry. A paused
 * skill is edited where it lies — the frontmatter is inside the `.paused` file too —
 * so describing something does not quietly resume it.
 */
export function describe(payload) {
  const file = payload?.file
  const modelDescription = payload?.modelDescription
  const humanSummary = payload?.humanSummary
  if (typeof file !== 'string' || file === '') return { code: 'bad-request' }
  if (!insideRoots(file)) return { code: 'outside-roots' }
  if (!existsSync(file)) return { code: 'not-found' }
  const front = readFrontmatter(file)
  if (front === null) return { code: 'unreadable' }
  const id = front.name !== '' ? front.name : 'unnamed'

  if (typeof modelDescription === 'string' && modelDescription.trim() !== '') {
    writeDescription(file, modelDescription.trim())
  }
  const registry = readRegistry()
  const previous = registry.skills[id] ?? {}
  registry.skills[id] = {
    id,
    file,
    workspace: payload?.workspace ?? previous.workspace ?? null,
    modelDescription: typeof modelDescription === 'string' && modelDescription.trim() !== ''
      ? modelDescription.trim()
      : (previous.modelDescription ?? front.description),
    humanSummary: typeof humanSummary === 'string' ? humanSummary.trim() : (previous.humanSummary ?? ''),
    enabled: !file.endsWith(PAUSED_SUFFIX),
    registeredAt: previous.registeredAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  writeRegistry(registry)
  return { ok: true, id }
}

/** Forget a registry entry. The skill itself is untouched. */
export function forget(id) {
  if (typeof id !== 'string' || id === '') return { code: 'bad-request' }
  const registry = readRegistry()
  if (registry.skills[id] === undefined) return { code: 'not-registered' }
  delete registry.skills[id]
  writeRegistry(registry)
  return { ok: true }
}

/** JSON response helper. */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Reject with a stable code the browser half can translate. */
const fail = (code, status = 400, detail) =>
  json(detail === undefined ? { ok: false, code } : { ok: false, code, detail }, status)

/**
 * Mount the management route.
 * @param ctx - host context carrying `connection`.
 */
export function apply(ctx) {
  const disposeRoute = ctx.connection.fetch.register({
    path: SKILL_ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') {
        try {
          return json({ ok: true, state: snapshot() })
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
        const action = payload?.action
        let result
        if (action === 'pause' || action === 'resume') result = toggle(payload?.file, action)
        else if (action === 'describe') result = describe(payload)
        else if (action === 'forget') result = forget(payload?.id)
        else result = { code: 'bad-request' }
        if (result.ok !== true) return fail(result.code)
        return json({ ok: true, ...result, state: snapshot() })
      } catch (error) {
        return fail('write-failed', 500, String(error?.message ?? error))
      }
    },
  })
  ctx.effect(() => () => {
    void disposeRoute()
  }, 'skill-manager: route lifecycle')
}

export default { name, inject, apply }
