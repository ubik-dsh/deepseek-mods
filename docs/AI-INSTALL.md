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
3. **Starting your own `dsh web` is fine; restarting the user's is not.** To
   verify an installation, boot a second server on a free port under your own
   `DSH_HOME` — that never touches theirs, and it is how every check below was
   validated. The exact command is in Step 4.
4. **Never commit or print credentials.** `$DSH_HOME/.credentials.yaml` holds
   API keys and the browser-session signing secret.
5. **Verify, don't assume.** Every claim below is checkable with a command.

## Step 1 — locate the environment

```powershell
node --version        # must exist; DSH runs on Node
$env:DSH_HOME         # empty means the default below
```

```bash
node --version        # the bash equivalents
echo "$DSH_HOME"
```

The Harness home is `$DSH_HOME`, or `~/.dsh` (`%USERPROFILE%\.dsh` on Windows)
when unset. `web` is the browser GUI and the default target.

**A missing home is not a blocker.** Do *not* interrupt the user to "run
`dsh web` once first": `tools/install.mjs` creates the directories it needs, and
the first `dsh web` afterwards materialises the rest of the profile around them
while leaving the patch file byte-for-byte intact. That was measured on a home
with nothing in it, not assumed.

**Check:** after Step 2, `$DSH_HOME/profiles/web/cordis.patch.yml` exists and
contains one `- insert:` row per package.

If the `dsh` command itself will not run, go to the troubleshooting table: on
Windows a blocked PowerShell script is the usual reason, and the table shows how
to launch the same binary with `node`.

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

If **no** server is running yet — a home that has never booted has none — there
is nothing to reload: start one as shown in Step 4 and it will serve both mods
on its first page load.

When a server *is* running: the **host** half of a newly inserted row is loaded
live when the patch file changes, and the **browser** half enters the roster
when the page loads, so:

- **Reload the page (F5)** — enough when DSH is already running and the row is
  new.
- **Restart `dsh web`** — required when a package's *files* changed under a row
  that is already loaded: the loader imports a module once per process and
  caches it by resolved URL, so editing `lib/index.js` on disk does not affect a
  running server. Ask the user to do this; do not kill the process yourself.

## Step 4 — verify

`boot-check` needs a running server. If the user already has one, use its URL.
Otherwise start your **own** — a second server, on a free port, in your own home;
the user's server and home are left alone:

```powershell
# 1. find the launcher; the `dsh` shim may be blocked by execution policy
$launcher = (Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Filter bin.js |
  Where-Object FullName -like '*@deepseek-ai\dsh*' | Select-Object -First 1).FullName

# 2. a scratch home, so the user's is untouched
$env:DSH_HOME = "$env:TEMP\dsh-mod-check"

# 3. boot on a free port; --no-open keeps the default browser closed
node $launcher web --no-open --port 3088
```

The first boot creates whatever the home is missing — the profile files,
`storages/`, `.credentials.yaml` — and leaves `cordis.patch.yml` untouched. Run
it in the background or a second shell; it serves until you stop it.

Then:

```bash
node tools/boot-check.mjs                       # defaults to http://127.0.0.1:3080
node tools/boot-check.mjs http://127.0.0.1:3088 # the server you just started
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

**What `boot-check` does not prove.** It greps the served page for two package
names. It does not prove that the prompt mod's host route registered, nor that
the language pack carries translations. Two cheap extra checks close that gap:

- the route answers when the host half is live:
  `GET /api/system-prompt.mod` — its full contract is in
  [the package README](../packages/system-prompt-mod/README.md#http-contract);
- open a session and click **Промпт** — the dialog lists the current prompt. The
  length depends on the deployment prompt and the preset layers, so do not
  compare it against a number from another machine; what matters is that a
  prompt appears at all. An error line instead means the route answered but the
  prompt assembly failed, which is a different problem.

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
| `dsh` is not found at all | DSH was installed through npx and never linked onto `PATH` | find its launcher and call it with node: `Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Filter bin.js \| Where-Object FullName -like '*@deepseek-ai\dsh*'`, then `node <that> web` |
| `dsh` fails with `…dsh.ps1 cannot be loaded because running scripts is disabled on this system` | PowerShell execution policy blocks the shim on Windows | **Do not change the machine's security policy on your own.** Call the launcher directly instead: `Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Filter bin.js \| Where-Object FullName -like '*@deepseek-ai\dsh*'`, then `node <that> web --no-open --port <free port>`. Widening the policy (`Set-ExecutionPolicy …`) is a machine-wide change the *user* may choose to make, not a step in this runbook |
| `boot-check` prints `cannot read the browser-session secret` | the home has never booted, so it has no `.credentials.yaml` yet | start `dsh web` once against that home, then re-run the probe |
| `boot-check` prints `cannot reach …` | `dsh web` is not running, or a different port | start it, or pass the right URL |
| `boot-check` prints `the derived cookie was refused` | wrong Harness home (the secret belongs to another install) | set `DSH_HOME` to the home the running server uses |
| Rows are in the patch file but a mod is missing from the roster | the page was not reloaded, or the row names a package the loader cannot resolve — and a row whose import failed once stays failed | reload; then read the browser console. If it is still missing, check that the package sits in `@local/` under its **own package name** (`@local/dsh-locale-ru` → `dsh-locale-ru`) and restart `dsh web` |
| The mod is in the roster but its UI is absent | the target slot does not exist in this DSH version | see [Compatibility](../README.md#compatibility); the slot name is version-specific |
| Русский is not in the language list | the page was loaded before the pack was installed | reload the page |
| A mod was working, then it reverted to older behaviour after you edited its files or re-ran the installer | the running process serves the build it loaded at boot — both halves are cached, the host module and the browser bundle | restart `dsh web`; reloading the page is not enough, because the bundle is assembled once and then held in memory |
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
