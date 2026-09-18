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
| 7 | Prompt mod's route on a running server | `node tools/dev/verify-live.mjs` | `GET /api/system-prompt.mod` → **200**, `section=mod:user-system-prompt`, `order=10300`, every documented key present |
| 8 | Both mods in the served boot graph (live GUI) | `node tools/boot-check.mjs` | **OK** ×2 of 168 client rows |
| 9 | Prompt mod rendered in a real browser, live GUI | `node _dsh_mod/ui-check.mjs …` | control present; dialog **760 px**; "Load current" filled the editor with **7041 characters**; 0 console errors |
| 10 | Language pack switched in a real browser | `node _dsh_mod/ui-locale.mjs` | pack in roster; **Русский** offered; → English (`lang=en`) → back to Русский (`lang=ru`); 620 Cyrillic characters; 0 console errors |
| 11 | Install into a **clean** Harness home, then boot | `node tools/install.mjs` + `dsh web` | both mods in the served boot graph |
| 12 | The same checks on a clean instance **without** the mods | `node tools/dev/verify-live.mjs http://127.0.0.1:3089` | **FAIL** ×4 — packages absent from the boot graph, route `404`. This is the row that shows checks 7 and 18 can fail |
| 13 | Uninstall on a running instance | `node tools/install.mjs --uninstall` | packages and rows removed; patch restored to `[]`; both rows became **MISS** in the served boot graph **without a restart** |
| 14 | Re-running the installer writes nothing | `node tools/install.mjs` twice | second run: every package reported current (`is already up to date` in English, `уже актуален` under `--lang ru`), no `mod-backups` directory created |
| 15 | Markdown links and anchors resolve | `node tools/dev/test-links.mjs` | **PASS** — 16 files, 65 relative links |
| 16 | No secret in anything published | `node tools/dev/scan-secrets.mjs --git <path>` | **PASS** — 127 tracked names, 162 blobs including unreachable ones, 131 files on disk, no key or password |
| 17 | A stranger can read and clone it | `node _dsh_mod/verify-public.mjs` | **PASS** — page `HTTP 200`; anonymous `ls-remote`; anonymous clone with `README.md`, `README.ru.md`, `LICENSE`, both packages |
| 18 | Every live check on the running GUI | `node tools/dev/verify-live.mjs` | **PASS** — 6 of 6: page 28 463 bytes, 171 boot rows, **25 783** Cyrillic characters in the served bundle, both host routes `200`, the manager reporting 2 layers and 3 rows |
| 19 | The secret scanner can fail | planted key on disk, then committed and deleted, then a tracked `.env` | **FAIL** ×3, each on the right finding — including the deleted-but-still-stored blob |
| 20 | Mod manager, host half | `node tools/dev/test-mod-manager.mjs` | **PASS** — 27 checks: patch parsing, every action, and every refusal |
| 21 | Mod manager, browser bundle | `node tools/dev/test-mod-manager-client.mjs` | **PASS** — 13 checks on a React stub that honours hook dependencies |
| 22 | A clean home installs and boots | `node tools/install.mjs`, then `dsh web` on a scratch home | **PASS** — packages land under `@local/dsh-*`, 171 boot rows, all three mods listed, both host routes `200` |
| 23 | Turning a mod off and on from the panel, in the real GUI | headless Edge: Settings → Plugins → Mods | **PASS** — turning the prompt mod off removed its row and the route answered `404`; turning it back on restored both; 0 console errors |
| 24 | The installer places packages where the loader looks | clean home, then read `@local/` | **PASS** — `dsh-locale-ru`, `dsh-mod-manager`, `dsh-system-prompt-mod`; installing under the repository's folder name had left a clean home unable to boot at all |

### Reproducing this table

Rows 1–8, 13–16 and 19–21 run from a fresh clone with Node alone. Rows 11, 12, 18,
22 and 24 need a running instance; `tools/dev/verify-live.mjs` lives in the
repository, so they need nothing more than that and a scratch home. Rows 9, 10 and
23 are the browser checks: they need Windows, Edge and a running `dsh web`, and
live in `tools/dev` as machine-specific harness. Row 17 needs network access and is
the only row whose command lives outside the repository — it verifies the
*published* copy rather than a checkout, which is a different question from the
rest of the table.

## What the run established about DSH itself

