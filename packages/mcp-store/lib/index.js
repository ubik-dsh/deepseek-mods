/**
 * `@local/dsh-mcp-store` — host half.
 *
 * One file in the Harness home, one route over it, and four tools an agent calls:
 *
 *   mcp-store.json   the registry of MCP servers: what it is, what it gives an
 *                    agent, what was measured, and whether it is worth reaching for
 *
 * ## A registry, not a configuration
 *
 * The obvious design is for this plugin to write the harness's MCP server list. It
 * is the wrong one, and not for a stylistic reason: what this harness *loads* is a
 * loader row in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, and writing rows
 * there changes what every later session can call. That is a different act with a
 * different blast radius from keeping a note about a server, and it is the act
 * AGENTS.md rule 1 fences off.
 *
 * So this file records, and never enables. The panel shows the operator the exact
 * snippet to paste and where it goes; he decides. A store that quietly turned itself
 * into a configuration would make every entry a decision nobody took.
 *
 * ## The description is the field that matters
 *
 * `comment` is the operator's own note, in whatever language he writes. `description`
 * is written FOR AN AGENT — what this server gives an agent and when to reach for it —
 * because that is the string a future agent reads when deciding whether this server is
 * worth the tokens. An entry without it is a link with a name, so it is required.
 *
 * ## What is live and what is a finding
 *
 * The file is the live state and it lives in `$DSH_HOME`. `found` blocks under each
 * entry are **measurements**, not claims: what an endpoint answered, from this machine,
 * on the date beside it. The two seeded entries carry what was actually observed, and
 * the one that changed mid-probe says so rather than picking the flattering half.
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'mcp-store'

/** The host services this plugin needs: one route, and the tool registry. */
export const inject = ['connection', 'tools']

/** Exact route below `/api` owned by this plugin. */
export const STORE_ROUTE_PATH = '/api/mcp-store.mod'

/** The two transports DSH's own MCP bridge accepts, in its vocabulary. */
export const TRANSPORTS = ['stdio', 'streamable-http']

/**
 * Where an entry is in its life. Ordered from "someone wrote it down" to "we have an
 * answer", so an entry that never gets past `proposed` reads as untested rather than
 * as a gain.
 */
export const STATUSES = ['proposed', 'tried', 'working', 'refused']

/** How many entries a store is allowed to grow to before it needs a prune. */
const STORE_SOFT_LIMIT = 200

/** Tool names, so the tests and the panel name them in exactly one place. */
export const TOOL_ADD = 'mcp_store_add'
export const TOOL_LIST = 'mcp_store_list'
export const TOOL_UPDATE = 'mcp_store_update'
export const TOOL_NOTE = 'mcp_store_note'

export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function storePath() {
  return join(dshHome(), 'mcp-store.json')
}

