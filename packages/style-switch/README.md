# style-switch

A control in the chat header for choosing **how the agent should think on the next request**.

| Style | What it contributes to the system prompt |
|---|---|
| **DSH** | **Nothing.** No prompt section is registered, so the prompt is exactly the one the harness ships. |
| **КОДЕКС** | The concise style: answer first, then a short proof; branches of cases instead of a full enumeration; nothing beyond the question; a table or 5–10 lines. |

**Why this exists.** The same puzzle, the same DeepSeek model, two harnesses: our way took
7 min 24 s and 306K tokens, the Codex desktop client took 2 min 14 s. Both answers were
correct. The difference was the *amount of work*, not the quality of thought — so the amount
is now something the user picks, with a button, instead of something the prompt decides.

**The `DSH` style is deliberately empty.** "Reproduce the default" cannot be implemented by
adding text that changes nothing; it is implemented by contributing nothing at all, so the
prompt is byte-for-byte the shipped one.

## What it is made of

```
packages/style-switch/
  package.json
  lib/index.js     host half   — the prompt section and the /api route
  lib/client.js    browser half — the header control and the dialog
```

- **Host** registers a system-prompt section whose text provider is re-evaluated at every
  assembly, so a switch reaches the next model request with no restart. It is registered only
  while the chosen style contributes text.
- **Host** also owns `GET`/`POST /api/style-switch.mod` on the authenticated Connection
  channel the Web GUI already speaks.
- **Browser** registers one control into `conversation.session.header.utilities` and shows
  every offered style as a card, with the text the chosen style actually adds.

State lives in `$DSH_HOME/style-switch.json`. An unreadable or unknown value falls back to
`dsh`, so a corrupt file costs a preference, not the interface.

## Install

```bash
node tools/install.mjs            # from the repository root
node tools/boot-check.mjs         # is the package in the served boot graph?
```

The style section text is live, but **a changed package file needs a restart of `dsh web`** —
the loader imports a module once per process.

## Verify

```bash
node tools/dev/test-style-switch.mjs          # host half, with a fake ctx
node tools/dev/test-style-switch-client.mjs   # browser bundle, with a stub loader
```

See [README.ru.md](README.ru.md) for the Russian version.
