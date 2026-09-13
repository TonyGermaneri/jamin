/**
 * Two-handed keyboard parts, cut from POP909.
 *
 * A lick is one line; a part is what a player's two hands were doing over one
 * chord -- a bass, a voicing, a rhythm. Same phrase model either way, so a part
 * transposes and voice-leads exactly as anything else here does.
 *
 * Cut at POP909's own chord annotations by scripts/extract_pop909.html, which
 * runs this application's MIDI reader and phrase code in a browser rather than
 * reimplementing them, and filtered down to things that really are two hands: at
 * least three pitch classes, more than an octave of spread, and more than one
 * note sounding at a time. An octave hammered back and forth passes the first
 * two of those and is not a keyboard part, which is what the third is for.
 *
 * POP909 is MIT licensed. Copyright (c) 2020 Music X Lab.
 * @see https://github.com/music-x-lab/POP909-Dataset
 */

import { parseChord } from './chordParser.js'
import { maxSimultaneous } from './phrases.js'
import { loadChordDictionary, nameForSet } from './chordDictionary.js'

let partsCache = null
let partsPending = null

export async function loadParts() {
  if (partsCache) return partsCache
  if (!partsPending) {
    // The dictionary names the chord each part was played over, which is the
    // only categorisation POP909 actually carries -- it has no genre of its own.
    partsPending = loadChordDictionary()
      .then(() => fetch(new URL('../data/pop909Phrases.json', import.meta.url)))
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status))))
      .then((payload) => {
        partsCache = (payload.parts || []).map(entryToPart).filter(Boolean)
        return partsCache
      })
      .catch(() => {
        partsCache = []
        return partsCache
      })
  }
  return partsPending
}

export function loadedParts() {
  return partsCache || []
}

/**
 * The stored notes are already rooted on C -- they were normalised during
 * extraction -- so the chord symbol only supplies the degrees, not a key.
 */
export function entryToPart(entry, index) {
  const chord = parseChord(entry.c)
  if (!chord.ok || !chord.pcs.length) return null
  const notes = entry.v.map(([at, note, duration, velocity]) => ({ at, note, velocity, duration }))
  return {
    id: `p${index}`,
    name: entry.n,
    kind: 'part',
    category: nameForSet(chord.pcs) || entry.c,
    origin: `POP909 #${entry.s}`,
    sourceChord: entry.c,
    sourcePcs: chord.pcs,
    rootPc: 0,
    quality: chord.pcs.join(','),
    lengthPulses: entry.d,
    notes,
    voices: maxSimultaneous(notes),
    song: entry.s,
    builtin: true,
  }
}
