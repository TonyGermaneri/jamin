/**
 * What somebody is playing, as a chord.
 *
 * Mr. Accompany Me used to wait for a chord to be written down and then record
 * what was played over it. This is the other way round: the notes come first,
 * and the chord is worked out from them while they are still being held.
 *
 * **It answers with a name, not with a pitch-class set.** The name goes back
 * through `parseChord`, so a detected chord is the same kind of object as one
 * typed into the chart -- same fields, same voice leading, same phrase
 * re-pointing. There is one definition of what a chord is here, and this is not
 * a second one.
 *
 * Deterministic template matching: twelve roots by a table of qualities,
 * scored, best wins. No statistics and no history, so the same notes always
 * give the same answer and a wrong answer can be reasoned about by looking at
 * the table.
 */

import { parseChord, PC_NAMES_SHARP, PC_NAMES_FLAT } from './chordParser.js'

/**
 * The qualities worth recognising, simplest first.
 *
 * Order is the tie-break: three notes that are both a C major triad and the top
 * of an A minor seventh are a C major triad, because that is what somebody
 * playing three notes means. Anything rarer than this is better typed than
 * guessed at.
 *
 * `ivs` are intervals from the root. `weight` marks the qualities that need
 * their character note to be present at all -- a seventh chord with no seventh
 * in it is a triad, and should lose to one.
 */
export const QUALITIES = [
  { suffix: '',      ivs: [0, 4, 7] },
  { suffix: '-',     ivs: [0, 3, 7] },
  { suffix: '5',     ivs: [0, 7] },
  { suffix: 'sus4',  ivs: [0, 5, 7] },
  { suffix: 'sus2',  ivs: [0, 2, 7] },
  { suffix: '°',     ivs: [0, 3, 6] },
  { suffix: '+',     ivs: [0, 4, 8] },
  { suffix: '7',     ivs: [0, 4, 7, 10] },
  { suffix: 'maj7',  ivs: [0, 4, 7, 11] },
  { suffix: '-7',    ivs: [0, 3, 7, 10] },
  { suffix: '-maj7', ivs: [0, 3, 7, 11] },
  { suffix: '-7b5',  ivs: [0, 3, 6, 10] },
  { suffix: 'dim7',  ivs: [0, 3, 6, 9] },
  { suffix: '6',     ivs: [0, 4, 7, 9] },
  { suffix: '-6',    ivs: [0, 3, 7, 9] },
  { suffix: 'add9',  ivs: [0, 2, 4, 7] },
  { suffix: '7sus4', ivs: [0, 5, 7, 10] },
  { suffix: '9',     ivs: [0, 2, 4, 7, 10] },
  { suffix: '-9',    ivs: [0, 2, 3, 7, 10] },
  { suffix: 'maj9',  ivs: [0, 2, 4, 7, 11] },
  { suffix: '7b9',   ivs: [0, 1, 4, 7, 10] },
  { suffix: '7#9',   ivs: [0, 3, 4, 7, 10] },
  { suffix: '13',    ivs: [0, 2, 4, 5, 7, 9, 10] },
]

const pc = (note) => ((note % 12) + 12) % 12

/** A note name for a pitch class. Flats by default, which is what most of the
    chart's own spellings use, and what a jazz chart uses. */
export function noteName(pitchClass, prefersFlat = true) {
  return (prefersFlat ? PC_NAMES_FLAT : PC_NAMES_SHARP)[pc(pitchClass)]
}

/**
 * Score one reading of the held notes.
 *
 * Three things matter and they are not equal:
 *
 *   - Every note of the quality that is actually there is worth a lot. A
 *     reading that accounts for what is being played beats one that does not.
 *   - A held note the quality has no room for costs more than a missing one.
 *     Playing a note the chord does not contain is positive evidence against
 *     that chord; leaving one out is only absence.
 *   - The lowest note being the root is worth a little. It breaks ties towards
 *     what somebody's left hand is saying without overruling the notes.
 */
