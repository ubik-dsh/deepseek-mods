#!/usr/bin/env node
/**
 * Check every package that claims to be an installable plugin bundle.
 *
 * Why this exists. The Plugins panel installs **bundles**, and a bundle is a package whose manifest
 * declares `dsh.bundle.patch`: a layer of loader rows that travels with the package. Two mistakes in
 * that layer are invisible until a user installs it on another machine:
 *
 * 1. **A machine path inside a published layer.** The layer is copied into a shared repository, so a
 *    path like `C:\Users\someone\...` either breaks or leaks where it came from. Settings that
 *    differ per machine belong in the environment or next to the package, never in the layer.
 * 2. **A layer that inserts something else.** The row's `name` must be the package's own name, or
 *    installing the bundle mounts a different module than the one it ships.
 *
 * The check is deliberately small and exact: it reads each `dsh.bundle.patch` file, parses it,
 * and reports. It cannot prove the bundle installs (that needs pnpm and a profile), and it says so.
 *
 * Usage:
 *   node tools/dev/check-plugin-bundles.mjs
 *   node tools/dev/check-plugin-bundles.mjs --json
 *
 * @module tools/dev/check-plugin-bundles
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(HERE))
const PACKAGES = join(REPO, 'packages')

/** Paths that only exist on one machine, which a published layer must never carry. */
const MACHINE_PATHS = [
  { why: 'путь Windows с именем пользователя', pattern: /[A-Za-z]:\\Users\\[^'"\s]+/u },
  { why: 'домашний путь Unix', pattern: /\/(home|Users)\/[A-Za-z0-9._-]+\//u },
  { why: 'путь к программе на конкретной машине', pattern: /[A-Za-z]:\\(Program Files|Python|Windows)[^'"\s]*/u },
]

/** Packages in this checkout, from their manifests. */
function readPackages() {
  const found = []
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(PACKAGES, entry.name, 'package.json')
    if (!existsSync(manifestPath)) continue
    try {
      found.push({ dir: entry.name, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) })
    } catch (error) {
      found.push({ dir: entry.name, error: `манифест не разобран: ${error.message}` })
    }
  }
  return found
}

/** Parse the small subset of YAML a patch layer uses: `- insert:` lists with `id`/`name`. */
function rowsOf(text) {
  const rows = []
  let current = null
  for (const line of text.split(/\r?\n/u)) {
    const id = /^\s*-\s*id:\s*(\S+)\s*$/u.exec(line)
    if (id !== null) {
      current = { id: id[1] }
      rows.push(current)
      continue
    }
    const name = /^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/u.exec(line)
    if (name !== null && current !== null && current.name === undefined) current.name = name[1]
  }
  return rows
}

function main() {
  const json = process.argv.includes('--json')
  const report = []
  let problems = 0

  for (const entry of readPackages()) {
    if (entry.error !== undefined) {
      report.push({ package: entry.dir, status: 'манифест не разобран', detail: entry.error })
      problems += 1
      continue
    }
    const patch = entry.manifest?.dsh?.bundle?.patch
    if (patch === undefined) continue // не плагин-bundle, проверять нечего

    const patchPath = join(PACKAGES, entry.dir, patch)
    if (!existsSync(patchPath)) {
      report.push({ package: entry.manifest.name, status: 'слой объявлен, файла нет', detail: patch })
      problems += 1
      continue
    }
    const text = readFileSync(patchPath, 'utf8')
    const rows = rowsOf(text)
    const issues = []

    if (rows.length === 0) issues.push('в слое нет ни одной строки с id')
    const names = new Set(rows.map((row) => row.name).filter(Boolean))
    if (!names.has(entry.manifest.name)) {
      issues.push(`слой не вставляет сам пакет: ожидалось name: ${entry.manifest.name}, `
        + `найдено ${[...names].join(', ') || 'ничего'}`)
    }
    const ids = rows.map((row) => row.id)
    if (new Set(ids).size !== ids.length) issues.push(`повторяющиеся id: ${ids.join(', ')}`)
    for (const rule of MACHINE_PATHS) {
      if (rule.pattern.test(text)) issues.push(`машинный путь в опубликованном слое: ${rule.why}`)
    }
    if (/DSH_VOICE|process\.env/u.test(text) === false && entry.dir === 'voice-stream') {
      issues.push('в слое говорилки нет ни одной настройки, а путей быть и не должно: проверьте, '
        + 'что плагин берёт их из окружения')
    }

    if (issues.length === 0) {
      report.push({ package: entry.manifest.name, status: 'ok', detail: `${rows.length} строк(и), ${patch}` })
    } else {
      report.push({ package: entry.manifest.name, status: 'ОШИБКА', detail: issues.join('; ') })
      problems += issues.length
    }
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ problems, report }, null, 2)}\n`)
    process.exit(problems === 0 ? 0 : 1)
  }

  console.log('плагины-bundle в этом репозитории:\n')
  for (const row of report) {
    console.log(`  ${row.status === 'ok' ? 'ok     ' : 'ОШИБКА '} ${row.package}`)
    console.log(`          ${row.detail}`)
  }
  console.log('')
  if (problems > 0) {
    console.log(`ПРОВАЛ — ${problems} замечани(й). Слой плагина это опубликованный файл: путей `
      + 'конкретной машины в нём быть не должно.')
    process.exit(1)
  }
  console.log('PASS — слои плагинов чистые. Установку целиком этот тест не проверяет: '
    + 'для неё нужны pnpm и профиль.')
  process.exit(0)
}

main()
