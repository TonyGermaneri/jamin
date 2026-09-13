let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- a Standard MIDI File, built by hand ---------------- */
function varint(value) {
  const out = [value & 0x7f]
  value >>= 7
  while (value > 0) { out.unshift((value & 0x7f) | 0x80); value >>= 7 }
  return out
}
function be(value, bytes) {
  const out = []
  for (let i = bytes - 1; i >= 0; i--) out.push((value >> (i * 8)) & 0xff)
  return out
}
function chunk(tag, body) {
  return [...tag].map((c) => c.charCodeAt(0)).concat(be(body.length, 4), body)
}
function track(events, name) {
  // events: [{ tick, bytes }]
  const body = []
  if (name) body.push(...varint(0), 0xff, 0x03, name.length, ...[...name].map((c) => c.charCodeAt(0)))
  let last = 0
  for (const event of events.slice().sort((a, b) => a.tick - b.tick)) {
    body.push(...varint(event.tick - last), ...event.bytes)
    last = event.tick
  }
  body.push(...varint(0), 0xff, 0x2f, 0x00)
  return chunk('MTrk', body)
}
function notesToEvents(notes) {
  const events = []
  for (const [tick, note, duration, velocity = 90] of notes) {
    events.push({ tick, bytes: [0x90, note, velocity] })
    events.push({ tick: tick + duration, bytes: [0x80, note, 0] })
  }
  return events
}
function buildMidi(ppq, trackSpecs) {
  const head = chunk('MThd', [...be(0, 2), ...be(trackSpecs.length, 2), ...be(ppq, 2)])
  const body = trackSpecs.flatMap((spec) => track(spec.events, spec.name))
  return new Uint8Array(head.concat(body))
}

const PPQ = 480
const BAR = PPQ * 4
// Two hands: a bass note and a right-hand voicing, one chord per bar.
const bars = [
  { bass: 36, voicing: [60, 64, 67] },        // C
  { bass: 38, voicing: [62, 65, 69, 72] },    // Dm7
  { bass: 43, voicing: [62, 65, 67, 71] },    // G7
  { bass: 41, voicing: [60, 64, 65, 69] },    // Fmaj7
]
const performance = []
bars.forEach((bar, index) => {
  const start = index * BAR
  performance.push([start, bar.bass, BAR - 10])
  bar.voicing.forEach((note, voice) => performance.push([start + voice * (PPQ / 2), note, PPQ]))
})

const file = buildMidi(PPQ, [
  { name: 'tempo', events: [{ tick: 0, bytes: [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20] }] },
  { name: 'PIANO', events: notesToEvents(performance) },
])

/* ---------------- reading it back ---------------- */
const parsed = parseMidiFile(file)
check('ticks per quarter', parsed.ppq, 480)
check('two tracks', parsed.tracks.length, 2)
check('track names', parsed.tracks.map((t) => t.name), ['tempo', 'PIANO'])
check('tempo found', parsed.tempos.length, 1)
check('tempo value', parsed.tempos[0].usPerQuarter, 500000)
check('every note recovered', parsed.tracks[1].notes.length, performance.length)
check('first note', [parsed.tracks[1].notes[0].tick, parsed.tracks[1].notes[0].note, parsed.tracks[1].notes[0].duration],
  [0, 36, BAR - 10])
check('one second per two beats at 120bpm', tickToSeconds(PPQ * 2, PPQ, parsed.tempos), 1)
check('not a midi file is rejected', (() => {
  try { parseMidiFile(new Uint8Array([1, 2, 3, 4])); return 'no error' } catch (e) { return 'threw' }
})(), 'threw')

/* ---------------- guessing the chord ---------------- */
const held = (notes) => notes.map((note, i) => ({ at: 0, note, duration: 96, velocity: 90 }))
check('major triad', inferChord(held([36, 60, 64, 67])).text, 'C')
check('minor seventh', inferChord(held([38, 62, 65, 69, 72])).text, 'Dm7')
check('dominant seventh', inferChord(held([43, 62, 65, 67, 71])).text, 'G7')
check('major seventh', inferChord(held([41, 60, 64, 65, 69])).text, 'Fmaj7')
check('minor triad', inferChord(held([45, 57, 60, 64])).text, 'Am')
check('sus4', inferChord(held([43, 67, 72, 74])).text, 'Gsus4')
// C6 and Am7 are the same four notes; only the bass tells them apart.
check('C in the bass makes it a six chord', inferChord(held([36, 60, 64, 67, 69])).text, 'C6')
check('A in the bass makes it a minor seventh', inferChord(held([45, 60, 64, 67, 69])).text, 'Am7')
check('a slash bass is still the same chord', inferChord(held([40, 60, 64, 67])).text, 'C')
check('nothing in, nothing out', inferChord([]), null)

/* ---------------- cutting it into phrases ---------------- */
const result = phrasesFromMidi(file, { beatsPerBar: 4, segmentBars: 1, trackFilter: /piano/i })
check('one phrase per bar', result.phrases.length, 4)
check('the chords were read off the notes', result.phrases.map((p) => p.sourceChord), ['C', 'Dm7', 'G7', 'Fmaj7'])
check('each is a bar long', result.phrases.map((p) => p.lengthPulses), [96, 96, 96, 96])
check('stored rooted on C', result.phrases.map((p) => p.rootPc), [0, 0, 0, 0])
check('both hands are in there', result.phrases.every((p) => p.voices >= 2), true)
check('and it is really two hands apart', result.phrases.every((p) => {
  const pitches = p.notes.map((n) => n.note)
  return Math.max(...pitches) - Math.min(...pitches) >= 12
}), true)
check('notes start at the top of each phrase', result.phrases.map((p) => p.notes[0].at), [0, 0, 0, 0])
check('the track filter picked the piano', result.report.used, 1)

// Without a filter it takes everything that has notes.
check('no filter still works', phrasesFromMidi(file, { beatsPerBar: 4 }).phrases.length, 4)
// Two bars at a time gives half as many, twice as long.
const wide = phrasesFromMidi(file, { beatsPerBar: 4, segmentBars: 2, trackFilter: /piano/i })
check('two bars per phrase', wide.phrases.length, 2)
check('and they are twice as long', wide.phrases[0].lengthPulses, 192)
// A phrase needs more than a stray note.
check('sparse bars are skipped', phrasesFromMidi(file, { beatsPerBar: 4, minNotes: 99 }).phrases.length, 0)

/* ---------------- annotations, when you have them ---------------- */
const spans = parseChordAnnotations('0.0 2.0 C:maj\n2.0 4.0 D:min7\nbad line\n4.0 4.0 G:7\n6.0 8.0 N',
  (seconds) => seconds * 24)
check('two usable spans', spans.length, 2)
check('converted to pulses', [spans[0].startPulse, spans[0].endPulse], [0, 48])
check('harte labels kept', spans.map((s) => s.label), ['C:maj', 'D:min7'])
check('no-chord spans dropped', spans.some((s) => s.label === 'N'), false)
check('zero-length spans dropped', spans.some((s) => s.label === 'G:7'), false)

console.log(failed === 0 ? 'midi-import: all checks passed' : `midi-import: ${failed} FAILED`)
