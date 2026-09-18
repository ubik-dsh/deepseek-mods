# Verification

**English** · [Русский](VERIFICATION.ru.md)

What was actually run against these mods, and what it produced. Reproduce any
line with the command in the last column.

Environment: DSH `0.1.5-rc.2`, `web` profile, Windows 11, Node `v24.20.0`,
headless Edge driven over the DevTools Protocol for the UI checks.

## Results

| # | Check | Command | Result |
|---|---|---|---|
| 1 | DSH packages resolvable for the tests | `node tools/dev/link-dsh.mjs` | linked |
| 2 | Prompt mod, host half (11 checks) | `node tools/dev/test-host.mjs` | **PASS** |
| 3 | Prompt mod, browser bundle (6 checks) | `node tools/dev/test-client.mjs` | **PASS** |
| 4 | Language pack contract and key coverage | `node tools/dev/test-locale-ru.mjs` | **PASS** — 42 namespaces, 1257 keys, 1195 with Cyrillic |
| 5 | Language bundle reproducible from `i18n/` | `node tools/build-locale.mjs` | rebuilt file **byte-identical** to the committed one |
| 6 | Installer is a no-op when everything is installed | `node tools/install.mjs --dry-run` | every row already present, nothing written |
| 7 | Prompt mod loaded in a running server | `node _dsh_mod/probe-3080.mjs` | `GET /api/system-prompt.mod` → **200**, new host half |
| 8 | Both mods in the served boot graph (live GUI) | `node tools/boot-check.mjs` | **OK** ×2 of 168 client rows |
| 9 | Prompt mod rendered in a real browser, live GUI | `node _dsh_mod/ui-check.mjs …` | control present; dialog **760 px**; "Load current" filled the editor with **7041 characters**; 0 console errors |
| 10 | Language pack switched in a real browser | `node _dsh_mod/ui-locale.mjs` | pack in roster; **Русский** offered; → English (`lang=en`) → back to Русский (`lang=ru`); 620 Cyrillic characters; 0 console errors |
| 11 | Install into a **clean** Harness home, then boot | `node tools/install.mjs` + `dsh web` | both mods in the served boot graph |
| 12 | Host route on that clean instance | probe | **200**, new host half |
| 13 | Uninstall on a running instance | `node tools/install.mjs --uninstall` | packages and rows removed; patch restored to `[]`; both rows became **MISS** in the served boot graph **without a restart** |

## What the run established about DSH itself

Three behaviours, each verified against a running server rather than inferred:

- **A new loader row is mounted live.** The mod appeared in the running GUI's
  boot graph right after the row was added to `cordis.patch.yml`.
- **A removed row is unloaded live.** After `--uninstall`, the served boot graph
  dropped both packages with no restart (check 13).
- **A changed row is not re-imported.** Pointing an existing row at a
  nonexistent specifier (`@local/dsh-system-prompt-mod/nope`) left the old route
  answering `200` — mounted entries are not re-created, and the loader imports
  modules without cache-busting. Changing a package's files therefore needs a
  `dsh web` restart.

The first two make installation and removal pleasant; the third is why the
install runbook tells a user to restart after an upgrade rather than promising a
hot swap.

## Not covered

Stated plainly, so nobody reads more into the table than it says:

- **Only the `web` profile.** `headless`, `sdk`, `sdk-minimal` and `acp` were
  not exercised. The language pack is browser-only, and the prompt mod's route
  needs the Web transport, so both are inert elsewhere — but that is reasoning,
  not a test.
- **No real model request.** Replace/append modes were verified at the assembly
  and HTTP level (the assembled prompt changes, the guard rejects `{{…}}`), not
  by sending a prompt to a model and reading the answer.
- **Windows only.** The packages are plain JavaScript with no OS-specific code
  and the tools take no absolute paths, but nothing was run on Linux or macOS.
  The harness under `tools/dev` — the headless-browser and PowerShell scripts —
  *is* Windows-specific and marked as such.
- **DSH version drift.** Everything above was measured on `0.1.5-rc.2`. The API
  surface these mods bind to is listed under
  [Compatibility](../README.md#compatibility); a newer DSH may rename a slot or
  a service, and the mods are designed to fail softly when it does.
- **Translation quality is reviewed by eye, not by tooling.** The builder
  guarantees key sets and placeholders match the English source; it cannot judge
  whether a phrase reads well.
