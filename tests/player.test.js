let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// noteOn/noteOff report whether the note reached a port, which is how the
// player knows what it actually has to release later.
class FakeEngine {
  constructor() { this.log = [] }
  noteOn(out, ch, note, vel) { this.log.push(['on', note, ch]); return true }
  noteOff(out, ch, note) { this.log.push(['off', note, ch]); return true }
}

function makeSettings(patch = {}) {
  const s = defaultSettings()
  s.midi.chordOutputId = 'out'
  s.midi.accompOutputId = 'out'
  s.chords.smartVoicing = false
  s.chords.bassNote = false
  Object.assign(s.accompany, patch.accompany || {})
  Object.assign(s.chords, patch.chords || {})
  return s
}

// --- block chord playback ---
let engine = new FakeEngine()
let settings = makeSettings()
let player = new Player(engine, settings)
let changes = []
player.onEventChange = (e) => changes.push(e.index)
player.setScore(parseScore('C F', { beatsPerBar: 4 }))

for (let p = 1; p <= 191; p++) player.tick(p)
check('two chord changes', changes, [0, 1])
const ons = engine.log.filter(l => l[0] === 'on').map(l => l[1])
check('C then F sounded', ons, [60, 64, 67, 65, 69, 72])
const offsBeforeF = engine.log.slice(0, engine.log.indexOf(engine.log.find(l => l[0] === 'on' && l[1] === 65))).filter(l => l[0] === 'off').map(l => l[1])
check('C released before F', offsBeforeF, [60, 64, 67])

// --- looping wraps back to the top ---
changes = []
for (let p = 192; p <= 400; p++) player.tick(p)
check('loops back to chord 0', changes[0], 0)

// --- half-bar chords ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
changes = []
player.onEventChange = (e) => changes.push([e.index, e.startPulse, e.endPulse])
player.setScore(parseScore('F,F- C', { beatsPerBar: 4 }))
for (let p = 1; p <= 191; p++) player.tick(p)
check('half bar boundaries', changes, [[0, 0, 48], [1, 48, 96], [2, 96, 192]])

// --- repeated chord does not re-articulate ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C C C', { beatsPerBar: 4 }))
for (let p = 1; p <= 287; p++) player.tick(p)
check('single attack across 3 bars', engine.log.filter(l => l[0] === 'on').length, 3)

// --- phrase capture ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
settings.accompany.monitor = false
const captured = []
player.onCapture = (c) => captured.push(c)
player.setScore(parseScore('C F', { beatsPerBar: 4 }))
player.tick(1)
player.arm('once')
player.tick(2)
player.noteIn(60, 100, true)
for (let p = 3; p <= 30; p++) player.tick(p)
player.noteIn(60, 0, false)
player.noteIn(64, 90, true)
for (let p = 31; p <= 200; p++) player.tick(p)   // crosses into the next chord

check('one phrase captured', captured.length, 1)
check('capture note count', captured[0].notes.length, 2)
check('capture start offsets', captured[0].notes.map(n => n.at), [2, 30])
check('capture length is the slot', captured[0].lengthPulses, 96)
check('capture source chord', captured[0].sourceChord, 'C')
check('capture source pcs', captured[0].sourcePcs, [0, 4, 7])
check('auto disarmed', player.capture.armed, false)

// --- phrase playback, re-pointed at each chord ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
const phrase = {
  name: 'arp',
  lengthPulses: 96,
  sourcePcs: [0, 4, 7],
  sourceChord: 'C',
  notes: [
    { at: 0, note: 60, velocity: 100, duration: 24 },
    { at: 24, note: 64, velocity: 100, duration: 24 },
    { at: 48, note: 67, velocity: 100, duration: 24 },
  ],
}
player.getPhrase = (name) => (name === 'arp' ? phrase : null)
player.setScore(parseScore('.C{arp} F', { beatsPerBar: 4 }))
for (let p = 1; p <= 191; p++) player.tick(p)
const played = engine.log.filter(l => l[0] === 'on').map(l => l[1])
check('phrase replaces the block chord', played.length, 6)
check('first chord plays the phrase as recorded', played.slice(0, 3), [60, 64, 67])
check('second chord is the phrase over F', played.slice(3).map(n => n % 12).sort((a, b) => a - b), [0, 5, 9])