/** The profile whose patch layer decides what this harness actually loads. */
export function patchFileName() {
  return join(dshHome(), 'profiles', 'web', 'cordis.patch.yml')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** A stable, readable id: the server name, reduced to what survives a URL and a key. */
function entryId(serverName) {
  return String(serverName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
}

const text = (value, limit) => String(value ?? '').trim().slice(0, limit)

/** A measurement: what an endpoint answered, and when it was asked. */
function foundOf(value) {
  if (typeof value === 'string') return { at: null, fact: value.slice(0, 900) }
  return {
    at: typeof value?.at === 'string' ? value.at.slice(0, 40) : null,
    fact: text(value?.fact, 900),
  }
}

function observationOf(value) {
  return {
    at: text(value?.at, 40) || new Date().toISOString(),
    text: text(value?.text, 2000),
  }
}

/**
 * One entry, canonicalised.
 *
 * Every stored entry goes through here, so an entry read back has the same shape as
 * one just written and the panel never has to guess whether a field exists.
 */
function entryOf(payload, previous) {
  const serverName = text(payload?.name, 120)
  const transport = text(payload?.transport, 40) || 'streamable-http'
  const command = text(payload?.command, 300)
  const args = Array.isArray(payload?.args) ? payload.args.map((one) => text(one, 200)).slice(0, 40) : []
  const url = text(payload?.url, 500)
  const status = text(payload?.status, 20) || 'proposed'
  const now = new Date().toISOString()
  return {
    id: payload?.id ?? entryId(serverName),
    name: serverName,
    transport,
    url,
    command,
    args,
    // Free text, in whatever language the operator writes. Never normalised, never
    // translated: it is his note, and a store that rewrote it would be his store no more.
    // A rewrite that omits it keeps the one already there — the operator's own words are
    // the last thing a later call should be able to erase by not mentioning them.
    comment: text(payload?.comment, 500) || (previous?.comment ?? ''),
    // The field that matters: written for an agent, not for a person.
    description: text(payload?.description, 700),
    status,
    source: text(payload?.source, 500) || (previous?.source ?? ''),
    addedAt: previous?.addedAt ?? now,
    updatedAt: now,
    found: Array.isArray(payload?.found) ? payload.found.map(foundOf).slice(0, 10)
      : (previous?.found ?? []),
    observations: Array.isArray(payload?.observations)
      ? payload.observations.map(observationOf).slice(0, 20)
      : (previous?.observations ?? []),
  }
}

/**
 * What the two entries every store starts with were measured to be.
 *
 * This is seed data, not a claim about what these servers will answer tomorrow. The
 * VkusVill block is deliberately longer than the happy line: the first probe from this
 * machine stopped after `tools/list` and a `tools/call` answered **HTTP 403**, and a
 * completed handshake — `initialize`, then the `notifications/initialized` note — made
 * the same call answer 200. Both facts are recorded, so a later reader can tell a
 * protocol mistake from a permission one.
 */
function seedEntries() {
  const at = '2026-09-21'
  return [
    entryOf({
      id: 'vkusvill',
      name: 'vkusvill',
      transport: 'streamable-http',
      url: 'https://mcp001.vkusvill.ru/mcp',
      comment: 'ВкусВилл, свой MCP. Без ключей. Корзину собирает ссылкой — заказ и оплата не здесь.',
      description: 'Product lookup for VkusVill, a Russian grocery chain: search, details by id or barcode, analogs, discounts, shops, recipes, and one link-builder that puts chosen items into a shareable cart. Reach for it when a question is about what VkusVill sells, what a product contains, or what it costs, and when the answer should end in a cart link the human opens. It does NOT order and cannot pay — the last step is that link.',
      status: 'proposed',
      source: 'https://mcp001.vkusvill.ru/mcp',
      found: [
        { at, fact: 'initialize and tools/list answer anonymously, HTTP 200. serverInfo "VV MCP Server" 0.0.1, protocol 2025-03-26.' },
        { at, fact: 'Eight tools listed: vkusvill_products_search, vkusvill_product_details, vkusvill_product_barcode, vkusvill_product_analogs, vkusvill_products_discount, vkusvill_shops, vkusvill_recipes, vkusvill_cart_link_create.' },
        { at, fact: 'tools/call for vkusvill_products_search with q=молоко answered HTTP 200 with real data (total 541) — but only after the full handshake, initialize THEN notifications/initialized. A first probe that skipped the notification got HTTP 403, reason never established; that 403 is recorded here because a later reader should be able to tell a protocol mistake from a credential wall.' },
      ],
    }),
    entryOf({
      id: 'drawio',
      name: 'drawio',
      transport: 'streamable-http',
      url: 'https://mcp.draw.io/mcp',
      comment: 'draw.io, официальный. Схемы рисует прямо в чате. Диаграмма уходит на их сервер.',
      description: 'The official draw.io MCP server from jgraph. Two tools: create_diagram renders draw.io XML as an interactive diagram inline in chat, and search_shapes finds the exact style string for a shape among 10,000+ library shapes (AWS, Azure, GCP, UML, BPMN, electrical, Kubernetes, ...) plus brand icons. Reach for it when a picture explains something better than prose and the picture should be editable in draw.io afterwards, or when the correct draw.io shape style is unknown. Inline rendering needs a host that implements the MCP Apps extension; where it is absent the tool still works and returns the XML as text. Diagrams sent to the hosted endpoint leave the machine.',
      status: 'proposed',
      source: 'https://github.com/jgraph/drawio-mcp',
      found: [
        { at, fact: 'https://mcp.draw.io/mcp answers initialize anonymously, HTTP 200, serverInfo "drawio-mcp-app" 1.0.0, protocol 2025-06-18, tools.listChanged true. It returns an mcp-session-id header, unlike the VkusVill endpoint.' },
        { at, fact: 'Tools per the repository README: create_diagram, search_shapes. The same repo also publishes a stdio server (npx @drawio/mcp) that opens diagrams in the draw.io editor and takes XML, CSV or Mermaid.' },
      ],
    }),
  ]
}

/**
 * The store: the registry of MCP servers, and never the harness's own MCP config.
 *
 * A first run has no file. Rather than an empty table — which reads as a broken panel —
 * the two servers found on 2026-09-21 are seeded, both `proposed`, because nothing in
 * this harness has loaded either one yet.
 */
export function readStore() {
  const raw = readJson(storePath(), null)
  if (raw === null) {
    return { version: 1, updated: null, entries: seedEntries(), seeded: true }
  }
  return {
    version: 1,
    updated: raw?.updated ?? null,
    entries: Array.isArray(raw?.entries) ? raw.entries : [],
    seeded: false,
  }
}

export function writeStore(store) {
  writeJson(storePath(), {
    version: 1,
    updated: new Date().toISOString(),
    entries: store.entries,
  })
}

/** Create the file if it is not there yet, so the panel's path is a real path. */
export function ensureStore() {
  if (!existsSync(storePath())) writeStore(readStore())
  return storePath()
}

/** What is wrong with the connection half of an entry, or null. */
function transportProblem(payload) {
  const transport = text(payload?.transport, 40)
  if (transport === '') return null
  if (!TRANSPORTS.includes(transport)) return 'bad-transport'
  if (transport === 'stdio') return text(payload?.command, 300) === '' ? 'needs-command' : null
  return text(payload?.url, 500) === '' ? 'needs-url' : null
}

// ── the tools the agent calls ─────────────────────────────────────────────────

/**
 * Put a server into the store.
 *
 * Called by the agent when the operator says "add this to the MCP store", and by
 * nobody else. It writes a row; it does not enable anything. What actually loads is a
 * loader row in the profile's patch layer, which a person pastes — see the panel.
 */
export function add(payload) {
  const serverName = text(payload?.name, 120)
  if (serverName === '') return { code: 'needs-name' }
  // Nothing enters the store without a description for an agent. The whole point of the
  // store is that a future agent reads it and decides; a row without one is a link.
  const description = text(payload?.description, 700)
  if (description === '') return { code: 'needs-description' }
  const status = text(payload?.status, 20)
  if (status !== '' && !STATUSES.includes(status)) return { code: 'bad-status' }
  // The connection half is checked from the values that will actually be stored, so an
  // omitted transport is judged as the default it becomes and not as an empty string.
  const problem = transportProblem({
    transport: text(payload?.transport, 40) || 'streamable-http',
    command: payload?.command,
    url: payload?.url,
  })
  if (problem !== null) return { code: problem }

  const store = readStore()
  const id = text(payload?.id, 60) !== '' ? entryId(text(payload?.id, 60)) : entryId(serverName)
  // A name made only of characters an id cannot hold — punctuation, an emoji — would
  // otherwise produce an empty id and two entries that overwrite each other.
  if (id === '') return { code: 'bad-id' }
  const existing = store.entries.findIndex((item) => item.id === id)
  const entry = entryOf({ ...payload, id, name: serverName, description, status: status || 'proposed' },
    existing >= 0 ? store.entries[existing] : undefined)
  if (existing >= 0) {
    store.entries[existing] = entry
  } else {
    store.entries.unshift(entry)
  }
  // A store nobody prunes stops being read. Keep the newest and say so in the snapshot.
  if (store.entries.length > STORE_SOFT_LIMIT) store.entries.length = STORE_SOFT_LIMIT
  writeStore(store)
  return { ok: true, entry, replaced: existing >= 0 }
}

/**
 * Change an entry in place.
 *
 * A partial update on purpose: the operator edits one field from the chat, and the
 * fields he did not mention must survive. An empty string is refused rather than
 * silently clearing a field, because "make the description empty" and "leave the
 * description alone" arriving as the same value is how a store loses its content.
 */
export function update(payload) {
  const store = readStore()
  const entry = store.entries.find((item) => item.id === text(payload?.id, 60))
  if (entry === undefined) return { code: 'no-such-entry' }

  for (const field of ['name', 'comment', 'description', 'source']) {
    if (payload?.[field] === undefined) continue
    const value = text(payload[field], field === 'description' ? 700 : 500)
    if (value === '') return { code: `empty-${field}` }
    entry[field] = value
  }
  if (payload?.transport !== undefined) {
    if (!TRANSPORTS.includes(text(payload.transport, 40))) return { code: 'bad-transport' }
    entry.transport = text(payload.transport, 40)
  }
  if (payload?.url !== undefined) entry.url = text(payload.url, 500)
  if (payload?.command !== undefined) entry.command = text(payload.command, 300)
  if (payload?.args !== undefined) {
    if (!Array.isArray(payload.args)) return { code: 'bad-args' }
    entry.args = payload.args.map((one) => text(one, 200)).slice(0, 40)
  }
  if (payload?.status !== undefined) {
    if (!STATUSES.includes(text(payload.status, 20))) return { code: 'bad-status' }
    entry.status = text(payload.status, 20)
  }
  const problem = transportProblem(entry)
  if (problem !== null) return { code: problem }
  entry.updatedAt = new Date().toISOString()
  writeStore(store)
  return { ok: true, entry }
}

/**
 * Record what a server actually answered.
 *
 * A measurement, dated, appended rather than replacing what came before. `status` is
 * flipped to `tried` only from `proposed`: an entry someone already called `working` or
 * `refused` is a decision, and a new observation does not quietly undo it.
 */
export function note(payload) {
  const store = readStore()
  const entry = store.entries.find((item) => item.id === text(payload?.id, 60))
  if (entry === undefined) return { code: 'no-such-entry' }
  const observation = text(payload?.text, 2000)
  if (observation === '') return { code: 'empty-note' }
  if (!Array.isArray(entry.observations)) entry.observations = []
  entry.observations.unshift(observationOf({ text: observation }))
  entry.observations = entry.observations.slice(0, 20)
  if (entry.status === 'proposed') entry.status = 'tried'
  entry.updatedAt = new Date().toISOString()
  writeStore(store)
  return { ok: true, entry }
}

/** Forget an entry. Nothing outside this file is touched — that is the whole point. */
export function forget(id) {
  const store = readStore()
  const before = store.entries.length
  store.entries = store.entries.filter((item) => item.id !== id)
  if (store.entries.length === before) return { code: 'no-such-entry' }
  writeStore(store)
  return { ok: true }
}

// ── the snippet, which is the honest boundary made visible ────────────────────

/**
 * Quote a scalar for YAML.
 *
 * Only a token that cannot mean anything else is left bare: one starting with a letter or
 * digit, containing no punctuation YAML reads as structure, and **not numeric**. That last
 * one is not pedantry — a bare `8080` parses back as the integer 8080, so an argument list
 * of `['-y', '--port', '8080']` would reach the spawned server with a number where it was
 * promised a string. A Windows path is full of backslashes YAML would take as escapes and a
 * URL is full of colons, so both are quoted; `-y` is quoted because a leading `-` is a
 * sequence indicator, while `streamable-http` is not. Inside single quotes the only
 * character to double is the quote itself.
 */
function yaml(value) {
  const raw = String(value ?? '')
  const bare = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/u.test(raw)
  const numeric = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/u.test(raw)
  if (bare && !numeric) return raw
  return `'${raw.replace(/'/gu, "''")}'`
}

/**
 * The loader rows this entry would become, and where they go.
 *
 * Deliberately a string for a person to paste rather than a write this plugin performs.
 * `id` is prefixed with `mcp-` to match the shipped example and to keep it from
 * colliding with a mod row of the same name.
 */
export function snippet(entry) {
  const lines = [
    '- insert:',
    `    - id: mcp-${String(entry?.id ?? 'server')}`,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    `        serverName: ${yaml(entry?.name)}`,
    `        transport: ${yaml(entry?.transport)}`,
  ]
  if (entry?.transport === 'stdio') {
    lines.push(`        command: ${yaml(entry?.command)}`)
    const args = Array.isArray(entry?.args) ? entry.args : []
    lines.push(args.length === 0 ? '        args: []'
      : `        args: [${args.map((one) => yaml(one)).join(', ')}]`)
  } else {
    lines.push(`        url: ${yaml(entry?.url)}`)
  }
  return lines.join('\n')
}

/** Everything a tool hands back: the entry as stored, plus what it would load as. */
function withSnippet(entry) {
  return { ...entry, snippet: snippet(entry), patchFile: patchFileName() }
}

/**
 * The entry, reduced to exactly the fields a tool's output schema declares.
 *
 * `defineTool` validates a tool's result against its own output schema, so a returned
 * object with extra keys is not a harmless surplus: it is a violation, and the call
 * fails after it has already written. Each name below is declared in the schema of the
 * tool that uses it and nowhere else.
 */
function outputOf(entry, fields) {
  const picked = {}
  for (const field of fields) picked[field] = entry[field] ?? ''
  return picked
}

// ── the snapshot the panel reads ──────────────────────────────────────────────

/** Everything the panel needs, in one read. */
export function snapshot() {
  // The panel's path box should name a file that exists, so a first look writes it.
  ensureStore()
  const store = readStore()
  return {
    storePath: storePath(),
    patchFile: patchFileName(),
    updated: store.updated,
    seeded: store.seeded === true,
    entries: store.entries.map(withSnippet),
    softLimit: STORE_SOFT_LIMIT,
    proposed: store.entries.filter((entry) => entry.status === 'proposed').length,
    working: store.entries.filter((entry) => entry.status === 'working').length,
    refused: store.entries.filter((entry) => entry.status === 'refused').length,
    tried: store.entries.filter((entry) => entry.status === 'tried').length,
    transports: {
      stdio: store.entries.filter((entry) => entry.transport === 'stdio').length,
      http: store.entries.filter((entry) => entry.transport === 'streamable-http').length,
    },
  }
}

/** JSON response helper. */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const fail = (code, status = 400, detail) =>
  json(detail === undefined ? { ok: false, code } : { ok: false, code, detail }, status)

/**
 * Register the four tools and mount the panel's route.
 * @param ctx - host context carrying `connection` and `tools`.
 */
export function apply(ctx) {
  const statusEnum = [...STATUSES]
  const transportEnum = [...TRANSPORTS]

  ctx.tools.register(defineTool({
    name: TOOL_ADD,
    description: 'Add one MCP server to the operator\'s MCP store — the registry the "MCP store" settings tab shows. Use when the operator says "add this to the MCP store", "занеси в хранилище MCP", or pastes an MCP server URL or npx command to keep. This records a row and enables NOTHING: the harness loads MCP servers from a loader row in the profile patch file, which the operator pastes himself. `description` is required and must be written FOR AN AGENT — what this server gives an agent and when to reach for it, in one or two sentences; it is what a later agent reads when deciding whether to use the server. `comment` is the operator\'s own note and may be in his language.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Short unique server name; it becomes the tool namespace mcp__<name>__<tool>. [A-Za-z0-9_-], max 32 characters, and it must contain at least one letter or digit — the store builds a readable id from it.',
      },
      description: {
        type: 'string',
        required: true,
        description: 'For an agent, not a person: what this server gives an agent and when to reach for it. This is the field a future agent decides on.',
      },
      transport: {
        type: 'string',
        enum: transportEnum,
        description: "streamable-http (remote endpoint, use `url`) or stdio (local program, use `command` + `args`). Default streamable-http.",
      },
      url: { type: 'string', description: 'Endpoint URL. Required for streamable-http.' },
      command: { type: 'string', description: 'Executable to spawn. Required for stdio.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments for `command`, one per item.' },
      comment: { type: 'string', description: "The operator's own note, free text, in whatever language he writes." },
      status: {
        type: 'string',
        enum: statusEnum,
        description: 'proposed (written down, never run) | tried (run, result unclear) | working (measured working here) | refused (decided against). Default proposed.',
      },
      source: { type: 'string', description: 'Where it came from — a link, a README, a message.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entry: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              id: { type: 'string', required: true },
              name: { type: 'string', required: true },
              transport: { type: 'string', required: true },
              url: { type: 'string', required: true },
              command: { type: 'string', required: true },
              description: { type: 'string', required: true },
              status: { type: 'string', required: true },
              snippet: { type: 'string', required: true },
              patchFile: { type: 'string', required: true },
            },
          },
          replaced: { type: 'boolean', required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.replaced ? 'Updated' : 'Added'} «${value.entry.name}» in the MCP store (${value.entry.status}), ${String(value.count)} entries now.\n`
          + `Paste into ${value.patchFile} to actually load it:\n${value.entry.snippet}`,
      }],
    },
    execute(args) {
      const result = add(args)
      if (result.ok !== true) throw new Error(`mcp_store_add refused: ${result.code}`)
      const entry = withSnippet(result.entry)
      return Promise.resolve({
        entry: outputOf(entry, ['id', 'name', 'transport', 'url', 'command', 'description', 'status', 'snippet', 'patchFile']),
        replaced: result.replaced === true,
        count: readStore().entries.length,
      })
    },
    presentCall: (args) => ({ card: 'generic', title: `MCP store: add ${args.name}`, kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: TOOL_LIST,
    description: 'List the MCP servers in the operator\'s MCP store, with the agent-facing description, status and the config snippet each entry would become. Read it BEFORE hunting for an MCP server or proposing one: a server already in the store is not looked for twice, and an entry marked `refused` carries a decision that should not be re-litigated without a reason.',
    parameters: {
      status: {
        type: 'string',
        enum: statusEnum,
        description: 'Only entries in this state. Omit for all of them.',
      },
      query: { type: 'string', description: 'Only entries whose name, description, comment or URL contains this text.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          shown: { type: 'integer', required: true },
          storePath: { type: 'string', required: true },
          patchFile: { type: 'string', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                transport: { type: 'string', required: true },
                status: { type: 'string', required: true },
                description: { type: 'string', required: true },
                comment: { type: 'string', required: true },
                source: { type: 'string', required: true },
                url: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
                addedAt: { type: 'string', required: true },
                found: { type: 'array', required: true, items: { type: 'string' } },
                observations: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? `The MCP store holds ${String(value.total)} entries and none match the filter.`
          : value.entries.map((entry) => `• ${entry.name} [${entry.status}, ${entry.transport}]`
            + `${entry.url !== '' ? ` — ${entry.url}` : ''}\n    ${entry.description}`
            + `${entry.comment !== '' ? `\n    comment: ${entry.comment}` : ''}`
            + `${entry.found.length > 0 ? `\n    measured: ${entry.found.join(' | ')}` : ''}`
            + `${entry.observations.length > 0 ? `\n    since: ${entry.observations.join(' | ')}` : ''}`)
            .join('\n'),
      }],
    },
    execute(args) {
      const listed = list(args)
      return Promise.resolve({
        total: listed.total,
        shown: listed.entries.length,
        storePath: storePath(),
        patchFile: patchFileName(),
        entries: listed.entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          transport: entry.transport,
          status: entry.status,
          description: entry.description,
          comment: entry.comment,
          source: entry.source,
          url: entry.url,
          snippet: snippet(entry),
          addedAt: entry.addedAt ?? '',
          found: (entry.found ?? []).map((one) => one.fact),
          observations: (entry.observations ?? []).map((one) => one.text),
        })),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read the MCP store', kind: 'read', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: TOOL_UPDATE,
    description: 'Change fields of one MCP store entry in place. Use when the operator corrects a comment, rewrites the agent-facing description, or moves an entry to another status — for example after an entry was measured to work, or after he decides against it. Only the fields given are touched; the others survive. An empty string is refused: to clear a field, say which one should be blank rather than sending "".',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Entry id as mcp_store_list returns it.',
      },
      name: { type: 'string', description: 'New server name.' },
      description: { type: 'string', description: 'New agent-facing description — what it gives an agent and when to reach for it.' },
      comment: { type: 'string', description: "New operator's note, in his own language." },
      transport: { type: 'string', enum: transportEnum, description: 'New transport.' },
      url: { type: 'string', description: 'New endpoint URL.' },
      command: { type: 'string', description: 'New executable for a stdio server.' },
      args: { type: 'array', items: { type: 'string' }, description: 'New argument list for a stdio server.' },
      status: { type: 'string', enum: statusEnum, description: 'New state: proposed | tried | working | refused.' },
      source: { type: 'string', description: 'New source link.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entry: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              id: { type: 'string', required: true },
              name: { type: 'string', required: true },
              description: { type: 'string', required: true },
              comment: { type: 'string', required: true },
              status: { type: 'string', required: true },
              snippet: { type: 'string', required: true },
              patchFile: { type: 'string', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `«${value.entry.name}» is now ${value.entry.status} in the MCP store.\n`
          + `Its loader rows, for ${value.patchFile}:\n${value.entry.snippet}`,
      }],
    },
    execute(args) {
      const result = update(args)
      if (result.ok !== true) throw new Error(`mcp_store_update refused: ${result.code}`)
      const entry = withSnippet(result.entry)
      return Promise.resolve({
        entry: outputOf(entry, ['id', 'name', 'description', 'comment', 'status', 'snippet', 'patchFile']),
      })
    },
    presentCall: (args) => ({ card: 'generic', title: `MCP store: update ${args.id}`, kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: TOOL_NOTE,
    description: 'Record what an MCP server actually answered, against its store entry. Use after probing an endpoint, because the store keeps measurements rather than impressions: the fact, the date, and the status of the entry all move together. An entry that was only `proposed` becomes `tried`; a `working` or `refused` entry keeps the decision it already carries. Write what was observed — the HTTP status, the tool names, the error text — not a conclusion.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id as mcp_store_list returns it.' },
      text: {
        type: 'string',
        required: true,
        description: 'What was measured, with the numbers: endpoint, HTTP status, tools seen, error text.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          status: { type: 'string', required: true },
          observations: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Recorded against «${value.name}» (${value.status}), ${String(value.observations)} observation(s) kept.`,
      }],
    },
    execute(args) {
      const result = note(args)
      if (result.ok !== true) throw new Error(`mcp_store_note refused: ${result.code}`)
      return Promise.resolve({
        id: result.entry.id,
        name: result.entry.name,
        status: result.entry.status,
        observations: result.entry.observations.length,
      })
    },
    presentCall: (args) => ({ card: 'generic', title: `MCP store: note on ${args.id}`, kind: 'other', rawInput: args }),
  }))

  const disposeRoute = ctx.connection.fetch.register({
    path: STORE_ROUTE_PATH,
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
        let result
        switch (payload?.action) {
          case 'add': result = add(payload.entry ?? {}); break
          case 'update': result = update(payload.entry ?? {}); break
          case 'note': result = note(payload.entry ?? {}); break
          case 'forget': result = forget(payload?.id); break
          default: result = { code: 'bad-request' }
        }
        if (result.ok !== true) return fail(result.code)
        return json({ ok: true, ...result, state: snapshot() })
      } catch (error) {
        return fail('write-failed', 500, String(error?.message ?? error))
      }
    },
  })
  ctx.effect(() => () => {
    void disposeRoute()
  }, 'mcp-store: route lifecycle')
}

/** The store, filtered. Used by the list tool and by nothing else. */
export function list(payload) {
  const store = readStore()
  const status = text(payload?.status, 20)
  const query = text(payload?.query, 200).toLowerCase()
  const entries = store.entries.filter((entry) => {
    if (status !== '' && entry.status !== status) return false
    if (query === '') return true
    const haystack = [entry.name, entry.description, entry.comment, entry.url, entry.source]
      .join(' ').toLowerCase()
    return haystack.includes(query)
  })
  return { total: store.entries.length, entries }
}

export default { name, inject, apply }
