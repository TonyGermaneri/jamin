/**
 * The drum catalogue.
 *
 * Two and a half thousand grooves cut from human performances: a beat that
 * loops for as long as a section lasts, and a fill that goes in the bar before
 * the next one. That division is the corpus's own -- every performance in the
 * Groove MIDI Dataset is labelled `beat` or `fill` -- and it is also how a drum
 * chart has worked since long before there were corpora to draw on.
 *
 * **A groove is not a phrase.** A phrase is stored as degrees and re-pointed at
 * whatever chord it lands on; a drum note is an instrument, not a pitch, and
 * transposing one turns a snare into a tom. Nothing here goes near the voice
 * leading. What it does need is translating from the kit it was played on to
 * the kit that will play it, which is @see drumKits.js.
 *
 * @see src/data/grooveDrums.LICENSE for the attribution CC BY 4.0 requires.
 */

import { resourceOk } from './fetchResource.js'
import { mapDrumNotes } from './drumKits.js'

const PULSES_PER_BAR_4_4 = 96

let cache = null
let pending = null
let report = { grooves: 0, error: null }

/** One entry of the shipped file, as the application uses it. */
function toGroove(entry, index) {
  if (!entry || !Array.isArray(entry.v)) return null

  const [numerator = 4, denominator = 4] = String(entry.t || '4-4').split('-').map(Number)

  const groove = {
    id: `g${index}`,
    name: entry.n || `groove ${index}`,
    // beat | fill | song. A beat is short enough to loop, a song is a
    // performance you play through, and the corpus itself says which are fills.
    kind: entry.k === 'fill' ? 'fill' : entry.k === 'song' ? 'song' : 'beat',
    genre: entry.g || '',
    substyle: entry.u || '',
    bpm: Number(entry.b) || 0,
    timeSignature: entry.t || '4-4',
    beatsPerBar: numerator,
    beatUnit: denominator,
    bars: Number(entry.r) || 1,
    lengthPulses: Number(entry.d) || PULSES_PER_BAR_4_4,
    // How many hits, for the list line, without touching the notes.
    hits: entry.v.length,
    // Whose take it is. These are performances rather than patterns, and a
    // performance has somebody playing it.
    drummer: entry.w || '',
    origin: 'Groove MIDI Dataset',
    builtin: true,
  }

  /*
   * The notes are built when something asks for them, and not before.
   *
   * These are whole performances -- one is 639 bars -- so building every note
   * object for all eleven hundred of them is millions of allocations, and it
   * was happening on every page load. Measured on an editor open: twenty-one
   * seconds of it, out of twenty-one and a half.
   *
   * Almost none of them are ever played. The list needs a name, a length and a
   * hit count; the player needs the notes, for the four or five a chart binds.
   * So the raw arrays are kept as they arrived and turned into notes once, on
   * first use. Left in the kit they were played on either way -- translating
   * here would bake one kit into the catalogue, and that happens at playback
   * where the answer is known.
   */
  let notes = null
  Object.defineProperty(groove, 'notes', {
    enumerable: true,
    get() {
      if (!notes) {
        notes = entry.v.map(([at, note, duration, velocity]) => ({ at, note, duration, velocity }))
      }
      return notes
    },
  })

  return groove
}

export async function loadDrums() {
  if (cache) return cache
  if (!pending) {
    pending = fetch(new URL('../data/grooveDrums.json', import.meta.url))
      .then((response) => (resourceOk(response) ? response.json() : Promise.reject(new Error(response.status))))
      .then((payload) => {
        cache = (payload.grooves || []).map(toGroove).filter(Boolean)
        report = { grooves: cache.length, error: null }
        return cache
      })
      .catch((error) => {
        cache = []
        report = { grooves: 0, error: String((error && error.message) || error) }
        return cache
      })
  }
  return pending
}

export function loadedDrums() {
  return cache || []
}

export function drumReport() {
  return report
}

/** Free-text search over the name, genre and substyle. */
export function searchDrums(list, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return list
  return list.filter(
    (groove) =>
      groove.name.toLowerCase().includes(needle) ||
      groove.genre.toLowerCase().includes(needle) ||
      groove.substyle.toLowerCase().includes(needle) ||
      groove.kind.includes(needle)
  )
}

/** A line for the list: what it is, how long, and how fast it was played. */
export function summarizeGroove(groove) {
  if (!groove) return 'empty'
  const bars = `${groove.bars} bar${groove.bars === 1 ? '' : 's'}`
  const style = groove.substyle ? `${groove.genre} · ${groove.substyle}` : groove.genre
  const who = groove.drummer ? ` · ${groove.drummer}` : ''
  return `${groove.kind} · ${bars} · ${groove.hits ?? groove.notes.length} hits · ${style} · played at ${groove.bpm}${who}`
}

/**
 * Does this pattern fit that many bars exactly?
 *
 * Either it is the same length or it goes in a whole number of times. A two-bar
 * groove fits an eight-bar verse four times over and a three-bar one does not
 * fit at all -- it would be cut off mid-phrase every time round, which is the
 * thing that makes a loop sound like a mistake rather than a part.
 *
 * A pattern longer than the span never fits: it would be truncated, and half a
 * phrase is not the phrase.
 */
