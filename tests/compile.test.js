// The compiler, run in JavaScriptCore -- which is the same engine the plugin
// embeds, so this is not a stand-in for the real thing, it is the real thing
// without a DAW attached.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
function ok(label, got) { if (!got) { failed++; console.log(`FAIL ${label}`) } }

const settings = defaultSettings()
// A port is bound so nothing is filtered on the way out; the compiler drops the
// port anyway, but the player only records notes that reached one.
settings.midi.chordOutputId = 'test'

const ON = 0x90
const OFF = 0x80
const noteOns = (s) => s.events.filter((e) => (e[1] & 0xf0) === ON)
const at = (s, pulse) => s.events.filter((e) => e[0] === pulse)

/* ---------------- the shape of it ---------------- */

let song = compileSong({ text: '| C | F |', settings })
check('two bars of four is 192 pulses', song.lengthPulses, 192)
check('two chords', song.chords, 2)
ok('it played something', song.events.length > 0)

// Every event is [pulse, status, note, velocity], sorted, in range.
ok('events are quads', song.events.every((e) => e.length === 4))
ok('pulses never go backwards', song.events.every((e, i) => i === 0 || e[0] >= song.events[i - 1][0]))
ok('notes are in range', song.events.every((e) => e[2] >= 0 && e[2] <= 127))
ok('velocities are in range', song.events.every((e) => e[3] >= 0 && e[3] <= 127))
ok('only note on and note off', song.events.every((e) => (e[1] & 0xf0) === ON || (e[1] & 0xf0) === OFF))

// The channel is the one the user set, zero-based on the wire.
check('the chord channel came through',
  new Set(noteOns(song).map((e) => e[1] & 0x0f)).size, 1)
check('and it is the configured one, unshifted',
  noteOns(song)[0][1] & 0x0f, settings.midi.chordChannel)

/* ---------------- it plays the right chords ---------------- */

song = compileSong({ text: '| C | F |', settings })
const firstChord = at(song, 0).filter((e) => (e[1] & 0xf0) === ON).map((e) => e[2] % 12).sort((a, b) => a - b)
check('the downbeat is a C major triad', [...new Set(firstChord)], [0, 4, 7])

const secondBar = at(song, 96).filter((e) => (e[1] & 0xf0) === ON).map((e) => e[2] % 12).sort((a, b) => a - b)
check('the second bar is an F major triad', [...new Set(secondBar)], [0, 5, 9])

// The first chord is released when the second arrives, not left hanging.
const releasedAt96 = at(song, 96).filter((e) => (e[1] & 0xf0) === OFF).map((e) => e[2])
const soundedAt0 = at(song, 0).filter((e) => (e[1] & 0xf0) === ON).map((e) => e[2])
check('the first chord is released as the second sounds',
  releasedAt96.slice().sort(), soundedAt0.slice().sort())

/* ---------------- nothing is left hanging ---------------- */

// Over one pass, every note that was turned on gets turned off. The releases
// for the last chord live at pulse 0, because the sequence loops and pulse
// `lengthPulses` is never reached.
function hanging(s) {
  const held = new Map()
  for (const [, status, note] of s.events) {
    const key = `${status & 0x0f}:${note}`
    if ((status & 0xf0) === ON) held.set(key, (held.get(key) || 0) + 1)
    else held.set(key, (held.get(key) || 0) - 1)
  }
  return [...held.values()].filter((n) => n !== 0).length
}
check('nothing is left sounding at the end of a pass', hanging(song), 0)

// And the releases come first at pulse 0, so a second pass does not cancel its
// own opening chord.
const atZero = at(song, 0)
const lastOffIndex = atZero.map((e) => (e[1] & 0xf0) === OFF).lastIndexOf(true)
const firstOnIndex = atZero.map((e) => (e[1] & 0xf0) === ON).indexOf(true)
ok('releases precede the downbeat', lastOffIndex < firstOnIndex || lastOffIndex === -1)

