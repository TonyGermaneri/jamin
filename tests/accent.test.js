// The accent is scheduled in real time rather than in pulses, so it can play
// over the top of the chart and can play while the transport is stopped.
// JavaScriptCore has no timers, so here is one we can wind by hand.
let failed = 0
const check = (l, g, w) => {
  if (JSON.stringify(g) !== JSON.stringify(w)) { failed++; console.log(`FAIL ${l}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`) }
}

const timers = []
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms: ms || 0, dead: false }); return timers.length }
globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].dead = true }
function wind(to) {
  timers
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !t.dead && t.ms <= to)
    .sort((a, b) => a.t.ms - b.t.ms || a.i - b.i)
    .forEach(({ t }) => { t.dead = true; t.fn() })
}

class E {
  constructor() { this.log = []; this.bpm = 120 }
  noteOn(o, c, n) { this.log.push(['on', n, c]); return true }
  noteOff(o, c, n) { this.log.push(['off', n, c]); return true }
}

const settings = defaultSettings()
settings.midi.chordOutputId = 'out'
settings.midi.accompOutputId = 'out'
settings.chords.smartVoicing = false

// A two-note stab, an eighth long.
const accent = {
  id: 'a1', name: 'stab', rootPc: 0, sourcePcs: [0, 4, 7], sourceChord: 'C', lengthPulses: 24,
  notes: [
    { at: 0, note: 60, velocity: 100, duration: 12 },
    { at: 12, note: 67, velocity: 100, duration: 12 },
  ],
}

let engine = new E()
let player = new Player(engine, settings)
player.setScore(parseScore('| Fm7 | Bb7 |', { beatsPerBar: 4 }))

check('there is nothing to play it over before the clock moves', player.triggerAccent(accent), false)
player.tick(1)
engine.log = []

check('it fires once a chord is current', player.triggerAccent(accent), true)
check('an empty phrase plays nothing', player.triggerAccent({ notes: [] }), false)
check('nothing has sounded yet', engine.log.length, 0)

// At 120bpm a pulse is about 20.8ms, so an eighth note is a quarter of a second.
wind(1)
const first = engine.log.filter((l) => l[0] === 'on').map((l) => l[1])
check('one note lands immediately', first.length, 1)
// Harmonised to the chord that is current, so the phrase's root is F, not C.
check('and it is the root of the chord under it', ((first[0] % 12) - 5 + 12) % 12, 0)
wind(260)
const fired = engine.log.filter((l) => l[0] === 'on').map((l) => l[1])
check('both notes, in order', fired.length, 2)
check('the second is a fifth above the first', fired[1] - fired[0], 7)
wind(10000)
const ons = engine.log.filter((l) => l[0] === 'on').length
const offs = engine.log.filter((l) => l[0] === 'off').length
check('everything it started, it stopped', ons, offs)

// It is harmonised to the chord that is current, not to the one it was played over.
check('over Fm7 it plays Fm7 notes', fired.map((n) => ((n % 12) - 5 + 12) % 12), [0, 7])

// A second trigger cancels the first rather than piling up.
engine = new E(); player = new Player(engine, settings)
player.setScore(parseScore('| Fm7 |', { beatsPerBar: 4 }))
player.tick(1)
player.triggerAccent(accent)
const scheduled = player.accentTimers.length
player.triggerAccent(accent)
check('retriggering replaces rather than stacks', player.accentTimers.length, scheduled)

// Stopping the transport cancels it.
player.transport('stop')
check('stopping clears it', player.accentTimers.length, 0)

// Speed applies to it as well.
engine = new E(); player = new Player(engine, settings)
player.setScore(parseScore('| Fm7 |', { beatsPerBar: 4 }))
player.tick(1)
settings.accompany.speed = 2
timers.length = 0
player.triggerAccent(accent)
const fastest = Math.max(...timers.filter((t) => !t.dead).map((t) => t.ms))
settings.accompany.speed = 1
timers.length = 0
player.triggerAccent(accent)
const normal = Math.max(...timers.filter((t) => !t.dead).map((t) => t.ms))
check('twice the speed is half the time', Math.round(normal / fastest), 2)

console.log(failed === 0 ? 'accent: all checks passed' : `accent: ${failed} FAILED`)
