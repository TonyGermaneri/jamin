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
player.setScore(parseScore('.C{arp} F', { beatsPerBar: 4, perChordPhrases: true }))
for (let p = 1; p <= 191; p++) player.tick(p)
const played = engine.log.filter(l => l[0] === 'on').map(l => l[1])
check('phrase replaces the block chord', played.length, 6)
check('first chord plays the phrase as recorded', played.slice(0, 3), [60, 64, 67])
check('second chord is the phrase over F', played.slice(3).map(n => n % 12).sort((a, b) => a - b), [0, 5, 9])

// --- a split bar must not double-time the phrase ---
// A one-bar pattern under `| Fm7 Gm7 |`: each chord gets half a bar. The rhythm
// is the rhythm; only the harmony changes.
const pattern = {
  name: 'pattern', rootPc: 0, sourcePcs: [0, 3, 7, 10], sourceChord: 'Cm7', lengthPulses: 96,
  notes: [[0, 60], [24, 63], [48, 67], [72, 70]].map(([at, note]) => ({ at, note, velocity: 90, duration: 12 })),
}
const splitBar = parseScore('| Fm7 Gm7 |', { beatsPerBar: 4, songPhrase: 'pattern' })
settings = makeSettings()
const queueFor = (event) => buildPhraseQueue(pattern, event.chord, event, settings).queue.filter(q => q.on)

let first = queueFor(splitBar.events[0])
let second = queueFor(splitBar.events[1])
check('half a bar gets half the pattern', [first.length, second.length], [2, 2])
check('at the rhythm it was played', first.map(q => q.at), [0, 24])
check('and so does the second half', second.map(q => q.at), [0, 24])
check('the gap is never halved', first[1].at - first[0].at, 24)

// The second chord gets the *second* half of the pattern, not the first again.
const degreesOf = (list, root) => list.map(q => ((q.note % 12) - root + 12) % 12)
check('first chord plays the first half', degreesOf(first, 5), [0, 3])
check('second chord plays the second half', degreesOf(second, 7), [7, 10])

// A chord longer than the phrase gets it more than once, still at its own speed.
const twoBar = parseScore('| Cm7 | % |', { beatsPerBar: 4, songPhrase: 'pattern' })
const long = queueFor(twoBar.events[0])
check('two bars, pattern twice', long.map(q => q.at), [0, 24, 48, 72, 96, 120, 144, 168])

// Restart begins the pattern again on every chord and cuts it short.
settings.accompany.fit = 'restart'
check('restart: second chord starts over', degreesOf(queueFor(splitBar.events[1]), 7), [0, 3])
check('restart: still at the right speed', queueFor(splitBar.events[1]).map(q => q.at), [0, 24])

// Stretch is still available for anyone who wants it, and is still a tempo change.
settings.accompany.fit = 'stretch'
check('stretch: everything crammed in', queueFor(splitBar.events[0]).map(q => q.at), [0, 12, 24, 36])
settings.accompany.fit = 'follow'

// --- fit modes over a two-bar chord ---
const event = { startPulse: 0, endPulse: 192, bars: 2, chord: parseChord('C') }
settings.accompany.fit = 'stretch'
let queue = buildPhraseQueue(phrase, event.chord, event, settings).queue
check('stretched to 2 bars', queue.filter(q => q.on).map(q => q.at), [0, 48, 96])
settings.accompany.fit = 'follow'
queue = buildPhraseQueue(phrase, event.chord, event, settings).queue
check('followed, so it simply repeats', queue.filter(q => q.on).map(q => q.at), [0, 24, 48, 96, 120, 144])
settings.accompany.fit = 'restart'
queue = buildPhraseQueue(phrase, event.chord, event, settings).queue
check('restart fills the same way from zero', queue.filter(q => q.on).map(q => q.at), [0, 24, 48, 96, 120, 144])
settings.accompany.fit = 'follow'

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


