/**
 * The phrase book.
 *
 * A phrase is a short performance captured over exactly one chord: the notes as
 * played, plus the pitch classes of the chord they were played over, which is
 * what lets the voice-leading code re-point them at a different chord later.
 *
 * Phrases are referenced from the chart by name -- `.C7{walkup}` -- so the text
 * stays the single source of truth and a chart can be copied around intact.
 */

import { PHRASE_KEY } from './settings.js'
import { PC_NAMES_FLAT, PC_NAMES_SHARP, parseChord } from './chordParser.js'
import { mod12, signedDelta } from './voiceLeading.js'

/**
 * Store a phrase in one key so it can be played in any.
 *
 * The notes are transposed so the chord they were played over is rooted on C,
 * which turns them into degrees measured from the root. Nothing about the phrase
 * is lost -- it is the same shape, written down once instead of once per key --
 * and playback transposes it to whatever chord it lands on.
 */
export function normalizePhrase(phrase) {
  if (!phrase || !Array.isArray(phrase.notes) || phrase.rootPc === 0) return phrase

  const root = phraseRoot(phrase)
  if (root === null) return phrase

  const shift = signedDelta(root, 0)
  return {
    ...phrase,
    notes: phrase.notes.map((note) => ({ ...note, note: note.note + shift })),
    sourcePcs: [...new Set((phrase.sourcePcs || []).map((pc) => mod12(pc + shift)))].sort((a, b) => a - b),
    rootPc: 0,
    originalRoot: root,
  }
}

function phraseRoot(phrase) {
  if (typeof phrase.rootPc === 'number') return phrase.rootPc
  const chord = parseChord(phrase.sourceChord || '')
  if (chord.ok && chord.rootPc !== null) return chord.rootPc
  return Array.isArray(phrase.sourcePcs) && phrase.sourcePcs.length ? phrase.sourcePcs[0] : null
}

/**
 * What a phrase's own name says about it.
 *
 * A collection names itself. POP909 calls its parts "F# comp 19", "Cm busy 4",
 * "Gsus4 pad 2" -- the chord it was played over, what sort of part it is, and
 * which one. All 8,168 of them are that shape, and the middle word is the only
 * categorisation the collection carries: `category` there is a chord-quality
 * name, which says nothing about whether a part comps or pads.
 *
 * **The chord is stripped by exact match, not by pattern.** Every phrase knows
 * the chord it was played over, so there is nothing to guess: if the name
 * begins with that symbol, the rest of the name is the part that describes it.
 * A looser reading -- take the first word, or anything that looks like a pitch
 * -- turns "Major 2-5" into a key of "Major" and "dominant Cycle" into its own
 * category, and both of those are real names in the shipped vocabulary.
 *
 *   name                 chord     category
 *   "F# comp 19"         F#        "comp"
 *   "Cm-busy-4"          Cm        "busy"          (after sanitizeName)
 *   "C minor pentatonic" C         "minor pentatonic"
 *   "Gsus4 pad 2"        Gsus4     "pad"
 *   "Major 2-5"          Dm7       ""              the name is not that shape
 *   "dominant-altered"   C7        ""              ditto, so the label survives
 *
 * Empty means "this name does not categorise itself", which is the signal to
 * fall back to whatever `category` the collection did supply.
 */