/* ---------------- the difficult chart from before ---------------- */

// Two chords sharing a bar: the second must start halfway, not twice as fast.
song = compileSong({ text: '| Dm7 G7 | Cmaj7 |', settings })
check('three chords', song.chords, 3)
const starts = [...new Set(noteOns(song).map((e) => e[0]))].sort((a, b) => a - b)
check('they start on the bar, the half bar and the next bar', starts, [0, 48, 96])

/* ---------------- repeats really repeat ---------------- */

const once = compileSong({ text: '| C | F |', settings })
const twice = compileSong({ text: '|: C | F :|', settings })
check('a repeat doubles the length', twice.lengthPulses, once.lengthPulses * 2)
ok('and doubles the playing', twice.events.length > once.events.length)

/* ---------------- phrases ---------------- */

const phrase = {
  id: 'riff', name: 'test riff', rootPc: 0,
  sourcePcs: [0, 4, 7], lengthPulses: 96,
  notes: [
    { at: 0, note: 60, duration: 24, velocity: 90 },
    { at: 24, note: 64, duration: 24, velocity: 90 },
    { at: 48, note: 67, duration: 24, velocity: 90 },
  ],
}
const withPhrase = { ...settings }
withPhrase.accompany = { ...settings.accompany, enabled: true }
song = compileSong({ text: '| C | F |', settings: withPhrase, songPhrase: 'riff', phrases: { riff: phrase } })
check('nothing hangs with a phrase either', hanging(song), 0)

// Re-pointed at the second chord rather than repeated verbatim: the phrase over
// F is not the same pitches as the phrase over C.
const accompChannel = withPhrase.midi.accompChannel
const overC = song.events.filter((e) => e[0] < 96 && (e[1] & 0xf0) === ON && (e[1] & 0x0f) === accompChannel).map((e) => e[2])
const overF = song.events.filter((e) => e[0] >= 96 && (e[1] & 0xf0) === ON && (e[1] & 0x0f) === accompChannel).map((e) => e[2])
ok('the phrase sounded over both chords', overC.length > 0 && overF.length > 0)
ok('and was re-pointed, not repeated', JSON.stringify(overC) !== JSON.stringify(overF))

/* ---------------- it never throws ---------------- */

check('an empty chart compiles to nothing', compileSong({ text: '', settings }).events.length, 0)
check('and reports no length', compileSong({ text: '', settings }).lengthPulses, 0)
check('nonsense chords do not stop it', compileSong({ text: '| Hzz | C |', settings }).chords, 2)
check('no settings is survivable', compileSong({ text: '| C |' }).events.length, 0)
check('no request at all is survivable', compileSong(null).events.length, 0)

// The JSON door the plugin actually uses.
const answer = JSON.parse(compileJson(JSON.stringify({ text: '| C |', settings, generation: 7 })))
check('the generation is echoed back', answer.generation, 7)
ok('and it compiled', answer.events.length > 0)
const broken = JSON.parse(compileJson('{not json'))
check('bad json comes back as an empty sequence', broken.events.length, 0)
ok('carrying its own explanation', typeof broken.error === 'string' && broken.error.length > 0)

/* ---------------- the sustain pedal reaches the sequence ---------------- */
// A sequence event is a status byte and two data bytes, so a control change
// needs nothing new to carry it -- but it does need the plugin to stop reading
// "not a note-on" as "note-off", which it used to.
const pedalled = compileSong({ text: '| C | F |', settings: { ...settings,
  accompany: { ...settings.accompany, pedal: true } } }).events
const ccs = pedalled.filter(([, status]) => (status & 0xf0) === 0xb0)
ok('the pedal is in the compiled sequence', ccs.length >= 3)
check('as CC 64', [...new Set(ccs.map((e) => e[2]))], [64])
check('down and up, nothing in between', [...new Set(ccs.map((e) => e[3]))].sort((a, b) => a - b), [0, 127])

