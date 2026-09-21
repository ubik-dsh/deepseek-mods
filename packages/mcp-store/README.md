# MCP store

A harness plugin adding an **MCP store** tab to *Settings → Plugins*, one step after the
skill **Collection**. It is a **registry of MCP servers** — what each one is, what it gives
an agent, and whether it is worth reaching for — and it is a table with three columns:

| Server | Comment | Mini-description for the agent |
|---|---|---|
| the short unique name, which becomes the tool namespace `mcp__<name>__<tool>` | the operator's own note, free text, in whatever language he writes | one or two sentences **written for an agent**: what this server gives and when to reach for it |
| `vkusvill` · proposed | ВкусВилл, свой MCP. Без ключей. | Product lookup for VkusVill: search, details by id or barcode, analogs, discounts, shops, recipes, and a shareable cart link. It does NOT order and cannot pay. |

The third column is the one that matters. It is the string a future agent reads when it
decides whether this server is worth the tokens, so an entry without one is refused.

## It is a registry, not a configuration

**This plugin never writes the harness's MCP configuration.** A server is loaded by a loader
row in the profile's patch layer, and writing that file changes what every later session can
call — a different act from keeping a note about a server, with a different blast radius.
A store that quietly enabled its own entries would make every row a decision nobody took.

Instead, the panel **shows the exact rows to paste and the exact file they go into**, and
the operator pastes them. The snippet is computed by the host half, returned by the tools,
and displayed in a read-only box: it is text a person moves, never a write this code makes.

For the same reason the panel can remove a row and has no button that adds one: what a
person can do by clicking is *forget*, and what the agent can do is *record*.

## Where the snippet goes

This is what was found on this machine, stated as a finding rather than a rule:

- `dsh-mcp-client` (`@deepseek-ai/dsh-mcp-client`) bridges external MCP servers into native
  harness tools, named `mcp__<serverName>__<rawName>`. Its README says it is configured by a
  loader row with `serverName`, `transport` (`stdio` or `streamable-http`), and either
  `command` + `args` or `url`.
- The operator's live patch layer is `$DSH_HOME/profiles/web/cordis.patch.yml`, and it
  holds **no MCP row today** — so nothing from this store is loaded, and every entry is
  honestly `proposed`.
- The store's snippet is written for that file. `settings.yaml` was also checked and holds
  no `mcp` key at all, so it is **not** where this harness reads its servers from.

If a future version reads MCP servers from somewhere else, the snippet is the one thing
here that needs changing, and it is one function.

## The schema

One file in the harness home, `$DSH_HOME/mcp-store.json`, with the same versioning shape as
the sibling catalogue:

```json
{
  "version": 1,
  "updated": "2026-09-21T15:57:51.878Z",
  "entries": [
    {
      "id": "vkusvill",
      "name": "vkusvill",
      "transport": "streamable-http",
      "url": "https://mcp001.vkusvill.ru/mcp",
      "command": "",
      "args": [],
      "comment": "ВкусВилл, свой MCP. Без ключей.",
      "description": "Product lookup for VkusVill: search, details by id or barcode, ...",
      "status": "proposed",
      "source": "https://mcp001.vkusvill.ru/mcp",
      "addedAt": "2026-09-21T15:00:00.000Z",
      "updatedAt": "2026-09-21T15:00:00.000Z",
      "found": [{ "at": "2026-09-21", "fact": "initialize and tools/list answer anonymously, HTTP 200." }],
      "observations": []
    }
  ]
}
```

| field | what it is |
|---|---|
| `id` | stable and readable; derived from the name, and never changes with it |
| `name` | the short unique name, which becomes the `mcp__<name>__<tool>` namespace |
| `transport` | `stdio` or `streamable-http` — the two the harness bridge accepts |
| `url` / `command` + `args` | the endpoint for http, the executable and its arguments for stdio |
| `comment` | the operator's own note, kept verbatim, never translated or rewritten |
| `description` | **for an agent**, not for a person. Required. |
| `status` | `proposed` · `tried` · `working` · `refused` |
| `source` | a link to where it came from |
| `addedAt` | when it entered. A store with no dates is a pile. |
| `found` | dated **measurements** — what an endpoint answered, from this machine |
| `observations` | dated measurements added later, newest first |

`found` and `observations` are the difference between a store and a wish list: a claim about
what a server does is only worth what was measured, and the date says when.

## The tools the agent calls

Four tools, registered on the harness tool registry, so *"add this to the MCP store"* in the
chat has somewhere to land.

| tool | what it does |
|---|---|
| `mcp_store_add` | records one server. Requires `name` and an agent-facing `description`; refuses a transport the harness does not have, a url-less http entry, and a command-less stdio entry |
| `mcp_store_list` | every entry with its description, status, measurements and the snippet it would become. Read this **before** hunting for a server |
| `mcp_store_update` | changes the fields given and **leaves the others alone**; refuses an empty string rather than silently clearing a field |
| `mcp_store_note` | records what a server actually answered, dated, appended. `proposed` becomes `tried`; a `working` or `refused` entry keeps the decision it already carries |

Every result is validated against its declared output schema, because a result the registry
rejects fails *after* the write has happened.

## The states

| status | meaning | colour |
|---|---|---|
| `proposed` | written down, never run here | neutral |
| `tried` | run, and the result is not a verdict yet | amber |
| `working` | measured working from this machine | green |
| `refused` | a decision against it, with a reason in the measurements | red |

`working` and `refused` are decisions, and a new measurement does not quietly undo either —
that is why only `proposed` is advanced automatically.

## What is in it on first run

A first run seeds the two servers found on **2026-09-21**, both `proposed`, because nothing
in this harness has loaded either one:

| | |
|---|---|
| **VkusVill** — `https://mcp001.vkusvill.ru/mcp` | Eight tools: `vkusvill_products_search`, `vkusvill_product_details`, `vkusvill_product_barcode`, `vkusvill_product_analogs`, `vkusvill_products_discount`, `vkusvill_shops`, `vkusvill_recipes`, and `vkusvill_cart_link_create`. It does **not** place orders and cannot pay — the last step is a cart link the human opens. `initialize` and `tools/list` answer anonymously; `tools/call` for a product search answered **HTTP 200** with real data, but only after the full handshake. A first probe that skipped the `notifications/initialized` note got **HTTP 403**, and that is recorded beside the 200 so a later reader can tell a protocol mistake from a credential wall. |
| **draw.io** — `https://mcp.draw.io/mcp` | The official `jgraph/drawio-mcp` server. `create_diagram` renders draw.io XML inline in chat and `search_shapes` finds the right style string among 10,000+ library shapes. Inline rendering needs a host that implements the MCP Apps extension; where it is absent the tool returns the XML as text. Diagrams sent to the hosted endpoint leave the machine. The same repository also publishes a stdio server (`npx @drawio/mcp`) that opens diagrams in the draw.io editor. |

## Refreshing, and what needs what

| what changes | what it needs |
|---|---|
| an entry, its status, a measurement, the snippet | **nothing** — written and read live |
| installing this plugin for the first time | the page reloaded (F5) |
| updating an already-installed copy | `dsh web` restarted |
| actually loading a server | the operator pastes the snippet into the patch file, then restarts |

## What the tab does not do

- **It does not load a server.** See above: it hands over the rows to paste.
- **It does not test a server.** Probing an endpoint from a browser button would put an
  outbound call behind a click; an agent does that and records the result with
  `mcp_store_note`.
- **It does not translate the comment.** Your note is your note.
