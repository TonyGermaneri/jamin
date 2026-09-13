let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// --- durations, in pulses (24 per quarter, 96 per whole) ---
check('whole', durationPulses('1', 0), 96)
check('half', durationPulses('2', 0), 48)
check('quarter', durationPulses('4', 0), 24)
check('eighth', durationPulses('8', 0), 12)
check('sixteenth', durationPulses('16', 0), 6)
check('thirty-second', durationPulses('32', 0), 3)
check('dotted quarter', durationPulses('4.', 0), 36)
check('eighth triplet', durationPulses('8/3', 0), 8)
check('quarter triplet', durationPulses('4/3', 0), 16)
check('half triplet', durationPulses('2/3', 0), 32)
// D notes in the time of the nearest lower power of two: 5 sixteenths in 4
check('sixteenth quintuplet', durationPulses('16/5', 0), 4.8)
check('tied quarter and eighth', durationPulses('4+8', 0), 36)
check('three tied eighths', durationPulses('8+8+8', 0), 36)
check('mixed tie', durationPulses('2/3+16/3', 0), 36)
check('an empty duration repeats the last', durationPulses('', 17), 17)
check('nonsense is rejected', durationPulses('e8', 12), null)

// --- pitches: `c` is middle C ---
check('middle C', pitchToMidi('c'), 60)
check('B below', pitchToMidi('b'), 71)
check('B flat', pitchToMidi('bb'), 70)
check('F sharp', pitchToMidi('f#'), 66)
check('octave up', pitchToMidi('c+'), 72)
check('two octaves up', pitchToMidi('c++'), 84)
check('octave down', pitchToMidi('c-'), 48)
check('flat an octave up', pitchToMidi('ab+'), 80)
check('double flat', pitchToMidi('ebb'), 62)
check('not a pitch', pitchToMidi('r'), null)
check('not a pitch either', pitchToMidi('h'), null)

// --- note runs ---
let read = readNotes('b4 ab8 gb8 eb8')
check('the worked example', read.events, [[0, 71, 24], [24, 68, 12], [36, 66, 12], [48, 63, 12]])
check('its total', read.total, 60)
read = readNotes('r8 c8 d8')
check('rests take time but make no note', read.events, [[12, 60, 12], [24, 62, 12]])
check('rests count toward the total', read.total, 36)
read = readNotes('c8 d e')
check('durations carry over', read.events, [[0, 60, 12], [12, 62, 12], [24, 64, 12]])
check('a typo is rejected rather than guessed', readNotes('bb8 g8 be8 d8'), null)
check('all rests is nothing at all', readNotes('r4 r4'), null)

// --- whole entries ---
const VOC = `
(lick (notes d8 f8 a8 e8) (sequence G7 C7 |) (name dominant Cycle))
(lick (notes c8 e8 g8) (sequence C7 C7 |) (name one chord twice))
(cell (notes b4 ab8 gb8 eb8) (name blues) (chords Ab7))
(idiom (notes f#+8/3 g+8/3 g#+8/3) (chords G7) (name dominant))
(quote (notes g2/3 f8/3) (sequence Eb Fm7 |) (name mixed))
(cell (notes bb8 g8 be8 d8) (name broken) (chords Cm7))
(cell (name no notes at all) (chords Cm7))
(scale (name C major) (spell c d e f g a b c))
`
const parsed = parseVocabulary(VOC)
check('only single-chord entries are kept', parsed.entries.map(e => e.n),
  ['one chord twice', 'blues', 'dominant'])
check('a sequence of one repeated chord counts as single', parsed.entries[0].c, 'C7')
check('kinds are recorded', parsed.entries.map(e => e.k), ['lick', 'cell', 'idiom'])
check('skip tally', parsed.skipped, { multiChord: 2, unreadable: 1, noNotes: 1 })
check('scales are not licks', parsed.entries.some(e => e.n === 'C major'), false)
check('length rounds up to a beat', parsed.entries[1].d, 72)
check('a short entry still gets a beat', parseVocabulary('(cell (notes c16) (chords C7))').entries[0].d, 24)
check('notes survive', parsed.entries[1].v, [[0, 71, 24], [24, 68, 12], [36, 66, 12], [48, 63, 12]])
check('names are collapsed and trimmed', parseVocabulary('(cell (notes c4) (name  a   b ) (chords C7))').entries[0].n, 'a b')

// nesting must not confuse the scanner
const nested = parseVocabulary('(cell (notes c4) (name x) (chords C7))\n(cell (notes d4) (name y) (chords C7))')
check('two entries read back', nested.entries.map(e => e.n), ['x', 'y'])

console.log(failed === 0 ? 'voc: all checks passed' : `voc: ${failed} FAILED`)
