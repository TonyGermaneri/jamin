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
  // The pedal, which is not a note. Recorded the same way so a check can
  // say what left and on which channel. @see Player.passControl
  controlChange(out, ch, cc, value) { this.log.push(['cc', cc, ch, value]); return true }
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

// --- Mr. Accompany Me listens ---
// It used to wait for a chord to be written down and record what was played
// over it. Now the playing comes first: notes are heard, named as a chord, and
// that chord is articulated while the keys are still down. Nothing is kept.
const livePhrase = {
  name: 'live', lengthPulses: 96, sourcePcs: [0, 4, 7], sourceChord: 'C',
  notes: [
    { at: 0, note: 60, velocity: 100, duration: 12 },
    { at: 24, note: 64, velocity: 100, duration: 12 },
  ],
}

function listening(patch = {}) {
  const e = new FakeEngine()
  const s = makeSettings()
  s.accompany.passNotes = false
  s.accompany.listen = true
  s.accompany.liveBars = 1
  s.accompany.settleMs = 10
  Object.assign(s.accompany, patch)
  const p = new Player(e, s)
  p.getLivePhrase = () => livePhrase
  p.setScore(parseScore('C F', { beatsPerBar: 4 }))
  return { e, s, p }
}

// Three notes go down, and once they stop moving the chord they make is heard.
let live = listening()
const heard = []
live.p.onHeard = (h) => heard.push(h ? h.name : null)
live.p.tick(1)
live.p.noteIn(62, 100, true, 1000)
live.p.noteIn(65, 100, true, 1005)
live.p.noteIn(69, 100, true, 1010)
live.p.hearTick(1015)
check('nothing while the hand is still moving', heard, [])
live.p.hearTick(1100)
check('the chord under the fingers is heard', heard, ['D-'])

// And it is articulated: the phrase, re-pointed at what was played.
live.e.log.length = 0
for (let t = 2; t <= 40; t++) live.p.tick(t)
const livePlayed = live.e.log.filter((l) => l[0] === 'on').map((l) => l[1] % 12)
check('the heard chord is played through a phrase', livePlayed.length > 0, true)
check('and re-pointed at what was heard', livePlayed.every((n) => [2, 5, 9].includes(n)), true)

// Letting go stops it. There is no recording to close and nothing to name.
live.p.noteIn(62, 0, false, 2000)
live.p.noteIn(65, 0, false, 2001)
live.p.noteIn(69, 0, false, 2002)
live.p.hearTick(2100)
check('letting go is heard too', heard, ['D-', null])
check('and nothing of it is left sounding', live.p.liveHeld.size, 0)

// --- merge: two parts, which is what a second player in the room is ---
live = listening({ liveMode: 'merge' })
live.p.setScore(parseScore('C F', { beatsPerBar: 4 }))
live.p.tick(1)
check('the chart plays its own chord', live.e.log.filter((l) => l[0] === 'on').length > 0, true)
live.e.log.length = 0
live.p.noteIn(62, 100, true, 1000)
live.p.noteIn(65, 100, true, 1005)
live.p.noteIn(69, 100, true, 1010)
live.p.hearTick(1100)
for (let t = 2; t <= 40; t++) live.p.tick(t)
const merged = live.e.log.filter((l) => l[0] === 'on').map((l) => l[1] % 12)
check('and the hands play over the top of it', merged.some((n) => [2, 5, 9].includes(n)), true)

// --- override: the hands decide the harmony ---
live = listening({ liveMode: 'override' })
live.p.setScore(parseScore('C F', { beatsPerBar: 4 }))
live.p.noteIn(62, 100, true, 1000)
live.p.noteIn(65, 100, true, 1005)
live.p.noteIn(69, 100, true, 1010)
live.p.hearTick(1100)
live.e.log.length = 0
for (let t = 1; t <= 40; t++) live.p.tick(t)
const over = live.e.log.filter((l) => l[0] === 'on').map((l) => l[1] % 12)
check('the chart holds its tongue', over.every((n) => [2, 5, 9].includes(n)), true)
check('and something is still playing', over.length > 0, true)

// Letting go hands the chart back, at the chord it was already on.
live.p.noteIn(62, 0, false, 2000)
live.p.noteIn(65, 0, false, 2001)
live.p.noteIn(69, 0, false, 2002)
live.e.log.length = 0
live.p.hearTick(2100)
const resumed = live.e.log.filter((l) => l[0] === 'on').map((l) => l[1] % 12)
check('the chart comes back when the hands come off', resumed.sort(), [0, 4, 7])

