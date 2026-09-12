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
    return Array.isArray(parsed) ? parsed.filter(isPhrase) : []
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

function maxSimultaneous(notes) {
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
