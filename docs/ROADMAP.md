# Roadmap

**English** · [Русский](ROADMAP.ru.md)

Mod ideas that are not built yet, kept here so they survive a session. Nothing
in this file is a promise: an idea is listed with what is known about it, and
"needs discovery" means exactly that — nobody has checked yet whether the
platform allows it.

Built and shipped: the system-prompt editor (`packages/system-prompt-mod`), the
Russian language pack (`packages/locale-ru`), and the mod manager
(`packages/mod-manager`).

## Verified to be possible

Each of these rests on an API this repository already uses successfully:
`ctx.systemPrompt.section`, `ctx.connection.fetch.register`,
`ctx.locale.addLanguage`, and `ctx.slots.register` into a declared slot.

### A prompt library

One named prompt per use — "review", "refactor", "translate" — switched from a
dropdown instead of overwriting a single override. Import and export as files,
and a diff between two saved versions.

*Why it is easy:* it is the existing prompt mod with a list in front of it. The
store is already a JSON file in the Harness home.
*Risk:* low. The prompt mod already proves the section and the route.

### Project memory

A `MEMORY.md` in the workspace that is injected as a prompt section and edited
from the GUI, so a project's conventions travel with the project rather than
with the deployment.

*Why it is easy:* `section({ text })` re-evaluates its provider at every
assembly, so the file can be re-read per request.
*Risk:* low, with one design question — which directory counts as "the project"
when the GUI has several workspaces open.

### Context breakdown

Show what the assembled prompt is made of: which section contributes how many
characters, where the base ends and the override begins.

*Why it is easy:* `assemble()` is already called by the prompt mod, and
`renderPrompt` is already imported.
*Risk:* low. Needs a clear presentation more than new capability.

### More languages

`uk`, `de`, `es`, `zh` along the existing pipeline: `tools/extract-locale.mjs`,
`tools/locale-chunk.mjs`, `tools/build-locale.mjs`, and the contract test.

*Why it is easy:* the tooling is finished and the contract test already passes
for a second language.
*Risk:* low technically, high in volume — and translation quality can only be
judged by eye, which this repository admits rather than measures.

### Theme and density

Accent colour, a compact mode, a font size that suits long sessions. Client CSS
only.

*Risk:* low, and cosmetic — worth it only if the default look is actually in the
way.

## Needs discovery first

Not refused, not promised. Each needs a look at the DSH client and host bundles
before anyone can say whether it is possible.

| Idea | What must be checked |
|---|---|
| Slot inspector — what registered what, and where | Whether `ctx.slots` can enumerate its own slots and owners. `dsh-client-ui-settings-plugin-inventory` already shows part of this, so the question may be whether anything is left to add |
| Custom slash commands and snippets | The contract of `conversation.input.overlay` and `dsh-client-ui-input-trigger`, and whether a third-party entry can insert text into the composer |
| Session templates | Whether a session can be created with a preset model, prompt and workspace, and from where |
| Secret guard — warn when a tool reads credentials or writes something key-shaped | Whether tool calls can be intercepted at all. If they cannot, this idea is dead rather than hard |
| Agent action audit — what the agent did, exported to a repository | Overlaps `dsh-client-ui-trajectory` and `dsh-session-log-export`; the question is what those do not already provide |
| Notifications when a long job finishes | Straightforward outbound HTTP, but it needs a credential, and this repository's rule is that it stores none |
| Git helper — status, commit and push from the GUI | Running `git` from the host half is possible; the design work is identity, credentials and not committing secrets by accident |

## Deliberately not planned

- Anything that edits the DSH installation itself. Mods live in the Harness home
  and are removed by deleting them.
- Anything that duplicates a shipped plugin: model selection, permission presets,
  attachments, skills, subagents, jobs, plans, approvals, session export.