export function phraseCategory(phrase) {
  if (!phrase) return ''
  const name = String(phrase.name || '').trim()
  const chord = String(phrase.sourceChord || '').trim()
  if (!name || !chord) return ''

  // startsWith rather than a regular expression built from the chord. Two
  // reasons, and the second is the one that matters: a symbol like "C(add9)"
  // would have to be escaped before it could be a pattern, and this runs over
  // every entry in the catalogue on every keystroke of the search box -- ten
  // thousand regular expressions compiled and thrown away, per keystroke.
  if (!name.startsWith(chord)) return ''

  // A separator has to follow, or "C" matches the start of "Cm comp 1" and the
  // category comes out as "m comp". Space in the source, hyphen once
  // sanitizeName has been over it, underscore because somebody's files will be.
  const after = name.charAt(chord.length)
  if (after !== ' ' && after !== '-' && after !== '_' && after !== '\t') return ''

  return name
    .slice(chord.length)
    .replace(/[\s_-]+\d+$/, '')             // "comp 19" -> "comp"
    .split(/[\s_-]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * The key a phrase was played in, spelled the way its own chord spells it.
 *
 * "F#" from "F#maj7", "Cm" gives "C", "Bb7" gives "Bb". The root rather than
 * the whole symbol, because twelve keys is a filter and a hundred chord symbols
 * is a list -- and the quality is already on the phrase for anyone who wants it.
 *
 * Taken from the symbol's own text rather than from a pitch class, so a
 * collection written in flats stays in flats instead of being renamed into
 * sharps on its way into a dropdown.
 */
export function phraseKey(phrase) {
  const match = /^([A-G][#b\u266f\u266d]?)/.exec(String(phrase?.sourceChord || '').trim())
  return match ? match[1].replace('\u266f', '#').replace('\u266d', 'b') : ''
}

/**
 * The pitch a key name names, 0 to 11, or null.
 *
 * Ab and G# are one key. They are not one *spelling* -- POP909 writes every
 * black note as a sharp and Impro-Visor writes most of them as flats -- and
 * grouping the catalogue by the text would put half of F# under F# and the
 * other half under Gb, which is two entries in a filter for one thing to filter
 * by. So the grouping is by pitch and the label carries both spellings.
 */
export function keyPitchClass(key) {
  const text = String(key || '').trim()
  const sharp = PC_NAMES_SHARP.indexOf(text)
  if (sharp >= 0) return sharp
  const flat = PC_NAMES_FLAT.indexOf(text)
  return flat >= 0 ? flat : null
}

/** Names live inside `{}` in the chart, so they cannot contain braces or spaces. */
export function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/[{}\s,.|]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

export function uniqueName(list, base) {
  const clean = sanitizeName(base) || 'phrase'
  if (!list.some((phrase) => phrase.name === clean)) return clean
  let n = 2
  while (list.some((phrase) => phrase.name === `${clean}-${n}`)) n++
  return `${clean}-${n}`
}

export function loadPhrases() {
  try {
    const raw = localStorage.getItem(PHRASE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    // Phrases saved before normalisation carried their original key; bring them
    // into line on the way in.
    return Array.isArray(parsed) ? parsed.filter(isPhrase).map(normalizePhrase) : []
  } catch {
    return []
  }
}

export function savePhrases(list) {
  try {
    localStorage.setItem(PHRASE_KEY, JSON.stringify(list))
  } catch {
    /* nothing sensible to do */
  }
}

function isPhrase(value) {
  return value && typeof value === 'object' && Array.isArray(value.notes) && typeof value.name === 'string'
}

/** How many notes sound at once at the busiest moment -- one hand or two. */
/** A one-line description for the phrase list. */
export function summarize(phrase) {
  if (!phrase || !phrase.notes.length) return 'empty'
  const notes = phrase.notes.map((n) => n.note)
  const low = Math.min(...notes)
  const high = Math.max(...notes)
  const span = high - low
  const polyphony = maxSimultaneous(phrase.notes)
  const shape = polyphony > 2 ? 'chordal' : polyphony > 1 ? 'double stops' : 'single line'
  return `${phrase.notes.length} notes · ${shape} · ${span} semitone range · over ${phrase.sourceChord}`
}

/** How many notes sound at once at the busiest moment -- one hand or two. */
export function maxSimultaneous(notes) {
  const edges = []
  for (const note of notes) {
    edges.push({ at: note.at, delta: 1 })
    edges.push({ at: note.at + note.duration, delta: -1 })
  }
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta)
  let current = 0
  let peak = 0
  for (const edge of edges) {
    current += edge.delta
    peak = Math.max(peak, current)
  }
  return peak
}

/**
 * Rewrite the chart so `event` carries a phrase-change dot and the given
 * binding.  Returns the new text, or null when nothing needed to change.
 *
 * Editing the text rather than keeping a side table means bindings survive
 * copy/paste, reload and hand-editing, and the dot the user sees above a chord
 * is literally the character that creates the binding.
 */
export function bindPhraseInText(text, token, phraseName) {
  if (!token) return null
  const before = text.slice(0, token.start)
  const after = text.slice(token.end)
  const body = token.body
  const marked = phraseName ? `.${body}{${phraseName}}` : `.${body}`
  if (text.slice(token.start, token.end) === marked) return null
  return before + marked + after
}

/** Strip the dot and any binding off a chord word. */
export function unbindPhraseInText(text, token) {
  if (!token) return null
  const before = text.slice(0, token.start)
  const after = text.slice(token.end)
  return before + token.body + after
}


/**
 * The chart as somebody else would want it: chords, without the marks that bind
 * phrases to them.
 *
 * Copying out of jamin puts this on the clipboard as plain text, so what lands
 * in an email or a text file is a readable chart rather than one full of
 * punctuation nobody else's software understands. The unstripped text goes on
 * the clipboard too, under a type only jamin reads, so pasting back into jamin
 * brings the phrases with it.
 *
 * The leading dot only counts at the start of a word. `N.C.` has dots in it and
 * is not a phrase mark, and losing them would turn a no-chord bar into an
 * unreadable one.
 */
export function stripPhraseMarks(text) {
  return String(text == null ? '' : text)
    .replace(/\{[^}]*\}/g, '')
    .replace(/(^|\s)(\|*:*)\.(?=\S)/g, '$1$2')
}