// --- a phrase keeps its degrees across a progression, and stays put ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
const arp = {
  name: 'arp',
  lengthPulses: 96,
  rootPc: 0,
  sourcePcs: [0, 4, 7, 10],
  sourceChord: 'C7',
  notes: [
    { at: 0, note: 60, velocity: 100, duration: 12 },
    { at: 24, note: 64, velocity: 100, duration: 12 },
    { at: 48, note: 67, velocity: 100, duration: 12 },
    { at: 72, note: 70, velocity: 100, duration: 12 },
  ],
}
player.getPhrase = (n) => (n === 'arp' ? arp : null)
player.setScore(parseScore('.C7{arp} F7 Bb7 Eb7', { beatsPerBar: 4, perChordPhrases: true }))
for (let p = 1; p <= 383; p++) player.tick(p)

const sounded = engine.log.filter(l => l[0] === 'on').map(l => l[1])
check('four chords of phrase', sounded.length, 16)
const roots = [0, 5, 10, 3]
const degrees = []
for (let i = 0; i < 4; i++) {
  const four = sounded.slice(i * 4, i * 4 + 4)
  degrees.push(four.map(n => ((n % 12) - roots[i] + 12) % 12).join(','))
}
check('every chord gets the same degrees', degrees, ['0,4,7,10', '0,4,7,10', '0,4,7,10', '0,4,7,10'])

// It never leaps a register between chords.
let worst = 0
for (let i = 1; i < 4; i++) {
  worst = Math.max(worst, Math.abs(sounded[i * 4] - sounded[(i - 1) * 4]))
}
check('and never jumps more than a tritone between chords', worst <= 6, true)


// --- by default one phrase covers the whole song, with no dots in the chart ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.getPhrase = (n) => (n === 'arp' ? arp : null)
player.setScore(parseScore('C7 F7 Bb7', { beatsPerBar: 4, songPhrase: 'arp' }))
for (let p = 1; p <= 287; p++) player.tick(p)
check('the phrase plays on every chord', engine.log.filter(l => l[0] === 'on').length, 12)

// The same chart with no song phrase plays block chords instead.
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.getPhrase = (n) => (n === 'arp' ? arp : null)
player.setScore(parseScore('C7 F7 Bb7', { beatsPerBar: 4 }))
for (let p = 1; p <= 95; p++) player.tick(p)
check('no phrase means block chords', engine.log.filter(l => l[0] === 'on').map(l => l[1]), [60, 64, 67, 70])

// Dots are inert unless per-chord articulations are on.
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.getPhrase = (n) => (n === 'arp' ? arp : null)
player.setScore(parseScore('.C7{arp} F7', { beatsPerBar: 4 }))
for (let p = 1; p <= 95; p++) player.tick(p)
check('a dot alone does not bind', engine.log.filter(l => l[0] === 'on').map(l => l[1]), [60, 64, 67, 70])


// --- a real song: repeats, merged chords and split bars together ---
// Every chord length in one chart -- two bars, one bar, half a bar, all inside
// repeats. The phrase must keep one rhythm through all of it.
const song = parseScore(':Cm7 Cm7 Abmaj7 Gm7:\n:Fm7,Gm7 Abmaj,Bb6:', { beatsPerBar: 4, songPhrase: 'pattern' })
check('twelve bars', song.bars, 12)
check('every chord readable', song.tokens.filter(t => t.type === 'error'), [])
check('lengths as written', song.events.map(e => e.bars), [2, 1, 1, 2, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])

settings = makeSettings()
const everyGap = new Set()
let totalNotes = 0
for (const event of song.events) {
  const on = buildPhraseQueue(pattern, event.chord, event, settings).queue.filter(q => q.on)
  totalNotes += on.length
  on.slice(1).forEach((q, i) => everyGap.add(q.at - on[i].at))
}
check('one rhythm through the whole song', [...everyGap], [24])
check('a note every beat, all twelve bars', totalNotes, 48)

// The half-bar chords take consecutive halves of the pattern, not the same half.
const halves = song.events.slice(6, 10).map((event) => {
  const on = buildPhraseQueue(pattern, event.chord, event, settings).queue.filter(q => q.on)
  return on.map(q => ((q.note % 12) - event.chord.rootPc + 12) % 12).join(',')
})
// Positionally the pattern just carries on: first halves get its opening pair,
// second halves its closing pair. The degrees differ because the chords do --
// over Abmaj the pattern's b3 is a 3, and over Bb6 its b7 is a 6.
check('each half bar continues the pattern', halves, ['0,3', '7,10', '0,4', '7,9'])


console.log(failed === 0 ? 'player: all checks passed' : `player: ${failed} FAILED`)
