/**
 * Turns the text in the editor into a timeline.
 *
 * Rules of the notation:
 *   - whitespace separates bars:            `C  F  G`      -> three 1-bar chords
 *   - the same chord twice is one long one: `C  C  F`      -> 2 bars of C, 1 of F
 *   - commas subdivide a bar:               `F,F- C`       -> 1/2 F, 1/2 Fm, 1 C
 *   - `|` and `[section labels]` are decoration, ignored by the clock
 *   - `%` repeats the previous bar
 *   - a leading `.` marks a phrase change:  `.C7{walkup}`
 *
 * Every token keeps the character range it came from, because the highlight
 * overlay paints the text the user actually typed -- not a re-rendered copy.
 */

import { parseChord } from './chordParser.js'

export const PPQN = 24

const PHRASE_REF = /\{([^}]*)\}$/

/**
 * @param {string} text
 * @param {{beatsPerBar?: number, mergeRepeats?: boolean, conventions?: object}} opts
 */
export function parseScore(text, opts = {}) {
  const beatsPerBar = Math.max(1, opts.beatsPerBar || 4)
  const mergeRepeats = opts.mergeRepeats !== false
  const pulsesPerBar = beatsPerBar * PPQN

  const src = String(text ?? '')
  const tokens = []
  const events = []
  const lines = []

  let cursor = 0
  let lineStart = 0
  let lineIndex = 0
  let pulse = 0

  const rawLines = src.split('\n')
  for (const lineText of rawLines) {
    const line = { index: lineIndex, start: lineStart, end: lineStart + lineText.length, text: lineText, tokens: [] }
    lines.push(line)

    for (const group of splitGroups(lineText, lineStart)) {
      if (/^\|+$/.test(group.text)) {
        tokens.push(makeToken(group, lineIndex, 'barline'))
        line.tokens.push(tokens.length - 1)
        continue
      }

      // [Verse], [A], [chorus 2] -- a label for the reader, invisible to the clock.
      if (/^\[[^\]]*\]$/.test(group.text)) {
        tokens.push(makeToken(group, lineIndex, 'label'))
        line.tokens.push(tokens.length - 1)
        continue
      }

      const parts = splitParts(group)
      const subCount = parts.length
      const slices = divide(pulsesPerBar, subCount)
      let subIndex = 0
      let groupPulse = pulse

      for (const part of parts) {
        const token = makeToken(part, lineIndex, 'chord')
        token.subIndex = subIndex
        token.subCount = subCount
        line.tokens.push(tokens.length)
        tokens.push(token)

        readMarks(token)

        if (token.body === '%') {
          // Repeat the previous bar: stretch the last event rather than adding one.
          const previous = events[events.length - 1]
          if (previous) {
            previous.endPulse += slices[subIndex]
            previous.bars += slices[subIndex] / pulsesPerBar
            previous.tokens.push(tokens.length - 1)
            token.eventIndex = previous.index
          } else {
            token.type = 'error'
            token.error = 'nothing to repeat'
          }
          groupPulse += slices[subIndex]
          subIndex++
          continue
        }

        token.chord = parseChord(token.body, opts.conventions)
        if (!token.chord.ok) {
          token.type = 'error'
          token.error = token.chord.error
        }

        const last = events[events.length - 1]
        const canMerge =
          mergeRepeats &&
          last &&
          subCount === 1 &&
          last.subCount === 1 &&
          !token.phraseChange &&
          sameChord(last.chord, token.chord)

        if (canMerge) {
          last.endPulse += slices[subIndex]
          last.bars += slices[subIndex] / pulsesPerBar
          last.tokens.push(tokens.length - 1)
          token.eventIndex = last.index
        } else {
          const event = {
            index: events.length,
            startPulse: groupPulse,
            endPulse: groupPulse + slices[subIndex],
            bars: slices[subIndex] / pulsesPerBar,
            subCount,
            chord: token.chord,
            tokens: [tokens.length - 1],
            phraseChange: token.phraseChange,
            phraseRef: token.phraseRef,
            phraseId: null,
            valid: token.type === 'chord',
          }
          events.push(event)
          token.eventIndex = event.index
        }

        groupPulse += slices[subIndex]
        subIndex++
      }
      pulse = groupPulse
    }

    cursor = line.end + 1
    lineStart = cursor
    lineIndex++
  }

  resolvePhraseSections(events)

  return {
    text: src,
    tokens,
    lines,
    events,
    beatsPerBar,
    pulsesPerBar,
    totalPulses: pulse,
    bars: pulse / pulsesPerBar,
  }
}