export function fitsBars(groove, bars) {
  if (!groove || !bars || bars <= 0) return false
  if (groove.bars > bars) return false
  return bars % groove.bars === 0
}

/**
 * The groove, as this kit plays it, laid over a stretch of chart.
 *
 * Looped rather than stretched. A two-bar groove under an eight-bar verse plays
 * four times; it is not slowed down to last eight, because a drum groove
 * stretched to twice its length is not that groove played slower, it is a
 * different and much worse groove.
 *
 * **Locked to the song's bars, not to the groove's own length.** This is the
 * part that was wrong for a long time and sounded like a timing bug. An
 * imported library is full of patterns whose bar is not the song's -- a 3/4
 * pattern is 72 pulses against a 4/4 song's 96 -- and looping one at its own
 * length walks it off the grid: hits at 72, 144, 216, 360, with the downbeat
 * landing on the 1 only every fourth time round.
 *
 * So the loop is a whole number of the *song's* bars, wide enough to hold the
 * pattern, and every repetition begins on a bar line. A 72-pulse pattern comes
 * round every 96 and leaves a quarter of silence rather than dragging the 1
 * with it. The pattern itself is untouched: what changes is only where each
 * repetition starts.
 *
 * `startPulse` is where this stretch begins in the song, so the grid is the
 * song's and not the section's -- a section starting mid-bar does not take the
 * drums off the 1 with it. Notes come back relative to the stretch, as before.
 */
export function layOutGroove(groove, spanPulses, map, inbound = undefined, options = {}) {
  if (!groove || !groove.notes.length || spanPulses <= 0) return []

  const { startPulse = 0, barPulses = 0 } = options
  const length = Math.max(1, groove.lengthPulses)
  const step = barPulses > 0 ? Math.max(barPulses, Math.ceil(length / barPulses) * barPulses) : length

  const played = mapDrumNotes(groove.notes, map, inbound || undefined)
  const out = []

  const from = startPulse
  const to = startPulse + spanPulses
  // The last repetition boundary at or before this stretch begins. Counted from
  // the song's own zero, which is what puts the 1 on the 1.
  const first = barPulses > 0 ? Math.floor(from / step) * step : from

  for (let start = first; start < to; start += step) {
    for (const note of played) {
      const at = start + note.at
      if (at < from || at >= to) continue
      out.push({ ...note, at: at - from })
    }
  }

  return out.sort((a, b) => a.at - b.at || a.note - b.note)
}

/**
 * A fill, placed so it *ends* where the section does.
 *
 * This is the whole point of a fill and the easy thing to get backwards. It
 * leads into the change, so a one-bar fill occupies the last bar and a two-bar
 * fill the last two -- it is not started at the section's end and allowed to
 * run over, and it is not started at the beginning. A fill longer than the span
 * it has to live in is refused rather than truncated: half a fill is a mistake,
 * and playing the groove instead is not.
 */
export function placeFill(fill, spanPulses, map, inbound = undefined) {
  if (!fill || !fill.notes.length) return []

  const length = Math.max(1, fill.lengthPulses)
  if (length > spanPulses) return []

  const offset = spanPulses - length
  return mapDrumNotes(fill.notes, map, inbound || undefined)
    .map((note) => ({ ...note, at: offset + note.at }))
    .sort((a, b) => a.at - b.at || a.note - b.note)
}

/**
 * Where the drums change, over the whole chart.
 *
 * A span is a stretch of chart playing one groove. Sections make them, and so
 * does a `[d:...]` written mid-section -- which is why this is not simply a walk
 * over `score.sections`. A chart with no sections at all is one span, because a
 * song with no marked parts still has drums.
 */
function drumSpans(score) {
  const total = score.totalPulses | 0
  if (!total) return []

  const spans = []
  let open = null

  for (const event of score.events) {
    const section = event.section ?? -1
    const groove = event.drums || null

    // A new section, or the chart asking for something different inside one.
    if (!open || open.section !== section || open.groove !== groove) {
      if (open) open.endPulse = event.startPulse
      open = {
        section,
        sectionName: event.sectionName || null,
        groove,
        startPulse: event.startPulse,
        endPulse: total,
        // Only the span that reaches a section's end can carry its fill.
        noFill: event.noFill,
      }
      spans.push(open)
    } else {
      open.noFill = event.noFill
    }
  }

  if (open) open.endPulse = total
  return spans.filter((span) => span.endPulse > span.startPulse)
}

/**
 * The whole drum part, worked out once.
 *
 * Built ahead rather than decided beat by beat, for the same reason the rest of
 * the song is compiled: it depends on nothing that happens at play time, and a
 * list of notes at fixed pulses is a thing the plugin can perform without
 * knowing what a section is.
 *
 * @param {object} score            a parsed chart
 * @param {object} options
 * @param {function} options.groove  name or section -> a groove, or null
 * @param {function} [options.fill]  a section -> the fill to lead out of it
 * @param {object|function} options.map  the kit in use, or a function from a
 *                                   groove to one -- an imported library is
 *                                   written for its own instrument, and a chart
 *                                   can use one library for the verse and
 *                                   another for the chorus @see drumKits.js
 * @param {boolean} [options.fillOnEveryBoundary]
 */
