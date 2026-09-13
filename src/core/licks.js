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
 * Vocabulary from Impro-Visor (Robert Keller / Harvey Mudd College),
 * GPL-2.0-or-later. Converted by scripts/build_licks.py.
 * @see https://github.com/Impro-Visor/Impro-Visor
 */

import { parseChord } from './chordParser.js'

let cache = null
let pending = null

/** Lazily fetched: ~230KB, and nothing needs it until the catalogue is opened. */
export async function loadLicks() {
  if (cache) return cache
  if (!pending) {
    pending = fetch(new URL('../data/improvisorLicks.json', import.meta.url))
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status))))
      .then((payload) => {
        cache = (payload.licks || []).map(entryToPhrase).filter(Boolean)
        return cache
      })
      .catch(() => {
        cache = []
        return cache
      })
  }
  return pending
}

export function loadedLicks() {
  return cache || []
}

export function entryToPhrase(entry, index) {
  const chord = parseChord(entry.c)
  if (!chord.ok || !chord.absPcs.length) return null
  return {
    id: `iv${index}`,
    name: entry.n,
    kind: entry.k,
    sourceChord: entry.c,
    sourcePcs: chord.absPcs,
    quality: chord.pcs.join(','),
    lengthPulses: entry.d,
    notes: entry.v.map(([at, note, duration]) => ({ at, note, velocity: 90, duration })),
    builtin: true,
  }
}

/**
 * Licks that fit a chord.
 *
 * Matched on the chord's shape rather than its root -- a lick written over C7
 * belongs over any dominant seventh, because it gets transposed on the way in.
 */
export function licksForChord(licks, chord) {
  if (!chord || !chord.ok || !chord.pcs.length) return []
  const key = chord.pcs.join(',')
  return licks.filter((lick) => lick.quality === key)
}

/** Free-text search over names, chord symbols and kinds. */
export function searchLicks(licks, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return licks
  return licks.filter(
    (lick) =>
      lick.name.toLowerCase().includes(needle) ||
      lick.sourceChord.toLowerCase().includes(needle) ||
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
