# DSH Mods

Plugins for **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** (DSH) — the
agent harness whose browser UI is the `dsh web` GUI.

Two mods live here:

| Mod | What it does |
|---|---|
| **[system-prompt-mod](packages/system-prompt-mod)** | A **Промпт / Prompt** button in the chat header that opens the live system prompt, lets you edit it, and applies the result on the next model request — no restart. |
| **[locale-ru](packages/locale-ru)** | **Russian localization** for the whole GUI: 42 namespaces, 1257 strings, selectable in Settings → General → Language. |

*Русская версия этого файла: [README.ru.md](README.ru.md).*

---

## Requirements

- **DeepSeek Harness** installed and able to run `dsh web`. Tested against **0.1.5-rc.2**.
- **Node.js** — the same runtime DSH itself runs on.
- No build step, no compiler, no network access at install time.

The mods are plain JavaScript packages. DSH is pre-1.0 and its plugin API moves
quickly, so read [Compatibility](#compatibility) before upgrading DSH.

## Install

```bash
git clone <this-repository> dsh-mods
cd dsh-mods
node tools/install.mjs
```

Then **reload the Web GUI (F5)** — the browser roster is composed when the page
loads.

That is the whole installation. The script copies both packages into
`$DSH_HOME/profiles/node_modules/@local/` (default `~/.dsh`) and adds one loader
row per package to `$DSH_HOME/profiles/web/cordis.patch.yml`, leaving any
existing content in that file untouched. It is **idempotent**: run it again and
it reports that everything is already in place. It also snapshots the packages
and the mod state into `$DSH_HOME/mod-backups/<timestamp>/` first.

Options:

```bash
node tools/install.mjs --lang ru        # Russian console output
node tools/install.mjs --profile tui    # a profile other than `web`
node tools/install.mjs --home-level     # rows also go to $DSH_HOME/cordis.patch.yml (all profiles)
node tools/install.mjs --dry-run        # report what would change, write nothing
node tools/install.mjs --backup-only    # snapshot only
node tools/install.mjs --uninstall      # remove the packages and their rows
```

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
