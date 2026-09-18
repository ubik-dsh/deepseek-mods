# AI install runbook

**English** · [Русский](AI-INSTALL.ru.md)

A step-by-step procedure for an AI agent asked to install these mods into
someone's DeepSeek Harness. Follow it in order; every step has a check, and the
troubleshooting table at the end covers what can go wrong.

> Scope: **installing** prebuilt mods. To *create* a mod, use
> [AI-PROMPT.md](AI-PROMPT.md).

## Ground rules

1. **Never modify the DSH installation.** It is the npm/npx package that
   contains `@deepseek-ai/dsh`. Mods live in the Harness home, not there.
2. **Never restart the user's `dsh web` process without asking.** If you are
   running inside it, restarting ends your own session. Tell the user the exact
   command instead.
3. **Never commit or print credentials.** `$DSH_HOME/.credentials.yaml` holds
   API keys and the browser-session signing secret.
4. **Verify, don't assume.** Every claim below is checkable with a command.

## Step 1 — locate the environment

```bash
node --version                 # must exist; DSH runs on Node
echo "$DSH_HOME"               # empty means the default below
```

The Harness home is `$DSH_HOME`, or `~/.dsh` (`%USERPROFILE%\.dsh` on Windows)
when unset. Check it exists:

```bash
ls "$DSH_HOME/profiles"        # or: dir "%USERPROFILE%\.dsh\profiles"
```

You should see one directory per profile. `web` is the browser GUI and the
default target.

**Check:** the profile directory contains `cordis.patch.yml` and `package.json`.

If the home does not exist, DSH has never run on this machine. Ask the user to
run `dsh web` once first — a fresh home is created from shipped templates.

## Step 2 — install

From the repository root:

```bash
node tools/install.mjs --lang ru    # or --lang en, or omit
```

Use `--profile <name>` when the target profile is not `web`. Read the output:
it lists the discovered packages, the installed paths and the rows it added.
Running it twice must print "every row is already present" — that is the
idempotence check.

**Check:** `$DSH_HOME/profiles/node_modules/@local/` now contains
`system-prompt-mod/` and `locale-ru/`, and `$DSH_HOME/profiles/<profile>/cordis.patch.yml`
contains one `- insert:` block per package.

If you need a preview first, `--dry-run` reports without writing.

## Step 3 — make the running GUI pick it up

The **host** half of a newly inserted row is loaded live when the patch file
changes. The **browser** half enters the roster when the page loads, so:

- **Reload the page (F5)** — enough when DSH is already running and the row is
  new.
- **Restart `dsh web`** — required when a package's *files* changed under a row
  that is already loaded: the loader imports a module once per process and
  caches it by resolved URL, so editing `lib/index.js` on disk does not affect a
  running server. Ask the user to do this; do not kill the process yourself.

## Step 4 — verify

With `dsh web` running:

```bash
node tools/boot-check.mjs                       # defaults to http://127.0.0.1:3080
node tools/boot-check.mjs http://127.0.0.1:3081 # another port
```

Expected:

```
GET / -> 200 (… bytes)
boot rows referencing /client.js: …
  OK   dsh-system-prompt-mod
  OK   dsh-locale-ru
```

The probe reads the browser-session secret from the local Harness home, mints
the same cookie the GUI uses, and reports which client rows the served boot
graph carries. It prints no secret. Exit code is non-zero when a row is missing.

Manual equivalent: open the GUI and check that

- a **Промпт / Prompt** control appears in a session header (the mod adds it to
  the header utilities row), and
- **Settings → General → Language** offers **Русский**.

## Step 5 — report

Tell the user exactly:

- which packages were installed and where,
- which rows were added to which patch file,
- that the page must be reloaded,
- how to undo it: `node tools/install.mjs --uninstall`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `boot-check` prints `cannot reach …` | `dsh web` is not running, or a different port | start it, or pass the right URL |
| `boot-check` prints `the derived cookie was refused` | wrong Harness home (the secret belongs to another install) | set `DSH_HOME` to the home the running server uses |
| Rows are in the patch file but a mod is missing from the roster | the page was not reloaded, or the browser half failed to parse | reload; then read the browser console |
| The mod is in the roster but its UI is absent | the target slot does not exist in this DSH version | see [Compatibility](../README.md#compatibility); the slot name is version-specific |
| Русский is not in the language list | the page was loaded before the pack was installed | reload the page |
| A mod was working, then you edited its files and it reverted | the running process still has the old module cached | restart `dsh web` |
| `dsh plugin --profile web …` was run and the mods disappeared | pnpm removed packages the profile manifest does not list | re-run `node tools/install.mjs` |

## Undo

```bash
node tools/install.mjs --uninstall
```

Removes the packages, removes exactly the rows this installer writes, and
restores the patch file to its shipped empty form. Reload the page afterwards.

## What "installed" means here

Worth knowing when the user asks what happens on a DSH upgrade:

- The mods are profile plugins: packages under
  `$DSH_HOME/profiles/node_modules/@local/` plus rows in the profile's
  `cordis.patch.yml`.
- `$DSH_HOME` is **not** part of the DSH installation. Updating or reinstalling
  DSH replaces the installation and leaves the home — sessions, settings,
  profiles, these mods — intact.
- The one operation that can drop them is a profile dependency install
  (`dsh plugin --profile <name> …`), which runs pnpm. Re-running
  `node tools/install.mjs` restores everything.
