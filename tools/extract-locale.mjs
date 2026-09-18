/**
 * Extract every locale dictionary from the installed client bundles.
 *
 * The bundles are built JavaScript, so this scans for `locale.register(...)`
 * calls, resolves their namespace and dictionary arguments (string and object
 * literals or same-file identifiers), and parses the object literals as JSON.
 *
 * Usage: node _dsh_mod/locale-extract.mjs [outFile]
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const ROOT = join(HOME, 'profiles', 'node_modules', '@deepseek-ai')
const outFile = process.argv[2] ?? join(here, 'locale-en.json')

/** Walk one directory level of packages (long paths break recursive walks here). */
function clientBundles() {
  const found = []
  for (const name of readdirSync(ROOT)) {
    const file = join(ROOT, name, 'lib', 'client.js')
    try {
      if (statSync(file).isFile()) found.push({ pkg: name, file })
    } catch {}
  }
  return found
}

/** Index of the closing bracket matching the opener at `start`. */
function matchBracket(text, start) {
  const open = text[start]
  const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : undefined
  if (close === undefined) return -1
  let depth = 0
  let inString = null
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString !== null) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === inString) inString = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      inString = char
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Parse an object literal as JSON. Built bundles write dictionary keys and
 * values double-quoted, but a locale map is passed as shorthand or with bare
 * identifier values (`{ zh, en }`, `{ zh: zh$1, en: en$1 }`); those become
 * `"key": key` pairs. Single quotes are deliberately left alone so an English
 * apostrophe inside a value cannot corrupt the object.
 */
/** Why the last `parseObjectLiteral` call failed (diagnostics only). */
let lastParseError = ''

/**
 * Rewrite a JavaScript object literal into strict JSON.
 *
 * A scanner вЂ” not a regex вЂ” because dictionary values are prose that may
 * contain braces (`"{seconds}s"`, `"Tool {toolName} requestsвЂ¦"`): only
 * characters outside string literals may be rewritten. Inside the root object
 * a bare identifier becomes a quoted key (before `:`) or a quoted shorthand
 * pair, and a trailing comma is dropped.
 */
function prepareLiteral(literal, objects) {
  const end = matchBracket(literal, 0)
  const text = end < 0 ? literal : literal.slice(0, end + 1)
  let out = ''
  let index = 0
  let depth = 0
  let expectKey = true
  while (index < text.length) {
    const char = text[index]
    if (char === '"' || char === "'") {
      let cursor = index + 1
      let escaped = false
      while (cursor < text.length) {
        const inner = text[cursor]
        if (escaped) escaped = false
        else if (inner === '\\') escaped = true
        else if (inner === char) {
          cursor += 1
          break
        }
        cursor += 1
      }
      out += text.slice(index, cursor)
      index = cursor
      continue
    }
    // `...OTHER_DICTIONARY` merges another bundle-local object literal.
    if (depth === 1 && text.startsWith('...', index)) {
      let cursor = index + 3
      while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1
      const start = cursor
      while (cursor < text.length && /[\w$]/u.test(text[cursor])) cursor += 1
      const ident = text.slice(start, cursor)
      const target = objects?.get(ident)
      if (target !== undefined) out += prepareLiteral(target, objects).slice(1, -1)
      index = cursor
      continue
    }
    if (char === '{' || char === '[') {
      depth += 1
      out += char
      index += 1
      continue
    }
    if (char === '}' || char === ']') {
      depth -= 1
      out += char
      index += 1
      continue
    }
    if (depth === 1 && char === ',') {
      let cursor = index + 1
      while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1
      if (text[cursor] === '}') {
        index += 1
        continue
      }
      expectKey = true
      out += char
      index += 1
      continue
    }
    if (depth === 1 && char === ':') {
      expectKey = false
      out += char
      index += 1
      continue
    }
    if (depth === 1 && /[A-Za-z_$]/u.test(char)) {
      let cursor = index
      while (cursor < text.length && /[\w$]/u.test(text[cursor])) cursor += 1
      const token = text.slice(index, cursor)
      let peek = cursor
      while (peek < text.length && /\s/u.test(text[peek])) peek += 1
      if (text[peek] === ':') out += `"${token}"`
      else if (expectKey) out += `"${token}": "${token}"`
      else out += `"${token}"`
      index = cursor
      continue
    }
    out += char
    index += 1
  }
  return out
}

function parseObjectLiteral(literal, objects) {
  try {
    lastParseError = ''
    return JSON.parse(prepareLiteral(literal, objects))
  } catch (error) {
    lastParseError = `${error.message} :: ${JSON.stringify(prepareLiteral(literal, objects).slice(0, 200))}`
    return null
  }
}