// Never two presses in a row, and never a lift on the same pulse as the press
// that follows it -- they would reach the instrument at one sample offset and
// the lift would be undone before it did anything.
let previous = null
let sameP = 0
let doubled = 0
for (const [pulse, , , value] of ccs) {
  const down = value >= 64
  if (previous && previous.down === down) doubled++
  if (previous && !previous.down && down && previous.pulse === pulse) sameP++
  previous = { pulse, down }
}
check('presses and lifts alternate', doubled, 0)
check('and a lift never shares a pulse with the press after it', sameP, 0)

// The last chord's pedal is lifted before the sequence ends, so a loop does not
// begin with the previous pass still sustaining.
check('the sequence ends lifted', ccs[ccs.length - 1][3], 0)

const plain = compileSong({ text: '| C | F |', settings }).events
check('and none of it when the switch is off', plain.filter(([, s]) => (s & 0xf0) === 0xb0).length, 0)

// The chart beats the switch, through the compiler as much as through the player.
const marked = compileSong({ text: '[p] | C | F |', settings }).events
ok('[p] compiles the pedal in with the switch off',
   marked.some(([, status]) => (status & 0xf0) === 0xb0))

/* ---------------- two tracks, two drum parts ----------------------------
 *
 * This is what per-track bindings are *for*, and it is the half that has to be
 * true for any of the rest to matter. Every instance used to read its bindings
 * from one browser-wide key, so a session with a kit on one track and a piano
 * on another could not give them different drum parts at all -- binding a groove
 * anywhere bound it everywhere.
 *
 * The compile is where that becomes audible. Each instance compiles its own
 * request, so two requests differing only in their bindings have to come out
 * differently; if the compile ignored them, per-track storage would be
 * bookkeeping that changed nothing anybody could hear.
 */
const kick = {
  id: 'g-kick', name: 'kick', kind: 'beat', bars: 1, beatsPerBar: 4,
  lengthPulses: 96, timeSignature: '4-4', bpm: 120,
  notes: [{ at: 0, note: 36, velocity: 100, length: 6 }],
}
const snare = {
  id: 'g-snare', name: 'snare', kind: 'beat', bars: 1, beatsPerBar: 4,
  lengthPulses: 96, timeSignature: '4-4', bpm: 120,
  notes: [{ at: 0, note: 38, velocity: 100, length: 6 }],
}

const drumming = defaultSettings()
drumming.midi.drumOutputId = 'test'
drumming.drums.fillOnEveryBoundary = false

const forTrack = (bindings) => compileSong({
  text: '[Verse]\n| C | F |',
  settings: drumming,
  sends: 'drums',
  grooves: { 'g-kick': kick, 'g-snare': snare },
  drumBindings: bindings,
})

const struck = (s) => [...new Set(noteOns(s).map((e) => e[2]))].sort((a, b) => a - b)

const kitTrack = forTrack({ Verse: { groove: 'g-kick' } })
const otherTrack = forTrack({ Verse: { groove: 'g-snare' } })

ok('a track bound to a groove plays it', noteOns(kitTrack).length > 0)
check('and plays that one', struck(kitTrack), [36])
check('while a track bound to another plays that one', struck(otherTrack), [38])
// The whole point, in one line: the same chart and the same catalogue, and the
// two tracks are not playing the same thing.
ok('two tracks do not have to play the same drums',
   JSON.stringify(struck(kitTrack)) !== JSON.stringify(struck(otherTrack)))
check('and a track bound to nothing plays nothing', noteOns(forTrack({})).length, 0)

// A binding that names a groove nobody has is silence rather than a wrong one.
// A remote track's bindings can name a pattern out of a library this window
// never imported, and guessing at a substitute would be worse.
check('a binding with no groove behind it is silent',
      noteOns(forTrack({ Verse: { groove: 'g-nothing' } })).length, 0)

console.log(failed === 0 ? 'compile: all checks passed' : `compile: ${failed} FAILED`)
