# Agent instructions

This repository contains **mods (plugins) for an agent harness**. If you
are an AI agent working here, read this first.

## What you are working with

- `packages/system-prompt-mod/` — a dual-face plugin (host + browser): a chat
  header control that shows and edits the live system prompt.
- `packages/locale-ru/` — a browser-only plugin: the Russian language pack.
- `packages/mod-manager/` — a dual-face plugin: a Settings tab that lists
  installed mods and turns them off, on, or removes them.
- `packages/skill-manager/` — a dual-face plugin: a Settings tab that lists the
  skills this harness resolves, gives each a model-facing description and a
  one-line human summary, and pauses or resumes it by renaming the file the
  harness reads.
- `packages/skill-scout/` — a dual-face plugin: a Settings tab that is the **collection of
  finds** — skills already found and judged, each with its source, description, two
  axes (worth keeping, runs here), the hearing's rating and the date it entered. The
  scout reads it before it searches, so a skill found once is not hunted for again.
  **Nothing enters it without a verdict.** The card shows the sentence to paste into
  the chat; adoption happens there, and the agent records it.
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

1. **Never edit the harness installation.** Mods are separate packages installed
   into the harness home (`$DSH_HOME`, default `~/.dsh`).
2. **Never restart the user's `dsh web` process unasked**, and never kill the
   process you are running inside. A changed package file needs a restart to
   take effect — hand the user the command.
3. **Never commit or print secrets.** `$DSH_HOME/.credentials.yaml` holds API
   keys and the browser-session signing secret.
4. **Verify with evidence.** Run `node tools/boot-check.mjs` or
   `node tools/dev/verify-live.mjs` (both need a running `dsh web`) or a unit
   test; do not report success from reading code.
5. **Install what you commit, and commit what you install.** A fix that lands in
   `packages/` and never reaches `$DSH_HOME` changes nothing, and one that reaches
   the home and never lands in `packages/` is lost on the next install. Run
   `node tools/dev/check-deployed.mjs` after either, and commit as soon as a fix
   is verified rather than batching it — drift between the two is invisible, because
   the code keeps working and the panel looks the same.
6. **Keep both languages in sync.** Every user-facing document exists as
   `X.md` (English) and `X.ru.md` (Russian).
7. **The skills repository is the source; the installed trees are deployment.**
   This family's skills live in three places at once —
   `../deepseek-harness-skills/skills` (the source: versioned, published, the one to
   edit), `../.agents/skills` (the live root this harness resolves) and
   `./.agents/skills` (a committed copy, so this repository carries its own tools).
   Edit the source, then run `node tools/dev/check-skills-synced.mjs --sync` and
   commit the copies. The first run of that check found `manage-windows` **installed
   without its `--pid` identity check** — a fix committed to the source and never
   copied out, so the installed preflight still matched a window by title alone. The
   code ran, the panel looked the same, and the fifth check of a five-check tool was
   missing on the machine that needed it.

## Cheat sheet

```bash
node tools/install.mjs                 # install every package in packages/
node tools/install.mjs --dry-run       # preview
node tools/install.mjs --uninstall     # remove packages and their rows
node tools/boot-check.mjs              # is each mod in the served boot graph?
node tools/build-locale.mjs            # rebuild the language bundle from i18n/
node tools/extract-locale.mjs          # re-read dictionaries from a harness install
node tools/dev/link-dsh.mjs            # make @deepseek-ai/* resolvable for tests
node tools/dev/test-host.mjs           # prompt mod, host half
node tools/dev/test-client.mjs         # prompt mod, browser bundle
node tools/dev/test-locale-ru.mjs      # language pack contract
node tools/dev/test-links.mjs          # markdown links and anchors
node tools/dev/test-mod-manager.mjs    # mod manager, host half
node tools/dev/test-mod-manager-client.mjs  # mod manager, browser bundle
node tools/dev/test-skill-manager.mjs       # skill manager, host half
node tools/dev/test-skill-manager-client.mjs  # skill manager, browser bundle
node tools/dev/test-skill-scout.mjs        # skill scout, host half
node tools/dev/test-skill-scout-client.mjs # skill scout, browser bundle
node tools/dev/check-deployed.mjs     # does the deployment match packages/?
node tools/dev/check-skills-synced.mjs # do the installed skill trees match the
                                       # published source? --sync to copy, --help
                                       # for the paused-skill rule
node tools/dev/scan-secrets.mjs        # secrets in tracked names, blobs, and on disk
node tools/dev/verify-live.mjs         # live HTTP checks against a running GUI
node tools/dev/verify-store-live.mjs      # the store of finds, live: task,
                                       # verdict gate, adopt, discuss, remove
node tools/dev/verify-skill-manager-roundtrip.mjs --skill <name>
                                       # pauses, describes and resumes a real
                                       # skill, restoring it afterwards
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

Кратко по-русски: это репозиторий модов для харнесса. Не правь установку
харнесса, не перезапускай `dsh web` без разрешения, не коммить секреты,
проверяй результат командой `tools/boot-check.mjs`, держи документацию на двух
языках. Скиллы
правятся в `../deepseek-harness-skills/skills`, оттуда копируются в
`../.agents/skills` и `./.agents/skills` командой
`node tools/dev/check-skills-synced.mjs --sync` — без неё правка живёт только
в репозитории, а работает старая.
Инструкция по установке — `docs/AI-INSTALL.ru.md`, по созданию мода —
`docs/AI-PROMPT.ru.md`.
