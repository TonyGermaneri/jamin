// The plugin bridge, tested with no plugin and no browser anywhere near it.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// Outside the plugin everything answers harmlessly rather than throwing, which
// is what lets the browser build ignore this module completely.
check('not hosted in a plain script', hosted(), false)
check('initialisation data falls back', hostData('jaminInstanceId', 'none'), 'none')
check('unsubscribing when never subscribed is safe', typeof onHost('x', () => {}), 'function')
onHost('x', () => {})()

/* ---------------- the clock ---------------- */

function record() {
  const clock = new HostClock()
  const ticks = []
  const transport = []
  clock.onTick = (pulse) => ticks.push(pulse)
  clock.onTransport = (kind) => transport.push(kind)
  return { clock, ticks, transport }
}

// Stopped and parked reports nothing at all. An instance nobody is using must
// cost nothing.
let { clock, ticks, transport } = record()
clock.update({ playing: false, ppq: 0, bpm: 120 })
clock.update({ playing: false, ppq: 0, bpm: 120 })
check('a stopped transport does not tick', ticks, [])
check('and does not report a change', transport, [])

// Rolling: one start, then a tick for every position that actually moved.
;({ clock, ticks, transport } = record())
clock.update({ playing: true, ppq: 0, bpm: 120 })
clock.update({ playing: true, ppq: 0.25, bpm: 120 })
clock.update({ playing: true, ppq: 0.5, bpm: 120 })
check('start is reported once', transport, ['start'])
check('pulses are quarter notes times 24', ticks, [0, 6, 12])

// The host reports faster than the pulse changes; a repeat is not a tick.
;({ clock, ticks } = record())
clock.update({ playing: true, ppq: 1.0 })
clock.update({ playing: true, ppq: 1.001 })   // still pulse 24
clock.update({ playing: true, ppq: 1.05 })    // pulse 25
check('a repeated pulse does not tick twice', ticks, [24, 25])

// Stopping is reported once, and nothing ticks after it.
;({ clock, ticks, transport } = record())
clock.update({ playing: true, ppq: 0 })
clock.update({ playing: false, ppq: 0.5 })
clock.update({ playing: false, ppq: 0.9 })
check('stop is reported once', transport, ['start', 'stop'])
check('and nothing ticks while stopped', ticks, [0])

// A locate -- the playhead jumping rather than advancing -- has to be called
// out, because everything sounding needs releasing before the new position.
;({ clock, ticks, transport } = record())
clock.update({ playing: true, ppq: 8 })
clock.update({ playing: true, ppq: 0 })
check('jumping backwards is a locate', transport, ['start', 'position'])
check('and the new position still ticks', ticks, [192, 0])

;({ clock, transport } = record())
clock.update({ playing: true, ppq: 0 })
clock.update({ playing: true, ppq: 32 })
check('jumping a long way forward is a locate', transport, ['start', 'position'])

// A slow frame is not a locate. At 30 reports a second even 300 bpm advances
// only a few pulses, so the threshold has room for a stall without tripping.
;({ clock, transport } = record())
clock.update({ playing: true, ppq: 0 })
clock.update({ playing: true, ppq: 3.9 })
check('a slow frame is not a locate', transport, ['start'])

// Starting again after a stop must not be read as a jump from wherever the
// playhead was left.
;({ clock, transport } = record())
clock.update({ playing: true, ppq: 64 })
clock.update({ playing: false, ppq: 64 })
clock.update({ playing: true, ppq: 0 })
check('restarting from the top is not a locate', transport, ['start', 'stop', 'start'])

// A count-in can report a negative position. There is no such pulse.
;({ clock, ticks } = record())
clock.update({ playing: true, ppq: -2 })
check('a count-in clamps to the top of the song', ticks, [0])

// Tempo and metre come through, and a nonsensical tempo is ignored rather than
// adopted -- a zero would make every derived duration infinite.
clock = new HostClock()
clock.update({ playing: false, ppq: 0, bpm: 91.5, numerator: 7, denominator: 8, hasPlayhead: true })
check('tempo', clock.bpm, 91.5)
check('metre', [clock.numerator, clock.denominator], [7, 8])
check('playhead reported', clock.hasPlayhead, true)
clock.update({ playing: false, ppq: 0, bpm: 0 })
check('a zero tempo is ignored', clock.bpm, 91.5)

// Nothing at all must not throw; a host can send an empty payload.
clock.update(null)
clock.update({})
check('an empty report is survivable', clock.running, false)

// reset() forgets the position, so the next report is fresh rather than a jump.
;({ clock, transport } = record())
clock.update({ playing: true, ppq: 100 })
clock.reset()
clock.update({ playing: true, ppq: 0 })
check('reset makes the next report fresh', transport, ['start', 'start'])

console.log(failed === 0 ? 'host: all checks passed' : `host: ${failed} FAILED`)
