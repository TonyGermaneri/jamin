/**
 * A standard MIDI file, for dragging something out of here into a DAW.
 *
 * The other direction has existed for a while -- @see midiFile.js reads what
 * somebody's library hands us. This writes, because a pattern you can hear but
 * cannot get into your own arrangement is a pattern you have to play in by
 * hand.
 *
 * **Format 0**, one track, because every DAW in the world reads it and nothing
 * here needs more than one. **480 ticks a quarter**, which is what a DAW
 * expects to see; jamin counts in 24 pulses a quarter internally, so everything
 * is multiplied on the way out and the arithmetic stays whole.
 *
 * A malformed MIDI file does not announce itself. A DAW shows an empty clip, or
 * refuses the drop with no reason given, and there is nothing to read. So this
 * is checked against the bytes the specification asks for rather than against
 * whether it happens to load. @see tests/midiWrite.test.js
 */

/** What jamin counts in, and what the file says. */
export const PULSES_PER_QUARTER = 24
export const FILE_PPQ = 480

const SCALE = FILE_PPQ / PULSES_PER_QUARTER

/**
 * A variable-length quantity, which is how a MIDI file writes every delta time.
 *
 * Seven bits at a time, most significant first, with the top bit set on every
 * byte but the last. It is the one piece of the format that is easy to get
 * subtly wrong and impossible to notice: a wrong length shifts everything after
 * it, and the file still parses -- into nonsense.
 */
export function variableLength(value) {
  const out = [value & 0x7f]
  let rest = Math.floor(value / 128)
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80)
    rest = Math.floor(rest / 128)
  }
  return out
}

const text = (word) => [...word].map((ch) => ch.charCodeAt(0))

/** Big-endian, which is the only endianness a MIDI file has. */
const uint32 = (n) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]
const uint16 = (n) => [(n >> 8) & 255, n & 255]

/**
 * Notes to a file.
 *
 * `notes` are jamin's own: `{ at, note, duration, velocity }` in pulses. What
 * comes back is the whole file, ready to be written to disk or handed to a
 * host.
 *
 * Channel is zero-based here and one-based in the message, the way MIDI has
 * always been. Drums go out on channel 10 -- index 9 -- because that is where a
 * DAW looks for them, and a drum clip that lands on channel 1 plays a piano.
 */
export function writeMidiFile({
  notes = [],
  name = 'jamin',
  bpm = 120,
  channel = 0,
  numerator = 4,
  denominator = 4,
  lengthPulses = 0,
} = {}) {
  const events = []

  // --- the header events, at time zero -----------------------------------
  const title = text(String(name).slice(0, 120))
  events.push({ at: 0, order: 0, bytes: [0xff, 0x03, ...variableLength(title.length), ...title] })

  // Microseconds per quarter note, which is how a MIDI file says tempo.
  const usPerQuarter = Math.max(1, Math.round(60000000 / (bpm > 0 ? bpm : 120)))
  events.push({
    at: 0,
    order: 1,
    bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255],
  })

  // The denominator is written as a power of two: 4 is 2, 8 is 3. 24 clocks a
  // metronome tick and 8 thirty-seconds a quarter are what everything uses.
  let power = 0
  let value = Math.max(1, denominator)
  while (value > 1) { value /= 2; power++ }
  events.push({ at: 0, order: 2, bytes: [0xff, 0x58, 0x04, Math.max(1, numerator), power, 24, 8] })

  // --- the notes ----------------------------------------------------------
  const line = Math.max(0, Math.min(15, channel))
  for (const note of notes) {
    const start = Math.round((note.at || 0) * SCALE)
    const length = Math.max(1, Math.round((note.duration || 1) * SCALE))
    const pitch = Math.max(0, Math.min(127, note.note | 0))
    const velocity = Math.max(1, Math.min(127, note.velocity == null ? 100 : note.velocity | 0))

    events.push({ at: start, order: 4, bytes: [0x90 | line, pitch, velocity] })
    // A note-off written as a note-on with zero velocity would also be legal,
    // and is what half of the files we read do. A real note-off is clearer to
    // anybody reading the bytes.
    events.push({ at: start + length, order: 3, bytes: [0x80 | line, pitch, 0] })
  }

  /*
   * Sorted by time, then by kind: every note-off at a given tick before any
   * note-on at the same tick.
   *
   * That order is what lets the same pitch repeat on consecutive beats. The
   * other way round, the new note starts and is immediately ended by the old
   * note's off -- the note vanishes, and the file is still perfectly valid.
   */
  events.sort((a, b) => a.at - b.at || a.order - b.order)

  const track = []
  let last = 0
  for (const event of events) {
    track.push(...variableLength(event.at - last), ...event.bytes)
    last = event.at
  }

  // The clip's own length, so a DAW makes a bar-long clip out of a bar-long
  // pattern rather than trimming it to the last note.
  const end = Math.max(last, Math.round(Math.max(0, lengthPulses) * SCALE))
  track.push(...variableLength(end - last), 0xff, 0x2f, 0x00)

  return new Uint8Array([
    ...text('MThd'), ...uint32(6), ...uint16(0), ...uint16(1), ...uint16(FILE_PPQ),
    ...text('MTrk'), ...uint32(track.length), ...track,
  ])
}

/** A file name a DAW will accept and a person will recognise. */
export function midiFileName(name) {
  const clean = String(name || 'jamin')
    .replace(/[^\w\s#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `${clean || 'jamin'}.mid`
}