// --- a held chord repeats rather than stopping ---
// A written chord knows how long it lasts because the bar says so. A held one
// lasts until the hands move, so the phrase comes round again.
live = listening({ liveBars: 1 })
live.p.setScore(parseScore('C C C', { beatsPerBar: 4 }))
live.p.noteIn(60, 100, true, 1000)
live.p.noteIn(64, 100, true, 1001)
live.p.noteIn(67, 100, true, 1002)
live.p.hearTick(1100)
live.e.log.length = 0
for (let t = 1; t <= 200; t++) live.p.tick(t)
const rounds = live.e.log.filter((l) => l[0] === 'on').length
check('a bar-long phrase plays more than once over two bars', rounds >= 4, true)

// --- switched off, it hears nothing ---
live = listening({ listen: false })
const silent = []
live.p.onHeard = (h) => silent.push(h)
live.p.noteIn(60, 100, true, 1000)
live.p.noteIn(64, 100, true, 1001)
live.p.hearTick(1100)
check('with listening off nothing is heard', silent, [])

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

// It never leaps a register between chords. A fifth is the most it can move:
// that is what a root going up a fourth looks like once the phrase is placed
// near the octave asked for, rather than being allowed to drift upward.
let worst = 0
for (let i = 1; i < 4; i++) {
  worst = Math.max(worst, Math.abs(sounded[i * 4] - sounded[(i - 1) * 4]))
}
check('and never jumps more than a fifth between chords', worst <= 7, true)


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


// --- speed, octave and the bass drone ---
settings = makeSettings()
const oneBar = { startPulse: 0, endPulse: 96, bars: 1, chord: parseChord('Cm7') }
const onsetsAt = (speed) => {
  settings.accompany.speed = speed
  return buildPhraseQueue(pattern, oneBar.chord, oneBar, settings).queue.filter(q => q.on).map(q => q.at)
}
check('1x is the rhythm as played', onsetsAt(1), [0, 24, 48, 72])
check('2x covers twice the ground', onsetsAt(2), [0, 12, 24, 36, 48, 60, 72, 84])
check('half speed gets through half of it', onsetsAt(0.5), [0, 48])
check('a quarter speed gets through a quarter', onsetsAt(0.25), [0])
check('four times over', onsetsAt(4).length, 16)
settings.accompany.speed = 1

// Octave decides where a phrase sits when it is not following the chord before.
const octaveMean = (octave) => {
  settings.accompany.octave = octave
  settings.accompany.keepRegister = false
  const notes = buildPhraseQueue(pattern, oneBar.chord, oneBar, settings).notes
  return notes.reduce((a, b) => a + b, 0) / notes.length
}
const low = octaveMean(2)
const high = octaveMean(6)
check('a higher octave setting sits higher', high > low, true)
check('and it is octaves apart, not something else', (high - low) % 12, 0)
settings.accompany.octave = 4
settings.accompany.keepRegister = true

// The bass drone: off unless asked for, then a held root.
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.getPhrase = () => null
player.setScore(parseScore('| Cm7 | F7 |', { beatsPerBar: 4 }))
player.tick(1)
check('off by default', engine.log.filter(l => l[0] === 'on').map(l => l[1]), [60, 63, 67, 70])
check('and a plain chord has no bass under it', engine.log.length, 4)

engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
settings.accompany.bass = true
player.setScore(parseScore('| Cm7 | F7 |', { beatsPerBar: 4 }))
player.tick(1)
let droned = engine.log.filter(l => l[0] === 'on').map(l => l[1])
check('one octave down by default', droned[droned.length - 1], 48)
check('and it is the root of the chord', droned[droned.length - 1] % 12, 0)

settings.accompany.doubleBass = true
engine = new FakeEngine(); player = new Player(engine, settings)
player.setScore(parseScore('| Cm7 | F7 |', { beatsPerBar: 4 }))
player.tick(1)
droned = engine.log.filter(l => l[0] === 'on').map(l => l[1])
check('double bass adds one an octave lower', droned.slice(-2), [48, 36])

// It follows the chord and is released with it.
engine.log = []
for (let p = 2; p <= 100; p++) player.tick(p)
check('released when the chord changes', engine.log.some(l => l[0] === 'off' && l[1] === 48), true)
check('and the new root is held', engine.log.filter(l => l[0] === 'on').map(l => l[1]).slice(-2), [53, 41])

