// The sustain pedal: a switch, two marks in the chart, and the ordering that
// makes it sound like a pedal rather than a smear.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- reading the marks -------------------------------------- */
check('[p] holds it', pedalMark('[p]'), 'down')
check('[np] lifts it', pedalMark('[np]'), 'up')
check('[n.p] is the same', pedalMark('[n.p]'), 'up')
check('[n.p.] too', pedalMark('[n.p.]'), 'up')
check('[p.] for symmetry', pedalMark('[p.]'), 'down')
check('case does not matter', pedalMark('[P]'), 'down')
check('nor does space', pedalMark('[ n.p. ]'), 'up')
// "np" is read before "p", or the mark to lift it would hold it instead.
check('a section is not a pedal mark', pedalMark('[verse 1]'), null)
check('nor is one that starts with p', pedalMark('[pre-chorus]'), null)
check('nor a bare word', pedalMark('p'), null)

/* ---------------- what it does to the events ------------------------------ */
const pedals = (text) => parseScore(text).events.map((e) => e.pedal)

check('a chart with no marks says nothing', pedals('Cm7 F7'), [null, null])
check('[p] applies from where it is', pedals('Cm7 [p] F7 Bb7'), [null, true, true])
check('[np] lifts it again', pedals('[p] Cm7 F7 [np] Bb7'), [true, true, false])
check('marks can alternate', pedals('[p] C [np] F [p] G'), [true, false, true])

// A chord repeated either side of a mark is two events, not one merged one --
// otherwise the second half of the merge would silently take the first's pedal.
check('a pedal change breaks a merge', pedals('C [p] C'), [null, true])
check('and without one it still merges', parseScore('C C').events.length, 1)

// The mark is a token of its own, so it is not read as a chord and not drawn
// as a section label.
const marked = parseScore('[p] Cm7')
check('the mark is its own token type', marked.tokens[0].type, 'pedal')
check('and carries what it did', marked.tokens[0].pedal, true)
check('a section label still is one', parseScore('[verse] Cm7').tokens[0].type, 'label')

// A repeat replays the events it spans, pedal state and all.
check('repeats carry it', pedals('|: [p] C F :| x2'), [true, true, true, true])

// Where a mark takes effect, which is not quite where it is written. A bracket
// is pulled out of the bar it sits in -- that is how section labels have always
// worked -- so a mark inside a bar applies from the start of that bar. Pinned
// here because it is surprising enough to be worth saying out loud in the
// README, and surprising enough to be "fixed" by accident later.
check('a mark inside a bar takes the whole bar', pedals('| C [p] F |'), [true, true])
check('between bars it does not', pedals('| C | [p] F |'), [null, true])
check('on its own between bars either', pedals('| C | [p] | F |'), [null, true])
check('and with no bar lines each word stands alone', pedals('C [p] F'), [null, true])

/* ---------------- the switch, and the chart beating it -------------------- */
const settings = defaultSettings()
settings.midi.chordOutputId = 'out'
settings.accompany.enabled = false

const player = new Player({ noteOn: () => true, noteOff: () => true, controlChange: () => true }, settings)

settings.accompany.pedal = false
check('the switch off, and nothing said', player.pedalFor({ pedal: null }), false)
settings.accompany.pedal = true
check('the switch on, and nothing said', player.pedalFor({ pedal: null }), true)
check('the chart beats the switch, off', player.pedalFor({ pedal: false }), false)
settings.accompany.pedal = false
check('and on', player.pedalFor({ pedal: true }), true)
check('no event at all falls back to the switch', player.pedalFor(null), false)

/* ---------------- the order it comes out in ------------------------------- */
// Stepped a pulse at a time, the way compile.js drives it and the way a real
// playhead moves. Ticking only at the chord boundaries is what hid the fault
// this section now pins down: the lift happens *between* chords, so a test that
// never looks between chords cannot see whether it happened there.
function record(text, pedal) {
  const sent = []
  const s = defaultSettings()
  s.midi.chordOutputId = 'out'
  s.accompany.enabled = false
  s.accompany.pedal = pedal
  s.chords.mergeRepeats = false
  let at = 0
  const engine = {
    noteOn: (_o, _c, note) => (sent.push({ at, what: `on ${note}` }), true),
    noteOff: (_o, _c, note) => sent.push({ at, what: `off ${note}` }),
    controlChange: (_o, _c, cc, value) => (sent.push({ at, what: `cc${cc} ${value}` }), true),
  }
  const p = new Player(engine, s)
  const score = parseScore(text, { beatsPerBar: 4 })
  p.setScore(score)
  for (at = 0; at < score.totalPulses; at++) p.tick(at)
  return sent
}

