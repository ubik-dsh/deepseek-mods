# Публикация репозитория

[English](PUBLISH.md) · **Русский**

Репозиторий готов к публикации как есть. В нём нет ничего привязанного к
конкретной машине: установщик и сборщики не содержат абсолютных путей, а
личные данные, ключи и бэкапы не отслеживаются (см.
[`.gitignore`](../.gitignore)).

## 1. Установить git

```powershell
winget install --id Git.Git -e    # Windows
```

```bash
sudo apt install git              # Debian/Ubuntu
brew install git                  # macOS
```

Затем представься — имя и почта попадут в каждый коммит:

```bash
git config --global user.name "Ваше Имя"
git config --global user.email "you@example.com"
```

## 2. Создать пустой репозиторий

**GitHub:** войти → **New repository** → имя `dsh-mods` → **Public** → **не**
добавлять README, .gitignore и лицензию (они уже есть в репозитории) →
**Create repository**.

**GitVerse:** войти на [gitverse.ru](https://gitverse.ru) → **Новый репозиторий**
→ те же варианты.

Оба выдадут адрес вида `https://<хост>/<пользователь>/dsh-mods.git`.

## 3. Запушить

Из каталога репозитория:

```bash
git init -b main
git add .
git commit -m "DSH mods: system prompt editor and Russian language pack"
git remote add origin https://github.com/<пользователь>/dsh-mods.git
git push -u origin main
```

Когда git спросит пароль, **GitHub больше не принимает пароль от аккаунта** —
нужен Personal Access Token:

> GitHub → Settings → Developer settings → Personal access tokens →
> Fine-grained tokens → Generate new token → Repository access: созданный
> репозиторий → Permissions: **Contents: Read and write**.

В поле пароля вставляй токен, имя пользователя — твой логин на GitHub. У
GitVerse то же самое: токены выдаются в его настройках.

## 4. Опубликовать на втором хостинге

Один локальный репозиторий может пушить в оба места. Добавь второй remote:

```bash
git remote add gitverse https://gitverse.ru/<пользователь>/dsh-mods.git
git push gitverse main
```

Дальше `git push` идёт на первый хостинг, `git push gitverse` — на второй. Чтобы
пушить сразу везде:

```bash
git remote set-url --add --push origin https://github.com/<пользователь>/dsh-mods.git
git remote set-url --add --push origin https://gitverse.ru/<пользователь>/dsh-mods.git
git push origin main
```

Если в веб-интерфейсе GitVerse есть импорт существующего репозитория с GitHub —
это на один пуш меньше; поищи в текущем меню пункт «Импорт».

## 5. Оформление

Описание репозитория:

> Моды для DSH (DeepSeek Harness): редактируемый системный промпт в шапке чата
> и русская локализация. Документация на двух языках, установка одной командой.

Теги: `dsh`, `deepseek-harness`, `plugin`, `mod`, `i18n`, `russian`,
`localization`, `system-prompt`.

## Обновление

```bash
git add -A
git commit -m "Что изменилось"
git push
```

## Что нельзя коммитить

Это уже закрыто `.gitignore`, но знать стоит:

| Путь | Почему |
|---|---|
| `$DSH_HOME/mod-backups/` | там твой `settings.yaml` и правка промпта — личное |
| `$DSH_HOME/.credentials.yaml` | ключи API и секрет подписи браузерной сессии — **утечка** |
| `node_modules/` | часто это junction в домашний каталог DSH |
| `_edge-profile*/`, `*.log` | артефакты стенда проверки |

Если файл с ключами всё же попал в коммит — сразу отзывай ключ: удаление файла
следующим коммитом не убирает его из истории.

## Публикация без git

Если ставить git не хочется: на странице репозитория — **Add file → Upload
files**, перетащи содержимое этого каталога (не сам каталог) и закоммить.
Браузер не умеет загружать пустые каталоги, но здесь они и не нужны.

## Публичный API GitVerse

`git push` кладёт файлы, а REST API доводит дело до конца: описание, приватность
и проверка того, что CI действительно отработал.

Документация: <https://gitverse.ru/docs/developers/public-api/>

- **База — `https://api.gitverse.ru`**, а не `gitverse.ru/api/…`. Пути в стиле
  Gitea (`/api/v1/…`) отвечают HTML-страницей 404.
- **Авторизация:** `Authorization: Bearer <токен>`.
- **Обязательный заголовок:** `Accept: application/vnd.gitverse.object+json;version=1`.
  Без него API отдаёт HTML вместо JSON — выглядит как неверный адрес, а на самом
  деле не хватает заголовка.
- **Токен:** Настройки → Токены. Права **Репозитории: Чтение + Запись** покрывают
  все вызовы ниже; больше ничего не нужно.

| Задача | Вызов |
|---|---|
| Кому принадлежит токен | `GET /user` |
| Состояние репозитория | `GET /repos/{owner}/{repo}` |
| Ветки (проверить пуш) | `GET /repos/{owner}/{repo}/branches` |
| Один файл | `GET /repos/{owner}/{repo}/contents/{path}` |
| Коммиты | `GET /repos/{owner}/{repo}/commits` |
| Задать описание или приватность | `PATCH /repos/{owner}/{repo}` с `{ "description": "…" }` или `{ "private": true }` |
| Отработал ли CI | `GET /repos/{owner}/{repo}/actions/runs` |

Токен же нужен агенту, чтобы проверять свою работу. Поэтому полезно знать приём,
который не пускает токен в переписку: **сохранить его в файл и дать инструментам
читать файл**, а не вставлять в чат.

```powershell
# один раз, руками: токен попадает в файл, а не в командную строку
Set-Content -Path .gitverse-token -Value '<токен>' -NoNewline
```

```powershell
# дальше токен — просто переменная
$token = (Get-Content .gitverse-token -Raw).Trim()
git push "https://$env:GITVERSE_USER:$token@gitverse.ru/$env:GITVERSE_USER/dsh-mods.git" main
```

Не забудь отозвать токен и удалить файл, когда работа закончена.