settings.accompany.bassOctaves = 3
engine = new FakeEngine(); player = new Player(engine, settings)
player.setScore(parseScore('| Cm7 |', { beatsPerBar: 4 }))
player.tick(1)
check('three octaves down', engine.log.filter(l => l[0] === 'on').map(l => l[1]).slice(-2), [24, 12])

// A slash chord says what belongs in the bass, and the drone plays that.
settings.accompany.bassOctaves = 1
settings.accompany.doubleBass = false
engine = new FakeEngine(); player = new Player(engine, settings)
player.setScore(parseScore('| C/E |', { beatsPerBar: 4 }))
player.tick(1)
const slashed = engine.log.filter(l => l[0] === 'on').map(l => l[1])
check('a slash chord puts its own note in the bass', slashed[slashed.length - 1] % 12, 4)
check('and the chord above it is unchanged', slashed.slice(0, 3), [60, 64, 67])

// It plays under a phrase too, not only under a plain chord.
engine = new FakeEngine(); player = new Player(engine, settings)
player.getPhrase = () => pattern
player.setScore(parseScore('| Cm7 |', { beatsPerBar: 4, songPhrase: 'pattern' }))
player.tick(1)
check('the drone sounds under a phrase as well',
  engine.log.filter(l => l[0] === 'on').map(l => l[1]).includes(48), true)



// --- the octave setting has to actually move the phrase ---
// It used to be consulted only when there was no previous phrase to follow, so
// after the first chord it did nothing and the phrase drifted where it liked.
function meanOverSong(octave) {
  const e = new FakeEngine()
  const s2 = makeSettings()
  s2.accompany.octave = octave
  const pl = new Player(e, s2)
  pl.getPhrase = () => pattern
  pl.setScore(parseScore('| C7 | F7 | Bb7 | Eb7 |', { beatsPerBar: 4, songPhrase: 'pattern' }))
  for (let t = 1; t <= 383; t++) pl.tick(t)
  const notes = e.log.filter((l) => l[0] === 'on').map((l) => l[1])
  return notes.reduce((a, b) => a + b, 0) / notes.length
}
const atTwo = meanOverSong(2)
const atFour = meanOverSong(4)
const atSix = meanOverSong(6)
// About two octaves a step. Not exactly, because at the bottom setting the
// range floor clips one placement and pulls the average up -- which is the range
// doing its job, not the octave failing to.
check('about two octaves a step', [atFour - atTwo, atSix - atFour].every((gap) => gap >= 18 && gap <= 24), true)
check('and it holds for the whole song, not just the first chord', atSix > atFour && atFour > atTwo, true)

// --- the drone goes where the bass goes, not where the phrases go ---
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
settings.accompany.bass = true
settings.midi.bassChannel = 3
settings.midi.accompChannel = 9
player.setScore(parseScore('| Cm7 |', { beatsPerBar: 4 }))
player.tick(1)
const droneEvents = engine.log.filter((l) => l[0] === 'on' && l[1] === 48)
check('the drone sounded', droneEvents.length, 1)
check('on the bass channel, not the accompaniment one', droneEvents[0][2], 3)

/* ---------------- nothing is left hanging --------------------------------
 *
 * Editing a chart while it plays is the ordinary way to use this program,
 * and every one of these used to leave notes on in the DAW until the track
 * was disarmed. The shape was always the same: the event that owed the
 * note-offs was forgotten before they were sent, and then either the next
 * tick collected the debt or nothing ever did.
 *
 * A note-on with no matching note-off is the whole of what is being checked,
 * so the engine is asked directly rather than the player being asked what it
 * thinks it is holding. @see core/player.js Held
 */
function ringing(log) {
  const on = new Map()
  for (const [what, note, channel] of log) {
    const key = `${channel}:${note}`
    if (what === 'on') on.set(key, (on.get(key) || 0) + 1)
    else on.set(key, (on.get(key) || 0) - 1)
  }
  return [...on.entries()].filter(([, n]) => n > 0).map(([key]) => key).sort()
}

// The chord under the playhead, deleted. There is no next event to start and
// nothing else was ever going to send these.
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C', { beatsPerBar: 4 }))
for (let p = 1; p <= 40; p++) player.tick(p)
check('the chord is sounding', ringing(engine.log), ['0:60', '0:64', '0:67'])
player.setScore(parseScore('', { beatsPerBar: 4 }))
check('deleting the whole chart releases it', ringing(engine.log), [])

