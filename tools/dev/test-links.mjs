/**
 * Check every relative link and image reference in the repository's Markdown.
 *
 * A public repository is read through its links: a relative path that no longer
 * exists, or a `#anchor` that no heading produces, is a dead end for a reader.
 * This walks every `.md` file and fails on either.
 *
 * Absolute URLs are syntax-checked only — this tool never touches the network,
 * so it stays usable in CI. Anchors are slugified the way GitHub and GitVerse
 * do: lowercased, links unwrapped, punctuation dropped, spaces to hyphens,
 * non-Latin letters kept.
 *
 * Usage:
 *   node tools/dev/test-links.mjs
 *
 * Exit code is 0 when everything resolves, 1 otherwise.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root: this file lives in `tools/dev/`. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP_DIRS = new Set(['.git', 'node_modules'])

/** Every Markdown file in the repository. */
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (entry.endsWith('.md')) files.push(full)
  }
}
walk(REPO)

/** Heading text to the anchor a browser would jump to. */
const slug = (heading) =>
  heading
    .trim()
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')

/**
 * Anchors a Markdown file offers, ignoring headings inside fenced code.
 *
 * Lines are split on any line ending: `.` does not match `\r`, so keeping the
 * carriage returns of a CRLF file makes the heading pattern match nothing at
 * all — a silent, total false alarm.
 */
const anchorsOf = (path) => {
  const anchors = new Set()
  let inFence = false
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading !== null) anchors.add(slug(heading[1]))
    for (const explicit of line.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(explicit[1])
  }
  return anchors
}

const anchorCache = new Map()
const anchorsFor = (path) => {
  if (!anchorCache.has(path)) anchorCache.set(path, anchorsOf(path))
  return anchorCache.get(path)
}

const problems = []
let checked = 0

for (const file of files) {
  const dir = dirname(file)
  const rel = relative(REPO, file).replace(/\\/g, '/')
  let inFence = false
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return
      }
      if (inFence) return
      for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)]*)\)/g)) {
        const raw = match[1].trim()
        checked += 1
        const at = `${rel}:${String(index + 1)}`

        // A target is a bare path or URL, optionally angle-bracketed, optionally
        // followed by a quoted title. Anything else — a raw space in the middle,
        // most often — does not render as a link at all, so it is reported
        // rather than silently skipped the way a stricter pattern would skip it.
        if (!/^(?:<[^>]*>|\S+)(?:\s+"[^"]*")?$/.test(raw)) {
          problems.push(`${at}  malformed link target: ${raw}`)
          continue
        }
        const target = raw.startsWith('<')
          ? raw.slice(1, raw.indexOf('>'))
          : raw.replace(/\s+"[^"]*"$/, '')

        if (/^(https?:|mailto:)/.test(target)) continue

        const [pathPart, fragment] = target.split('#')
        const targetFile = pathPart === '' ? file : resolve(dir, decodeURIComponent(pathPart))
        if (pathPart !== '' && !existsSync(targetFile)) {
          problems.push(`${at}  missing file: ${target}`)
          continue
        }
        if (fragment !== undefined && fragment !== '' && targetFile.endsWith('.md')) {
          if (!anchorsFor(targetFile).has(fragment.toLowerCase())) {
            problems.push(`${at}  missing anchor #${fragment} in ${relative(REPO, targetFile).replace(/\\/g, '/')}`)
          }
        }
      }
    })
}

console.log(`markdown files: ${String(files.length)}`)
console.log(`relative links checked: ${String(checked)}`)
if (problems.length === 0) {
  console.log('PASS — every relative link and anchor resolves')
  process.exit(0)
}
console.log('')
console.log(`FAIL — ${String(problems.length)} problem(s):`)
for (const problem of problems) console.log(`  ${problem}`)
process.exit(1)
