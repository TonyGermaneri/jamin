/**
 * Turning a MIDI performance into phrases.
 *
 * A phrase here is one chord's worth of music plus the chord it was played over.
 * A recorded keyboard part is exactly that, repeated: cut it at the chord
 * changes and each piece is a phrase -- two hands, real voicings, real rhythm,
 * rather than the single melodic line a lick gives you.
 *
 * Where the chords come from, in order of preference:
 *
 *   1. an annotation file, if you have one (POP909 ships chord spans in seconds,
 *      written in Harte notation, which the chord parser already reads)
 *   2. inferred from the notes themselves, which is what makes this work on a
 *      part you played into your own DAW five minutes ago
 */

import { parseMidiFile } from './midiFile.js'
import { pcName } from './chordParser.js'
import { normalizePhrase, maxSimultaneous } from './phrases.js'
import { mod12 } from './voiceLeading.js'
import { PPQN } from './score.js'

/** Shapes worth guessing at, simplest first so ties resolve sensibly. */
export const SHAPES = [
  { symbol: '', pcs: [0, 4, 7] },
  { symbol: 'm', pcs: [0, 3, 7] },
  { symbol: 'sus4', pcs: [0, 5, 7] },
  { symbol: 'sus2', pcs: [0, 2, 7] },
  { symbol: 'dim', pcs: [0, 3, 6] },
  { symbol: 'aug', pcs: [0, 4, 8] },
  { symbol: '7', pcs: [0, 4, 7, 10] },
  { symbol: 'maj7', pcs: [0, 4, 7, 11] },
  { symbol: 'm7', pcs: [0, 3, 7, 10] },
  { symbol: 'm7b5', pcs: [0, 3, 6, 10] },
  { symbol: 'dim7', pcs: [0, 3, 6, 9] },
  { symbol: '6', pcs: [0, 4, 7, 9] },
  { symbol: 'm6', pcs: [0, 3, 7, 9] },
  { symbol: 'mmaj7', pcs: [0, 3, 7, 11] },
  { symbol: '9', pcs: [0, 2, 4, 7, 10] },
  { symbol: 'maj9', pcs: [0, 2, 4, 7, 11] },
  { symbol: 'm9', pcs: [0, 2, 3, 7, 10] },
]

/**
 * Which chord is this pile of notes?
 *
 * Score every root against every shape: time spent on chord tones counts for,
 * time spent elsewhere counts against, and a shape whose tones never sound is
 * penalised so a triad is not read as a ninth. The lowest note gets a say,
 * because the bass usually is the root.
 */
export function inferChord(notes) {
  if (!notes.length) return null

  const weight = new Array(12).fill(0)
  let total = 0
  for (const note of notes) {
    const time = Math.max(1, note.duration)
    weight[mod12(note.note)] += time
    total += time
  }
  if (!total) return null

  const bass = mod12(notes.reduce((low, note) => (note.note < low.note ? note : low), notes[0]).note)

  let best = null
  for (let root = 0; root < 12; root++) {
    for (let index = 0; index < SHAPES.length; index++) {
      const shape = SHAPES[index]
      const tones = new Set(shape.pcs.map((pc) => mod12(pc + root)))
      let covered = 0
      let foreign = 0
      for (let pc = 0; pc < 12; pc++) {
        if (!weight[pc]) continue
        if (tones.has(pc)) covered += weight[pc]
        else foreign += weight[pc]
      }
      const missing = shape.pcs.filter((pc) => !weight[mod12(pc + root)]).length
      const score =
        covered -
        foreign * 0.9 -
        (missing * total) / shape.pcs.length / 2 -
        index * total * 0.004 + // nudge toward simpler shapes
        (root === bass ? total * 0.25 : 0)

      if (!best || score > best.score) best = { score, root, shape }
    }
  }

  if (!best) return null
  const text = pcName(best.root) + best.shape.symbol
  return {
    rootPc: best.root,
    symbol: best.shape.symbol,
    text,
    pcs: best.shape.pcs.map((pc) => mod12(pc + best.root)).sort((a, b) => a - b),
    confidence: Math.max(0, Math.min(1, best.score / total)),
  }
}

