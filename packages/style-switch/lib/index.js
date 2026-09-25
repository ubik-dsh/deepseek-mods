/**
 * `@local/dsh-style-switch` — host half.
 *
 * One question, asked with a button: **how should the agent think on this
 * request?** The chat header offers two styles, and this half turns the choice
 * into a system-prompt section.
 *
 * - `DSH` — the harness as it ships. This style contributes NOTHING: the
 *   section is not registered at all, so the prompt is byte-for-byte the one
 *   the harness would send on its own. A style that must reproduce the default
 *   cannot be allowed to add text "that changes nothing".
 * - `КОДЕКС` — the concise style: answer first, then a short proof, branches of
 *   cases instead of a full enumeration, nothing beyond the question.
 *
 * The text provider is re-evaluated at every assembly, so a switch reaches the
 * next model request with no restart — the same mechanism the first-party
 * prompt registry documents for live edits.
 *
 * @module @local/dsh-style-switch
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'style-switch'

/** Required services: the prompt registry and the authenticated Web transport. */
export const inject = ['systemPrompt', 'connection']

/** Exact route below `/api` owned by this plugin. */
export const MOD_ROUTE_PATH = '/api/style-switch.mod'

/** Section name this plugin owns. */
export const MOD_SECTION_NAME = 'mod:style-switch'

/**
 * Placement of the style block. After every first-party section (`10200` is the
 * deployment persona suffix) and after `mod:user-system-prompt` (`10300`), so a
 * hand-written override still has the last word.
 */
export const MOD_SECTION_ORDER = 10350

/**
 * The text of the concise style.
 *
 * Distilled from the instructions the Codex desktop client sends with every
 * request — measured at 21 465 characters in its own session log
 * (`payload.base_instructions.text`), of which these rules are the load-bearing
 * part. The measurement behind the style: the same puzzle, the same DeepSeek
 * model — 7 min 24 s and 306K tokens our way, 2 min 14 s the concise way, both
 * answers correct. The difference was the amount of work, not the quality of
 * thought.
 */
export const CODEX_STYLE_TEXT = [
  'СТИЛЬ РАБОТЫ: КОДЕКС (краткий, по делу)',
  '',
  'Это указание о ФОРМЕ ответа, а не о его содержании. Факты, числа и проверки остаются точными.',
  '',
  '- Сначала ответ, потом короткое доказательство. Первое предложение — уже суть.',
  '- Иди ветвями случаев, а не полным перебором: разбери варианты, отбрось невозможные,',
  '  доведи оставшийся до конца.',
  '- Ничего сверх вопроса: не пиши, что осталось неизменным, чем это полезно и что можно было',
  '  бы сделать ещё.',
  '- Никаких вступлений и итоговых пересказов.',
  '- Не хвали свой план через противопоставление («сделаю X, а не глупое Y»).',
  '- Инструменты — только когда без них нельзя.',
  '- Формат: таблица, список или 5–10 строк.',
  '- Если задача нерешаема — скажи это сразу и назови, что чему противоречит.',
  '- Если не проверял — скажи «не проверял» одной строкой.',
].join('\n')

/**
 * The offered styles.
 *
 * `text` is what the style contributes to the prompt; an empty text means
 * "register nothing", which is how `DSH` reproduces the shipped prompt exactly.
 * `summary` is the one line the browser shows next to the name, so the choice
 * is made from words rather than from the id.
 */
export const STYLES = [
  {
    id: 'dsh',
    label: 'DSH',
    summary: 'обычный: разбор, карта задачи, проверка запуском, источники',
    text: '',
  },
  {
    id: 'codex',
    label: 'КОДЕКС',
    summary: 'кратко: ответ и доказательство по ветвям, ничего сверх вопроса',
    text: CODEX_STYLE_TEXT,
  },
]

/** Style used when nothing is stored, or when the stored id is unknown. */
export const DEFAULT_STYLE = 'dsh'

/** Resolve this Harness home's state file. */
export function statePath() {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'style-switch.json')
}

