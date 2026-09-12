// Clock handling, driven by raw MIDI bytes.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

function makeEngine() {
  const engine = new MidiEngine()
  engine.clockInputId = 'clock'
  engine.transportLog = []
  engine.ticks = []
  engine.onTransport = (kind) => engine.transportLog.push(kind)
  engine.onTick = (pulse) => engine.ticks.push(pulse)
  return engine
}
const send = (engine, bytes, at) => engine._handle({ data: bytes, timeStamp: at, target: { id: 'clock' } })

// Clock alone does nothing until we are running.
let e = makeEngine()
e.autoStartOnClock = false
for (let i = 0; i < 5; i++) send(e, [0xf8], i * 20)
check('no ticks while stopped', e.ticks.length, 0)

// Start, then clock advances.
send(e, [0xfa], 100)
for (let i = 1; i <= 24; i++) send(e, [0xf8], 100 + i * 20)
check('start resets to zero', e.transportLog, ['start'])
check('24 pulses to the beat', e.pulse, 24)
check('ticks delivered', e.ticks.length, 24)

// Tempo comes out of the clock interval: 20ms per pulse is 125 bpm.
check('tempo estimated', Math.abs(e.bpm - 125) < 6, true)

// Stop releases, and free-running clock must not restart us.
send(e, [0xfc], 700)
check('stop reported', e.transportLog[e.transportLog.length - 1], 'stop')
e.autoStartOnClock = true
for (let i = 0; i < 10; i++) send(e, [0xf8], 720 + i * 20)
check('free-running clock does not restart after a stop', e.running, false)

// A real Start does.
send(e, [0xfb], 1000)
check('continue restarts', e.running, true)

// Song position: 16 sixteenths in, i.e. bar 2 of 4/4, i.e. pulse 96.
send(e, [0xf2, 16, 0], 1100)
check('song position', e.pulse, 96)
send(e, [0xf2, 0x7f, 0x01], 1200)
check('14-bit song position', e.pulse, ((0x7f | (1 << 7)) * 6))

// Auto-start for gear that sends clock with no Start message at all.
e = makeEngine()
for (let i = 0; i < 3; i++) send(e, [0xf8], i * 20)
check('auto-start on clock', e.running, true)
check('auto-start is reported', e.transportLog, ['clock-start'])

// A clock that simply goes quiet counts as a stop.
e.lastClockAt = 1000
e.checkStall(1100)
check('not stalled yet', e.running, true)
e.checkStall(1600)
check('stalled', e.running, false)

// Note input only comes through from the bound accompaniment port.
e = makeEngine()
const notes = []
e.onNoteIn = (note, velocity, on) => notes.push([note, velocity, on])
e._handle({ data: [0x90, 60, 100], timeStamp: 0, target: { id: 'keys' } })
check('unbound port ignored', notes.length, 0)
e.accompInputId = 'keys'
e._handle({ data: [0x90, 60, 100], timeStamp: 0, target: { id: 'keys' } })
e._handle({ data: [0x90, 60, 0], timeStamp: 1, target: { id: 'keys' } })
e._handle({ data: [0x80, 64, 40], timeStamp: 2, target: { id: 'keys' } })
check('note in', notes, [[60, 100, true], [60, 0, false], [64, 40, false]])

// Clock from a port we are not listening to is ignored.
e = makeEngine()
e._handle({ data: [0xfa], timeStamp: 0, target: { id: 'other' } })
check('clock from another port ignored', e.running, false)

console.log(failed === 0 ? 'midi: all checks passed' : `midi: ${failed} FAILED`)
