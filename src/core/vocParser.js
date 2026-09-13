/**
 * Reader for Impro-Visor vocabulary files (`.voc`).
 *
 * Runs in the page, so the catalogue is built from the vocabulary itself rather
 * than from a converted artifact checked in beside it. That means the file we
 * ship is the pristine upstream one, and you can point this at your own vocab
 * instead -- an Impro-Visor user's `My.voc` drops straight in.
 *
 * The format is s-expressions, one entry per top-level form:
 *
 *   (lick  (notes d8 f8 a8 e8 c8 f#8 bb4) (sequence G7 C7 |) (name dominant Cycle))
 *   (cell  (notes b4 ab8 gb8 eb8) (name blues) (chords Ab7))
 *   (idiom (notes f#+8/3 g+8/3 g#+8/3 a+8) (chords G7) (name dominant))
 *
 * Leadsheet note syntax, worked out against all 37,000 notes in the shipped
 * vocabulary rather than from documentation:
 *
 *   pitch     [a-g] accidentals(# b bb) octave(`+` up, `-` down, repeatable),
 *             or `r` for a rest
 *   duration  a sum of tied terms -- `8`, `4.`, `8/3`, `4+8`, `16/5`.
 *             `N` is a 1/N note; `.` dots it; `/D` makes it one of D in the time
 *             of the nearest lower power of two; an empty duration repeats the
 *             one before it
 *
 * Impro-Visor is GPL-2.0-or-later. @see https://github.com/Impro-Visor/Impro-Visor
 */

export const PPQN = 24
const WHOLE = PPQN * 4
const LETTER = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
export const KINDS = ['lick', 'cell', 'idiom', 'quote']

/**
 * Every top-level `(tag ...)` form, balanced by paren depth.
 * A regex cannot do this; the forms nest.
 */
function* forms(text, tag) {
  const opener = new RegExp(`^\\(${tag}\\b`, 'gm')
  let match
  while ((match = opener.exec(text))) {
    const start = match.index
    let depth = 0
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          yield text.slice(start, i + 1)
          opener.lastIndex = i + 1
          break
        }
      }
    }
  }
}

function field(form, name) {
  const match = new RegExp(`\\(${name}\\s+([^)]*)\\)`).exec(form)
  return match ? match[1].trim() : null
}

/** A tied sum of note values, in pulses. null if it cannot be read. */
export function durationPulses(spec, previous) {
  if (!spec) return previous
  let total = 0
  for (const term of spec.split('+')) {
    const match = /^(\d+)(\.?)(?:\/(\d+))?$/.exec(term)
    if (!match) return null
    let value = WHOLE / Number(match[1])
    if (match[2]) value *= 1.5
    if (match[3]) {
      const group = Number(match[3])
      // D notes in the time of the nearest lower power of two.
      const fits = 1 << Math.floor(Math.log2(group))
      value = (value * fits) / group
    }
    total += value
  }
  return total
}

/** `c` is middle C, `+` raises an octave, `-` lowers one. */
export function pitchToMidi(token) {
  const match = /^([a-g])([#b]*)([+-]*)$/.exec(token)
  if (!match) return null
  let pitch = LETTER[match[1]]
  for (const char of match[2]) pitch += char === '#' ? 1 : -1
  const octave = 4 + (match[3].match(/\+/g) || []).length - (match[3].match(/-/g) || []).length
  const note = 12 * (octave + 1) + pitch
  return note >= 0 && note <= 127 ? note : null
}

/** @returns {{events: Array, total: number}|null} */
export function readNotes(spec) {
  const events = []
  let at = 0
  let previous = WHOLE / 8

  for (const token of spec.split(/\s+/).filter(Boolean)) {
    const head = /^([a-g][#b]*[+-]*|r)(.*)$/.exec(token)
    if (!head) return null
    const length = durationPulses(head[2], previous)
    if (length === null || length <= 0) return null
    previous = length

    if (head[1] !== 'r') {
      const note = pitchToMidi(head[1])
      if (note === null) return null
      events.push([Math.round(at), note, Math.max(1, Math.round(length))])
    }
    at += length
  }
  return events.length ? { events, total: at } : null
}

/** The one chord this entry is played over, or null if it spans several. */
function singleChord(form) {
  const context = field(form, 'chords') || field(form, 'sequence')
  if (!context) return null
  const words = context.split(/\s+/).filter((word) => word && word !== '|')
  return new Set(words).size === 1 ? words[0] : null
}

/**
 * Read a whole vocabulary file.
 *
 * Entries spanning a chord sequence are left out: re-pointing a two-chord lick
 * at one chord would misrepresent it.
 *
 * @returns {{entries: Array, skipped: {multiChord: number, unreadable: number, noNotes: number}}}
 */
export function parseVocabulary(text) {
  const entries = []
  const skipped = { multiChord: 0, unreadable: 0, noNotes: 0 }
  const source = String(text || '')

  for (const kind of KINDS) {
    for (const form of forms(source, kind)) {
      const chord = singleChord(form)
      if (!chord) {
        skipped.multiChord++
        continue
      }
      const spec = field(form, 'notes')
      if (!spec) {
        skipped.noNotes++
        continue
      }
      const read = readNotes(spec)
      if (!read) {
        skipped.unreadable++
        continue
      }
      entries.push({
        n: (field(form, 'name') || kind).replace(/\s+/g, ' ').trim().slice(0, 48),
        k: kind,
        c: chord,
        // Rounded up to a beat: these are written to sit in a bar, and the
        // player stretches them to the chord anyway.
        d: Math.max(PPQN, Math.ceil(read.total / PPQN) * PPQN),
        v: read.events,
      })
    }
  }

  return { entries, skipped }
}