Four behaviours, each verified against a running server rather than inferred:

- **A new loader row is mounted live.** Adding a row to `cordis.patch.yml` while
  the server runs puts the package into the served boot graph within seconds, with
  no restart. Measured in both directions on a scratch instance.
- **A removed row is unloaded live.** Removing the row of a mounted package drops
  it from the boot graph, and restoring the row brings it back (checks 13 and 22).
- **A changed row is not re-imported.** Pointing an existing row at a
  nonexistent specifier (`@local/dsh-system-prompt-mod/nope`) left the old route
  answering `200` — mounted entries are not re-created, and the loader imports
  modules without cache-busting. Changing a package's files therefore needs a
  `dsh web` restart.
- **A row whose import failed once stays failed.** A row naming a package the
  loader cannot resolve leaves that entry in an error state, and rewriting the row
  afterwards does not recover it — while a server that boots with the same row
  works. This is why the installer says "reload the GUI" and why a restart is the
  fallback when a row was already present from a failed attempt.

The first two make installation and removal pleasant; the third is why the
install runbook tells a user to restart after an upgrade rather than promising a
hot swap.

## External reviews of the documentation

The install runbook is only as good as what a reader who has never seen this
repository can do with it. So it was tested that way: fresh AI agents, given
nothing but the repository path and the words "install these mods", with no
memory of how the mods were built and no access to the author's machine.

Each round used a scratch `DSH_HOME` and its own server on a free port; the
reviewers never touched the real Harness home.

| Round | Verdict | Score |
|---|---|---|
| 1 | **No** — a stranger would have to ask the author a question | — |
| 2 | **No** | 6.5 / 10 |
| 3 | **Yes** — a stranger got through without asking the author a question | 9 / 10 |

### What the reviews found, and what changed

| Finding | Resolution |
|---|---|
| The runbook told the reader to ask the user to start `dsh web` first, which is impossible when the user is not present | Removed. Installation was re-verified against an empty Harness home, and a first boot was shown to preserve the patch |
| A never-booted Harness home has no browser-session secret, and boot fails with `cannot read the browser-session secret` | Added as a troubleshooting row |
| Commands were written for bash in a world where the reader is on Windows | Every example split into PowerShell and POSIX forms |
| The `dsh` shim (`.ps1`) is blocked by the Windows execution policy | Added as a troubleshooting row **and** made the direct `node lib/bin.js` call the primary fix, with an explicit instruction never to change the execution policy |
| `boot-check.mjs` was presented as proof of a working mod, though it only proves the roster | Added "what it does not prove" and the route and GUI checks to the runbook |
| The launch recipe used undocumented flags (`--no-open`, the port argument) | A copy-pasteable, fully documented launch recipe in Step 4 |
| A character count was quoted as if it were a property of the mod | Removed; it is environment-dependent |
| Step 3 assumed the Harness home had been booted at least once | Added a note for the never-booted case |
| `git` was required but absent from Requirements | Added |
| Development UI scripts wrote screenshots into the repository and used inconsistent ports | Screenshots moved to a temp directory (override with `DSH_SHOTS`), port made a parameter, all documented in `tools/dev/README.md` |
| Re-running the installer still accumulated backup snapshots, and a code comment claimed otherwise | `treeDigest()` / `sameTree()` compare content digests, so a second run prints `already up to date` and writes nothing — verified as a full install/install/uninstall round trip |
| The evidence table cited one-off scripts living outside the repository, so it could not be re-run from a clone | Added `tools/dev/verify-live.mjs`, which reproduces those rows from inside the repository, and moved the cookie logic into a shared `tools/lib/session-cookie.mjs` so the credential handling has one source of truth |
| `--backup-only` printed a backup path on a clean tree without creating it | It now reports that there was nothing to back up and creates no directory; the flag's behaviour is documented in the README |
| `test-host.mjs` wipes and rewrites `tools/dev/_testhome-host/` inside the checkout | Documented in `tools/dev/README.md`; the directory was already covered by `.gitignore`, confirmed with `git check-ignore` rather than assumed |
| The idempotence row quoted an English phrase that only appears when the installer runs in English | The row now names both wordings |

The idempotence finding is worth calling out because it was a real defect in the
tool, not just in the prose: the first fix removed backups on a *clean* install
but still snapshotted on every re-run.

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
