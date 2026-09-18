/**
 * `@local/dsh-system-prompt-mod` — host half.
 *
 * Owns one editable system-prompt contribution plus the Web transport the
 * browser editor uses:
 *
 * - a prompt section whose text provider is re-evaluated at every assembly, so
 *   a saved edit reaches the next model request with no restart;
 * - `/api/system-prompt.mod` (GET state + rendered prompt, POST save) on the
 *   shared authenticated Connection channel the Web GUI already speaks.
 *
 * The override is deployment-wide (registered in the global scope), matching
 * what the editor presents: one prompt the user can read and rewrite.
 *
 * @module @local/dsh-system-prompt-mod
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'system-prompt-mod'

/** Required services: the prompt registry, the authenticated Web transport, and the live agent registry. */
export const inject = ['systemPrompt', 'connection', 'agents']

/** Exact route below `/api` owned by this plugin. */
export const MOD_ROUTE_PATH = '/api/system-prompt.mod'

/** Section name this plugin owns; the editor filters it out of the base preview. */
export const MOD_SECTION_NAME = 'mod:user-system-prompt'

/**
 * Placement of the appended override — after every first-party section,
 * including the deployment persona suffix (`10200`).
 */
export const MOD_SECTION_ORDER = 10300

/** Longest accepted override, in characters. */
const MAX_TEXT_LENGTH = 200000

/**
 * A complete `{{variable}}` group. `renderPrompt` interpolates these strictly
 * and throws on an unknown name, and the registry offers no escape syntax, so
 * user text carrying one is rejected instead of breaking every later request.
 */
const VARIABLE_GROUP = /\{\{[^{}]*\}\}/

/** Resolve this Harness home's state file. */
export function statePath() {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'system-prompt-mod.json')
}

/** Coerce untrusted persisted JSON into the accepted state shape. */
function normalizeState(raw) {
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    enabled: value.enabled === true,
    mode: value.mode === 'replace' ? 'replace' : 'append',
    text: typeof value.text === 'string' ? value.text : '',
  }
}

/** Read persisted state; a missing or malformed file reads as the disabled default. */
export function readState() {
  try {
    return normalizeState(JSON.parse(readFileSync(statePath(), 'utf8')))
  } catch {
    return normalizeState(null)
  }
}