// The same, with a tick afterwards -- which is the case that used to return
// before it looked at what was held.
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C', { beatsPerBar: 4 }))
for (let p = 1; p <= 40; p++) player.tick(p)
player.setScore(parseScore('', { beatsPerBar: 4 }))
for (let p = 41; p <= 60; p++) player.tick(p)
check('and an empty chart keeps it released', ringing(engine.log), [])

// A chord replaced by a different one, with the transport stopped: no tick
// follows to clean up after it.
engine = new FakeEngine(); settings = makeSettings(); player = new Player(engine, settings)
player.setScore(parseScore('C G', { beatsPerBar: 4 }))
for (let p = 1; p <= 40; p++) player.tick(p)
player.setScore(parseScore('Ab G', { beatsPerBar: 4 }))
check('changing the chord under the playhead releases the old one',
      ringing(engine.log), [])

// The chord survives the edit but what is bound to it does not. The queue in
// hand belongs to the old phrase: its remaining note-offs are for notes the
// new one never sounded, and the notes actually ringing have none at all.
const longPhrase = {
  id: 'one', name: 'one', over: 'C', sourcePcs: [0, 4, 7], sourceChord: 'C',
  lengthPulses: 96,
  // One long note, still down when the edit lands.
  notes: [{ at: 0, note: 60, velocity: 100, duration: 96 }],
}
engine = new FakeEngine(); settings = makeSettings({ accompany: { enabled: true } })
player = new Player(engine, settings)
player.getPhrase = (name) => (name === 'one' ? longPhrase : null)
player.setScore(parseScore('.C{one} F', { beatsPerBar: 4, perChordPhrases: true }))
for (let p = 1; p <= 40; p++) player.tick(p)
check('the phrase is sounding', ringing(engine.log).length > 0, true)
// The chord is untouched; only what is bound to it changes.
player.setScore(parseScore('.C F', { beatsPerBar: 4, perChordPhrases: true }))
check('unbinding the phrase releases what it was holding', ringing(engine.log), [])

// And the note-off goes where the note-on went, not where the settings point
// by the time it is released. Moving the accompaniment to another port used
// to send the release to the new one and leave the old one ringing.
class PortEngine {
  constructor() { this.log = [] }
  noteOn(out, ch, note) { this.log.push(['on', `${out}/${note}`, ch]); return true }
  noteOff(out, ch, note) { this.log.push(['off', `${out}/${note}`, ch]); return true }
}
const ports = new PortEngine()
settings = makeSettings()
player = new Player(ports, settings)
player.setScore(parseScore('C G', { beatsPerBar: 4 }))
for (let p = 1; p <= 40; p++) player.tick(p)
settings.midi.chordOutputId = 'somewhere else'
for (let p = 41; p <= 120; p++) player.tick(p)
check('released on the port it was sounded on',
      ringing(ports.log).filter((one) => one.includes('out/')), [])

/* ---------------- Mr. Accompany Me with nothing written down ------------
 *
 * The state somebody is in when they open jamin to play rather than to read.
 * `tick` used to return on an empty score before it reached the live path, so
 * the one button whose whole job is to answer what you play did nothing at
 * all until you had typed a chart first.
 */
{
  const arp = {
    id: 'arp', name: 'arp', over: 'C', sourcePcs: [0, 4, 7], sourceChord: 'C',
    lengthPulses: 96,
    notes: [{ at: 0, note: 60, velocity: 100, duration: 48 },
            { at: 48, note: 64, velocity: 100, duration: 48 }],
  }
  const bare = new FakeEngine()
  // Monitoring off, or the keys passing through would answer this on their
  // own and the check would pass with the live path doing nothing.
  const set = makeSettings({ accompany: { listen: true, liveBars: 1, passNotes: false } })
  const p = new Player(bare, set)
  p.getLivePhrase = () => arp            // the last articulation chosen
  p.setScore(parseScore('', { beatsPerBar: 4 }))

  p.noteIn(60, 100, true, 1000)
  p.noteIn(64, 100, true, 1001)
  p.noteIn(67, 100, true, 1002)
  p.hearTick(1200)
  for (let pulse = 1; pulse <= 60; pulse++) p.tick(pulse)

  check('an empty notepad still answers what is played',
        bare.log.filter((l) => l[0] === 'on').length > 0, true)

  // And letting go ends it, because Hold is off.
  p.noteIn(60, 0, false, 2000)
  p.noteIn(64, 0, false, 2001)
  p.noteIn(67, 0, false, 2002)
  p.hearTick(2100)
  check('and stops when the hands come off', p.liveHeld.size, 0)
}

