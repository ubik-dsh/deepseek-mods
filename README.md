# DSH Mods

Plugins for **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** (DSH) — the
agent harness whose browser UI is the `dsh web` GUI.

> **Repository:** <https://gitverse.ru/ubikon/dsh-mods>

Three mods live here:

| Mod | What it does |
|---|---|
| **[system-prompt-mod](packages/system-prompt-mod)** | A **Промпт / Prompt** button in the chat header that opens the live system prompt, lets you edit it, and applies the result on the next model request — no restart. |
| **[locale-ru](packages/locale-ru)** | **Russian localization** for the whole GUI: 42 namespaces, 1257 strings, selectable in Settings → General → Language. |
| **[mod-manager](packages/mod-manager)** | A **Mods** tab in Settings → Plugins: what is installed, whether the page was actually served it, and turn-off / turn-on / remove — without a restart. |

*Русская версия этого файла: [README.ru.md](README.ru.md).*

![The Prompt control in the session header](docs/screenshots/header-button.png)

![The editor showing the live system prompt](docs/screenshots/prompt-editor.png)

*The **Промпт** control sits with the session header actions; the dialog shows
the prompt the model actually receives — assembled in the live agent's scope,
with `{{model}}`, `{{cwd}}` and preset layers already resolved.*

![Language selection in Russian](docs/screenshots/russian-settings.png)

*The language pack adds **Русский** to Settings → General → Language.*

![The Mods tab listing installed mods](docs/screenshots/mods-panel.png)

*Before: every loader row, whether this page was served it, and what can be done
with each one.*

![The same tab after turning the prompt mod off](docs/screenshots/mods-turned-off.png)

*After: the prompt mod turned off from this panel. Its row left the patch file,
its host route stopped answering, the badge reads "off" and the button became
"turn on" — with no restart. Turning it back on restores the row the same way.*

---

## What is different here

Most collections list what they contain. This is what is different about this
one, written so that it can be checked rather than believed.

| | |
|---|---|
| **Verification with the evidence published** | Every claim in these docs was measured, and [`docs/VERIFICATION.md`](docs/VERIFICATION.md) is the table: what was run, what it returned, and — the column most projects leave out — **what was not covered**. |
| **Honest failure paths** | A mod that will not install says which check failed and what to do about it. The mirror script refuses to push a token saved for the wrong host. The skills checker reports what it cannot prove as a warning instead of a failure. |
| **Bilingual from the start** | Every user-facing file exists as `X.md` and `X.ru.md`. The Russian pack is a generated bundle of 1257 strings with its own test, not a hand-edited translation. |
| **Tests that are allowed to fail** | A browser test here caught a re-render loop that a naive stub could not see; the **stub** was fixed, not the test. When a check asserts something inconvenient, the check is examined rather than lowered. |
| **No build step** | Plain JavaScript packages. No compiler, no bundler, no network access at install time. |

What this repository does **not** claim is that any of it is a new idea. Plugin
managers exist elsewhere. What is uncommon is the verification discipline — and
the Russian localization, which a scan of the main DSH catalogues found to be an
empty niche.

## Requirements

- **DeepSeek Harness** installed and able to run `dsh web`. Tested against **0.1.5-rc.2**.
- **Node.js** — the same runtime DSH itself runs on.
- **git**, to clone (skip it and download the ZIP instead — the installer does
  not need git).
- No build step, no compiler, no network access at install time.

