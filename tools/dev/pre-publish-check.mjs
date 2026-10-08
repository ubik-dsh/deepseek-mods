#!/usr/bin/env node
/**
 * Look at what is about to leave, before it leaves.
 *
 * Why this exists. A `git push` publishes more than the file you just edited: it publishes every
 * commit between the remote and HEAD, and a `git add -A` publishes whatever happened to be lying
 * in the tree. On this repository a reader-only change rode out together with the Russian speech
 * recogniser, because its commits were already local; nothing was wrong, but nobody had looked.
 * A secret scanner answers "is there a key in a blob"; it does not answer "what else is in this
 * push", which is the question that catches accidents.
 *
 * Three answers, never two:
 *
 *   · **will be published** - the files a push or a commit would carry;
 *   · **stays behind** - ignored, or not staged, so it will not travel;
 *   · **needs a decision** - a binary, a big file, a credential-shaped name, a personal path, a
 *     state file. Nothing is deleted and nothing is rewritten; the exit code says "look at this".
 *
 * Usage:
 *   node tools/dev/pre-publish-check.mjs             # staged first, else what a push would carry
 *   node tools/dev/pre-publish-check.mjs --staged    # only the index (this is what the hook runs)
 *   node tools/dev/pre-publish-check.mjs --push      # commits between the remote and HEAD
 *   node tools/dev/pre-publish-check.mjs --all       # both, plus untracked files
 *   node tools/dev/pre-publish-check.mjs --install-hook   # put this in front of every commit
 *
 * Exit code is 1 when anything needs a decision, so it can stand in front of a commit.
 *
 * @module tools/dev/pre-publish-check
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HOOK = `#!/bin/sh
# Поставлено pre-publish-check.mjs --install-hook.
# Смотрит, что уедет, ДО коммита: имена-секреты, большие файлы, чужие пути.
node tools/dev/pre-publish-check.mjs --staged || {
  echo ""
  echo "коммит остановлен: посмотри причины выше."
  echo "Если файл нужен на самом деле: git commit --no-verify"
  exit 1
}
`

/** Run git and return its trimmed stdout; `null` when the command fails.
 *
 * `core.quotepath=false` is not cosmetic: without it git escapes non-ASCII paths, so a file
 * named `числа.py` arrives as `"\321\207..."`, its extension is unreadable and its content is
 * fetched under a name that does not exist. This repository is full of Russian file names. */
function git(args) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/** Run git with the output split into lines, dropping the empty tail. */
function gitLines(args) {
  const out = git(args)
  return out === null || out === '' ? [] : out.split(/\r?\n/u)
}

/**
 * Names that mean "state, credentials or a machine-specific file".
 * Deliberately narrow: a false alarm on a normal source file makes the check something to skip.
 */
const BLOCKED_NAMES = [
  /(^|[/\\])\.env(\.|$)/iu, /(^|[/\\])dsh-api\.json$/iu, /(^|[/\\])credentials?\.(ya?ml|json)$/iu,
  /(^|[/\\])[^/\\]*token[^/\\]*\.(json|txt|ya?ml)$/iu, /(^|[/\\])[^/\\]*cookie[^/\\]*$/iu,
  /(^|[/\\])id_(rsa|ed25519)(\.pub)?$/iu, /\.(pem|key|pfx|p12|jks)$/iu,
  // Русские имена: репозиторий русский, и файл «секрет.json» это ровно тот случай.
  /(^|[/\\])[^/\\]*(секрет|пароль|токен|куки|доступ)[^/\\]*$/iu,
]

/** Extensions that are models, recordings, logs or databases: never source. */
const BLOCKED_EXTENSIONS = ['.pt', '.onnx', '.ckpt', '.safetensors', '.bin', '.wav', '.mp3', '.zst', '.jsonl', '.log', '.sqlite', '.db', '.pth']

/** Extensions worth a human glance: they are legitimate, and they are also large. */
const WARN_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.pptx', '.xlsx', '.zip', '.7z']

