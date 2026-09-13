/**
 * The lick catalogue: Impro-Visor's vocabulary, as phrases.
 *
 * Each entry is one chord's worth of music plus the chord it was written over,
 * which is exactly jamin's phrase model -- so a lick can be adopted into the
 * phrase book and re-pointed at any chord by the same voice-leading code that
 * handles something you played yourself.
 *
 * Browsed, not bound directly: picking one copies it into your phrase library
 * under a name of its own, so the chart keeps referring to one namespace and
 * stays readable.
 *
 * The catalogue is built in the page from the vocabulary file itself, so what
 * ships here is Impro-Visor's own `My.voc`, unmodified, rather than a converted
 * artifact sitting beside it that could drift. It also means you can rebuild
 * from a different vocabulary -- your own `My.voc`, or a URL -- without a build
 * step.
 *
 * Vocabulary from Impro-Visor (Robert Keller / Harvey Mudd College),
 * GPL-2.0-or-later. @see https://github.com/Impro-Visor/Impro-Visor
 */

import { resourceOk } from './fetchResource.js'
import { parseChord } from './chordParser.js'
import { parseVocabulary } from './vocParser.js'
import { normalizePhrase } from './phrases.js'

let defaultUrl = null

/** Resolved lazily: `URL` does not exist in the headless test runner. */
export function defaultVocabularyUrl() {
  if (!defaultUrl) defaultUrl = new URL('../data/My.voc', import.meta.url).href
  return defaultUrl
}

let cache = null
let pending = null
let lastReport = null

/**
 * Build the catalogue. Cheap enough to do in the page -- a few tens of
 * milliseconds for the shipped vocabulary -- and kicked off in the background
 * once the chart is up, so it is ready before anyone opens the tab.
 */
export async function loadLicks(options = {}) {
  if (cache && !options.force && !options.text && !options.url) return cache
  if (pending && !options.force && !options.text && !options.url) return pending

  pending = build(options)
    .then((result) => {
      cache = result.licks
      lastReport = result.report
      return cache
    })
    .catch((error) => {
      cache = cache || []
      lastReport = { error: error && error.message ? error.message : String(error), total: 0 }
      return cache
    })
    .finally(() => {
      pending = null
    })

  return pending
}

async function build(options) {
  const started = Date.now()
  let text = options.text
  let source = 'your vocabulary'

  if (text === undefined) {
    const url = options.url || defaultVocabularyUrl()
    source = options.url || 'Impro-Visor'

    // The vocabulary we ship is same-origin, so it always loads. A URL someone
    // types is a cross-origin fetch, and a browser will refuse it unless that
    // server sends the CORS headers -- the failure arrives as an opaque
    // TypeError with nothing useful in it, so say what it usually means.
    let response
    try {
      response = await fetch(url)
    } catch (error) {
      throw new Error(
        `could not fetch ${url}. If it is on another site it has to allow cross-origin reads; ` +
        `opening the file from disk always works.`
      )
    }
    if (!resourceOk(response)) throw new Error(`${url} — ${response.status} ${response.statusText}`)
    text = await response.text()
  }

  const { entries, skipped } = parseVocabulary(text)

  // An entry written over "no chord" has no harmony to re-point it from, so
  // voice leading has nothing to work with. Counted rather than quietly lost.
  const licks = []
  let noHarmony = 0
  entries.forEach((entry, index) => {
    const phrase = entryToPhrase(entry, index)
    if (phrase) licks.push(phrase)
    else noHarmony++
  })

  return {
    licks,
    report: {
      source,
      total: licks.length,
      skipped: { ...skipped, noHarmony },
      bytes: text.length,
      ms: Date.now() - started,
    },
  }
}

export function loadedLicks() {
  return cache || []
}

/** What the last build did, for the UI to show. */
export function lickReport() {
  return lastReport
}

/** null when the entry has no harmony to be re-pointed from. */
export function entryToPhrase(entry, index) {
  const chord = parseChord(entry.c)
  if (!chord.ok || !chord.absPcs.length) return null
  // Stored in one key, played in any: the catalogue is not key dependent.
  return normalizePhrase({
    id: `iv${index}`,
    name: entry.n,
    kind: entry.k,
    // Impro-Visor labels its own entries -- "blues", "lydian", "dominant-altered",
    // "minor pentatonic", "parker". That label is the category; nothing invented.
    category: entry.n,
    origin: 'Impro-Visor',
    sourceChord: entry.c,
    sourcePcs: chord.absPcs,
    rootPc: chord.rootPc,
    quality: chord.pcs.join(','),
    lengthPulses: entry.d,
    notes: entry.v.map(([at, note, duration]) => ({ at, note, velocity: 90, duration })),
    builtin: true,
  })
}

/** Free-text search over names, chord symbols and kinds. */
export function searchLicks(licks, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return licks
  return licks.filter(
    (lick) =>
      lick.name.toLowerCase().includes(needle) ||
      lick.sourceChord.toLowerCase().includes(needle) ||
      (lick.category || '').toLowerCase().includes(needle) ||
      lick.kind.includes(needle)
  )
}

/** How many notes, how wide, how long -- enough to tell two apart in a list. */
export function describeLick(lick) {
  const notes = lick.notes.map((note) => note.note)
  const span = Math.max(...notes) - Math.min(...notes)
  const beats = Math.round((lick.lengthPulses / 24) * 10) / 10
  return `${lick.kind} · over ${lick.sourceChord} · ${lick.notes.length} notes · ${span} semitones · ${beats} beats`
}