const off = record('C F', false)
check('no pedal, no control changes', off.some((m) => m.what.startsWith('cc')), false)

const on = record('C F', true)
const ccs = on.filter((m) => m.what.startsWith('cc64'))
check('two chords, two presses and two lifts', ccs.length, 4)
check('and they alternate, lift before press',
      ccs.map((m) => m.what), ['cc64 127', 'cc64 0', 'cc64 127', 'cc64 0'])

// The point of the whole thing. A lift and the press that follows it landing on
// one pulse arrive at one sample offset, and an instrument reading a block in
// order sees the lift undone before it can do anything -- so the chord sustains
// straight through the change, which is the smear the pedal exists to avoid.
const lift = ccs[1]
const press = ccs[2]
check('the lift comes before the chord change', lift.at, 95)
check('the press comes at it', press.at, 96)
check('so they are never on the same pulse', lift.at < press.at, true)

// And the notes of the outgoing chord are still down when it lifts, so nothing
// is heard to stop early -- the lift only damps what was already released.
const offsAt96 = on.filter((m) => m.at === 96 && m.what.startsWith('off '))
check('the outgoing notes are released at the change, not before', offsAt96.length > 0, true)
check('nothing is released before the lift',
      on.some((m) => m.at < lift.at && m.what.startsWith('off ')), false)

// Stopping must lift it, or the chord rings under a stopped transport.
;(() => {
  const sent = []
  const s = defaultSettings()
  s.midi.chordOutputId = 'out'
  s.accompany.enabled = false
  s.accompany.pedal = true
  const p = new Player({
    noteOn: () => true,
    noteOff: () => true,
    controlChange: (_o, _c, cc, value) => (sent.push(`cc${cc} ${value}`), true),
  }, s)
  p.setScore(parseScore('C F'))
  p.tick(0)
  sent.length = 0
  p.stopAll()
  check('stopping lifts the pedal', sent, ['cc64 0'])
})()

/* ---------------- everything else that reads a chart ---------------------- */
// A pedal mark is a token with no chord on it, which is what keeps the rest of
// the program from tripping over it. Checked rather than assumed, because every
// one of these walks the same token list for something different.

// Transposing rewrites chord tokens in place. A mark has no chord, so there is
// nothing in it to move -- and `[p]` must not come back as `[q]`.
check('transposing leaves the marks alone',
      transposeChart('[p] | C | [np] F |', 2), '[p] | D | [np] G |')
check('and a chart that is only marks does not move', transposeChart('[p] [np]', 5), '[p] [np]')

// Converting a bar-lined progression to the space-is-a-bar shorthand, which is
// what dropping one into a chart without bar lines does.
check('the shorthand keeps them', toShorthand('[p] | C | F |'), '[p] C F')

// "Shift this progression to land on D" reads the first real chord.
check('the first root looks past a mark', firstRoot('[p] | F | C |'), 5)
check('and shifting is measured from it', shiftToRoot('[p] | F | C |', 0), 7)

// Key detection and the playback loop both work off events rather than tokens,
// and a mark never becomes an event -- which is what keeps it out of both.
check('a mark is not an event', parseScore('[p]').events.length, 0)
check('nor is it an error to be counted',
      parseScore('[p] C').tokens.filter((t) => t.type === 'error').length, 0)

// Copying as plain text strips the phrase marks -- the braces and the
// articulation dot -- and nothing else. A pedal mark is part of the chart the
// way a section label is, so it travels.
check('plain-text copy carries them', stripPhraseMarks('[p] .C{walk} [np] F'), '[p] C [np] F')

console.log(failed ? `pedal: ${failed} FAILED` : 'pedal: all checks passed')
