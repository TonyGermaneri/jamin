// A standard MIDI file, for dragging something out into a DAW.
//
// A malformed MIDI file does not announce itself. A DAW shows an empty clip, or
// refuses the drop and says nothing, and there is no error anywhere to read. So
// this checks the bytes the specification asks for -- not that it happens to
// load, which is a test of somebody else's parser.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
function ok(label, got, detail) {
  if (!got) { failed++; console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`) }
}

const bytes = (file) => [...file]
const at = (file, from, count) => bytes(file).slice(from, from + count)
const ascii = (file, from, count) => at(file, from, count).map((b) => String.fromCharCode(b)).join('')

/* ---------------- variable-length quantities ---------------------------- */
// Seven bits at a time, top bit set on every byte but the last. The one piece
// of the format that is easy to get subtly wrong and impossible to notice: a
// wrong length shifts everything after it and the file still parses, into
// nonsense. These are the specification's own examples.
check('zero', variableLength(0), [0x00])
check('the largest single byte', variableLength(0x7f), [0x7f])
check('one more than that', variableLength(0x80), [0x81, 0x00])
check('two bytes', variableLength(0x2000), [0xc0, 0x00])
check('the largest two bytes', variableLength(0x3fff), [0xff, 0x7f])
check('three bytes', variableLength(0x4000), [0x81, 0x80, 0x00])
check('four bytes', variableLength(0x0fffffff), [0xff, 0xff, 0xff, 0x7f])

/* ---------------- the header -------------------------------------------- */
const file = writeMidiFile({
  name: 'test',
  bpm: 120,
  notes: [{ at: 0, note: 60, duration: 24, velocity: 100 }],
})

check('it starts with MThd', ascii(file, 0, 4), 'MThd')
check('a six byte header', at(file, 4, 4), [0, 0, 0, 6])
check('format 0', at(file, 8, 2), [0, 0])
check('one track', at(file, 10, 2), [0, 1])
check('480 ticks a quarter', at(file, 12, 2), [0x01, 0xe0])
check('then MTrk', ascii(file, 14, 4), 'MTrk')

// The track length has to be the real one. A wrong length is the most common
// way to write a file that a strict parser refuses and a lenient one truncates.
const declared = (at(file, 18, 4)[0] << 24) | (at(file, 18, 4)[1] << 16)
  | (at(file, 18, 4)[2] << 8) | at(file, 18, 4)[3]
check('and a track length that matches the track', declared, file.length - 22)

// And it ends where it says it does.
check('ending with end-of-track', at(file, file.length - 3, 3), [0xff, 0x2f, 0x00])

/* ---------------- tempo and metre --------------------------------------- */
// 120bpm is 500,000 microseconds a quarter, which is the number in every
// example ever written and therefore the one worth pinning.
ok('120bpm is half a million microseconds',
   bytes(file).join(',').includes([0xff, 0x51, 0x03, 0x07, 0xa1, 0x20].join(',')),
   'no tempo event of 500000us')

const waltz = writeMidiFile({ notes: [], numerator: 3, denominator: 4 })
ok('three four', bytes(waltz).join(',').includes([0xff, 0x58, 0x04, 3, 2, 24, 8].join(',')),
   'no 3/4 time signature')
const twelveEight = writeMidiFile({ notes: [], numerator: 12, denominator: 8 })
// The denominator is a power of two: 8 is written as 3.
ok('twelve eight', bytes(twelveEight).join(',').includes([0xff, 0x58, 0x04, 12, 3, 24, 8].join(',')),
   'no 12/8 time signature')

const slow = writeMidiFile({ notes: [], bpm: 60 })
ok('sixty bpm is a whole second', bytes(slow).join(',').includes([0xff, 0x51, 0x03, 0x0f, 0x42, 0x40].join(',')),
   'no tempo event of 1000000us')

/* ---------------- what comes back out ----------------------------------- */
// Read back through our own parser, which is the one that reads everybody
// else's libraries -- so if it cannot read this, the file is wrong.
const back = parseMidiFile(writeMidiFile({
  name: 'round trip',
  bpm: 96,
  notes: [
    { at: 0, note: 60, duration: 12, velocity: 100 },
    { at: 24, note: 64, duration: 12, velocity: 80 },
    { at: 48, note: 67, duration: 24, velocity: 64 },
  ],
}))

check('it reads back as 480 ppq', back.ppq, 480)
const read = back.tracks.flatMap((track) => track.notes).sort((a, b) => a.tick - b.tick)
check('with every note', read.length, 3)
check('at the right pitches', read.map((n) => n.note), [60, 64, 67])
// 24 pulses is a quarter here, 480 ticks a quarter there: a factor of twenty.
check('at the right times', read.map((n) => n.tick), [0, 480, 960])
check('for the right lengths', read.map((n) => n.duration), [240, 240, 480])
check('with their velocities', read.map((n) => n.velocity), [100, 80, 64])
check('and the tempo it was given', Math.round(60000000 / back.tempos[0].usPerQuarter), 96)

/* ---------------- the ordering that matters ----------------------------- */
/*
 * The same pitch on consecutive beats: every note-off at a tick must be written
 * before any note-on at that tick. The other way round, the new note starts and
 * the old note's off immediately ends it -- the note disappears, and the file
 * is still perfectly valid, which is why this is worth a test rather than a
 * comment.
 */
const repeated = parseMidiFile(writeMidiFile({
  notes: [
    { at: 0, note: 38, duration: 24, velocity: 100 },
    { at: 24, note: 38, duration: 24, velocity: 100 },
    { at: 48, note: 38, duration: 24, velocity: 100 },
  ],
}))
const hits = repeated.tracks.flatMap((t) => t.notes)
check('a repeated note survives being written', hits.length, 3)
check('and each one keeps its length', hits.map((n) => n.duration), [480, 480, 480])

/* ---------------- channels ---------------------------------------------- */
// Drums go out on channel 10 -- index 9 -- because that is where a DAW looks
// for them. A drum clip that lands on channel 1 plays a piano.
const drums = parseMidiFile(writeMidiFile({ channel: 9, notes: [{ at: 0, note: 36, duration: 6 }] }))
check('drums are written on channel ten', drums.tracks.flatMap((t) => t.notes)[0].channel, 9)
const keys = parseMidiFile(writeMidiFile({ channel: 0, notes: [{ at: 0, note: 60, duration: 6 }] }))
check('and everything else on one', keys.tracks.flatMap((t) => t.notes)[0].channel, 0)

/* ---------------- the clip's length ------------------------------------- */
/*
 * A one-bar pattern whose last note stops early is still a bar long. Without
 * this a DAW trims the clip to the last note and the loop comes out the wrong
 * length -- which is the kind of thing that sounds like a timing bug for an
 * afternoon before anybody thinks to look at the clip's end.
 *
 * Checked in the bytes, because the parser does not report where a track ends
 * and this is precisely a fact about where a track ends. One bar is 96 pulses
 * is 1920 ticks; the last note-off is at 6 pulses, 120 ticks; so the delta in
 * front of end-of-track has to be 1800, which as a variable-length quantity is
 * 0x8E 0x08.
 */
const short = writeMidiFile({ lengthPulses: 96, notes: [{ at: 0, note: 36, duration: 6 }] })
check('the clip runs to the end of the bar', at(short, short.length - 5, 2), [0x8e, 0x08])
check('and then ends', at(short, short.length - 3, 3), [0xff, 0x2f, 0x00])

// And a pattern with no declared length just ends after its last note.
const tight = writeMidiFile({ notes: [{ at: 0, note: 36, duration: 6 }] })
check('with no length given it ends at the last note', at(tight, tight.length - 4, 4),
      [0x00, 0xff, 0x2f, 0x00])

/* ---------------- nothing at all ---------------------------------------- */
const empty = writeMidiFile({ notes: [] })
check('an empty pattern is still a valid file', ascii(empty, 0, 4), 'MThd')
check('and still ends properly', at(empty, empty.length - 3, 3), [0xff, 0x2f, 0x00])

/* ---------------- names ------------------------------------------------- */
check('a name becomes a file name', midiFileName('C busy 5'), 'C busy 5.mid')
check('slashes and colons go', midiFileName('Rock/Indie: take 2'), 'Rock Indie take 2.mid')
check('sharps stay, because chords have them', midiFileName('F# comp 19'), 'F# comp 19.mid')
check('and nothing is still something', midiFileName(''), 'jamin.mid')

console.log(failed ? `midi-write: ${failed} FAILED` : 'midi-write: all checks passed')