/** Coerce untrusted persisted JSON into the accepted state shape. */
function normalizeState(raw) {
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  const known = STYLES.some((style) => style.id === value.style)
  return { style: known ? value.style : DEFAULT_STYLE }
}

/** Read persisted state; a missing or malformed file reads as the default style. */
export function readState() {
  try {
    return normalizeState(JSON.parse(readFileSync(statePath(), 'utf8')))
  } catch {
    return normalizeState(null)
  }
}

/** Atomically persist state so a crash never leaves a half-written choice. */
export function writeState(state) {
  const path = statePath()
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

/** The style record for an id, falling back to the default. */
export function styleOf(id) {
  return STYLES.find((style) => style.id === id) ?? STYLES.find((style) => style.id === DEFAULT_STYLE)
}

/** The prompt text this style contributes right now. */
export function styleText(state) {
  return styleOf(state.style).text
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

/** What the browser needs to render the switch and preview the consequence. */
export function snapshot(state) {
  const current = styleOf(state.style)
  return {
    ok: true,
    style: current.id,
    label: current.label,
    summary: current.summary,
    text: current.text,
    // An empty contribution is a real state, not a failure: it is what `DSH` is.
    contributes: current.text.trim() !== '',
    styles: STYLES.map((style) => ({
      id: style.id,
      label: style.label,
      summary: style.summary,
      contributes: style.text.trim() !== '',
      length: style.text.length,
    })),
    section: MOD_SECTION_NAME,
    order: MOD_SECTION_ORDER,
    path: statePath(),
  }
}

/** Validate one incoming choice against the current state. */
function mergeState(payload) {
  if (payload === null || typeof payload !== 'object') return { error: 'request body must be a JSON object' }
  if (payload.style === undefined) return { error: '`style` is required' }
  if (typeof payload.style !== 'string') return { error: '`style` must be a string' }
  if (!STYLES.some((style) => style.id === payload.style)) {
    return { error: `unknown style "${payload.style}"; known: ${STYLES.map((style) => style.id).join(', ')}` }
  }
  return { state: { style: payload.style } }
}

/**
 * Mount the style section and its transport.
 * @param ctx - host context carrying `systemPrompt` and `connection`.
 */
export function apply(ctx) {
  const state = readState()
  let disposeSection = null

  /**
   * (Re)register the prompt section. The text provider reads `state` at every
   * assembly, which is what makes the switch live; the section itself is
   * registered only while the chosen style contributes something, so that the
   * `DSH` style leaves the prompt untouched.
   */
  const sync = () => {
    if (disposeSection !== null) {
      disposeSection()
      disposeSection = null
    }
    if (styleText(state).trim() === '') return
    disposeSection = ctx.systemPrompt.section({
      name: MOD_SECTION_NAME,
      order: MOD_SECTION_ORDER,
      complete: false,
      text: () => styleText(state),
    })
  }

  sync()
  ctx.effect(() => () => {
    if (disposeSection !== null) {
      disposeSection()
      disposeSection = null
    }
  }, 'style-switch: prompt section lifecycle')

  const disposeRoute = ctx.connection.fetch.register({
    path: MOD_ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return json(snapshot(state))
      if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
      let payload
      try {
        payload = await request.json()
      } catch {
        return json({ ok: false, error: 'request body must be valid JSON' }, 400)
      }
      const merged = mergeState(payload)
      if (merged.error !== undefined) return json({ ok: false, error: merged.error }, 400)
      Object.assign(state, merged.state)
      try {
        writeState(state)
      } catch (error) {
        return json({ ok: false, error: `не удалось сохранить: ${messageOf(error)}` }, 500)
      }
      sync()
      ctx.logger?.info?.(`style-switch: style = ${state.style}`)
      return json(snapshot(state))
    },
  })
  ctx.effect(() => () => {
    void disposeRoute()
  }, 'style-switch: route lifecycle')
}

export default { name, inject, apply }