/** Content that should not be in a published repository, and how to look for it. */
const CONTENT_RULES = [
  { why: 'личный путь с именем пользователя', pattern: /[A-Za-z]:\\Users\\(?!<|%|\.\.\.)[A-Za-z0-9._-]+/u },
  { why: 'похоже на токен доступа', pattern: /\b(ghp_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{15,}|sk-[A-Za-z0-9]{20,})/u },
  { why: 'ключ или сертификат в тексте', pattern: /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/u },
  { why: 'заголовок авторизации', pattern: /\bAuthorization:\s*Bearer\s+\S{20,}/u },
  { why: 'имя файла-состояния в коде', pattern: /\bdsh-api\.json\b/u },
  // Присваивание с длинным значением, а не упоминание слова: иначе правило ловит прозу и
  // собственный сканер секретов, где такие слова стоят в образцах, а не в значениях.
  { why: 'похоже на секрет в присваивании', pattern: /\b(cookie|token|password|secret|api[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9_\-.]{16,}/iu },
  { why: 'секрет по-русски в присваивании', pattern: /\b(пароль|токен|секрет|куки)\b\s*[:=]\s*["']?\S{16,}/iu },
]

const MB = 1024 * 1024
const BIG_WARN = 2 * MB
const BIG_BLOCK = 20 * MB

/** Files a push would carry: what is on HEAD and not on the upstream. */
function pushRange() {
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream === null || upstream === '') return { upstream: null, files: [], commits: [] }
  const files = gitLines(['diff', '--name-only', `${upstream}..HEAD`])
  const commits = gitLines(['log', '--oneline', `${upstream}..HEAD`])
  return { upstream, files, commits }
}

/** Files in the index right now. */
function stagedFiles() {
  return gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
}

/** Untracked files, which `git add -A` would pick up. */
function untrackedFiles() {
  return gitLines(['ls-files', '--others', '--exclude-standard'])
}

/** Size of a path in the index or on disk; `null` when it cannot be measured. */
function sizeOf(path, fromIndex) {
  if (fromIndex) {
    const raw = git(['cat-file', '-s', `:${path}`])
    return raw === null ? null : Number(raw)
  }
  const raw = git(['cat-file', '-s', `HEAD:${path}`])
  return raw === null ? null : Number(raw)
}

/** Text content of a file in the index or on HEAD; `null` for binary or oversized. */
function contentOf(path, fromIndex) {
  const spec = fromIndex ? `:${path}` : `HEAD:${path}`
  try {
    const out = execFileSync('git', ['show', spec], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * MB })
    return out
  } catch {
    return null
  }
}

/**
 * Files whose own content is the patterns, and which therefore trip every content rule.
 *
 * The list is deliberately exact paths, not patterns: a scanner that exempts anything holding the
 * word "token" exempts the very files this check exists to catch. These are the checkers themselves
 * (the third one looks for machine paths in plugin layers, so its own source holds those patterns);
 * everything else, including this file's own siblings, is judged normally.
 */
const SELF_EXEMPT = new Set([
  'tools/dev/pre-publish-check.mjs',
  'tools/dev/scan-secrets.mjs',
  'tools/dev/check-plugin-bundles.mjs',
])

/** Judge one file; returns a list of reasons, each with a severity. */
function judge(path, size, content) {
  const found = []
  const name = path.replace(/\\/gu, '/')
  const exempt = SELF_EXEMPT.has(name)
  for (const pattern of BLOCKED_NAMES) {
    if (pattern.test(name)) found.push({ level: 'block', why: `имя файла не для публикации (${pattern})` })
  }
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (BLOCKED_EXTENSIONS.includes(extension)) found.push({ level: 'block', why: `расширение ${extension} это не исходник` })
  if (WARN_EXTENSIONS.includes(extension)) found.push({ level: 'warn', why: `вложение ${extension}, проверь глазами` })
  if (size !== null && size >= BIG_BLOCK) found.push({ level: 'block', why: `${(size / MB).toFixed(1)} МБ, слишком много для репозитория` })
  else if (size !== null && size >= BIG_WARN) found.push({ level: 'warn', why: `${(size / MB).toFixed(1)} МБ` })
  if (path.split('/').some((part) => part.startsWith('_') && part !== '_')) {
    found.push({ level: 'warn', why: 'рабочая папка с подчёркиванием, обычно не для публикации' })
  }
  if (content !== null && !exempt) {
    for (const rule of CONTENT_RULES) {
      if (rule.pattern.test(content)) found.push({ level: 'block', why: rule.why })
    }
  }
  return found
}

function report(title, files, fromIndex) {
  const rows = []
  for (const path of files) {
    const size = sizeOf(path, fromIndex)
    const content = size !== null && size < BIG_WARN ? contentOf(path, fromIndex) : null
    rows.push({ path, size, reasons: judge(path, size, content) })
  }
  const blocked = rows.filter((row) => row.reasons.some((reason) => reason.level === 'block'))
  const warned = rows.filter((row) => row.reasons.length > 0 && !blocked.includes(row))
  console.log(`\n${title}: ${files.length} файл(ов)`)
  for (const row of blocked) {
    console.log(`  СТОП   ${row.path}`)
    for (const reason of row.reasons) console.log(`         ${reason.why}`)
  }
  for (const row of warned) {
    console.log(`  взгляд ${row.path}`)
    for (const reason of row.reasons) console.log(`         ${reason.why}`)
  }
  if (files.length > 0 && blocked.length === 0 && warned.length === 0) {
    console.log('  всё чисто: ни имён-секретов, ни больших файлов, ни чужих путей')
  }
  return blocked.length
}

function main() {
  const argv = process.argv.slice(2)
  const onlyStaged = argv.includes('--staged')
  const onlyPush = argv.includes('--push')
  const everything = argv.includes('--all')
  const installHook = argv.includes('--install-hook')

  const root = git(['rev-parse', '--show-toplevel'])
  if (root === null) {
    console.log('это не репозиторий git')
    return 2
  }

  if (installHook) {
    const hooksDir = git(['rev-parse', '--git-path', 'hooks']) ?? join(root, '.git', 'hooks')
    const target = join(root, hooksDir.endsWith('hooks') ? hooksDir : join(hooksDir, 'hooks'), 'pre-commit')
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, HOOK, 'utf8')
    try {
      chmodSync(target, 0o755)
    } catch {
      // Windows не хранит права так, git for Windows запускает хук и без них.
    }
    console.log(`хук поставлен: ${target}`)
    console.log('теперь каждый коммит сначала проходит эту проверку')
    return 0
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '?'
  console.log(`репозиторий: ${root}\nветка: ${branch}`)

  let blocked = 0
  const staged = stagedFiles()
  const range = pushRange()

  if (!onlyPush) {
    if (staged.length > 0) {
      blocked += report('в коммите (индекс)', staged, true)
    } else if (!onlyStaged) {
      console.log('\nв коммите (индекс): пусто, ничего не готово к коммиту')
    }
  }

  if (!onlyStaged) {
    if (range.upstream === null) {
      console.log('\nпубликация: удалённая ветка не настроена, проверить нечего')
    } else if (range.commits.length === 0) {
      console.log(`\nпубликация: ${range.upstream} уже догнал HEAD, уезжать нечему`)
    } else {
      console.log(`\nпубликация: ${range.commits.length} коммит(ов) уедет в ${range.upstream}`)
      for (const line of range.commits.slice(0, 12)) console.log(`  ${line}`)
      if (range.commits.length > 12) console.log(`  ... и ещё ${range.commits.length - 12}`)
      blocked += report('уедет в этих коммитах', range.files, false)
    }
  }

  if (everything || (!onlyStaged && !onlyPush)) {
    const untracked = untrackedFiles()
    if (untracked.length > 0) {
      console.log(`\nне отслеживается: ${untracked.length} файл(ов), их заберёт "git add -A"`)
      for (const path of untracked.slice(0, 20)) console.log(`  ${path}`)
      if (untracked.length > 20) console.log(`  ... и ещё ${untracked.length - 20}`)
    }
  }

  console.log('')
  if (blocked > 0) {
    console.log(`НУЖНО РЕШЕНИЕ: ${blocked} файл(ов) с причиной. Посмотри их выше.`)
    console.log('Если файл действительно нужен: git commit --no-verify, и напиши в сообщении почему.')
    return 1
  }
  console.log('PASS — ничего подозрительного в том, что уезжает.')
  return 0
}

process.exit(main())