// --- fit modes ---
const event = { startPulse: 0, endPulse: 192, bars: 2, chord: parseChord('C') }
settings.accompany.fit = 'stretch'
let queue = buildPhraseQueue(phrase, event.chord, event, settings)
check('stretched to 2 bars', queue.filter(q => q.on).map(q => q.at), [0, 48, 96])
settings.accompany.fit = 'repeat'
queue = buildPhraseQueue(phrase, event.chord, event, settings)
check('repeated twice', queue.filter(q => q.on).map(q => q.at), [0, 24, 48, 96, 120, 144])
settings.accompany.fit = 'truncate'
queue = buildPhraseQueue(phrase, event.chord, event, settings)
check('truncated', queue.filter(q => q.on).map(q => q.at), [0, 24, 48])

// --- stop releases everything ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C', { beatsPerBar: 4 }))
player.tick(1)
engine.log = []
player.transport('stop')
check('stop releases the chord', engine.log.filter(l => l[0] === 'off').map(l => l[1]), [60, 64, 67])

// --- editing the chart mid-playback must not re-articulate the chord ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C F G', { beatsPerBar: 4 }))
for (let p = 1; p <= 50; p++) player.tick(p)
engine.log = []
// Same chart, retyped (what happens on every keystroke elsewhere in the line).
player.setScore(parseScore('C F G ', { beatsPerBar: 4 }))
player.tick(51)
check('no retrigger on an unrelated edit', engine.log, [])
// Now actually change the chord being played.
player.setScore(parseScore('Am F G', { beatsPerBar: 4 }))
player.tick(52)
check('edit to the sounding chord retriggers', engine.log.filter(l => l[0] === 'on').map(l => l[1]), [69, 72, 76])

// --- stop then start again must re-sound the same chord ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C F', { beatsPerBar: 4 }))
for (let p = 1; p <= 20; p++) player.tick(p)
player.transport('stop')
engine.log = []
player.transport('start')
for (let p = 1; p <= 5; p++) player.tick(p)
check('chord sounds again after restart', engine.log.filter(l => l[0] === 'on').map(l => l[1]), [60, 64, 67])

// --- a song-position jump re-sounds whatever chord we landed on ---
engine.log = []
player.transport('position')
for (let p = 100; p <= 105; p++) player.tick(p)
check('relocating re-sounds the new chord', engine.log.filter(l => l[0] === 'on').map(l => l[1]), [65, 69, 72])


// --- with no output bound, nothing is remembered as sounding ---
class DeafEngine {
  constructor() { this.log = [] }
  noteOn() { this.log.push('on'); return false }   // no port: nothing was sent
  noteOff() { this.log.push('off'); return true }
}
engine = new DeafEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C F', { beatsPerBar: 4 }))
for (let p = 1; p <= 20; p++) player.tick(p)
engine.log = []
player.transport('stop')
check('no phantom note-offs when nothing was sent', engine.log, [])


// --- a no-chord bar releases the previous chord and plays nothing ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C N.C. F', { beatsPerBar: 4 }))
for (let p = 1; p <= 95; p++) player.tick(p)
engine.log = []
for (let p = 96; p <= 191; p++) player.tick(p)
check('no-chord releases and sounds nothing', engine.log, [['off', 60, 0], ['off', 64, 0], ['off', 67, 0]])
engine.log = []
for (let p = 192; p <= 200; p++) player.tick(p)
check('the chord after it plays normally', engine.log.filter(l => l[0] === 'on').map(l => l[1]), [65, 69, 72])


console.log(failed === 0 ? 'player: all checks passed' : `player: ${failed} FAILED`)
