/**
 * The progression library.
 *
 * A progression is just a snippet of chart text with a name -- the same
 * notation you type, so anything in the library can be pasted into a chart and
 * anything in a chart can be saved to the library. Nothing is re-encoded.
 *
 * The one thing worth doing to a saved progression is moving it to another key,
 * which is why `transposeChart` lives here: it rewrites the roots and leaves
 * every other character -- suffixes, inversions, commas, bar lines, phrase dots
 * and bindings -- exactly where it found them.
 */

import { parseScore, splitBars } from './score.js'
import { pcName } from './chordParser.js'
import {
  chordonomiconToChart,
  looksLikeChordonomicon,
  unwrapDatasetsServer,
  describeChordonomiconRow,
} from './importers.js'

export const PROGRESSION_KEY = 'jamin.progressions.v1'
export const EXPORT_FORMAT = 'jamin.progressions'

const NOTE = /^[A-Ga-g](?:#|♯|b|♭)*$/

/**
 * Move a whole chart by `semitones`.
 *
 * Edits are applied back to front so earlier offsets stay valid, and only the
 * root (and any slash bass) of each chord is touched.
 */
export function transposeChart(text, semitones, opts = {}) {
  const shift = ((Math.round(semitones) % 12) + 12) % 12
  if (!shift) return text

  const score = parseScore(text, opts.scoreOptions)
  const flat = opts.preferFlat !== undefined ? opts.preferFlat : usesFlats(text)
  const edits = []

  for (const token of score.tokens) {
    const chord = token.chord
    if (!chord || !chord.ok || chord.silent) continue

    const body = token.body
    let rest = body.slice(chord.rootName.length)

    if (chord.bassPc !== null) {
      const slash = rest.lastIndexOf('/')
      if (slash >= 0 && NOTE.test(rest.slice(slash + 1))) {
        rest = rest.slice(0, slash + 1) + pcName((chord.bassPc + shift) % 12, flat)
      }
    }

    edits.push({
      start: token.bodyStart,
      end: token.bodyEnd,
      text: pcName((chord.rootPc + shift) % 12, flat) + rest,
    })
  }

  let out = text
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

/**
 * Which way to spell the black notes in a given key.
 *
 * Db, Eb, F, Ab and Bb are flat keys; everything else reads better sharp. This
 * is why transposing to F gives Bb7 rather than A#7 -- both name the same note,
 * only one of them is readable on a chart.
 */
const FLAT_KEYS = new Set([1, 3, 5, 8, 10])

export function preferFlatForRoot(pc) {
  return FLAT_KEYS.has(((pc % 12) + 12) % 12)
}

/** Does this chart spell things with flats? Used when no key is being targeted. */
export function usesFlats(text) {
  const score = parseScore(text)
  let flats = 0
  let sharps = 0
  for (const token of score.tokens) {
    if (!token.chord || !token.chord.ok || token.chord.silent) continue
    if (token.chord.prefersFlat) flats++
    else if (/[#♯]/.test(token.chord.rootName)) sharps++
  }
  return flats >= sharps && flats > 0
}

/** The root everything is measured from when transposing to a named key. */
export function firstRoot(text) {
  const score = parseScore(text)
  for (const token of score.tokens) {
    if (token.chord && token.chord.ok && !token.chord.silent) return token.chord.rootPc
  }
  return null
}

/** Semitones needed to take a progression to a given root. */
export function shiftToRoot(text, targetPc) {
  const from = firstRoot(text)
  if (from === null || targetPc === null) return 0
  return ((targetPc - from) % 12 + 12) % 12
}

/**
 * Rewrite a bar-line chart in the space-is-a-bar shorthand.
 *
 * Needed when dropping a progression into a chart that does not use bar lines:
 * one `|` anywhere switches how the whole chart reads, so pasting a bar-lined
 * progression into `C F G` would quietly turn three bars into one. Converting
 * what goes in leaves what is already there alone.
 */
export function toShorthand(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      const words = []
      let opening = false

      for (const group of splitBars(line, 0, true)) {
        if (group.type === 'barline') continue
        if (group.type === 'label') {
          words.push(group.text)
          continue
        }
        if (group.type === 'repeat-open') {
          opening = true
          continue
        }
        if (group.type === 'repeat-close') {
          if (words.length) words[words.length - 1] += `:${group.times}`
          continue
        }
        // Everything in a bar divides it, which is what a comma means here.
        let word = group.parts.map((part) => part.text).join(',')
        if (opening) {
          word = `:${word}`
          opening = false
        }
        words.push(word)
      }

      return words.join(' ')
    })
    .join('\n')
}

/** Does this chart use bar lines? */
export const usesBarlines = (text) => String(text || '').includes('|')

/**
 * A progression's bars, as the chords in each.
 *
 * Written for the die, which builds a chart out of a progression by repeating
 * its bars across a form -- so it needs them one at a time rather than as a
 * block of text.
 *
 * Two spellings and the same rule as everywhere else: one `|` anywhere means
 * bar lines say where the bars are, and otherwise a bar is a group of chords
 * separated by spaces. Section labels are not bars and neither are repeat
 * marks; a progression is changes, and the form comes from the die.
 */
export function barsOfProgression(text) {
  const source = String(text || '').replace(/\[[^\]]*\]/g, ' ')

  if (usesBarlines(source)) {
    return source
      .split(/\|+/)
      .map((bar) => bar.replace(/:/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }

  // No bar lines: a space is a bar. Newlines are bar breaks too, which is what
  // a progression written over several lines means.
  return source.split(/\s+/).map((one) => one.trim()).filter(Boolean)
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

/** Progression names are shown, never parsed, so they can read like English. */
export function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 64)
}

export function uniqueProgressionName(list, base) {
  const clean = cleanName(base) || 'Progression'
  if (!list.some((item) => item.name === clean)) return clean
  let n = 2
  while (list.some((item) => item.name === `${clean} ${n}`)) n++
  return `${clean} ${n}`
}

export function loadProgressions() {
  try {
    const raw = localStorage.getItem(PROGRESSION_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter(isProgression) : []
  } catch {
    return []
  }
}

export function saveProgressions(list) {
  try {
    localStorage.setItem(PROGRESSION_KEY, JSON.stringify(list))
  } catch {
    /* nothing sensible to do */
  }
}

function isProgression(value) {
  return value && typeof value === 'object' && typeof value.name === 'string' && typeof value.text === 'string'
}

/** Bars, chords and the roots involved, for the library list. */
export function summarizeProgression(progression, beatsPerBar = 4) {
  const score = parseScore(progression.text, { beatsPerBar })
  const bars = Math.round(score.bars * 10) / 10
  const chords = score.events.filter((event) => event.valid).length
  const bad = score.tokens.filter((token) => token.type === 'error').length
  const root = firstRoot(progression.text)
  const key = root === null ? '' : ` · from ${pcName(root, usesFlats(progression.text))}`
  return `${bars} bar${bars === 1 ? '' : 's'} · ${chords} chord${chords === 1 ? '' : 's'}${key}${bad ? ` · ${bad} unreadable` : ''}`
}

/* ------------------------------------------------------------------ *
 * Import / export
 * ------------------------------------------------------------------ */

export function exportProgressions(list) {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: 1,
      exported: new Date().toISOString(),
      progressions: list.map(({ name, text, tags, source }) => ({ name, text, tags, source })),
    },
    null,
    2
  )
}

/**
 * Read a progression collection.
 *
 * Deliberately forgiving about shape, because collections found in the wild are
 * all shaped differently: our own export, a bare array, `{progressions: [...]}`,
 * or entries that list chords in an array rather than as a line of text.
 */
export function parseProgressionImport(input) {
  let data = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch {
      return { ok: false, error: 'That is not valid JSON', progressions: [] }
    }
  }

  const rows =
    unwrapDatasetsServer(data) ||
    (Array.isArray(data)
      ? data
      : Array.isArray(data && data.progressions)
        ? data.progressions
        : Array.isArray(data && data.items)
          ? data.items
          : null)

  if (!rows) return { ok: false, error: 'No list of progressions found', progressions: [] }

  const progressions = []
  const skipped = []
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return
    const text = readText(row)
    const name = cleanName(row.name || row.title || row.label || '') || cleanName(describeChordonomiconRow(row, index))
    if (!text) {
      skipped.push(name || '(unnamed)')
      return
    }
    progressions.push({
      name: name || 'Untitled',
      text,
      tags: readTags(row),
      source: row.source || row.artist || row.attribution || '',
    })
  })

  return { ok: progressions.length > 0, progressions, skipped, error: progressions.length ? null : 'Nothing usable in there' }
}

