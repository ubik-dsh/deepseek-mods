# Agent instructions

This repository contains **mods (plugins) for DeepSeek Harness (DSH)**. If you
are an AI agent working here, read this first.

## What you are working with

- `packages/system-prompt-mod/` — a dual-face plugin (host + browser): a chat
  header control that shows and edits the live system prompt.
- `packages/locale-ru/` — a browser-only plugin: the Russian language pack.
- `packages/mod-manager/` — a dual-face plugin: a Settings tab that lists
  installed mods and turns them off, on, or removes them.
- `packages/skill-manager/` — a dual-face plugin: a Settings tab that lists the
  skills this Harness resolves, gives each a model-facing description and a
  one-line human summary, and pauses or resumes it by renaming the file DSH reads.
- `tools/` — installer, verifier, builders, and `tools/lib/session-cookie.mjs`,
  the single place that mints the browser-session cookie. No absolute paths.
- `tools/dev/` — development and verification harness. **Machine-specific paths
  live here**; the Windows/Edge scripts are not portable.

## Task-specific guides

| The user asks for | Read |
|---|---|
| "install these mods" | [`docs/AI-INSTALL.md`](docs/AI-INSTALL.md) (RU: `docs/AI-INSTALL.ru.md`) |
| "make me a mod" | [`docs/AI-PROMPT.md`](docs/AI-PROMPT.md) (RU: `docs/AI-PROMPT.ru.md`) |
| "how do I publish this" | [`docs/PUBLISH.md`](docs/PUBLISH.md) |

## Rules that override convenience

1. **Never edit the DSH installation.** Mods are separate packages installed into
   the Harness home (`$DSH_HOME`, default `~/.dsh`).
2. **Never restart the user's `dsh web` process unasked**, and never kill the
   process you are running inside. A changed package file needs a restart to
   take effect — hand the user the command.
3. **Never commit or print secrets.** `$DSH_HOME/.credentials.yaml` holds API
   keys and the browser-session signing secret.
4. **Verify with evidence.** Run `node tools/boot-check.mjs` or
   `node tools/dev/verify-live.mjs` (both need a running `dsh web`) or a unit
   test; do not report success from reading code.
5. **Keep both languages in sync.** Every user-facing document exists as
   `X.md` (English) and `X.ru.md` (Russian).

## Cheat sheet

```bash
node tools/install.mjs                 # install every package in packages/
node tools/install.mjs --dry-run       # preview
node tools/install.mjs --uninstall     # remove packages and their rows
node tools/boot-check.mjs              # is each mod in the served boot graph?
node tools/build-locale.mjs            # rebuild the language bundle from i18n/
node tools/extract-locale.mjs          # re-read dictionaries from a DSH install
node tools/dev/link-dsh.mjs            # make @deepseek-ai/* resolvable for tests
node tools/dev/test-host.mjs           # prompt mod, host half
node tools/dev/test-client.mjs         # prompt mod, browser bundle
node tools/dev/test-locale-ru.mjs      # language pack contract
node tools/dev/test-links.mjs          # markdown links and anchors
node tools/dev/test-mod-manager.mjs    # mod manager, host half
node tools/dev/test-mod-manager-client.mjs  # mod manager, browser bundle
node tools/dev/test-skill-manager.mjs       # skill manager, host half
node tools/dev/scan-secrets.mjs        # secrets in tracked names, blobs, and on disk
node tools/dev/verify-live.mjs         # live HTTP checks against a running GUI
node tools/dev/push-mirrors.mjs        # push to every published mirror
```

## Editing cautions

- `packages/locale-ru/lib/client.js` is **generated**. Edit
  `packages/locale-ru/i18n/ru/*.json` and rebuild.
- The browser bundles are hand-written in the lazy-CJS form
  `window.__ModuleLoader__.load({ id, factory })`. `id` must equal the package
  name. Only nine baseline modules may be `require`d — see
  [`docs/AI-PROMPT.md`](docs/AI-PROMPT.md) Phase 3.
- On Windows, PowerShell 5.1 corrupts UTF-8 when a script does
  `Get-Content -Raw` + `Set-Content`. Use a UTF-8-aware tool and verify the
  encoding after any bulk rewrite.

---

Кратко по-русски: это репозиторий модов для DSH. Не правь установку DSH, не
перезапускай `dsh web` без разрешения, не коммить секреты, проверяй результат
командой `tools/boot-check.mjs`, держи документацию на двух языках.
Инструкция по установке — `docs/AI-INSTALL.ru.md`, по созданию мода —
`docs/AI-PROMPT.ru.md`.
