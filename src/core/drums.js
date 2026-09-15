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

  return {
    id: `g${index}`,
    name: entry.n || `groove ${index}`,
    // beat | fill. The only two things a drummer is doing at this level.
    kind: entry.k === 'fill' ? 'fill' : 'beat',
    genre: entry.g || '',
    substyle: entry.u || '',
    bpm: Number(entry.b) || 0,
    timeSignature: entry.t || '4-4',
    beatsPerBar: numerator,
    beatUnit: denominator,
    bars: Number(entry.r) || 1,
    lengthPulses: Number(entry.d) || PULSES_PER_BAR_4_4,
    // Left in the kit they were played on. Translating here would bake one
    // kit into the catalogue; it happens at playback, where the answer is known.
    notes: entry.v.map(([at, note, duration, velocity]) => ({ at, note, duration, velocity })),
    origin: 'Groove MIDI Dataset',
    builtin: true,
  }
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
  return `${groove.kind} · ${bars} · ${groove.notes.length} hits · ${style} · played at ${groove.bpm}`
}

/**
 * The groove, as this kit plays it, laid out over a span of chart.
 *
 * Looped rather than stretched. A two-bar groove under an eight-bar verse plays
 * four times; it is not slowed down to last eight, because a drum groove
 * stretched to twice its length is not that groove played slower, it is a
 * different and much worse groove. A groove that does not divide the span
 * evenly is cut off at the end, which is what a drummer does when the section
 * changes under them.
 */
export function layOutGroove(groove, spanPulses, map) {
  if (!groove || !groove.notes.length || spanPulses <= 0) return []

  const length = Math.max(1, groove.lengthPulses)
  const played = mapDrumNotes(groove.notes, map)
  const out = []

  for (let start = 0; start < spanPulses; start += length) {
    for (const note of played) {
      const at = start + note.at
      if (at >= spanPulses) continue
      out.push({ ...note, at })
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
export function placeFill(fill, spanPulses, map) {
  if (!fill || !fill.notes.length) return []

  const length = Math.max(1, fill.lengthPulses)
  if (length > spanPulses) return []

  const offset = spanPulses - length
  return mapDrumNotes(fill.notes, map)
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

  const { groove: pickGroove, fill: pickFill, map, fillOnEveryBoundary = true } = options
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

    const fill = wantFill && typeof pickFill === 'function' ? pickFill(span) : null
    const placed = fill ? placeFill(fill, length, mapFor(fill)) : []

    // The groove stops where the fill starts. Both playing at once is two
    // drummers, which is not what a fill is.
    const grooveSpan = placed.length ? length - fill.lengthPulses : length
    for (const note of layOutGroove(chosen, grooveSpan, mapFor(chosen))) {
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

  const only = fills.filter((fill) => fill.kind === 'fill'
    && fill.timeSignature === beat.timeSignature
    && (bars === null || fill.bars === bars))

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
