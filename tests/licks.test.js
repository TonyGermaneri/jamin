let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// Entries shaped exactly as scripts/build_licks.py emits them.
const RAW = [
  { n: 'blues', k: 'cell', c: 'Ab7', d: 72, v: [[0, 71, 24], [24, 68, 12], [36, 66, 12], [48, 63, 12]] },
  { n: 'dominant Cycle', k: 'lick', c: 'C7', d: 96, v: [[0, 62, 12], [12, 65, 12], [24, 69, 12]] },
  { n: 'minor Bill Evans', k: 'idiom', c: 'Dm7', d: 96, v: [[0, 69, 12], [12, 65, 12]] },
  { n: 'major', k: 'cell', c: 'CM7', d: 48, v: [[0, 60, 24], [24, 64, 24]] },
  { n: 'broken', k: 'cell', c: 'Hzz', d: 48, v: [[0, 60, 24]] },
]

const licks = RAW.map(entryToPhrase).filter(Boolean)
check('unreadable chord contexts are dropped', licks.length, 4)
check('ids are stable and text safe', licks.map(l => l.id), ['iv0', 'iv1', 'iv2', 'iv3'])
check('notes become phrase notes', licks[0].notes[0], { at: 0, note: 71, velocity: 90, duration: 24 })
check('length carried through', licks[0].lengthPulses, 72)
check('source chord kept', licks[0].sourceChord, 'Ab7')
check('source pitch classes are absolute', licks[0].sourcePcs, [0, 3, 6, 8])   // C Eb Gb Ab
check('quality is root-relative', licks[0].quality, '0,4,7,10')
check('marked as built in', licks[0].builtin, true)

// --- matching is by shape, not by root ---
const dominant = licksForChord(licks, parseChord('G7'))
check('a C7 lick fits G7', dominant.map(l => l.name).sort(), ['blues', 'dominant Cycle'])
check('an Ab7 lick fits G7 too', dominant.some(l => l.sourceChord === 'Ab7'), true)
check('a minor 7 lick does not', dominant.some(l => l.sourceChord === 'Dm7'), false)
check('minor 7 matches minor 7', licksForChord(licks, parseChord('Am7')).map(l => l.name), ['minor Bill Evans'])
check('major 7 matches major 7', licksForChord(licks, parseChord('Fmaj7')).map(l => l.name), ['major'])
check('a triad matches nothing here', licksForChord(licks, parseChord('C')).length, 0)
check('no chord matches nothing', licksForChord(licks, parseChord('N.C.')).length, 0)

// --- search ---
check('search by name', searchLicks(licks, 'bill').map(l => l.name), ['minor Bill Evans'])
check('search by chord symbol', searchLicks(licks, 'ab7').map(l => l.name), ['blues'])
check('search by kind', searchLicks(licks, 'idiom').map(l => l.name), ['minor Bill Evans'])
check('empty search returns everything', searchLicks(licks, '').length, 4)

check('described', describeLick(licks[0]), 'cell · over Ab7 · 4 notes · 8 semitones · 3 beats')

// --- a lick must survive being re-pointed at another chord ---
const moved = remapPhraseNotes(licks[0].notes.map(n => n.note), licks[0].sourcePcs, parseChord('G7').absPcs, {
  keepRegister: true, snapNonChordTones: false, range: [48, 88],
})
check('every note moved', moved.length, 4)
check('it stayed in register', moved.every((n, i) => Math.abs(n - licks[0].notes[i].note) <= 6), true)
check('contour survived', moved[0] > moved[1] && moved[1] > moved[2] && moved[2] > moved[3], true)

console.log(failed === 0 ? 'licks: all checks passed' : `licks: ${failed} FAILED`)