export function buildDrumTrack(score, options = {}) {
  if (!score || !score.events || !score.events.length) return []

  const { groove: pickGroove, fill: pickFill, map, inbound, fillOnEveryBoundary = true } = options
  if (typeof pickGroove !== 'function') return []

  const spans = drumSpans(score)
  const out = []

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    const chosen = pickGroove(span)
    if (!chosen) continue                       // nothing bound, and nothing invented

    const length = span.endPulse - span.startPulse

    // A fill belongs to the boundary, not to the section: it leads into the
    // change, so it goes in the bar before the *next* section starts. Which is
    // why it is only considered on the span that actually reaches one.
    const next = spans[i + 1]
    const leavesSection = next && next.section !== span.section
    const wantFill = fillOnEveryBoundary && leavesSection && !span.noFill

    const mapFor = (groove) => (typeof map === 'function' ? map(groove) : map)
    // How an arriving note is *read*, which an imported library answers
    // differently from the shipped corpus. @see drumKits.GENERAL_MIDI_IN
    const inFor = (groove) => (typeof inbound === 'function' ? inbound(groove) : inbound)

    const fill = wantFill && typeof pickFill === 'function' ? pickFill(span) : null
    const placed = fill ? placeFill(fill, length, mapFor(fill), inFor(fill)) : []

    // The groove stops where the fill starts. Both playing at once is two
    // drummers, which is not what a fill is.
    const grooveSpan = placed.length ? length - fill.lengthPulses : length
    // The song's bar, so the groove is locked to the chart's grid rather than
    // to wherever this section happens to begin. @see layOutGroove
    const bar = score.pulsesPerBar || 0
    for (const note of layOutGroove(chosen, grooveSpan, mapFor(chosen), inFor(chosen),
                                   { startPulse: span.startPulse, barPulses: bar })) {
      out.push({ ...note, at: span.startPulse + note.at })
    }
    for (const note of placed) {
      out.push({ ...note, at: span.startPulse + note.at })
    }
  }

  return out.sort((a, b) => a.at - b.at || a.note - b.note)
}

/**
 * A fill that suits this beat.
 *
 * The corpus does not hand you one. Beats and fills were recorded in separate
 * sessions -- only seven of twenty-five sessions contain both, and the median
 * beat has no fill of its own at all -- so "the fill that goes with this groove"
 * has to be found rather than looked up.
 *
 * What genuinely relates them is genre, time signature and tempo, in that order
 * of importance. A rock fill under a rock beat is right; a rock fill at 80
 * under a rock beat at 160 is not, because a fill is a flurry and its density
 * is a function of the tempo it was played at.
 *
 * So it narrows and then widens until something is found:
 *
 *   genre + time signature + within a fifth of the tempo   median 36 to choose from
 *   genre + time signature                                 median 61
 *   time signature alone                                   always something
 *
 * Five genres in the corpus have no fills at all -- afrobeat, blues, dance,
 * highlife, middleeastern -- which is why the last rung exists and why it is a
 * rung rather than a refusal.
 */
export function matchingFill(beat, fills, { bars = null, prefer = 'closest' } = {}) {
  if (!beat || !fills || !fills.length) return null

  const fits = (one) => one.timeSignature === beat.timeSignature
    && (bars === null || one.bars === bars)

  /*
   * Labelled fills first, anything short enough after.
   *
   * It used to refuse everything a library had not called a fill, which is the
   * interface arguing with somebody about their own collection: the label is a
   * guess made from a file name, and a vendor who files their one-bar phrases
   * under `Breaks` or `Turnarounds` or nothing at all has not said those are
   * not fills. Five genres in the bundled corpus have no labelled fills at all.
   *
   * So it is a preference rather than a gate, and the fallback is bounded by
   * length instead: a fill leads out of a section, and two bars is the most of
   * one anybody wants. A labelled fill still wins whenever there is one.
   */
  const labelled = fills.filter((one) => one.kind === 'fill' && fits(one))
  const only = labelled.length
    ? labelled
    : fills.filter((one) => one.id !== beat.id && one.bars <= 2 && fits(one))

  if (!only.length) return null

  const sameGenre = only.filter((fill) => fill.genre === beat.genre)
  const nearTempo = sameGenre.filter((fill) => Math.abs(fill.bpm - beat.bpm) <= beat.bpm * 0.2)

  const pool = nearTempo.length ? nearTempo : sameGenre.length ? sameGenre : only

  if (prefer === 'random') return pool[Math.floor(Math.random() * pool.length)]

  // The closest tempo, and the shorter fill when two are equally close: a
  // one-bar fill fits everywhere a two-bar one does and in places it does not.
  return pool.slice().sort((a, b) =>
    Math.abs(a.bpm - beat.bpm) - Math.abs(b.bpm - beat.bpm) || a.bars - b.bars)[0]
}
