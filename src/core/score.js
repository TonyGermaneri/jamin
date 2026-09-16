/**
 * Turns the text in the editor into a timeline.
 *
 * There are two ways to write a chart here, and which one you get depends on
 * whether you use bar lines. Write them and you get the convention every
 * fake book, lead sheet and iReal Pro chart uses:
 *
 *   | Dm7 G7 | Cmaj7 | %  |     two chords splitting a bar, one bar of Cmaj7,
 *                              then a bar the same as the one before
 *   | C / Am / |                each symbol is a beat; `/` holds the chord
 *
 * Leave them out and you get a shorthand that is quicker to type, where a space
 * is a bar:
 *
 *   C  F  G                    three bars
 *   C  C  F                    two bars of C, then F
 *   F,F- C                     half a bar each, then a bar of C
 *
 * Common to both: `/` holds the chord before it for another slot, `%` repeats
 * the previous bar, `x` repeats the previous two, `[section labels]` are
 * decoration, and a leading `.` marks a phrase change -- `.C7{walkup}`.
 *
 * Sections repeat between repeat marks, written either way round:
 *
 *   |: Am7 | Bbmaj7 :|16       the conventional spelling, sixteen times through
 *   :Am7 Am7 Bbmaj7 Bbmaj7:16  the same thing without the bar lines
 *
 * A bare `:|` means twice, as it does on paper.
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
  let repeatFrom = null

  // The section the chart is in, and where it started. A label is no longer
  // only something to read: a section runs from its own label to the next one,
  // which is what lets a groove be bound to "the chorus" rather than to a bar
  // number that moves the moment anybody edits anything.
  let section = null
  let sectionAt = 0
  let sectionIndex = -1
  const sections = []

  // What the drums are doing, and from where. Same three states as the pedal:
  // null is "the chart has not said", so the binding in the drum book decides.
  let drums = null
  let noFill = false

  // null means nothing in the chart has said either way, so the switch in the
  // settings decides. Kept as three states rather than seeded from the setting
  // so that turning the switch on takes effect immediately, on a chart that was
  // parsed before it was touched -- a parse that depended on a setting would
  // have to be redone every time one changed.
  let pedal = null

  // Bar lines change what a space means, so the whole chart reads one way or the
  // other rather than flipping halfway down.
  const useBarlines = opts.barlines !== undefined ? opts.barlines : src.includes('|')

  const rawLines = src.split('\n')
  for (const lineText of rawLines) {
    const line = { index: lineIndex, start: lineStart, end: lineStart + lineText.length, text: lineText, tokens: [] }
    lines.push(line)

    for (const group of splitBars(lineText, lineStart, useBarlines)) {
      if (group.type === 'label') {
        const pedalling = pedalMark(group.text)
        const drumming = pedalling ? null : drumMark(group.text)
        const kind = pedalling ? 'pedal' : drumming ? 'drum' : 'label'
        const token = makeToken(group, lineIndex, kind)

        if (pedalling) {
          pedal = pedalling === 'down'
          token.pedal = pedal
        } else if (drumming) {
          token.drum = drumming
          if (drumming.kind === 'off') { drums = null; noFill = true }
          else if (drumming.kind === 'nofill') noFill = true
          else if (drumming.kind === 'fill') noFill = false
          else { drums = drumming.name; noFill = false }
        } else {
          // An ordinary bracket is a section: [Intro], [Verse 1], [Chorus].
          // Named rather than lettered, because a name is what somebody in the
          // room says. @see docs/drums.md
          section = group.text.slice(1, -1).trim()
          sectionAt = pulse
          sectionIndex = sections.length
          sections.push({
            index: sectionIndex,
            name: section,
            startPulse: pulse,
            endPulse: pulse,
            firstEvent: events.length,
            lastEvent: events.length,
            token: tokens.length,
          })
          // A new section takes the drums the chart last asked for, not the
          // previous section's override -- an override is for where it is
          // written, and the section is a fresh page.
          noFill = false
        }

        tokens.push(token)
        line.tokens.push(tokens.length - 1)
        continue
      }

      if (group.type === 'barline') {
        tokens.push(makeToken(group, lineIndex, group.type))
        line.tokens.push(tokens.length - 1)
        continue
      }

      if (group.type === 'repeat-open') {
        tokens.push(makeToken(group, lineIndex, 'repeat'))
        line.tokens.push(tokens.length - 1)
        repeatFrom = { eventIndex: events.length, pulse }
        continue
      }

      if (group.type === 'repeat-close') {
        const mark = makeToken(group, lineIndex, 'repeat')
        tokens.push(mark)
        line.tokens.push(tokens.length - 1)
        pulse = closeRepeat(events, repeatFrom, pulse, group.times, pulsesPerBar, mark)
        repeatFrom = null
        continue
      }

      const parts = group.parts
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

        readMarks(token, repeatFrom !== null)
        if (token.repeatOpen) repeatFrom = { eventIndex: events.length, pulse: groupPulse }

        // `/` holds the chord before it; `%` repeats the bar before it; `x`
        // repeats the two before it. All three stretch the last event rather
        // than starting a new one.
        const held = HOLD.test(token.body)
        if (held) {
          const previous = events[events.length - 1]
          const span = token.body.toLowerCase() === 'x' ? slices[subIndex] * 2 : slices[subIndex]
          if (previous) {
            previous.endPulse += span
            previous.bars += span / pulsesPerBar
            previous.tokens.push(tokens.length - 1)
            token.eventIndex = previous.index
          } else {
            token.type = 'error'
            token.error = 'nothing to hold'
          }
          groupPulse += span
          if (token.repeatClose) {
            groupPulse = closeRepeat(events, repeatFrom, groupPulse, token.repeatClose, pulsesPerBar, token)
            repeatFrom = null
          }
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
          last.pedal === pedal &&
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
            // true, false, or null for "the chart did not say". @see pedalMark
            pedal,
            // Which section this chord is in, and what the chart said about
            // drums at this point. @see drumMark
            section: sectionIndex,
            sectionName: section,
            drums,
            noFill,
            valid: token.type === 'chord',
          }
          events.push(event)
          token.eventIndex = event.index
        }

        groupPulse += slices[subIndex]
        if (token.repeatClose) {
          groupPulse = closeRepeat(events, repeatFrom, groupPulse, token.repeatClose, pulsesPerBar, token)
          repeatFrom = null
        }
        subIndex++
      }
      pulse = groupPulse
    }

    cursor = line.end + 1
    lineStart = cursor
    lineIndex++
  }

  resolvePhraseSections(events, opts)
  closeSections(sections, events, pulse)

  return {
    text: src,
    tokens,
    lines,
    events,
    sections,
    beatsPerBar,
    pulsesPerBar,
    barlines: useBarlines,
    totalPulses: pulse,
    bars: pulse / pulsesPerBar,
  }
}

/** `/`, `%` and `x` all mean "keep playing what was already playing". */
const HOLD = /^(\/+|%+|x)$/i