/* ---------------- Hold: the hands can come off -------------------------- */
{
  const pad = {
    id: 'pad', name: 'pad', over: 'C', sourcePcs: [0, 4, 7], sourceChord: 'C',
    lengthPulses: 96,
    notes: [{ at: 0, note: 60, velocity: 100, duration: 96 }],
  }
  const out = new FakeEngine()
  const set = makeSettings({ accompany: { listen: true, passNotes: false } })
  const p = new Player(out, set)
  p.getLivePhrase = () => pad
  p.setScore(parseScore('', { beatsPerBar: 4 }))

  p.noteIn(60, 100, true, 1000)
  p.noteIn(64, 100, true, 1001)
  p.noteIn(67, 100, true, 1002)
  p.hearTick(1200)
  for (let pulse = 1; pulse <= 20; pulse++) p.tick(pulse)
  check('the chord is answered', p.liveHeld.size > 0, true)

  p.setHolding(true)
  p.noteIn(60, 0, false, 2000)
  p.noteIn(64, 0, false, 2001)
  p.noteIn(67, 0, false, 2002)
  p.hearTick(2100)
  for (let pulse = 21; pulse <= 40; pulse++) p.tick(pulse)
  check('holding, the hands come off and it plays on', p.liveHeld.size > 0, true)

  // A new chord still takes over -- that is what makes it playable, the left
  // hand moving while the right stays free.
  p.noteIn(65, 100, true, 3000)
  p.noteIn(69, 100, true, 3001)
  p.noteIn(72, 100, true, 3002)
  p.hearTick(3200)
  check('a new chord takes over while held', p.live.heard && p.live.heard.rootPc, 5)
  p.noteIn(65, 0, false, 4000)
  p.noteIn(69, 0, false, 4001)
  p.noteIn(72, 0, false, 4002)
  p.hearTick(4100)
  check('and is held in its turn', p.live.heard !== null, true)

  // Letting go of Hold with the hands already off ends it.
  p.setHolding(false)
  check('letting go of Hold ends it', p.liveHeld.size, 0)
}

/* Lifting the pedal while the keys are still down is not the end of the
   chord: the hands have not stopped playing it, and taking it away would be
   a hole in the middle of a bar. */
{
  const pad = {
    id: 'pad', name: 'pad', over: 'C', sourcePcs: [0, 4, 7], sourceChord: 'C',
    lengthPulses: 96,
    notes: [{ at: 0, note: 60, velocity: 100, duration: 96 }],
  }
  const out = new FakeEngine()
  const p = new Player(out, makeSettings({ accompany: { listen: true, passNotes: false } }))
  p.getLivePhrase = () => pad
  p.setScore(parseScore('', { beatsPerBar: 4 }))
  p.noteIn(60, 100, true, 1000)
  p.noteIn(64, 100, true, 1001)
  p.noteIn(67, 100, true, 1002)
  p.hearTick(1200)
  for (let pulse = 1; pulse <= 20; pulse++) p.tick(pulse)
  p.setHolding(true)
  p.setHolding(false)
  check('the pedal comes up but the keys are still down', p.live.heard !== null, true)
}

/* A stop is not the hands moving. A chord left latched across one would come
   back sounding on its own. */
{
  const pad = {
    id: 'pad', name: 'pad', over: 'C', sourcePcs: [0, 4, 7], sourceChord: 'C',
    lengthPulses: 96,
    notes: [{ at: 0, note: 60, velocity: 100, duration: 96 }],
  }
  const out = new FakeEngine()
  const p = new Player(out, makeSettings({ accompany: { listen: true, passNotes: false } }))
  p.getLivePhrase = () => pad
  p.setScore(parseScore('', { beatsPerBar: 4 }))
  p.noteIn(60, 100, true, 1000)
  p.noteIn(64, 100, true, 1001)
  p.hearTick(1200)
  for (let pulse = 1; pulse <= 20; pulse++) p.tick(pulse)
  p.setHolding(true)
  p.transport('stop')
  check('a stop clears the latch', p.holding, false)
  check('and nothing is left sounding', p.liveHeld.size, 0)
}

