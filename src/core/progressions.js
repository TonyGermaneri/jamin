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

import { parseScore } from './score.js'
import { pcName } from './chordParser.js'

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
    if (!chord || !chord.ok) continue

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
    if (!token.chord || !token.chord.ok) continue
    if (token.chord.prefersFlat) flats++
    else if (/[#♯]/.test(token.chord.rootName)) sharps++
  }
  return flats >= sharps && flats > 0
}

/** The root everything is measured from when transposing to a named key. */
export function firstRoot(text) {
  const score = parseScore(text)
  for (const token of score.tokens) {
    if (token.chord && token.chord.ok) return token.chord.rootPc
  }
  return null
}

/** Semitones needed to take a progression to a given root. */
export function shiftToRoot(text, targetPc) {
  const from = firstRoot(text)
  if (from === null || targetPc === null) return 0
  return ((targetPc - from) % 12 + 12) % 12
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

  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data && data.progressions)
      ? data.progressions
      : Array.isArray(data && data.items)
        ? data.items
        : null

  if (!rows) return { ok: false, error: 'No list of progressions found', progressions: [] }

  const progressions = []
  const skipped = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const text = readText(row)
    const name = cleanName(row.name || row.title || row.label || '')
    if (!text) {
      skipped.push(name || '(unnamed)')
      continue
    }
    progressions.push({
      name: name || 'Untitled',
      text,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : row.genre ? [String(row.genre)] : [],
      source: row.source || row.artist || row.attribution || '',
    })
  }

  return { ok: progressions.length > 0, progressions, skipped, error: progressions.length ? null : 'Nothing usable in there' }
}

function readText(row) {
  if (typeof row.text === 'string' && row.text.trim()) return row.text.trim()
  if (typeof row.chart === 'string' && row.chart.trim()) return row.chart.trim()
  if (typeof row.progression === 'string' && row.progression.trim()) return row.progression.trim()
  for (const key of ['chords', 'sequence', 'bars']) {
    if (Array.isArray(row[key]) && row[key].length) {
      return row[key].map((entry) => (typeof entry === 'string' ? entry : entry && entry.chord)).filter(Boolean).join(' ')
    }
  }
  return ''
}

/* ------------------------------------------------------------------ *
 * Starters
 * ------------------------------------------------------------------ */

/** A library that opens empty is a library nobody uses. */
export const BUILTIN_PROGRESSIONS = [
  { name: 'ii–V–I major', text: 'D-7 G7 Cmaj7 Cmaj7', tags: ['jazz', 'cadence'] },
  { name: 'ii–V–i minor', text: 'D-7b5 G7b9 C-maj7 C-maj7', tags: ['jazz', 'cadence'] },
  { name: 'Backdoor ii–V', text: 'D-7 G7 Bb-7,Eb7 Cmaj7', tags: ['jazz', 'cadence'] },
  { name: 'Turnaround', text: 'C6 A7b9 D-7 G7', tags: ['jazz'] },
  { name: '12-bar blues', text: 'C7 F7 C7 C7\nF7 F7 C7 C7\nG7 F7 C7 G7', tags: ['blues'] },
  { name: 'Minor blues', text: 'C-7 F-7 C-7 C-7\nF-7 F-7 C-7 C-7\nAb7 G7b9 C-7 G7b9', tags: ['blues'] },
  { name: 'Rhythm changes A', text: 'C6,A-7 D-7,G7 C6,A-7 D-7,G7\nC6,C7 F6,F#o7 C6,G7 C6', tags: ['jazz', 'standard'] },
  { name: 'Giant Steps opening', text: 'Bmaj7,D7 Gmaj7,Bb7 Ebmaj7 A-7,D7', tags: ['jazz', 'coltrane'] },
  { name: 'Autumn cycle', text: 'A-7 D7 Gmaj7 Cmaj7\nF#-7b5 B7b9 E-7 E-7', tags: ['jazz', 'standard'] },
  { name: 'So What vamp', text: 'D-7 D-7 D-7 D-7\nEb-7 Eb-7 D-7 D-7', tags: ['modal'] },
  { name: 'Doo-wop', text: 'C A-7 F G7', tags: ['pop'] },
  { name: 'Andalusian cadence', text: 'A- G F E7', tags: ['folk', 'flamenco'] },
  { name: 'Pachelbel', text: 'C G A- E- F C F G', tags: ['classical', 'pop'] },
  { name: 'Pop I–V–vi–IV', text: 'C G A- F', tags: ['pop'] },
  { name: 'Circle of fifths', text: 'C7 F7 Bb7 Eb7\nAb7 Db7 Gb7 B7\nE7 A7 D7 G7', tags: ['exercise'] },
].map((item) => ({ ...item, builtin: true, source: 'built in' }))
