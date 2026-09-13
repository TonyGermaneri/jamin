/**
 * Turns a parsed chord into actual MIDI note numbers.
 *
 * Explicit inversions (`Dii`) always win.  When none is written and smart
 * voicing is on, we audition every rotation and a couple of octave placements
 * and keep whichever sits closest to the chord that just played, so a
 * progression doesn't leap around the keyboard for no reason.
 */

import { voicingDistance, mod12 } from './voiceLeading.js'

export const DEFAULT_VOICING = {
  octave: 4,
  range: [36, 96],
  smartVoicing: true,
  maxVoices: 6,
}

/**
 * @param {object} chord parsed chord from chordParser
 * A bass note is not this function's business: there is one bass setting, in
 * the phrase book, and it holds a root under everything whether a phrase is
 * playing or not.
 *
 * @param {object} opts see DEFAULT_VOICING, plus `previousNotes`
 * @returns {{notes: number[]}}
 */
export function realizeChord(chord, opts = {}) {
  const config = { ...DEFAULT_VOICING, ...opts }
  // A no-chord bar is valid and takes up time; it just has nothing to play.
  if (!chord || !chord.ok || !chord.intervals.length) return { notes: [] }

  const base = (config.octave + 1) * 12 + chord.rootPc
  let intervals = chord.intervals.slice()
  if (intervals.length > config.maxVoices) {
    // Thin from the middle: the root, the guide tones and the top colour matter
    // most, so drop 5ths first, then whatever is left in the middle.
    intervals = thin(intervals, config.maxVoices)
  }

  let notes = intervals.map((interval) => base + interval)

  if (chord.inversion > 0) {
    notes = invert(notes, chord.inversion)
  } else if (config.smartVoicing && config.previousNotes && config.previousNotes.length) {
    notes = pickClosest(notes, config.previousNotes, config.range)
  }

  notes = fitToRange(notes, config.range)

  return { notes: [...new Set(notes)].sort((a, b) => a - b) }
}

/** Move the lowest `count` notes up an octave each. */
function invert(notes, count) {
  const out = notes.slice().sort((a, b) => a - b)
  for (let i = 0; i < count && i < out.length; i++) {
    const lowest = out.shift()
    out.push(lowest + 12)
    out.sort((a, b) => a - b)
  }
  return out
}

/** Audition rotations and octave placements; keep the least athletic one. */
function pickClosest(notes, previousNotes, range) {
  let best = notes
  let bestScore = Infinity
  for (let rotation = 0; rotation < notes.length; rotation++) {
    for (const octaveShift of [-12, 0, 12]) {
      const candidate = invert(notes, rotation).map((note) => note + octaveShift)
      if (candidate.some((note) => note < range[0] || note > range[1])) continue
      // A small pull toward the written register keeps it from drifting away
      // over a long progression.
      const drift = Math.abs(mean(candidate) - mean(notes)) * 0.15
      const score = voicingDistance(previousNotes, candidate) + drift
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }
  }
  return best
}

function fitToRange(notes, range) {
  let out = notes.slice()
  let guard = 0
  while (Math.max(...out) > range[1] && guard++ < 8) out = out.map((n) => n - 12)
  guard = 0
  while (Math.min(...out) < range[0] && guard++ < 8) out = out.map((n) => n + 12)
  return out.map((n) => Math.max(0, Math.min(127, n)))
}

const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length

/**
 * Reduce a tall voicing to `limit` notes: 5ths go first (they add the least),
 * then interior extensions, always keeping the root, the 3rd/7th guide tones
 * and the top note.
 */
function thin(intervals, limit) {
  const out = intervals.slice()
  const droppable = (interval) => {
    const degree = mod12(interval)
    return degree === 7 ? 0 : degree === 5 || degree === 2 ? 1 : 2
  }
  while (out.length > limit) {
    let victim = -1
    let worst = 3
    for (let i = 1; i < out.length - 1; i++) {
      const rank = droppable(out[i])
      if (rank < worst) {
        worst = rank
        victim = i
      }
    }
    if (victim < 0) victim = 1
    out.splice(victim, 1)
  }
  return out
}