/**
 * Whitespace-delimited runs, with absolute character offsets.
 *
 * A bracketed label is taken whole first, so `[verse 1]` stays one token
 * instead of becoming two unreadable chords.
 */
function splitGroups(lineText, offset) {
  const out = []
  const re = /\[[^\]]*\]|\S+/g
  let m
  while ((m = re.exec(lineText))) out.push({ text: m[0], start: offset + m.index, end: offset + m.index + m[0].length })
  return out
}

/** Comma-delimited pieces of one group, with absolute character offsets. */
function splitParts(group) {
  const out = []
  let index = 0
  for (const piece of group.text.split(',')) {
    const start = group.start + index
    if (piece.length) out.push({ text: piece, start, end: start + piece.length })
    index += piece.length + 1
  }
  return out.length ? out : [group]
}

function makeToken(part, lineIndex, type) {
  return {
    type,
    text: part.text,
    body: part.text,
    start: part.start,
    end: part.end,
    line: lineIndex,
    subIndex: 0,
    subCount: 1,
    phraseChange: false,
    phraseRef: null,
    eventIndex: -1,
    chord: null,
    body: part.text,
    bodyStart: part.start,
    bodyEnd: part.end,
  }
}

/** Peel the `.` phrase-change marker and the `{phrase}` binding off a word. */
function readMarks(token) {
  let body = token.text
  if (body.startsWith('.')) {
    token.phraseChange = true
    body = body.slice(1)
  }
  const ref = PHRASE_REF.exec(body)
  if (ref) {
    token.phraseRef = ref[1].trim() || null
    token.refStart = token.start + (token.phraseChange ? 1 : 0) + ref.index
    body = body.slice(0, ref.index)
  }
  token.body = body
  token.bodyStart = token.start + (token.phraseChange ? 1 : 0)
  token.bodyEnd = token.bodyStart + body.length
}

/** Split `total` pulses into `count` near-equal integer slices. */
function divide(total, count) {
  const base = Math.floor(total / count)
  const out = new Array(count).fill(base)
  let remainder = total - base * count
  for (let i = 0; remainder > 0; i++, remainder--) out[i % count]++
  return out
}

/** Do two parsed chords describe exactly the same sound? */
export function sameChord(a, b) {
  if (!a || !b || !a.ok || !b.ok) return false
  return (
    a.rootPc === b.rootPc &&
    a.inversion === b.inversion &&
    a.bassPc === b.bassPc &&
    a.intervals.length === b.intervals.length &&
    a.intervals.every((n, i) => n === b.intervals[i])
  )
}

/**
 * A phrase binding sticks until the next chord wearing a dot.  Walk the events
 * once and stamp each with whatever phrase is currently in force.
 */
function resolvePhraseSections(events) {
  let current = null
  let sectionStart = 0
  for (const event of events) {
    if (event.phraseChange || event.index === 0) {
      if (event.phraseChange || event.phraseRef) {
        current = event.phraseRef
        sectionStart = event.index
      }
    }
    event.phraseId = current
    event.sectionStart = sectionStart
  }
}

/** Which event is sounding at `pulse`, wrapping if the chart is set to loop. */
export function eventAtPulse(score, pulse, loop = true) {
  if (!score.events.length || score.totalPulses <= 0) return null
  let p = pulse
  if (loop) p = ((p % score.totalPulses) + score.totalPulses) % score.totalPulses
  else if (p < 0 || p >= score.totalPulses) return null

  let lo = 0
  let hi = score.events.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const event = score.events[mid]
    if (p < event.startPulse) hi = mid - 1
    else if (p >= event.endPulse) lo = mid + 1
    else return event
  }
  return null
}

/** Normalised position inside the chart, for looping playheads. */
export function wrapPulse(score, pulse, loop = true) {
  if (!score.totalPulses) return 0
  if (!loop) return pulse
  return ((pulse % score.totalPulses) + score.totalPulses) % score.totalPulses
}