function score(heldPcs, rootPc, quality, bassPc) {
  const wanted = new Set(quality.ivs.map((iv) => pc(rootPc + iv)))

  let matched = 0
  for (const note of wanted) if (heldPcs.has(note)) matched++

  const missing = wanted.size - matched
  let extra = 0
  for (const note of heldPcs) if (!wanted.has(note)) extra++

  // Nothing of the chord present is not a reading of anything.
  if (!matched) return -Infinity
  // The root itself has to be somewhere. A rootless voicing is a real thing and
  // a thing to type rather than to guess at, because every rootless voicing is
  // also some other chord with a root.
  if (!heldPcs.has(pc(rootPc))) return -Infinity

  return matched * 3 - missing * 2 - extra * 4 + (pc(rootPc) === bassPc ? 1 : 0)
}

/**
 * The chord somebody is holding, or null.
 *
 * `pitches` are MIDI note numbers, in any order; the lowest is taken as the
 * bass. Two notes or fewer is not a chord -- a third is an interval and there
 * is no honest way to call it major or minor -- except for a bare fifth, which
 * is one of the qualities above and is what a power chord is.
 *
 * Returns `{ name, chord, rootPc, bassPc, quality, score }` where `chord` is a
 * parsed chord, ready for the phrase engine, or null when the notes do not add
 * up to anything.
 */
export function detectChord(pitches, conventions = {}) {
  const notes = [...new Set((pitches || []).filter((n) => Number.isFinite(n)))]
  if (notes.length < 2) return null

  const heldPcs = new Set(notes.map(pc))
  const bassPc = pc(Math.min(...notes))

  let best = null
  for (const quality of QUALITIES) {
    for (let root = 0; root < 12; root++) {
      const points = score(heldPcs, root, quality, bassPc)
      if (points === -Infinity) continue
      // Strictly greater, so the table's order decides a tie and the simpler
      // reading -- which is earlier in it -- wins.
      if (!best || points > best.score) best = { score: points, rootPc: root, quality }
    }
  }

  if (!best) return null

  // A bass note that is not the root is a slash chord, which is information
  // somebody played on purpose. It is written the way the chart writes it.
  const prefersFlat = conventions.prefersFlat !== false
  const root = noteName(best.rootPc, prefersFlat)
  const slash = bassPc !== pc(best.rootPc) ? `/${noteName(bassPc, prefersFlat)}` : ''
  const name = `${root}${best.quality.suffix}${slash}`

  const chord = parseChord(name, conventions)
  if (!chord || !chord.ok) return null

  return {
    name,
    chord,
    rootPc: best.rootPc,
    bassPc,
    quality: best.quality.suffix,
    score: best.score,
    pitches: notes.slice().sort((a, b) => a - b),
  }
}

/**
 * Notes going down and coming up, turned into a chord when it settles.
 *
 * Somebody putting four fingers down does not land them all in the same
 * millisecond, and every note on the way is briefly a different chord -- a C, a
 * C5, a C major, a Cmaj7 -- so reacting to each one means four chords for one
 * gesture. A short wait after the last change is the whole of the fix, and it
 * is short enough not to be felt.
 *
 * Nothing here touches a clock of its own: `now` is passed in, so the same
 * sequence of notes and times always gives the same chords and this can be
 * tested without waiting for anything. @see tests/chordDetect.test.js
 */
export class ChordListener {
  constructor({ settleMs = 60, conventions = {} } = {}) {
    this.settleMs = settleMs
    this.conventions = conventions
    this.held = new Map()          // note -> velocity, in the order they arrived
    this.changedAt = 0
    this.reported = null           // the name last handed out
    this.onChord = null            // (detected | null) => void
  }

  /** One note on or off. Returns true if the held set changed. */
  note(note, on, now = 0) {
    const had = this.held.has(note)
    if (on) this.held.set(note, true)
    else this.held.delete(note)

    const changed = on !== had
    if (changed) this.changedAt = now
    return changed
  }

  /**
   * Called as often as the caller likes. Emits when the held notes have been
   * still for long enough and say something different from last time.
   */
  tick(now = 0) {
    if (this.changedAt === null) return
    if (now - this.changedAt < this.settleMs) return
    this.changedAt = null

    const found = this.held.size ? detectChord([...this.held.keys()], this.conventions) : null
    const name = found ? found.name : null
    if (name === this.reported) return

    this.reported = name
    if (this.onChord) this.onChord(found)
  }

  /** Everything up, as a locate or a stop leaves it. */
  clear() {
    this.held.clear()
    this.changedAt = null
    if (this.reported !== null) {
      this.reported = null
      if (this.onChord) this.onChord(null)
    }
  }

  get holding() {
    return this.held.size
  }
}
