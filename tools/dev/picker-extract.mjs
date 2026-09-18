/**
 * Extract the one dictionary the main scanner cannot follow: the directory
 * browser builds `[["zh", {…}], ["en", {…}]]` inside `apply` and registers it
 * in a loop, so the call arguments are variables rather than literals.
 *
 * Usage: node _dsh_mod/picker-extract.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const file = 'C:\\Users\\admin\\.dsh\\profiles\\node_modules\\@deepseek-ai\\dsh-client-ui-directory-picker-browse\\lib\\client.js'
const text = readFileSync(file, 'utf8')

/** Index of the bracket matching the opener at `start`, ignoring string bodies. */
function matchBracket(source, start) {
  const open = source[start]
  const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : undefined
  let depth = 0
  let quote = null
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
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

const anchor = text.indexOf('const dictionaries = [')
if (anchor < 0) throw new Error('dictionaries array not found')
const start = text.indexOf('[', anchor)
const end = matchBracket(text, start)
const literal = text.slice(start, end + 1)

// Elements are `["zh", {…}]` pairs whose object bodies are already strict JSON,
// so a split on top level commas plus a plain JSON.parse is enough here.
const elements = []
let depth = 0
let quote = null
let escaped = false
let current = ''
for (const char of literal.slice(1, -1)) {
  if (quote !== null) {
    current += char
    if (escaped) escaped = false
    else if (char === '\\') escaped = true
    else if (char === quote) quote = null
    continue
  }
  if (char === '"' || char === "'") {
    quote = char
    current += char
    continue
  }
  if ('{[('.includes(char)) depth += 1
  if ('}])'.includes(char)) depth -= 1
  if (char === ',' && depth === 0) {
    elements.push(current.trim())
    current = ''
    continue
  }
  current += char
}
if (current.trim() !== '') elements.push(current.trim())

const localeNs = /const LOCALE_NS = "([^"]+)"/u.exec(text)?.[1] ?? 'directory-browser'
const output = {}
for (const element of elements) {
  const locale = /^\[\s*"([^"]+)"/u.exec(element)?.[1]
  const objectStart = element.indexOf('{')
  const objectEnd = matchBracket(element, objectStart)
  if (locale === undefined || objectStart < 0) continue
  const dict = JSON.parse(element.slice(objectStart, objectEnd + 1))
  output[locale] = dict
}

const english = output.en ?? {}
writeFileSync(join(here, 'i18n', 'en', `${localeNs}.json`), `${JSON.stringify(english, null, 1)}\n`, 'utf8')
console.log(`namespace: ${localeNs}`)
console.log(`locales found: ${Object.keys(output).join(', ')}`)
console.log(`english keys: ${String(Object.keys(english).length)}`)
console.log(JSON.stringify(english, null, 1))
