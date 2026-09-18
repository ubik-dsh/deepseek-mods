# Mod manager

A DSH plugin that adds a **Mods** tab to *Settings → Plugins*: what is installed
in this Harness home, what the running page was actually served, and controls to
turn a mod off, turn it back on, or remove it.

It is how you manage mods without a terminal — and without guessing whether a
restart is needed.

## What it shows

For every patch layer — the home layer and each profile — the rows it declares,
and for each row three independent facts:

| Fact | Where it comes from |
|---|---|
| **on disk** / missing on disk | the package's own `package.json` under `profiles/node_modules/@local/` |
| **served to this page** / not served here | the boot graph this page requested, read from the DOM and the resource timeline |
| **turned off** | the row is absent from the patch file and recorded in this plugin's ledger |

Keeping these apart is the point. A row can be present while the page loaded
before it existed; a package can be on disk with its row removed; a mod can be
installed and served but carrying files older than the checkout. One merged
"installed" badge would hide exactly the state a person opens this panel to
understand.

It also lists **packages with no loader row** — present under `@local/` but
mounted by nothing, so nothing loads them. Those are usually the leftovers of an
earlier install, and they are invisible from anywhere else in the GUI.

## What it can do

- **Turn a mod off** — removes its loader row and records it in
  `$DSH_HOME/mod-manager.json`.
- **Turn it back on** — restores the row from that record.
- **Remove a mod** — deletes the package and every row naming it in every layer,
  after copying the package and the affected patch files into
  `$DSH_HOME/mod-backups/<timestamp>/`.

Turning a mod off or on takes effect in a running server **without a restart**:
this was measured, not assumed — see `docs/VERIFICATION.md`. Removing a mod
likewise drops its rows live.

## Safety

The panel is deliberately narrow:

- only packages under `@local/` are managed; a row naming a shipped
  `@deepseek-ai/*` plugin is refused, so the deployment cannot be broken from
  here;
- the manager refuses to turn **itself** off, because removing its own row would
  unmount the panel doing the removing;
- every path it writes is checked to be inside the Harness home;
- a patch file is copied into the snapshot directory before it is rewritten.

## Two things it cannot do for you

- **Changing a mod's files still needs a restart.** The loader imports modules
  without cache-busting, so a package whose contents changed is not re-imported
  into a running server.
- **A row that failed to import once stays failed** until that entry changes or
  the server restarts. If you install a mod and its row was already present from
  a failed attempt, restart `dsh web` — turning the row off and on again does not
  always recover it.

## HTTP contract

```
GET  /api/mod-manager.mod
POST /api/mod-manager.mod   { action: "disable" | "enable" | "uninstall", layer, id }
```

The GET response carries `home`, `layers` (each with `key`, `label`, `path`,
`exists` and `rows`), `orphans`, `disabled`, `backupRoot` and `selfPackage`. Each
row carries `id`, `name`, `disabled`, `managed`, `self` and the resolved
`package` descriptor or `null`.

A failed action answers `{ ok: false, code }` rather than a sentence, and the
browser half phrases the code in the reader's language. The codes are
`unknown-layer`, `row-not-found`, `package-not-installed`, `forbidden-package`,
`self-managed`, `write-failed`, `read-failed`, `bad-request` and
`method-not-allowed`.

## Install

Use the repository installer — `node tools/install.mjs` — which copies this
package into `$DSH_HOME/profiles/node_modules/@local/dsh-mod-manager` and adds
the loader row:

```yaml
- insert:
    - id: mod-manager
      name: '@local/dsh-mod-manager'
```

Reload the GUI afterwards. If the row was already present from an earlier
attempt that failed to import, restart `dsh web`.

## Limitations

- The panel manages loader rows and packages, not configuration: it does not
  edit a mod's settings, only whether it is mounted.
- It reads the patch files directly, so a patch written in a shape this parser
  does not recognise is shown as fewer rows rather than as an error.
- The snapshot directory grows; nothing prunes it.