/** `const X = "value"` and `const X = {...}` bindings in one bundle. */
function collectBindings(text) {
  const strings = new Map()
  const objects = new Map()
  for (const match of text.matchAll(/(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*"((?:[^"\\]|\\.)*)"/gu)) {
    strings.set(match[1], match[2])
  }
  for (const match of text.matchAll(/(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/gu)) {
    const start = text.indexOf('{', match.index + match[0].length - 1)
    const end = matchBracket(text, start)
    if (end > start) objects.set(match[1], text.slice(start, end + 1))
  }
  return { strings, objects }
}

const report = []
const problems = []

for (const { pkg, file } of clientBundles()) {
  const text = readFileSync(file, 'utf8')
  const { strings, objects } = collectBindings(text)
  for (const call of text.matchAll(/locale\.register\(/gu)) {
    const open = text.indexOf('(', call.index)
    const close = matchBracket(text, open)
    if (close < 0) continue
    const args = text.slice(open + 1, close)
    const parts = []
    let depth = 0
    let current = ''
    for (const char of args) {
      if ('{(['.includes(char)) depth += 1
      if ('})]'.includes(char)) depth -= 1
      if (char === ',' && depth === 0) {
        parts.push(current.trim())
        current = ''
        continue
      }
      current += char
    }
    if (current.trim() !== '') parts.push(current.trim())

    const resolveString = (token) => {
      const literal = /^"((?:[^"\\]|\\.)*)"$/u.exec(token)
      if (literal !== null) return literal[1]
      return strings.get(token)
    }
    const resolveObject = (token) => {
      let parsed = null
      let source = token
      if (token.startsWith('{')) {
        source = token.slice(0, matchBracket(token, 0) + 1)
        parsed = parseObjectLiteral(source, objects)
      } else {
        source = objects.get(token)
        parsed = source === undefined ? null : parseObjectLiteral(source, objects)
      }
      if (parsed === null) {
        // A computed projection (`{ "a": accessEn["a"], вЂ¦ }`) fails to parse;
        // its base object carries exactly the keys being projected.
        const projection = /^\{\s*"[^"]*"\s*:\s*([A-Za-z_$][\w$]*)\s*\[/u.exec(String(source).trim())
        const base = projection === null ? undefined : objects.get(projection[1])
        if (base !== undefined) {
          const dict = parseObjectLiteral(base, objects)
          if (dict !== null) return { dict, why: '' }
        }
        return { dict: null, why: 'literal did not parse: ' + lastParseError }
      }
      // `{ zh, en }` / `{ zh: zh$1, en: en$1 }`: a locale map, not a dictionary.
      const values = Object.entries(parsed)
      const isLocaleMap = values.length > 0
        && values.every(([, value]) => typeof value === 'string' && /^[A-Za-z_$][\w$]*$/u.test(value))
      if (!isLocaleMap) return { dict: parsed, why: '' }
      const chosen = values.find(([key]) => /^en/iu.test(key))
        ?? values.find(([, value]) => /^en/iu.test(value))
        ?? values[values.length - 1]
      const literal = objects.get(chosen[1])
      if (literal === undefined) {
        return { dict: null, why: `locale map -> identifier ${chosen[1]} has no object binding (have: ${[...objects.keys()].join('/')})` }
      }
      const dict = parseObjectLiteral(literal, objects)
      return { dict, why: dict === null ? `dictionary ${chosen[1]} did not parse: ${lastParseError}` : '' }
    }

    const ns = resolveString(parts[0] ?? '')
    const perLocale = parts.length >= 3
    const dictToken = perLocale ? parts[2] : parts[1]
    const resolved = resolveObject(dictToken ?? '')
    const dict = resolved.dict
    if (ns === undefined || dict === null) {
      problems.push(`${pkg}: ns=${String(ns)} dict=${String(dictToken)} (${resolved.why})`)
      continue
    }
    const entries = Object.entries(dict).filter(([, value]) => typeof value === 'string')
    report.push({
      pkg,
      ns,
      perLocale,
      count: entries.length,
      dict: Object.fromEntries(entries),
    })
  }
}

const total = report.reduce((sum, entry) => sum + entry.count, 0)
const unique = new Map()
for (const entry of report) {
  const previous = unique.get(entry.ns)
  unique.set(entry.ns, {
    count: (previous?.count ?? 0) + entry.count,
    pkgs: [...(previous?.pkgs ?? []), entry.pkg],
  })
}
writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`, 'utf8')
console.log(`namespaces (register calls): ${String(report.length)}`)
console.log(`distinct namespace ids: ${String(unique.size)}`)
console.log(`translatable strings: ${String(total)}`)
console.log(`unresolved calls: ${String(problems.length)}`)
for (const problem of problems.slice(0, 10)) console.log(`  ! ${problem}`)
console.log('\ntop namespaces by string count:')
for (const [ns, info] of [...unique.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)) {
  console.log(`  ${ns.padEnd(34)} ${String(info.count).padStart(5)}   ${info.pkgs.join(', ')}`)
}
console.log(`\nwritten: ${outFile}`)
