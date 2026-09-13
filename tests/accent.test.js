// The accent: it replaces the next chord's phrase rather than sounding over it.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
function ok(label, got) { if (!got) { failed++; console.log(`FAIL ${label}`) } }

// A recorder in place of a MIDI port, as the compiler uses.
class PortLog {
  constructor() { this.on = []; this.off = [] }
  noteOn(_out, channel, note, velocity) { this.on.push({ channel, note, velocity }); return true }
  noteOff(_out, channel, note) { this.off.push({ channel, note }); return true }
  get bpm() { return 120 }
}

const settings = defaultSettings()
settings.midi.chordOutputId = 'test'
settings.accompany.enabled = true

const line = (name, notes) => ({
  id: name, name, rootPc: 0, sourcePcs: [0, 4, 7], lengthPulses: 96,
  notes: notes.map((note, i) => ({ at: i * 24, note, duration: 24, velocity: 90 })),
})

const ordinary = line('ordinary', [60, 62, 64])
const accent = line('accent', [72, 74, 76, 77])

/**
 * Play a chart through, optionally pressing the accent button part way.
 *
 * `atPulse` matters: arming before anything has started means the very first
 * chord is the next one, which is right but is not what pressing the button
 * during a tune does.
 */
function playThrough(text, arm, atPulse = 12) {
  const score = parseScore(text, scoreOptions(settings, 'ordinary'))
  const engine = new PortLog()
  const player = new Player(engine, settings)
  player.getPhrase = (id) => (id === 'ordinary' ? ordinary : null)
  player.setScore(score)
  const spent = []
  player.onAccentSpent = (event) => spent.push(event.index)
  for (let pulse = 0; pulse < score.totalPulses; pulse++) {
    if (arm && pulse === atPulse) arm(player)
    player.tick(pulse)
  }
  return { engine, player, spent, score }
}

const accompChannel = settings.midi.accompChannel
const phraseNotes = (engine, from, to) =>
  engine.on.filter((e) => e.channel === accompChannel).slice(from, to).map((e) => e.note)

/* ---------------- it does nothing until armed ---------------- */

let run = playThrough('| C | F | G |')
const plain = phraseNotes(run.engine, 0, 99)
ok('the ordinary phrase plays on every chord', plain.length >= 9)
check('nothing was spent', run.spent, [])

/* ---------------- armed for whichever comes next ---------------- */

run = playThrough('| C | F | G |', (p) => p.armAccent(accent))
check('pressed during the first chord, it lands on the second', run.spent, [1])

// Pressed before anything is playing, the first chord is the next one.
run = playThrough('| C | F | G |', (p) => p.armAccent(accent), 0)
check('pressed before the downbeat, it lands on the downbeat', run.spent, [0])
ok('the accent has more notes than the phrase it replaced', accent.notes.length > ordinary.notes.length)

// And it is spent: the third chord is back to the ordinary phrase.
run = playThrough('| C | F | G | Am |', (p) => p.armAccent(accent))
check('spent exactly once', run.spent.length, 1)

/* ---------------- armed for a named event ---------------- */

run = playThrough('| C | F | G | Am |', (p) => p.armAccent(accent, 2))
check('it waits for the event it was given', run.spent, [2])

run = playThrough('| C | F |', (p) => p.armAccent(accent, 9))
check('an event that never comes is never spent', run.spent, [])
ok('and the accent stays armed', run.player.accent !== null)

/* ---------------- it replaces rather than layers ---------------- */

const withAccent = playThrough('| C | F | G |', (p) => p.armAccent(accent, 1))
const without = playThrough('| C | F | G |')
const countOn = (r) => r.engine.on.filter((e) => e.channel === accompChannel).length
check('replacing changes the note count by exactly the difference',
  countOn(withAccent) - countOn(without), accent.notes.length - ordinary.notes.length)

// Nothing is left sounding either way.
const hanging = (r) => r.engine.on.length - r.engine.off.length
check('nothing hangs without an accent', hanging(without), 0)
check('nothing hangs with one', hanging(withAccent), 0)

/* ---------------- arming, disarming, and no phrase ---------------- */

const bare = new Player(new PortLog(), settings)
ok('arming reports success', bare.armAccent(accent))
ok('disarming reports it had one', bare.disarmAccent())
ok('and not twice', !bare.disarmAccent())
ok('a phrase with no notes cannot be armed', !bare.armAccent({ name: 'empty', notes: [] }))
ok('nor can nothing at all', !bare.armAccent(null))

/* ---------------- the accent is not gated on the accompaniment ---------------- */

const quiet = defaultSettings()
quiet.midi.chordOutputId = 'test'
quiet.accompany.enabled = false
{
  const score = parseScore('| C | F |', scoreOptions(quiet, 'ordinary'))
  const engine = new PortLog()
  const player = new Player(engine, quiet)
  player.getPhrase = () => ordinary
  player.setScore(score)
  const spent = []
  player.onAccentSpent = (e) => spent.push(e.index)
  for (let pulse = 0; pulse < score.totalPulses; pulse++) {
    if (pulse === 12) player.armAccent(accent)
    player.tick(pulse)
  }
  check('it plays with the accompaniment switched off', spent, [1])
}

/* ---------------- through the compiler, as the plugin sees it ---------------- */

const request = { text: '| C | F | G |', settings, songPhrase: 'ordinary',
                  phrases: { ordinary }, accent, accentAt: 1 }
const compiled = compileSong(request)
const plainCompiled = compileSong({ ...request, accent: null, accentAt: null })
ok('the compiled song carries the accent', compiled.events.length > plainCompiled.events.length)
check('and is otherwise the same length', compiled.lengthPulses, plainCompiled.lengthPulses)

// The accent's own pitches appear in the second bar and nowhere else.
const inBar = (song, from, to) => song.events
  .filter((e) => e[0] >= from && e[0] < to && (e[1] & 0xf0) === 0x90 && (e[1] & 0x0f) === accompChannel)
  .map((e) => e[2])
ok('the accent sounds in the bar it was aimed at', inBar(compiled, 96, 192).length === accent.notes.length)
check('and the bar before is untouched', inBar(compiled, 0, 96), inBar(plainCompiled, 0, 96))
check('and the bar after', inBar(compiled, 192, 288), inBar(plainCompiled, 192, 288))

console.log(failed === 0 ? 'accent: all checks passed' : `accent: ${failed} FAILED`)