/**
 * @param {Uint8Array|ArrayBuffer} bytes a standard MIDI file
 * @param {object} opts
 * @param {number} [opts.beatsPerBar=4]
 * @param {number} [opts.segmentBars=1] how much music makes one phrase
 * @param {number} [opts.minNotes=3] fewer than this and it is not a phrase
 * @param {Array} [opts.chordSpans] `[{startPulse, endPulse, text, rootPc, pcs}]`
 * @param {RegExp} [opts.trackFilter] which tracks to take, by name
 */
export function phrasesFromMidi(bytes, opts = {}) {
  const {
    beatsPerBar = 4,
    segmentBars = 1,
    minNotes = 3,
    maxPhrases = 400,
    chordSpans = null,
    trackFilter = null,
  } = opts

  const file = parseMidiFile(bytes)
  const scale = PPQN / file.ppq

  const chosen = file.tracks.filter((track) => {
    if (!track.notes.length) return false
    return trackFilter ? trackFilter.test(track.name || '') : true
  })
  const used = chosen.length ? chosen : file.tracks.filter((track) => track.notes.length)

  const notes = []
  for (const track of used) {
    for (const note of track.notes) {
      notes.push({
        at: note.tick * scale,
        note: note.note,
        velocity: note.velocity,
        duration: Math.max(1, note.duration * scale),
      })
    }
  }
  notes.sort((a, b) => a.at - b.at || a.note - b.note)

  if (!notes.length) return { phrases: [], report: { reason: 'no notes in that file', tracks: file.tracks.length } }

  const end = Math.max(...notes.map((note) => note.at + note.duration))
  const spans = chordSpans && chordSpans.length ? chordSpans : evenSpans(end, beatsPerBar * PPQN * segmentBars)

  const phrases = []
  const skipped = { tooFew: 0, noChord: 0 }

  for (const span of spans) {
    if (phrases.length >= maxPhrases) break
    const inside = []
    for (const note of notes) {
      if (note.at + note.duration <= span.startPulse) continue
      if (note.at >= span.endPulse) break
      const at = Math.max(0, note.at - span.startPulse)
      const stop = Math.min(note.at + note.duration - span.startPulse, span.endPulse - span.startPulse)
      if (stop - at < 1) continue
      inside.push({ at: Math.round(at), note: note.note, velocity: note.velocity, duration: Math.round(stop - at) })
    }

    if (inside.length < minNotes) {
      skipped.tooFew++
      continue
    }

    const chord = span.text ? span : inferChord(inside)
    if (!chord || chord.rootPc === null || chord.rootPc === undefined) {
      skipped.noChord++
      continue
    }

    phrases.push(
      normalizePhrase({
        name: `${chord.text} bar ${phrases.length + 1}`,
        notes: inside,
        lengthPulses: Math.round(span.endPulse - span.startPulse),
        sourceChord: chord.text,
        sourcePcs: chord.pcs.slice().sort((a, b) => a - b),
        rootPc: chord.rootPc,
        voices: maxSimultaneous(inside),
        origin: 'MIDI import',
      })
    )
  }

  return {
    phrases,
    report: {
      tracks: file.tracks.map((track) => ({ name: track.name, notes: track.notes.length })),
      used: used.length,
      bars: Math.round(end / (beatsPerBar * PPQN)),
      skipped,
    },
  }
}

function evenSpans(end, size) {
  const spans = []
  for (let start = 0; start < end; start += size) spans.push({ startPulse: start, endPulse: start + size })
  return spans
}


/**
 * Read POP909-style chord annotations: `start end label` in seconds, one per
 * line, Harte labels. Converted to pulses with the file's own tempo map.
 */
export function parseChordAnnotations(text, secondsToPulses) {
  const spans = []
  for (const line of String(text || '').split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const start = Number(parts[0])
    const stop = Number(parts[1])
    const label = parts.slice(2).join(' ')
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue
    if (label === 'N' || label === 'X') continue
    spans.push({ startPulse: secondsToPulses(start), endPulse: secondsToPulses(stop), label })
  }
  return spans
}
