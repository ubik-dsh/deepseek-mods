/**
 * Split the extracted English dictionaries into per-namespace source files and
 * balanced work groups for parallel translation.
 *
 * Usage: node _dsh_mod/locale-chunk.mjs [groups]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const groupCount = Number(process.argv[2] ?? 8)
const entries = JSON.parse(readFileSync(join(here, 'locale-en.json'), 'utf8'))

/** Merge every registration of one namespace into a single key set. */
const merged = new Map()
for (const entry of entries) {
  const current = merged.get(entry.ns) ?? {}
  for (const [key, value] of Object.entries(entry.dict)) {
    if (current[key] === undefined) current[key] = value
  }
  merged.set(entry.ns, current)
}

const enDir = join(here, 'i18n', 'en')
mkdirSync(enDir, { recursive: true })

const units = []
for (const [ns, dict] of merged) {
  const file = join(enDir, `${ns}.json`)
  writeFileSync(file, `${JSON.stringify(dict, null, 1)}\n`, 'utf8')
  const weight = Object.entries(dict)
    .reduce((sum, [key, value]) => sum + key.length + value.length + 8, 0)
  units.push({ ns, file, keys: Object.keys(dict).length, weight })
}

// Longest-processing-time first: biggest namespaces lead, so the groups balance.
units.sort((a, b) => b.weight - a.weight)
const groups = Array.from({ length: groupCount }, (_, index) => ({ index, units: [], weight: 0 }))
for (const unit of units) {
  const target = groups.reduce((best, group) => (group.weight < best.weight ? group : best), groups[0])
  target.units.push(unit)
  target.weight += unit.weight
}

const manifest = groups.map((group) => ({
  group: group.index,
  namespaces: group.units.map((unit) => unit.ns),
  keys: group.units.reduce((sum, unit) => sum + unit.keys, 0),
  weight: group.weight,
}))
writeFileSync(join(here, 'i18n', 'groups.json'), `${JSON.stringify(manifest, null, 1)}\n`, 'utf8')

console.log(`namespaces: ${String(units.length)}  keys: ${String(units.reduce((s, u) => s + u.keys, 0))}`)
console.log(`source files: ${enDir}`)
for (const group of manifest) {
  console.log(`  group ${String(group.group)}: ${String(group.keys).padStart(4)} keys, weight ${String(group.weight).padStart(6)} -> ${group.namespaces.join(', ')}`)
}
