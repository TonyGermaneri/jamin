/**
 * A progression as the shape it is, rather than as the notes it is in.
 *
 * `D-7 G7 Cmaj7` and `F-7 Bb7 Ebmaj7` are the same progression. They share
 * no chord symbol, so any grouping that reads the symbols files them apart
 * -- which is how a library of four thousand progressions comes to be a
 * list of four thousand things rather than a few dozen shapes with
 * variations. Read as degrees they are both `ii7 V7 Imaj7`, and that is
 * the thing somebody is actually looking for.
 *
 * Degrees rather than intervals from the first chord, because a
 * progression that begins away from home is common and its shape is still
 * about home: `IV V I` and `I ii V` both start somewhere and mean
 * different things. So the key is found first. @see core/key.js
 *
 * Case carries the quality, as it has in figured bass for three hundred
 * years -- `V` is major, `v` is minor -- and a short suffix carries the
 * colour. Nothing here invents a name: the quality comes off the parsed
 * chord and the suffix is the same vocabulary the chart is typed in.
 */

import { parseScore } from './score.js'
import { detectKey } from './key.js'

/** Semitones from the tonic, wrapped into one octave. */
const stepFrom = (n) => ((n % 12) + 12) % 12

/**
 * Where each degree of the major scale sits, and what to call the ones
 * between. Flats rather than sharps for the chromatic degrees because that
 * is how a borrowed chord is nearly always written: bIII, bVI, bVII.
 */
const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII']

/**
 * The colour, in as few characters as carry it.
 *
 * Only what changes the chord's job. A dominant seventh is a different
 * animal from a major seventh and both are different from a triad; the
 * ninths and thirteenths on top of a dominant do not change where it is
 * going, so they are not in the name. A grouping with `V7`, `V9` and
 * `V13` as three separate branches is the shape being lost in the detail.
 */
function colourOf(chord) {
  const quality = chord.quality || ''
  if (quality.includes('dim')) return chord.intervals.includes(9) ? '°7' : '°'
  if (quality.includes('half')) return 'ø7'
  if (quality.includes('aug')) return '+'

  const seventh = chord.intervals.includes(10) ? 'b7'
    : chord.intervals.includes(11) ? 'maj7' : ''
  const minor = chord.intervals.includes(3)

  if (!seventh) return quality.includes('sus') ? 'sus' : ''
  if (seventh === 'maj7') return 'maj7'
  return minor ? '7' : '7'
}

/** Whether the chord is minor, which is what decides the case of the numeral. */
const isMinor = (chord) => chord.intervals.includes(3) && !chord.intervals.includes(4)

/**
 * One chord, named as a degree of a key.
 *
 * `null` for anything that is not a chord -- a rest, a repeat, a bar of
 * nonsense -- because a shape with a hole in it is not a shape and the
 * caller stops there rather than pretending.
 */
export function degreeOf(chord, tonicPc) {
  if (!chord || !chord.ok || chord.silent || chord.rootPc === null
      || chord.rootPc === undefined) {
    return null
  }
  const step = ROMAN[stepFrom(chord.rootPc - tonicPc)]
  const numeral = isMinor(chord) ? step.toLowerCase() : step
  const slash = chord.bassPc !== null && chord.bassPc !== undefined
    && chord.bassPc !== chord.rootPc
    ? `/${ROMAN[stepFrom(chord.bassPc - tonicPc)]}` : ''
  return `${numeral}${colourOf(chord)}${slash}`
}

/**
 * The first `n` chords of a progression, as degrees.
 *
 * Cached on the text, because the tree is rebuilt whenever `n` moves and
 * parsing four thousand progressions again to answer a slightly different
 * question is four thousand parses nobody needed. The cache holds the
 * whole analysis and the caller takes a prefix of it.
 */
const read = new Map()

export function degreesOf(text, most = 12) {
  const key = String(text || '')
  if (!key.trim()) return { key: '', degrees: [] }

  const held = read.get(key)
  if (held) return held

  const score = parseScore(key, { beatsPerBar: 4 })
  const found = detectKey(score)
  const tonic = found ? found.tonicPc : 0

  const degrees = []
  for (const event of score.events) {
    if (degrees.length >= most) break
    const name = degreeOf(event.chord, tonic)
    if (!name) continue
    // A chord held across two bars is one chord in the shape, not two.
    if (name !== degrees[degrees.length - 1]) degrees.push(name)
  }

  const answer = { key: found ? found.name : '', degrees }
  // A few thousand progressions is what a library holds; past that this is
  // a different screen with a different problem.
  if (read.size > 20000) read.clear()
  read.set(key, answer)
  return answer
}

/**
 * The path a progression hangs at on the map: its first `n` degrees.
 *
 * Short progressions are not padded. A two-chord vamp under a setting of
 * four is two levels deep and sits in the branch its first two chords
 * name, beside everything else that starts the same way -- which is where
 * somebody looking for it would go.
 */
export function degreePath(text, n) {
  const { degrees } = degreesOf(text)
  const many = Math.max(1, Math.min(8, Math.round(n) || 1))
  const head = degrees.slice(0, many)
  return head.length ? head : ['(no chords)']
}
