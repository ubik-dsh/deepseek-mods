# Skill manager

A DSH plugin adding a **Skills** tab to *Settings → Plugins*, one step after
**Mods**: what this Harness resolves, from which root, with which description — and
a switch to pause a skill or bring it back.

## The cards are the platform's

A card is the same shape as a mod card and is built from the same elements —
`Tag` and `StateDot`. So a skill reads **green when it is available** and **red
when it is paused**, the way every other element in DSH reads, rather than like
something imitating it.

The plate **is** the switch: pressing it pauses or resumes. The chevron opens the
card, where the root, rank, path, size, both descriptions and the registration form
live.

## How a pause works

**By renaming the file DSH reads.** Nothing is deleted and nothing is edited:

| Before | After |
|---|---|
| `<root>/name/SKILL.md` | `<root>/name/SKILL.md.paused` |
| `<root>/name.md` | `<root>/name.md.paused` |

The discovery rule in `dsh-skill-filesystem` looks **one level into a root** and
accepts exactly two shapes — `<root>/name/SKILL.md` and `<root>/name.md`. A file
with the `.paused` suffix matches neither, so the skill leaves the catalogue.

The paused state **is** the filename. There is no second source of truth to fall
out of step with it.

The provider watches its roots and invalidates the catalogue when a path shaped
like a skill changes, so the rename lands in the **running session**: DSH hands the
model its skill list before every request, and a paused skill is simply not in it.
No reload, no restart.

## The registry: a folder is not enough

A directory gives a skill neither an identity nor a description a person can read.
So there is a registry at `~/.dsh/skill-registry.json`, holding per skill:

| Field | Why |
|---|---|
| `id` | a stable name, so the skill is still recognised if the folder is renamed |
| `file` | where it lives |
| `modelDescription` | **the description for the model**, written into the `SKILL.md` frontmatter |
| `humanSummary` | **one line for a person**, kept here, never read by a model |
| `enabled` | whether it is on the shelf or on pause |

The registry is an **addition, not a gate**: a skill it has never seen is still
listed and still works. The form in the card simply fills it in.

### Two descriptions, and they are not the same text

DSH matches a request against **the `description` line in the frontmatter**. So the
model-facing description is written **there** — anywhere else it would be a
description the model never sees. The edit is surgical: exactly one line changes and
everything else in the file survives byte for byte, which the unit test asserts.

The human summary stays in the registry and never reaches the frontmatter.

## When you need a reload, and when you do not

| What changes | What it needs |
|---|---|
| Pausing or resuming a skill | **nothing** — it applies in the running session at once |
| A description, saved from the card | **nothing** — the frontmatter is re-read with the catalogue |
| Installing a **new** plugin | the page reloaded (F5), so the browser fetches its bundle |
| Updating an already-installed plugin | `dsh web` restarted: the running server keeps the build it started with |

## What it shows

Skills are grouped by root and each root shows its rank, because **the lower rank
wins**: the same name in two roots is served from one of them, and the copy that
loses is marked **shadowed** with the root that beat it.

Roots DSH resolves:

| Rank | Root |
|---|---|
| 100 | `<project>/.dsh/skills` |
| 200 | `<project>/.agents/skills` |
| 300 | custom directories (`DSH_SKILLS`) |
| 400 | `$DSH_HOME/skills` |
| 500 | `$DSH_AGENTS_HOME/skills` |

Projects come from `$DSH_HOME/storages/workspace.json` — **the same store the
sidebar is built from**. The first version resolved the project from the server's
working directory instead, which is not the project the page is open on, and the
panel came up empty in a live session.

## Skills DSH silently does not register

Shown separately and **not switchable**, because there is nothing to switch: a skill
whose `name` is not kebab-case, is longer than 64 characters, or **does not match its
folder** is not registered, and DSH says nothing about it. The tab names the reason —
otherwise a skill can sit in a root and never be offered, with no message anywhere.

## Safety

The route is reachable from the page, and a rename is not a thing to do to an
arbitrary file. Writes are confined to the roots this plugin scans: a path outside
them is refused and the file is left untouched.

## What the tab does not do

- **Bundled skills** are not listed and cannot be paused: they are host-trusted and
  live outside the user roots.
- **Skill bodies are not edited.** Only the one frontmatter line that is the
  model-facing description.
- **Nothing is deleted.** Pausing renames. Removing a skill is a filesystem action
  and stays a deliberate one rather than a button next to the cursor.