function readText(row) {
  if (typeof row.text === 'string' && row.text.trim()) return row.text.trim()
  if (typeof row.chart === 'string' && row.chart.trim()) return row.chart.trim()
  if (typeof row.progression === 'string' && row.progression.trim()) return row.progression.trim()

  for (const key of ['chords', 'sequence', 'bars']) {
    const value = row[key]
    if (Array.isArray(value) && value.length) {
      return value.map((entry) => (typeof entry === 'string' ? entry : entry && entry.chord)).filter(Boolean).join(' ')
    }
    // A whole song in one string. Only run the Chordonomicon dialect through
    // its converter when it actually looks like Chordonomicon -- its `s`-means-
    // sharp rule would mangle ordinary chord names.
    if (typeof value === 'string' && value.trim()) {
      return looksLikeChordonomicon(value) ? chordonomiconToChart(value) : value.trim()
    }
  }
  return ''
}

function readTags(row) {
  if (Array.isArray(row.tags)) return row.tags.map(String)
  const out = []
  for (const key of ['genre', 'main_genre', 'rock_genre']) {
    if (row[key]) out.push(String(row[key]))
  }
  if (Array.isArray(row.genres)) out.push(...row.genres.map(String))
  else if (row.genres) out.push(String(row.genres))
  if (row.decade) out.push(`${row.decade}s`)
  return [...new Set(out.filter(Boolean))].slice(0, 5)
}

