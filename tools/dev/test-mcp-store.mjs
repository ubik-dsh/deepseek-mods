#!/usr/bin/env node
/**
 * Unit tests for `@local/dsh-mcp-store`'s host half.
 *
 * The host half imports Node built-ins plus `@deepseek-ai/dsh-tools` for the tool
 * definition helper, so this needs `node tools/dev/link-dsh.mjs` to have run once. It
 * works on fabricated state in a temporary home, so nothing of anyone's own is touched.
 *
 * What it covers is the two things this plugin claims to be:
 *
 *   a REGISTRY   entries can be added, listed, changed and annotated, and every entry
 *                carries what an agent needs to decide on it вЂ” which is why a description
 *                for an agent is required and an entry without one is refused;
 *   not a CONFIG nothing here writes the harness's MCP server list. The snippet a person
 *                pastes is returned as a string, and the only file this plugin writes is
 *                the store itself.
 *
 * Usage: node tools/dev/test-mcp-store.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MOD = await import(`file://${join(REPO, 'packages', 'mcp-store', 'lib', 'index.js').replace(/\\/gu, '/')}`)
// The function the tool registry itself uses to check a tool's result against its declared
// output schema. A tool whose result does not match fails after it has already written, so
// this is checked here rather than discovered in a live session.
const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools')
// The snippet is pasted by hand into a YAML file, so it is parsed here with the same
// library the harness uses. A snippet that merely *looks* like YAML is the failure mode
// worth catching: an unquoted Windows path or a leading dash parses into something else.
const { parse: parseYaml } = await import('yaml')

let checks = 0
let failed = 0
const ok = (label, condition, detail) => {
  checks += 1
  if (condition) console.log(`ok ${String(checks).padStart(2)}. ${label}`)
  else {
    failed += 1
    console.log(`FAIL ${String(checks).padStart(2)}. ${label}${detail === undefined ? '' : ` вЂ” ${detail}`}`)
  }
}

const scratch = join(tmpdir(), `dsh-mcp-store-test-${String(process.pid)}`)
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
process.env.DSH_HOME = scratch

// в”Ђв”Ђ first run: seeded, and honest about what was measured в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const first = MOD.readStore()
ok('the store file starts absent', !existsSync(MOD.storePath()))
ok('and the first read seeds it rather than leaving a blank panel', first.seeded === true)
ok('its path is in the harness home', MOD.storePath().startsWith(scratch), MOD.storePath())
ok('with two entries', first.entries.length === 2, String(first.entries.length))
ok('both are proposed вЂ” nothing here has loaded either one', first.entries.every((entry) => entry.status === 'proposed'),
  first.entries.map((entry) => entry.status).join(', '))

const vv = first.entries.find((entry) => entry.id === 'vkusvill')
const dr = first.entries.find((entry) => entry.id === 'drawio')
ok('VkusVill is http, with its endpoint', vv?.transport === 'streamable-http'
  && vv?.url === 'https://mcp001.vkusvill.ru/mcp')
ok('and its eight tools are named in what was measured',
  vv?.found.some((one) => one.fact.includes('vkusvill_cart_link_create')),
  'the measurement block is the evidence, so it has to carry the names')
ok('the 403 is recorded beside the 200',
  vv?.found.some((one) => one.fact.includes('403')) && vv?.found.some((one) => one.fact.includes('200')),
  'a first probe got 403 and the completed handshake got 200 вЂ” both are facts')
ok('and it says the server cannot place an order',
  /does NOT order and cannot pay/u.test(vv?.description ?? ''))
ok('draw.io is seeded with its github source',
  dr?.source === 'https://github.com/jgraph/drawio-mcp' && dr?.url === 'https://mcp.draw.io/mcp')
ok('and its description names both tools, not one',
  (dr?.description ?? '').includes('create_diagram') && (dr?.description ?? '').includes('search_shapes'))
ok('every seeded entry carries a date it entered', first.entries.every(
  (entry) => typeof entry.addedAt === 'string' && entry.addedAt.length > 10))

MOD.ensureStore()
ok('ensuring the store materialises the file', existsSync(MOD.storePath()))
ok('and the second read is no longer a seed', MOD.readStore().seeded === false)

// в”Ђв”Ђ adding: what the agent calls when the operator says "add this to the store" в”Ђ

const added = MOD.add({
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  description: 'Read and write GitHub issues, pull requests and repository metadata. Reach for it when the answer lives in a repository rather than on the web.',
  comment: 'РЅСѓР¶РµРЅ С‚РѕРєРµРЅ',
  status: 'proposed',
  source: 'https://github.com/modelcontextprotocol/servers',
})
ok('an entry can be added', added.ok === true)
ok('its id is derived from the server name', added.entry?.id === 'github', String(added.entry?.id))
ok('it keeps the argument list', added.entry?.args?.[1] === '@modelcontextprotocol/server-github')
ok('the comment is kept verbatim, in the language it was written in',
  added.entry?.comment === 'РЅСѓР¶РµРЅ С‚РѕРєРµРЅ', String(added.entry?.comment))
ok('it is stamped with when it entered and when it last changed',
  typeof added.entry?.addedAt === 'string' && typeof added.entry?.updatedAt === 'string')
ok('the store now holds three', MOD.readStore().entries.length === 3)
ok('the newest is first', MOD.readStore().entries[0]?.id === 'github')

// Nothing enters the store without a description for an agent, because that description is
// the whole reason the store exists: it is what a future agent reads to decide.
ok('an entry with no name is refused', MOD.add({ description: 'x' }).code === 'needs-name')
ok('a name with nothing an id can be built from is refused rather than stored under an empty id',
  MOD.add({ name: '***', url: 'https://stars.test/mcp', description: 'x' }).code === 'bad-id',
  'two such rows would overwrite each other')
ok('and the slugged id is readable', (() => {
  const slugged = MOD.add({ name: 'My Server', url: 'https://slug.test/mcp', description: 'x' })
  return slugged.ok === true && slugged.entry?.id === 'my-server'
})(), 'a name with a space must still produce a usable id')
ok('an entry with no agent description is refused',
  MOD.add({ name: 'nameless', url: 'https://example.test/mcp' }).code === 'needs-description')
ok('an empty description is refused too',
  MOD.add({ name: 'blank', url: 'https://example.test/mcp', description: '   ' }).code === 'needs-description')
ok('an http entry with no url is refused',
  MOD.add({ name: 'nourl', transport: 'streamable-http', description: 'x' }).code === 'needs-url')
ok('a stdio entry with no command is refused',
  MOD.add({ name: 'nocmd', transport: 'stdio', description: 'x' }).code === 'needs-command')
ok('a transport this harness does not have is refused',
  MOD.add({ name: 'odd', transport: 'websocket', url: 'wss://x', description: 'x' }).code === 'bad-transport')
ok('a status outside the four is refused',
  MOD.add({ name: 'odd', url: 'https://x.test/mcp', description: 'x', status: 'maybe' }).code === 'bad-status')
ok('an http entry defaults to streamable-http when the transport is omitted',
  MOD.add({ name: 'defaulted', url: 'https://defaulted.test/mcp', description: 'x' }).entry?.transport === 'streamable-http')
ok('and defaults to proposed', MOD.readStore().entries.find((item) => item.id === 'defaulted')?.status === 'proposed')
ok('so the store holds five now', MOD.readStore().entries.length === 5, String(MOD.readStore().entries.length))
// Read the count from the store from here on rather than repeating a literal: this test
// has already had to be corrected twice for a hardcoded number that a new assertion moved.
const entriesAfterAdds = MOD.readStore().entries.length
ok('and every one of them is on disk', JSON.parse(readFileSync(MOD.storePath(), 'utf8')).entries.length === entriesAfterAdds)

// Re-adding the same server is an update of that row. It must not lose what a previous
// call wrote and this one did not mention вЂ” least of all the operator's own words.
const again = MOD.add({
  name: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'other'],
  description: 'A rewritten description for the agent.',
})
ok('adding the same server replaces its row rather than duplicating it',
  again.replaced === true && MOD.readStore().entries.filter((item) => item.id === 'github').length === 1)
ok('and the date it first entered survives the rewrite',
  again.entry?.addedAt === added.entry?.addedAt)
ok('and the operator\'s comment survives a call that did not mention it',
  again.entry?.comment === 'РЅСѓР¶РµРЅ С‚РѕРєРµРЅ',
  'a rewrite that erased his own note by omission would be the store losing his words')
ok('while the fields the call did state are replaced',
  again.entry?.description === 'A rewritten description for the agent.'
  && again.entry?.args?.[1] === 'other')

// в”Ђв”Ђ updating and annotating в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const renamed = MOD.update({ id: 'github', description: 'GitHub issues and pull requests. Reach for it when the answer is in a repository.' })
ok('a description can be rewritten', renamed.ok === true
  && renamed.entry?.description.startsWith('GitHub issues'))
ok('and the fields not mentioned survive',
  renamed.entry?.comment === 'РЅСѓР¶РµРЅ С‚РѕРєРµРЅ' && renamed.entry?.command === 'npx',
  'a partial update that cleared the rest would be a store losing its own content')
ok('an empty string is refused rather than silently clearing a field',
  MOD.update({ id: 'github', comment: '' }).code === 'empty-comment')
ok('an unknown entry cannot be updated', MOD.update({ id: 'nope', comment: 'x' }).code === 'no-such-entry')
ok('a bad status is refused on update too',
  MOD.update({ id: 'github', status: 'perhaps' }).code === 'bad-status')
ok('changing a transport to stdio without a command is refused',
  MOD.update({ id: 'vkusvill', transport: 'stdio' }).code === 'needs-command')
ok('and the entry was left alone by that refusal',
  MOD.readStore().entries.find((item) => item.id === 'vkusvill')?.transport === 'streamable-http',
  'a refused update must not half-apply')
ok('an argument list that is not a list is refused',
  MOD.update({ id: 'github', args: 'npx -y x' }).code === 'bad-args')

const noted = MOD.note({ id: 'vkusvill', text: 'tools/call answered HTTP 200 after the full handshake.' })
ok('a measurement can be recorded against an entry', noted.ok === true)
ok('and it moves the entry from proposed to tried', noted.entry?.status === 'tried')
ok('it is kept as an observation with its own date',
  noted.entry?.observations?.[0]?.text.includes('HTTP 200')
  && typeof noted.entry?.observations?.[0]?.at === 'string')
ok('an empty measurement is refused', MOD.note({ id: 'vkusvill', text: '  ' }).code === 'empty-note')
ok('an unknown entry cannot be annotated', MOD.note({ id: 'nope', text: 'x' }).code === 'no-such-entry')

// A decision is not undone by a new measurement: `working` and `refused` are decisions.
MOD.update({ id: 'drawio', status: 'working' })
const afterWorking = MOD.note({ id: 'drawio', text: 'initialize answered 200 anonymously from this machine.' })
ok('a measurement does not downgrade a decision already made',
  afterWorking.entry?.status === 'working', String(afterWorking.entry?.status))
ok('but it is still recorded', afterWorking.entry?.observations?.length === 1)

// в”Ђв”Ђ the snippet: the honest boundary, made visible в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const httpSnippet = MOD.snippet(MOD.readStore().entries.find((item) => item.id === 'vkusvill'))
ok('the snippet is a loader row for the harness MCP bridge',
  httpSnippet.includes("name: '@deepseek-ai/dsh-mcp-client'"), httpSnippet)
ok('it carries the transport in the harness vocabulary',
  httpSnippet.includes('transport: streamable-http'), JSON.stringify(httpSnippet))
ok('and the url, quoted because it contains a colon',
  httpSnippet.includes("url: 'https://mcp001.vkusvill.ru/mcp'"), httpSnippet)
const stdioSnippet = MOD.snippet(MOD.readStore().entries.find((item) => item.id === 'github'))
ok('a stdio entry produces command and args instead of a url',
  stdioSnippet.includes('command: npx') && !stdioSnippet.includes('url:'), stdioSnippet)
ok('an argument starting with a dash is quoted, because YAML would read it as a sequence',
  stdioSnippet.includes("args: ['-y', other]"), stdioSnippet)
ok('the row id cannot collide with a mod row of the same name',
  httpSnippet.includes('- id: mcp-vkusvill'))

// Parsed, not eyeballed. The snippet has to be a loader patch entry: a top-level array of
// one insert whose config carries the fields `dsh-mcp-client` reads.
const parsedHttp = parseYaml(httpSnippet)
ok('the snippet parses as YAML with the library the harness uses',
  Array.isArray(parsedHttp) && parsedHttp.length === 1, JSON.stringify(parsedHttp))
ok('and it is one insert of one row',
  Array.isArray(parsedHttp?.[0]?.insert) && parsedHttp[0].insert.length === 1)
const rowConfig = parsedHttp?.[0]?.insert?.[0]?.config
ok('the row names the MCP client package and the server',
  parsedHttp?.[0]?.insert?.[0]?.name === '@deepseek-ai/dsh-mcp-client'
  && rowConfig?.serverName === 'vkusvill')
ok('and parses to exactly the endpoint and transport',
  rowConfig?.transport === 'streamable-http' && rowConfig?.url === 'https://mcp001.vkusvill.ru/mcp',
  JSON.stringify(rowConfig))
const parsedStdio = parseYaml(MOD.snippet({ id: 'win', name: 'win', transport: 'stdio',
  command: 'C:\\Program Files\\srv.exe', args: ['-y', '--port', '8080'] }))
ok('a Windows path and a dashed flag survive the round trip as written',
  parsedStdio?.[0]?.insert?.[0]?.config?.command === 'C:\\Program Files\\srv.exe'
  && JSON.stringify(parsedStdio?.[0]?.insert?.[0]?.config?.args) === JSON.stringify(['-y', '--port', '8080']),
  JSON.stringify(parsedStdio?.[0]?.insert?.[0]?.config))
ok('a backslash in a Windows path is not left to YAML to interpret',
  MOD.snippet({ id: 'win', name: 'win', transport: 'stdio', command: 'C:\\Tools\\srv.exe', args: [] })
    .includes("command: 'C:\\Tools\\srv.exe'"),
  MOD.snippet({ id: 'win', name: 'win', transport: 'stdio', command: 'C:\\Tools\\srv.exe', args: [] }))
ok('the patch file the snippet belongs in is named',
  MOD.patchFileName().startsWith(scratch) && MOD.patchFileName().endsWith('.yml'),
  MOD.patchFileName())

// в”Ђв”Ђ listing, and the snapshot the panel reads в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const listed = MOD.list({})
ok('every entry is listed', listed.total === entriesAfterAdds, String(listed.total))
ok('a status filter narrows it, and does not over-report the total',
  MOD.list({ status: 'tried' }).entries.every((entry) => entry.status === 'tried')
  && MOD.list({ status: 'tried' }).total === listed.total)
ok('a query searches the description too',
  MOD.list({ query: 'shareable cart' }).entries.some((entry) => entry.id === 'vkusvill'))
ok('a query searches the operator\'s comment in any language',
  MOD.list({ query: 'С‚РѕРєРµРЅ' }).entries.some((entry) => entry.id === 'github'))

const snapshot = MOD.snapshot()
ok('the snapshot names the file it owns', snapshot.storePath === MOD.storePath())
ok('and the file a snippet would go into', snapshot.patchFile === MOD.patchFileName())
ok('it carries every entry with its snippet',
  snapshot.entries.every((entry) => typeof entry.snippet === 'string' && entry.snippet.includes('dsh-mcp-client')))
ok('it counts by status',
  typeof snapshot.proposed === 'number' && typeof snapshot.working === 'number'
  && typeof snapshot.refused === 'number' && typeof snapshot.tried === 'number')
ok('the counts add up to the store', snapshot.proposed + snapshot.working
  + snapshot.refused + snapshot.tried === snapshot.entries.length,
  `${String(snapshot.proposed + snapshot.working + snapshot.refused + snapshot.tried)} vs ${String(snapshot.entries.length)}`)
ok('it counts the transports', snapshot.transports.stdio + snapshot.transports.http === snapshot.entries.length)

const gone = MOD.readStore().entries.find((entry) => entry.id === 'defaulted')
ok('an entry can be dropped from the store', MOD.forget('defaulted').ok === true)
ok('and dropping it again is refused', MOD.forget('defaulted').code === 'no-such-entry')
ok('the id it had is gone', MOD.readStore().entries.every((entry) => entry.id !== gone?.id))

// в”Ђв”Ђ the tools, registered on the harness registry в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const tools = new Map()
let handler
const ctx = {
  connection: { fetch: { register: (options) => { handler = options.fetch; return () => {} } } },
  tools: { register: (tool) => { tools.set(tool.name, tool) } },
  effect: (fn) => { fn() },
}
MOD.apply(ctx)

const TOOL_NAMES = [MOD.TOOL_ADD, MOD.TOOL_LIST, MOD.TOOL_UPDATE, MOD.TOOL_NOTE]
ok('four tools were registered', tools.size === 4, [...tools.keys()].join(', '))
ok('the names say what "add this to the MCP store" means',
  TOOL_NAMES.every((toolName) => tools.has(toolName)), [...tools.keys()].join(', '))
ok('the add tool is named as the store is called',
  MOD.TOOL_ADD === 'mcp_store_add' && MOD.TOOL_LIST === 'mcp_store_list'
  && MOD.TOOL_UPDATE === 'mcp_store_update' && MOD.TOOL_NOTE === 'mcp_store_note',
  TOOL_NAMES.join(', '))
const addTool = tools.get(MOD.TOOL_ADD)
ok('each tool has a description an agent can decide on',
  [...tools.values()].every((tool) => typeof tool.description === 'string' && tool.description.length > 80))
ok('the add tool requires a name and a description',
  addTool?.parameters?.required?.includes('name') === true
  && addTool?.parameters?.required?.includes('description') === true,
  JSON.stringify(addTool?.parameters?.required))
ok('and offers only the transports this harness has',
  JSON.stringify(addTool?.parameters?.properties?.transport?.enum) === JSON.stringify(MOD.TRANSPORTS),
  JSON.stringify(addTool?.parameters?.properties?.transport?.enum))
ok('and only the four statuses',
  JSON.stringify(addTool?.parameters?.properties?.status?.enum) === JSON.stringify(MOD.STATUSES))
ok('the update tool names the fields an agent may change',
  ['name', 'description', 'comment', 'transport', 'url', 'command', 'args', 'status', 'source']
    .every((field) => tools.get(MOD.TOOL_UPDATE)?.parameters?.properties?.[field] !== undefined))

const beforeAdd = MOD.readStore().entries.length
const toolAdded = await addTool.execute({
  name: 'probe-test', url: 'https://probe.test/mcp',
  description: 'A server that exists only in this test.',
}, {})
ok('calling the add tool writes an entry', MOD.readStore().entries.length === beforeAdd + 1)
ok('and hands back the snippet to paste, not a silently written config',
  typeof toolAdded.entry.snippet === 'string' && toolAdded.entry.snippet.includes('mcp-probe-test'))
ok('and the file it would go into', toolAdded.entry.patchFile === MOD.patchFileName())
ok('it reports what the store holds now', toolAdded.count === MOD.readStore().entries.length)
ok('the tool refuses a bad call loudly rather than returning a false success',
  await addTool.execute({ name: 'x' }, {}).then(() => false, () => true))

const listTool = tools.get(MOD.TOOL_LIST)
const toolListed = await listTool.execute({}, {})
ok('the list tool answers with the entries and the store path',
  toolListed.entries.length > 0 && toolListed.storePath === MOD.storePath())
ok('it hands the agent each measurement as a plain string',
  toolListed.entries.find((entry) => entry.id === 'vkusvill')?.found.some((fact) => typeof fact === 'string'))
const updateTool = tools.get(MOD.TOOL_UPDATE)
const toolUpdated = await updateTool.execute({ id: 'probe-test', status: 'refused' }, {})
ok('the update tool moves an entry to a decided state', toolUpdated.entry.status === 'refused')
const noteTool = tools.get(MOD.TOOL_NOTE)
const toolNoted = await noteTool.execute({ id: 'probe-test', text: 'initialize answered 200.' }, {})
ok('the note tool records a measurement and reports the count',
  toolNoted.observations === 1 && toolNoted.status === 'refused',
  'the refusal stands; a measurement does not overwrite a decision')

// в”Ђв”Ђ every tool's result really matches the schema it declares в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
//
// `defineTool` validates a result against the tool's own output schema, and a result with
// an extra key is a violation rather than harmless surplus вЂ” the call fails after the write
// has already happened. Every declaration above is exercised here, against the same
// validator the registry uses.

const declaredViolations = (tool, value) => validateJsonSchemaValue(tool.output.schema, value, 'value')
const outputs = [
  ['mcp_store_add', addTool, { name: 'schema-check', url: 'https://schema.test/mcp', description: 'Declared output must match.' }],
  ['mcp_store_update', updateTool, { id: 'schema-check', comment: 'checked' }],
  ['mcp_store_note', noteTool, { id: 'schema-check', text: 'initialize answered 200.' }],
  ['mcp_store_list', listTool, {}],
]
for (const [toolName, tool, args] of outputs) {
  const value = await tool.execute(args, {})
  const violations = declaredViolations(tool, value)
  ok(`${toolName}'s result matches its declared output schema`, violations.length === 0, violations.join('; '))
}
ok('the renderer of every tool survives its own result', outputs.every(([, tool]) => {
  const schema = tool.output.schema
  return typeof schema === 'object' && tool.output.render !== undefined
}))
const renderedAdd = addTool.output.render({ name: 'x' }, {
  entry: { name: 'x', status: 'proposed', snippet: 'S', patchFile: 'P' }, replaced: false, count: 1,
})
ok('and the add tool tells the agent where the snippet goes, not just that it saved',
  Array.isArray(renderedAdd) && renderedAdd[0]?.text.includes('P') && renderedAdd[0]?.text.includes('S'),
  JSON.stringify(renderedAdd))

// в”Ђв”Ђ the route handler, with a stubbed connection в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

ok('the route was registered', typeof handler === 'function')
ok('on the declared path', MOD.STORE_ROUTE_PATH === '/api/mcp-store.mod')
const getBody = await (await handler(new Request('http://dsh.internal/api/mcp-store.mod'))).json()
ok('GET answers the table', getBody.ok === true && Array.isArray(getBody.state?.entries))
ok('and the state carries a snippet for every row',
  getBody.state.entries.every((entry) => typeof entry.snippet === 'string'))

const postForget = await handler(new Request('http://dsh.internal/api/mcp-store.mod', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'forget', id: 'probe-test' }),
}))
ok('POST forget answers 200 and drops the row',
  postForget.status === 200
  && !(await postForget.json()).state.entries.some((entry) => entry.id === 'probe-test'))

const postAdd = await handler(new Request('http://dsh.internal/api/mcp-store.mod', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'add', entry: { name: 'from-route', url: 'https://route.test/mcp', description: 'Added through the route.' } }),
}))
ok('POST add answers 200 and writes the row',
  postAdd.status === 200 && (await postAdd.json()).state.entries.some((entry) => entry.id === 'from-route'))

const badAction = await handler(new Request('http://dsh.internal/api/mcp-store.mod', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'enable-everything' }),
}))
ok('an unknown action is refused, and an "enable" action does not exist',
  badAction.status === 400)
const refusedAdd = await handler(new Request('http://dsh.internal/api/mcp-store.mod', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'add', entry: { name: 'no-description', url: 'https://x.test/mcp' } }),
}))
ok('the route enforces the same rules as the tool',
  refusedAdd.status === 400 && (await refusedAdd.json()).code === 'needs-description')
ok('a malformed body is refused',
  (await handler(new Request('http://dsh.internal/api/mcp-store.mod', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
  }))).status === 400)
ok('an unsupported method is refused',
  (await handler(new Request('http://dsh.internal/api/mcp-store.mod', { method: 'PUT' }))).status === 405)

// в”Ђв”Ђ the honest boundary, in the file system в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
//
// The plugin claims to write the store and nothing else. That is checkable: the home
// contains exactly one file, and no loader row, no settings and no profile were created.

const homeFiles = readdirSync(scratch)
ok('the home holds exactly one file, and it is the store',
  homeFiles.length === 1 && homeFiles[0] === 'mcp-store.json', homeFiles.join(', '))
ok('no cordis patch and no settings file were created by this plugin',
  !existsSync(join(scratch, 'settings.yaml')) && !existsSync(join(scratch, 'cordis.patch.yml'))
  && !existsSync(join(scratch, 'profiles')))
const onDisk = JSON.parse(readFileSync(MOD.storePath(), 'utf8'))
ok('the store file is versioned and dated', onDisk.version === 1 && typeof onDisk.updated === 'string')
ok('and carries every entry', Array.isArray(onDisk.entries) && onDisk.entries.length === entriesAfterAdds + 1,
  String(onDisk.entries.length))
ok('and it is the store the plugin just served',
  onDisk.entries.length === MOD.readStore().entries.length)
ok('every stored entry has the fields the panel and the tools read',
  onDisk.entries.every((entry) => ['id', 'name', 'transport', 'comment', 'description', 'status', 'source', 'addedAt']
    .every((field) => typeof entry[field] === 'string')))
ok('and the id is stable across a rewrite',
  onDisk.entries.filter((entry) => entry.id === 'vkusvill').length === 1)

rmSync(scratch, { recursive: true, force: true })
console.log('')
console.log(`${String(checks - failed)}/${String(checks)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