/**
 * The pedal marks: `[p]` holds it from here on, `[np]` lifts it.
 *
 * Written the way a pianist writes them. "n.p." is the usual hand-written form
 * and the dots are noise to type, so every spelling of it is accepted -- `[np]`,
 * `[n.p]`, `[n.p.]` -- and `[p.]` for symmetry. A mark applies to every chord
 * after it until another one changes it, so a chart says "pedal from the bridge"
 * by writing it once at the bridge.
 *
 * They are brackets because that is already how this notation marks something
 * that is not a chord, and they are read *before* section labels so `[p]` is a
 * pedal rather than a section called p.
 */
const PEDAL_DOWN = /^\[\s*p\.?\s*\]$/i
const PEDAL_UP = /^\[\s*n\.?\s*p\.?\s*\]$/i

/**
 * The drum marks: `[d:name]`.
 *
 * Drums are articulations like any other, so they are named the same way -- and
 * they go in brackets because that is already how this notation says "not a
 * chord", alongside the section labels they sit next to and the pedal marks.
 *
 *   [d:halftime]   play this groove from here
 *   [d:nofill]     no fill into the next section
 *   [d:none]       drums out
 *
 * A name rather than a catalogue number. `[d:g1841]` would be unreadable, would
 * not survive the catalogue changing, and could not be typed by somebody who
 * had not just looked it up -- which is the same objection that keeps phrase
 * references to names.
 */
const DRUM_MARK = /^\[\s*d\s*:\s*([^\]]*?)\s*\]$/i

/** What a `[d:...]` says, or null for a bracket that is not one. */
export function drumMark(text) {
  const found = DRUM_MARK.exec(String(text || '').trim())
  if (!found) return null

  const body = found[1].toLowerCase()
  if (!body) return null
  if (body === 'none' || body === 'off' || body === 'out') return { kind: 'off' }
  if (body === 'nofill') return { kind: 'nofill' }
  if (body === 'fill') return { kind: 'fill' }
  return { kind: 'groove', name: found[1] }
}

/** 'down', 'up', or null for a bracket that is an ordinary section label. */
export function pedalMark(text) {
  const mark = String(text || '').trim()
  if (PEDAL_UP.test(mark)) return 'up'
  if (PEDAL_DOWN.test(mark)) return 'down'
  return null
}

/** `|:` and `:|`, and the compact `:chord` / `chord:16` forms. */
const REPEAT_OPEN = /^\|:$/
const REPEAT_CLOSE = /^:\|\s*(?:x\s*)?(\d*)$/i

/**
 * Cut a line into bars.
 *
 * With bar lines, a bar is what sits between them and everything inside divides
 * it -- which is how a fake book reads. Without them, each whitespace-delimited
 * word is its own bar, which is quicker to type. Either way a bracketed label is
 * taken whole, so `[verse 1]` stays one token rather than two unreadable chords.
 */
