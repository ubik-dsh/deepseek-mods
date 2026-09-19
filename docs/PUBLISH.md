# Publishing this repository

**English** · [Русский](PUBLISH.ru.md)

This repository is ready to publish as-is. Nothing in it is machine-specific:
the installer and the builders take no absolute paths, and no personal data,
credentials, or backups are tracked (see [`.gitignore`](../.gitignore)).

**This copy lives at <https://gitverse.ru/ubikon/dsh-mods>** and is **public** —
a browser can open it, and `git clone` works with no credentials (verified by an
anonymous clone, not assumed). The commands below stay generic — `<user>` and
`<host>` are placeholders on purpose, so the guide works for GitHub, GitVerse, or
any other host, and for anybody publishing a fork.

## 1. Install git

```powershell
winget install --id Git.Git -e    # Windows
```

```bash
sudo apt install git              # Debian/Ubuntu
brew install git                  # macOS
```

Then tell git who you are — the name and e-mail become part of every commit:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## 2. Create the empty repository

**GitHub:** sign in → **New repository** → name it `dsh-mods` → **Public** →
do **not** add a README, .gitignore or license (this repository already has
them) → **Create repository**.

**GitVerse:** sign in at [gitverse.ru](https://gitverse.ru) → **New repository**
→ same choices.

Both give you a URL of the form `https://<host>/<user>/dsh-mods.git`.

## 3. Push

From the repository directory:

```bash
git init -b main
git add .
git commit -m "DSH mods: system prompt editor and Russian language pack"
git remote add origin https://github.com/<user>/dsh-mods.git
git push -u origin main
```

When git asks for a password, **GitHub no longer accepts your account
password** — create a Personal Access Token instead:

> GitHub → Settings → Developer settings → Personal access tokens →
> Fine-grained tokens → Generate new token → Repository access: the repo you
> just created → Permissions: **Contents: Read and write**.

Use the token as the password; the username is your GitHub login. The same
applies to GitVerse, which issues access tokens in its own settings.

## 4. Publish to the second host

One local repository can push to both hosts. Add a second remote and push:

```bash
git remote add gitverse https://gitverse.ru/<user>/dsh-mods.git
git push gitverse main
```

Afterwards `git push` goes to the first host and `git push gitverse` to the
second. To push everywhere at once:

```bash
git remote set-url --add --push origin https://github.com/<user>/dsh-mods.git
git remote set-url --add --push origin https://gitverse.ru/<user>/dsh-mods.git
git push origin main
```

That arrangement has a failure mode worth knowing: when one host rejects the
push and the other accepts it, `git push` still reports an error while leaving
the two copies at different commits. `tools/dev/push-mirrors.mjs` exists for
that — it pushes to each mirror in turn and then says which ones it did **not**
reach, so a half-finished publish cannot be mistaken for a finished one:

```bash
node tools/dev/push-mirrors.mjs            # every mirror
node tools/dev/push-mirrors.mjs --dry-run  # report only
```

It reads each token from a file — `$GITVERSE_TOKEN_FILE`, `$GITHUB_TOKEN_FILE`,
else `~/.dsh-mirror-tokens/<name>` — and scrubs them from everything it prints.

### The token needs the `workflow` scope

A GitHub token with only `repo` is **not** enough for this repository. It ships
`.github/workflows/ci.yaml`, and git refuses to create or update a workflow file
without the `workflow` scope:

```
! [remote rejected] main -> main (refusing to allow a Personal Access Token to
  create or update workflow `.github/workflows/ci.yaml` without `workflow` scope)
```

The push is rejected whole, so nothing partial lands — but it will keep failing
until the token carries both `repo` and `workflow`.

If GitVerse offers importing an existing repository from GitHub in its web
interface, that is one less push — check its current menu for an "Import"
entry.

## 5. Finishing touches

Suggested repository description:

> DSH (DeepSeek Harness) mods: an editable system prompt in the chat header and
> a Russian language pack. Bilingual docs, one-command install.

Suggested topics/tags: `dsh`, `deepseek-harness`, `plugin`, `mod`, `i18n`,
`russian`, `localization`, `system-prompt`.

## Updating

```bash
git add -A
git commit -m "Describe the change"
git push
```

## What must never be committed

Already covered by `.gitignore`, but worth knowing:

| Path | Why |
|---|---|
| `$DSH_HOME/mod-backups/` | contains your `settings.yaml` and your prompt override — personal |
| `$DSH_HOME/.credentials.yaml` | API keys and the browser-session signing secret — **a leak** |
| `node_modules/` | often a junction into the DSH home |
| `_edge-profile*/`, `*.log` | artefacts of the verification harness |

If you ever commit a credentials file by accident, revoke the key immediately:
removing the file from a later commit does not remove it from history.

## Publishing without git

If you would rather not install git: on the repository page use
**Add file → Upload files**, drag the contents of this directory (not the
directory itself), and commit. The browser cannot upload empty directories, but
none are required here.

## The GitVerse public API

`git push` puts the files there; the REST API finishes the job — description,
privacy, and checking whether CI actually ran.

Reference: <https://gitverse.ru/docs/developers/public-api/>

- **Base URL is `https://api.gitverse.ru`** — not `gitverse.ru/api/…`. The Gitea
  style `/api/v1/…` paths answer with HTML 404.
- **Auth:** `Authorization: Bearer <token>`.
- **Required header:** `Accept: application/vnd.gitverse.object+json;version=1`.
  Without it the API answers with HTML instead of JSON, which looks like a wrong
  URL but is a missing header.
- **Token:** Settings → Tokens. The scope **Repositories: Read and write** covers
  every call below; nothing else is needed.

| Task | Call |
|---|---|
| Who the token belongs to | `GET /user` |
| Repository state | `GET /repos/{owner}/{repo}` |
| Branches (verify a push) | `GET /repos/{owner}/{repo}/branches` |
| One file | `GET /repos/{owner}/{repo}/contents/{path}` |
| Commits | `GET /repos/{owner}/{repo}/commits` |
| Set description or privacy | `PATCH /repos/{owner}/{repo}` with `{ "description": "…" }` or `{ "private": true }` |
| Did CI run? | `GET /repos/{owner}/{repo}/actions/runs` |

A token is also what an agent needs to check its own work, so the workflow that
keeps a token out of a chat transcript is worth knowing: **save it to a file and
let the tooling read the file**, rather than pasting it into the conversation.

```powershell
# once, by hand: put the token in a file, never in a command line
Set-Content -Path .gitverse-token -Value '<token>' -NoNewline
```

```powershell
# then the token is only ever a variable
$token = (Get-Content .gitverse-token -Raw).Trim()
git push "https://$env:GITVERSE_USER:$token@gitverse.ru/$env:GITVERSE_USER/dsh-mods.git" main
```

Remember to revoke the token and delete the file when the work is done.
