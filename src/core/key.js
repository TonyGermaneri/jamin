/**
 * Guessing the key of a chart.
 *
 * Krumhansl-Schmuckler: build a weighted profile of how much each pitch class is
 * used, then correlate it against the twenty-four rotations of two reference
 * profiles measured from listeners. The best correlation is the key.
 *
 * Chord charts carry information a note histogram does not, so two adjustments:
 * roots count for more than the colour tones above them, and the chord a tune
 * ends on gets a nudge, because tunes tend to land home.
 *
 * It is a guess, and it says how confident it is. Nothing depends on it being
 * right -- it labels the readout and picks sharps or flats when transposing.
 */

import { pcName } from './chordParser.js'

// Krumhansl & Kessler's probe-tone profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const mod12 = (n) => ((n % 12) + 12) % 12

/** How much each degree of a chord says about the key. */
function weightFor(interval) {
  const degree = mod12(interval)
  if (degree === 0) return 3 // the root
  if (degree === 4 || degree === 3) return 2 // the third decides major from minor
  if (degree === 10 || degree === 11) return 1.5 // sevenths point at cadences
  return 1
}

/**
 * @param {object} score result of parseScore
 * @returns {{tonicPc: number, mode: string, name: string, confidence: number}|null}
 */
export function detectKey(score) {
  if (!score || !score.events || !score.events.length) return null

  const histogram = new Array(12).fill(0)
  let sounded = 0
  let last = null

  for (const event of score.events) {
    const chord = event.chord
    if (!chord || !chord.ok || chord.silent || !chord.intervals.length) continue
    const bars = Math.max(0.25, (event.endPulse - event.startPulse) / (score.pulsesPerBar || 96))
    sounded += bars
    last = chord
    for (const interval of chord.intervals) {
      histogram[mod12(chord.rootPc + interval)] += weightFor(interval) * bars
    }
  }

  if (!sounded) return null

  // Tunes tend to end at home.
  if (last) histogram[last.rootPc] += sounded * 0.35

  const scored = []
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [['major', MAJOR], ['minor', MINOR]]) {
      const rotated = profile.map((_, i) => profile[mod12(i)])
      const observed = histogram.map((_, i) => histogram[mod12(i + tonic)])
      scored.push({ tonicPc: tonic, mode, score: correlate(observed, rotated) })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  const runnerUp = scored[1]
  const spread = best.score - runnerUp.score
  const confidence = Math.max(0, Math.min(1, spread / 0.25))

  return {
    tonicPc: best.tonicPc,
    mode: best.mode,
    name: `${pcName(best.tonicPc, preferFlatKey(best.tonicPc, best.mode))}${best.mode === 'minor' ? 'm' : ''}`,
    confidence,
  }
}

/** Pearson correlation; both arrays are the same length. */
function correlate(a, b) {
  const n = a.length
  const meanA = a.reduce((x, y) => x + y, 0) / n
  const meanB = b.reduce((x, y) => x + y, 0) / n
  let top = 0
  let leftSum = 0
  let rightSum = 0
  for (let i = 0; i < n; i++) {
    const left = a[i] - meanA
    const right = b[i] - meanB
    top += left * right
    leftSum += left * left
    rightSum += right * right
  }
  const bottom = Math.sqrt(leftSum * rightSum)
  return bottom === 0 ? 0 : top / bottom
}

/** Flat keys are spelled flat: F, Bb, Eb, Ab, Db major, and their relatives. */
export function preferFlatKey(tonicPc, mode = 'major') {
  const relativeMajor = mode === 'minor' ? mod12(tonicPc + 3) : tonicPc
  return new Set([5, 10, 3, 8, 1, 6]).has(relativeMajor)
}
