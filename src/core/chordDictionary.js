/**
 * Names for pitch-class sets, from the ChordDictionary/SetTheory database --
 * roughly 2000 sets generated from Pascal's triangle and named by hand.
 *
 * The parser works from rules, not lookups; this is here so the app can tell you
 * what it thinks you typed ("Dominant 7 (9)"), and so a verbose spelling that
 * the rule parser chokes on can still be resolved by name.
 *
 * Loaded lazily -- it is ~190KB and nothing depends on it before first paint.
 *
 * @see https://github.com/ChordDictionary/SetTheory
 */

let data = null
let pending = null

export async function loadChordDictionary() {
  if (data) return data
  if (!pending) {
    pending = import('../data/chordSets.json')
      .then((module) => {
        data = module.default || module
        return data
      })
      .catch(() => {
        data = { sets: {}, byName: {} }
        return data
      })
  }
  return pending
}

const key = (pcs) => [...new Set(pcs.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b).join(',')

/** Every name the database has for this set, best first. */
function namesForSet(pcs) {
  if (!data || !pcs || !pcs.length) return []
  return data.sets[key(pcs)] || []
}

/** The name to show in the readout. */
export function nameForSet(pcs) {
  const names = namesForSet(pcs)
  return names.length ? names[0] : null
}

/** Resolve a written-out chord name ("minormajor7") to a pitch-class set. */
export function setForName(name) {
  if (!data) return null
  const slug = String(name || '')
    .toLowerCase()
    .replace(/triad|chord/g, '')
    .replace(/[^a-z0-9#b]/g, '')
  const found = data.byName[slug]
  return found ? found.split(',').map(Number) : null
}

/** Free-text search over the database, for the chord reference in settings. */
export function searchChords(query, limit = 60) {
  if (!data || !query) return []
  const needle = query.toLowerCase()
  const out = []
  for (const [set, names] of Object.entries(data.sets)) {
    for (const name of names) {
      if (name.toLowerCase().includes(needle)) {
        out.push({ set: set.split(',').map(Number), name })
        break
      }
    }
    if (out.length >= limit) break
  }
  return out
}