export function splitBars(lineText, offset, useBarlines) {
  const out = []
  // Repeat marks are matched before plain bar lines so `|:` is not read as a
  // bar line followed by a stray colon.
  const re = /\[[^\]]*\]|\|:|:\|\s*x?\d*|\|+|[^\s|]+/g
  let open = null
  let m

  const close = () => {
    if (open && open.parts.length) out.push(open)
    open = null
  }

  while ((m = re.exec(lineText))) {
    const piece = { text: m[0], start: offset + m.index, end: offset + m.index + m[0].length }

    // A closed bracket only: `[oops` with no `]` is just an unreadable chord.
    if (/^\[[^\]]*\]$/.test(piece.text)) {
      out.push({ ...piece, type: 'label' })
      continue
    }

    if (REPEAT_OPEN.test(piece.text)) {
      close()
      out.push({ ...piece, type: 'repeat-open' })
      continue
    }

    const closeMark = REPEAT_CLOSE.exec(piece.text)
    if (closeMark) {
      close()
      out.push({ ...piece, type: 'repeat-close', times: Number(closeMark[1]) || 2 })
      continue
    }

    if (/^\|/.test(piece.text)) {
      close()
      out.push({ ...piece, type: 'barline' })
      continue
    }

    const parts = splitParts(piece)
    if (useBarlines) {
      if (!open) open = { type: 'bar', start: piece.start, end: piece.end, parts: [] }
      open.parts.push(...parts)
      open.end = piece.end
    } else {
      out.push({ type: 'bar', start: piece.start, end: piece.end, parts })
    }
  }

  close()
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

/**
 * Peel the markers off a word: `:` opening a repeat, `:16` closing one, the `.`
 * phrase-change dot and the `{phrase}` binding.
 *
 * A trailing `:16` only closes a repeat when one is actually open, because
 * `C:7` is a perfectly good Harte spelling of C dominant seven. Context decides,
 * and there is no case where both readings are available at once.
 */
function readMarks(token, repeatIsOpen) {
  let body = token.text

  if (body.length > 1 && body.startsWith(':')) {
    token.repeatOpen = true
    body = body.slice(1)
  }

  if (repeatIsOpen || token.repeatOpen) {
    const closing = /:(\d*)$/.exec(body)
    if (closing && closing.index > 0) {
      token.repeatClose = Number(closing[1]) || 2
      body = body.slice(0, closing.index)
    }
  }

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
  token.bodyStart = token.start + (token.repeatOpen ? 1 : 0) + (token.phraseChange ? 1 : 0)
  token.bodyEnd = token.bodyStart + body.length
}

/**
 * Play a span again. The events are copied rather than the timeline being made
 * cleverer, so looking up what is playing stays a binary search -- and each copy
 * points at the same tokens, so the chord lights up on every pass.
 */
function closeRepeat(events, from, endPulse, times, pulsesPerBar, token) {
  if (!from || events.length <= from.eventIndex) {
    token.type = 'error'
    token.error = 'nothing to repeat'
    return endPulse
  }
  const span = endPulse - from.pulse
  if (span <= 0 || times < 2) return endPulse

  const original = events.slice(from.eventIndex)
  for (let pass = 1; pass < times; pass++) {
    for (const event of original) {
      events.push({
        ...event,
        index: events.length,
        startPulse: event.startPulse + span * pass,
        endPulse: event.endPulse + span * pass,
        tokens: event.tokens.slice(),
      })
    }
  }
  return from.pulse + span * times
}

/**
 * Give every section its end, and the events it holds.
 *
 * A section runs to wherever the next one starts, and the last runs to the end
 * of the chart. Sections are spans rather than points because that is what a
 * groove needs: "play this for the chorus" is a question about how long the
 * chorus is, and a fill going into the next section is a question about where
 * this one stops.
 */
function closeSections(sections, events, totalPulses) {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const next = sections[i + 1]

    section.endPulse = next ? next.startPulse : totalPulses
    section.lastEvent = next ? next.firstEvent - 1 : events.length - 1
    section.bars = section.endPulse - section.startPulse
    section.empty = section.lastEvent < section.firstEvent
  }
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
 * Work out which phrase is playing where.
 *
 * By default one phrase plays for the whole song and the chart stays free of
 * markup. Turn per-chord articulations on and a phrase instead sticks from the
 * chord wearing a dot until the next one -- which is what the dots in the text
 * are for.
 */
function resolvePhraseSections(events, opts) {
  /*
   * A chart that names a phrase means it, whatever the setting says.
   *
   * Writing `{p2551}` against a chord is an instruction, and a switch in a
   * dialog somewhere quietly ignoring it is the program arguing with what is
   * written in front of somebody. So the markup turns per-chord articulation on
   * for this chart -- the setting only decides what happens to a chart that
   * says nothing.
   */
  const named = events.some((event) => event.phraseChange || event.phraseRef)

  if (!opts.perChordPhrases && !named) {
    const songPhrase = opts.songPhrase || null
    for (const event of events) {
      event.phraseId = songPhrase
      event.sectionStart = 0
    }
    return
  }

  // Where the chart has forced this, the song's own phrase plays until the
  // chart first says otherwise -- rather than silence up to the first marker.
  let current = opts.perChordPhrases ? null : (opts.songPhrase || null)
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
