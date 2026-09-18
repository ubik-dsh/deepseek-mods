# Publishing this repository

**English** · [Русский](PUBLISH.ru.md)

This repository is ready to publish as-is. Nothing in it is machine-specific:
the installer and the builders take no absolute paths, and no personal data,
credentials, or backups are tracked (see [`.gitignore`](../.gitignore)).

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