/** Atomically persist state so a crash never leaves a half-written override. */
export function writeState(state) {
  const path = statePath()
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

/** Whether the override currently contributes anything to the prompt. */
function isActive(state) {
  return state.enabled && state.text.trim() !== ''
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

/** Message of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Tolerant rendering of an assembly.
 *
 * `renderPrompt` interpolates `{{variable}}` strictly and throws on the first
 * unresolved name. A preview must never fail that way, so this fallback
 * interpolates what the assembly resolved and leaves the rest as literal text.
 * It is only used when `renderPrompt` refuses the assembly.
 */
function renderTolerant(assembly) {
  const variables = assembly.variables ?? {}
  return assembly.sections
    .map((section) => section.text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (match, name) => (
      variables[name] !== undefined ? variables[name] : match
    )))
    .filter((text) => text !== '')
    .join('\n\n')
}

/**
 * Render one assembly for display, preferring the exact model-facing rendering
 * and degrading to the tolerant one instead of failing the whole preview.
 */
function renderPreview(assembly) {
  try {
    return { text: renderPrompt(assembly), exact: true, error: null }
  } catch (error) {
    return { text: renderTolerant(assembly), exact: false, error: messageOf(error) }
  }
}

/**
 * Assemble the deployment prompt for the editor.
 *
 * The prompt is assembled in the live agent's scope when the caller names a
 * session, because the loop's `{{model}}`/`{{cwd}}` variables live there; a
 * scope-less assembly is the fallback for a session with no live agent.
 *
 * `effectivePrompt` is what the model receives right now; `basePrompt` is the
 * same assembly with this plugin's own section removed, which is what the
 * editor offers as the starting point for a replacement. A `complete` (replace)
 * override leaves no base to show — the assembly then carries only this
 * plugin's section — so the base is reported as unavailable rather than empty.
 */
async function snapshot(ctx, state, sessionId) {
  const agent = typeof sessionId === 'string' && sessionId !== '' && typeof ctx.agents?.get === 'function'
    ? ctx.agents.get(sessionId)
    : undefined
  const result = {
    ok: true,
    enabled: state.enabled,
    mode: state.mode,
    text: state.text,
    active: isActive(state),
    path: statePath(),
    section: MOD_SECTION_NAME,
    order: MOD_SECTION_ORDER,
    sessionId: sessionId ?? null,
    scoped: agent !== undefined,
    basePrompt: null,
    baseAvailable: false,
    effectivePrompt: null,
    exact: true,
    error: null,
  }
  try {
    const assembly = await ctx.systemPrompt.assemble(agent !== undefined ? { agent, scope: agent } : {})
    const effective = renderPreview(assembly)
    result.effectivePrompt = effective.text
    result.exact = effective.exact
    result.error = effective.error
    if (!(result.active && state.mode === 'replace')) {
      const base = renderPreview({
        ...assembly,
        sections: assembly.sections.filter((section) => section.name !== MOD_SECTION_NAME),
      })
      result.basePrompt = base.text
      result.baseAvailable = true
    }
  } catch (error) {
    result.error = `prompt assembly failed: ${messageOf(error)}`
  }
  return result
}

/**
 * Validate one incoming edit against the current state.
 * @returns the merged next state, or an error message for the caller.
 */
function mergeState(current, payload) {
  if (payload === null || typeof payload !== 'object') return { error: 'request body must be a JSON object' }
  const next = { ...current }
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== 'boolean') return { error: '`enabled` must be a boolean' }
    next.enabled = payload.enabled
  }
  if (payload.mode !== undefined) {
    if (payload.mode !== 'append' && payload.mode !== 'replace') return { error: '`mode` must be "append" or "replace"' }
    next.mode = payload.mode
  }
  if (payload.text !== undefined) {
    if (typeof payload.text !== 'string') return { error: '`text` must be a string' }
    if (payload.text.length > MAX_TEXT_LENGTH) return { error: `\`text\` exceeds ${String(MAX_TEXT_LENGTH)} characters` }
    next.text = payload.text
  }
  if (isActive(next) && VARIABLE_GROUP.test(next.text)) {
    return {
      error: 'Текст содержит группу {{переменная}}: DSH подставляет такие группы строго и не имеет экранирования, '
        + 'поэтому запрос сломается. Уберите или перепишите её (например, как "переменная").',
    }
  }
  if (next.enabled && next.text.trim() === '') {
    return { error: 'Нечего применять: текст пуст.' }
  }
  return { state: next }
}

/**
 * Mount the prompt override and its editor transport.
 * @param ctx - host context carrying `systemPrompt` and `connection`.
 */
export function apply(ctx) {
  const state = readState()
  let disposeSection = null

  /**
   * (Re)register the prompt section. `complete` is captured at registration, so
   * the append/replace switch re-registers instead of mutating a flag; the text
   * provider itself stays dynamic, which is what makes a saved edit live.
   */
  const sync = () => {
    if (disposeSection !== null) {
      disposeSection()
      disposeSection = null
    }
    if (!isActive(state)) return
    disposeSection = ctx.systemPrompt.section({
      name: MOD_SECTION_NAME,
      order: MOD_SECTION_ORDER,
      complete: state.mode === 'replace',
      text: () => (isActive(state) ? state.text : ''),
    })
  }

  sync()
  ctx.effect(() => () => {
    if (disposeSection !== null) {
      disposeSection()
      disposeSection = null
    }
  }, 'system-prompt-mod: prompt section lifecycle')

  const disposeRoute = ctx.connection.fetch.register({
    path: MOD_ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const query = new URL(request.url).searchParams.get('sessionId') ?? undefined
      if (request.method === 'GET') return json(await snapshot(ctx, state, query))
      if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
      let payload
      try {
        payload = await request.json()
      } catch {
        return json({ ok: false, error: 'request body must be valid JSON' }, 400)
      }
      const merged = mergeState(state, payload)
      if (merged.error !== undefined) return json({ ok: false, error: merged.error }, 400)
      Object.assign(state, merged.state)
      try {
        writeState(state)
      } catch (error) {
        return json({ ok: false, error: `не удалось сохранить: ${messageOf(error)}` }, 500)
      }
      sync()
      ctx.logger?.info?.(`system-prompt-mod: override ${isActive(state) ? `active (${state.mode})` : 'inactive'}`)
      const sessionId = typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : query
      return json(await snapshot(ctx, state, sessionId))
    },
  })
  ctx.effect(() => () => {
    void disposeRoute()
  }, 'system-prompt-mod: route lifecycle')
}

export default { name, inject, apply }