The mods are plain JavaScript packages. DSH is pre-1.0 and its plugin API moves
quickly, so read [Compatibility](#compatibility) before upgrading DSH.

## Install

```bash
git clone https://gitverse.ru/ubikon/dsh-mods.git dsh-mods
cd dsh-mods
node tools/install.mjs
```

That URL is the repository's home. A clone from any mirror or fork works the
same — nothing in the project depends on where it was cloned from.

Then **reload the Web GUI (F5)** — the browser roster is composed when the page
loads.

That is the whole installation. The script copies both packages into
`$DSH_HOME/profiles/node_modules/@local/` (default `~/.dsh`) and adds one loader
row per package to `$DSH_HOME/profiles/web/cordis.patch.yml`, leaving any
existing content in that file untouched.

Re-running is safe and, when nothing changed, a genuine no-op: a package whose
installed copy already matches this checkout is left alone, the rows are checked
without duplication, and no backup is written. When an installed package
*differs* — you pulled a new version — that package is replaced and the previous
copy plus the mod state is snapshotted into
`$DSH_HOME/mod-backups/<timestamp>/` first, which is what makes a rollback
possible.

Options:

```bash
node tools/install.mjs --lang ru        # Russian console output
node tools/install.mjs --profile tui    # a profile other than `web`
node tools/install.mjs --home-level     # rows also go to $DSH_HOME/cordis.patch.yml (all profiles)
node tools/install.mjs --dry-run        # report what would change, write nothing
node tools/install.mjs --backup-only    # snapshot what a re-install would replace, then stop
node tools/install.mjs --uninstall      # remove the packages and their rows
```

`--backup-only` writes a snapshot only when there is something to preserve. When
the installed packages already match this checkout it says so and creates no
directory at all, rather than naming a path that does not exist.

## Verify

With `dsh web` running:

```bash
node tools/boot-check.mjs
```

```
GET / -> 200 (28171 bytes)
boot rows referencing /client.js: 168
  OK   dsh-system-prompt-mod
  OK   dsh-locale-ru
```

The probe reads the browser-session signing secret from your own Harness home,
mints the same cookie the GUI uses, and reports which client rows the served
boot graph carries. It never prints the secret.

## Using the mods

### System prompt

Open a session and click **Промпт** (Prompt) in the session header, next to the
other header actions. The dialog shows the prompt the model actually receives —
assembled in the live agent's scope, so `{{model}}`, `{{cwd}}` and preset layers
are resolved.

- **Взять текущий / Load current** copies the live prompt into the editor.
- **Показать / Show** reveals the prompt read-only.
- The switch chooses **append** (your text is added after the deployment prompt)
  or **replace** (your text becomes the entire system prompt).
- **Сохранить и применить / Save and apply** writes the change; it takes effect
  on the next model request.

The override is stored in `$DSH_HOME/system-prompt-mod.json` and applies to every
agent. While the mod is disabled — which is the default — the prompt is
untouched.

A text containing a `{{variable}}` group is **rejected** on save: DSH
interpolates those strictly and offers no escape syntax, so such a prompt would
break every later request. The editor explains this instead of accepting it.

### Russian

**Settings → General → Language → Русский.** The switch is instant, and the
choice is persisted in `$DSH_HOME/settings.yaml`.

A browser that asks for Russian (`Accept-Language: ru`) gets the Russian UI
immediately, without visiting Settings — DSH takes the locale from the browser
until an explicit choice is stored.

Anything not translated falls back to English per key, so a partial or outdated
pack degrades gracefully instead of leaving blanks.

## Skills

Skills are not mods: no install, no restart, no plugin row. A skill is a folder
of instructions an agent reads when a task matches it, and several harnesses —
DSH, Claude Code and others — read the same `SKILL.md` format.

| Skill | What it does |
|---|---|
| **[create-a-skill](.agents/skills/create-a-skill)** | Teaches an agent to write a good skill, and to measure whether it works. Assembled from every skill about skill authoring published in a repository with 5000+ stars, then extended with what none of them had: a **bundled checklist runner** (`scripts/check-skill.py`, standard library only) and a **measured evaluation protocol**. |

Copy the folder into your harness's skills root and it is live — see
[Where it goes](.agents/skills/create-a-skill/references/harness-locations.md)
for DSH's seven roots and the conventions of other harnesses.

Plain text, no binaries, nothing to build. The one Python file is a checker that
reads the standard library and nothing else, so the skill stays usable in any
harness even if you delete it.

## Uninstall

```bash
node tools/install.mjs --uninstall
```

Removes the packages and the rows this installer added, and restores the patch
file to its shipped empty form. Reload the page afterwards.

## How the mods are wired

This matters for updates, so it is worth knowing:

- A DSH **profile** is a directory under `$DSH_HOME/profiles/<name>/` holding a
  `package.json` (the bundle list) and `cordis.patch.yml` (your own patch layer).
- A profile plugin is an npm-shaped package placed in the profile's
  `node_modules`, plus one row in the patch layer:

  ```yaml
  - insert:
      - id: locale-ru
        name: '@local/dsh-locale-ru'
  ```

- A package becomes a **browser** plugin by declaring `dsh.client` in its
  `package.json` and exporting a `./client` bundle in the format the DSH client
  module system serves:

  ```js
  window.__ModuleLoader__.load({
    id: "@local/dsh-locale-ru",
    factory: (require) => { /* … */ return module.exports }
  })
  ```

- `$DSH_HOME` is **not** part of the DSH installation. Updating or reinstalling
  DSH replaces the installation; it leaves the home — your sessions, settings,
  profiles and these mods — in place.

The one operation that can drop the mods is installing profile dependencies
(`dsh plugin --profile web …`), because that runs pnpm, which removes packages
the profile manifest does not list. Re-run `node tools/install.mjs` afterwards.

## Repository layout

```
packages/
  system-prompt-mod/   dual-face plugin: host half + browser half
    lib/index.js       host: prompt section + /api/system-prompt.mod route
    lib/client.js      browser: header button + editor dialog
  locale-ru/           browser-only plugin
    lib/client.js      GENERATED by tools/build-locale.mjs
    i18n/en|ru/        translation sources, one file per locale namespace
tools/
  install.mjs          install / uninstall / backup
  boot-check.mjs       verify the served boot graph
  build-locale.mjs     rebuild the language pack from i18n/
  extract-locale.mjs   pull the shipped dictionaries out of a DSH installation
  dev/                 development and verification harness (see tools/dev/README.md)
docs/
  AI-INSTALL.md        install runbook for an AI agent
  AI-PROMPT.md         prompt + reference for having an AI build a new mod
  VERIFICATION.md      every check that was run, and what was not covered
  PUBLISH.md           how to publish this repository (GitHub, GitVerse)
  ROADMAP.md           mod ideas that are not built yet
  screenshots/         images used by this file
.github/workflows/
  ci.yaml              checks that need only Node — runs on GitHub and GitVerse
AGENTS.md              what a DSH agent working here should know — loaded automatically
```

Adding a mod is a matter of dropping a directory into `packages/`:
`tools/install.mjs` discovers packages there at run time, uses the directory name
as the loader row id, and reads the package name from its manifest.

## For AI agents

This repository is written to be operated by an agent as well as a person:

- **[`AGENTS.md`](AGENTS.md)** — loaded automatically by DSH when an agent works in this
  directory: the rules, the layout, and the command cheat sheet.
- **[`docs/AI-INSTALL.md`](docs/AI-INSTALL.md)** — a step-by-step install runbook with a
  check after every step and a troubleshooting table.
- **[`docs/AI-PROMPT.md`](docs/AI-PROMPT.md)** — a ready-to-paste prompt for having an AI
  **build a new DSH mod**: the reconnaissance procedure, the extension points, the exact
  client bundle format, the verified APIs, the pitfalls, and the deliverable checklist.

Both documents exist in Russian too: `docs/AI-INSTALL.ru.md`, `docs/AI-PROMPT.ru.md`.

Every check that was run against these mods — and everything that was **not**
covered — is written down in [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## Compatibility

The mods bind to DSH plugin APIs at a specific version:

| Mod | Depends on |
|---|---|
| system-prompt-mod | the `conversation.session.header.utilities` slot, `ctx.slots`, `ctx.systemPrompt.section`, `ctx.connection.fetch.register`, `ctx.agents.get`, and the `Modal`/`Button`/`Switch`/`Tag` primitives |
| locale-ru | `ctx.locale.addLanguage`, `ctx.locale.register(namespace, locale, dict)`, and the shipped namespace key sets |

DSH is pre-1.0 and states in its own onboarding notice that core plugins and
foundational APIs will keep changing. If a future version renames one of these,
a mod stops loading — **gracefully**: the language pack falls back to English,
and the prompt mod simply never registers its route, so the GUI itself keeps
working. Fixes are usually a line or two; the installer is also the recovery
path after any DSH upgrade.

Namespaces or keys added by a newer DSH stay English until the pack is rebuilt
with `tools/build-locale.mjs` after re-extracting with `tools/extract-locale.mjs`.

## Development

```bash
node tools/extract-locale.mjs              # shipped dictionaries -> locale-en.json
node tools/build-locale.mjs                # i18n/ru/*.json -> lib/client.js
node tools/dev/test-host.mjs               # 11 unit checks on the prompt host half
node tools/dev/test-client.mjs             # 6 checks on the prompt browser bundle
node tools/dev/test-locale-ru.mjs          # language pack contract
```

The unit tests need the DSH packages (`@deepseek-ai/*`) resolvable from the
repository, so they run on a machine that has DSH installed; see
[`tools/dev/README.md`](tools/dev/README.md).

## License

[MIT](LICENSE). The Russian dictionaries are translations of the DeepSeek
Harness user interface, which is MIT-licensed; the original English strings
remain the property of their authors.