/* ------------------------------------------------------------------ *
 * Starters
 * ------------------------------------------------------------------ */

/** A library that opens empty is a library nobody uses. */
export const BUILTIN_PROGRESSIONS = [
  { name: 'ii–V–I major', text: '| D-7 | G7 | Cmaj7 | % |', tags: ['jazz', 'cadence'] },
  { name: 'ii–V–i minor', text: '| D-7b5 | G7b9 | C-maj7 | % |', tags: ['jazz', 'cadence'] },
  { name: 'Backdoor ii–V', text: '| D-7 | G7 | Bb-7 Eb7 | Cmaj7 |', tags: ['jazz', 'cadence'] },
  { name: 'Turnaround', text: '| C6 A7b9 | D-7 G7 |', tags: ['jazz'] },
  { name: '12-bar blues', text: '| C7 | F7 | C7 | % |\n| F7 | % | C7 | % |\n| G7 | F7 | C7 | G7 |', tags: ['blues'] },
  { name: 'Minor blues', text: '| C-7 | F-7 | C-7 | % |\n| F-7 | % | C-7 | % |\n| Ab7 | G7b9 | C-7 | G7b9 |', tags: ['blues'] },
  { name: 'Rhythm changes A', text: '| C6 A-7 | D-7 G7 | C6 A-7 | D-7 G7 |\n| C6 C7 | F6 F#o7 | C6 G7 | C6 |', tags: ['jazz', 'standard'] },
  { name: 'Giant Steps opening', text: '| Bmaj7 D7 | Gmaj7 Bb7 | Ebmaj7 | A-7 D7 |', tags: ['jazz', 'coltrane'] },
  { name: 'Autumn cycle', text: '| A-7 | D7 | Gmaj7 | Cmaj7 |\n| F#-7b5 | B7b9 | E-7 | % |', tags: ['jazz', 'standard'] },
  { name: 'So What vamp', text: '|: D-7 | % | % | % |\n| Eb-7 | % | D-7 | % :|', tags: ['modal'] },
  { name: 'Doo-wop', text: '| C | A-7 | F | G7 |', tags: ['pop'] },
  { name: 'Andalusian cadence', text: '| A- | G | F | E7 |', tags: ['folk', 'flamenco'] },
  { name: 'Pachelbel', text: '| C | G | A- | E- |\n| F | C | F | G |', tags: ['classical', 'pop'] },
  { name: 'Pop I–V–vi–IV', text: '|: C | G | A- | F :|4', tags: ['pop'] },
  { name: 'Circle of fifths', text: '| C7 | F7 | Bb7 | Eb7 |\n| Ab7 | Db7 | Gb7 | B7 |\n| E7 | A7 | D7 | G7 |', tags: ['exercise'] },
].map((item) => ({ ...item, builtin: true, source: 'built in' }))