/* The live path has its own way out, because inside a plugin the page has no
   MIDI output and a heard chord is the one thing that cannot be compiled in
   advance. Everything else still goes through the engine. */
{
  const engineOut = new FakeEngine()
  const elsewhere = new FakeEngine()
  const pad = {
    id: 'pad', name: 'pad', over: 'C', sourcePcs: [0, 4, 7], sourceChord: 'C',
    lengthPulses: 96,
    notes: [{ at: 0, note: 60, velocity: 100, duration: 96 }],
  }
  const p = new Player(engineOut,
                       makeSettings({ accompany: { listen: true, passNotes: false } }))
  p.liveOut = elsewhere
  p.getLivePhrase = () => pad
  p.setScore(parseScore('', { beatsPerBar: 4 }))
  p.noteIn(60, 100, true, 1000)
  p.noteIn(64, 100, true, 1001)
  p.hearTick(1200)
  for (let pulse = 1; pulse <= 20; pulse++) p.tick(pulse)
  check('a heard chord leaves by the live route', elsewhere.log.length > 0, true)
  check('and not through the engine', engineOut.log.length, 0)
}

/* ---------------- passing your own playing on ---------------------------
 *
 * Mr. Accompany Me hears a chord and answers it. Whether the keys and the
 * pedal themselves are sent on is a separate question -- about the rig
 * rather than about the accompaniment -- so it is two switches, and both
 * start off: most keyboards already reach a sound some other way, and
 * passing them on again is every note twice.
 */
{
  const quiet = new FakeEngine()
  const p = new Player(quiet, makeSettings())
  check('nothing is passed through by default',
        [p.settings.accompany.passNotes, p.settings.accompany.passPedal], [false, false])
  p.noteIn(60, 100, true, 1000)
  p.noteIn(60, 0, false, 1100)
  p.passControl(64, 127)
  check('so playing sends nothing on', quiet.log.length, 0)
}

{
  const out = new FakeEngine()
  const p = new Player(out, makeSettings({ accompany: { passNotes: true } }))
  p.settings.midi.accompChannel = 3
  p.noteIn(60, 100, true, 1000)
  p.noteIn(60, 0, false, 1100)
  check('turned on, the keys go out on the accompaniment channel',
        out.log, [['on', 60, 3], ['off', 60, 3]])
}

{
  // And out by the live route, not the raw engine -- which is the whole of
  // why this was rewritten. Inside a plugin the page has no MIDI port of
  // its own, so the old monitor switch worked in a browser and did nothing
  // at all in a DAW. @see store.js liveOut
  const engineOut = new FakeEngine()
  const elsewhere = new FakeEngine()
  const p = new Player(engineOut, makeSettings({ accompany: { passNotes: true } }))
  p.liveOut = elsewhere
  p.noteIn(60, 100, true, 1000)
  check('and by the route that works inside a plugin', elsewhere.log.length, 1)
  check('not straight out of the engine', engineOut.log.length, 0)
}

{
  const out = new FakeEngine()
  const p = new Player(out, makeSettings({ accompany: { passPedal: true } }))
  p.settings.midi.accompChannel = 2
  p.passControl(64, 127)
  p.passControl(64, 0)
  check('the pedal goes through when asked',
        out.log, [['cc', 64, 2, 127], ['cc', 64, 2, 0]])

  // Sustain only. A keyboard sends a great deal down that wire and
  // forwarding all of it would make this a MIDI thru with a switch on it.
  out.log = []
  p.passControl(1, 127)
  p.passControl(11, 64)
  check('and nothing else does', out.log.length, 0)
}

{
  // The notes switch and the pedal switch are separate, because the two
  // questions are: one is "can my keyboard be heard", the other is "does
  // my pedal reach the sound".
  const out = new FakeEngine()
  const p = new Player(out, makeSettings({ accompany: { passNotes: true, passPedal: false } }))
  p.noteIn(60, 100, true, 1000)
  p.passControl(64, 127)
  check('notes without the pedal', out.log.map((one) => one[0]), ['on'])

  const other = new FakeEngine()
  const q = new Player(other, makeSettings({ accompany: { passNotes: false, passPedal: true } }))
  q.noteIn(60, 100, true, 1000)
  q.passControl(64, 127)
  check('and the pedal without the notes', other.log.map((one) => one[0]), ['cc'])
}

console.log(failed === 0 ? 'player: all checks passed' : `player: ${failed} FAILED`)
