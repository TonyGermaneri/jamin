// Pure-logic checks for the chord parser. Run with:  npm run test:chords
const cases = [
  ['C',        [0, 4, 7],                 0],
  ['A-',       [0, 3, 7],                 0],
  ['Amin',     [0, 3, 7],                 0],
  ['Aminor',   [0, 3, 7],                 0],
  ['Amaj',     [0, 4, 7],                 0],
  ['Amajor',   [0, 4, 7],                 0],
  ['Am',       [0, 3, 7],                 0],
  ['AM',       [0, 4, 7],                 0],
  ['B5',       [0, 7],                    0],
  ['C3',       [0, 4],                    0],
  ['Cm3',      [0, 3],                    0],
  ['Dii',      [0, 4, 7],                 2],
  ['Di',       [0, 4, 7],                 1],
  ['Diii',     [0, 4, 7],                 3],
  ['C7ii',     [0, 4, 7, 10],             2],
  ['Cmi',      [0, 3, 7],                 0],
  ['Cmii',     [0, 3, 7],                 2],
  ['Cmini',    [0, 3, 7],                 1],
  ['C-i',      [0, 3, 7],                 1],
  ['Cmaj7',    [0, 4, 7, 11],             0],
  ['CM7',      [0, 4, 7, 11],             0],
  ['C^7',      [0, 4, 7, 11],             0],
  ['CΔ7',      [0, 4, 7, 11],             0],
  ['C7',       [0, 4, 7, 10],             0],
  ['C9',       [0, 4, 7, 10, 14],         0],
  ['C11',      [0, 7, 10, 14, 17],        0],
  ['Cm11',     [0, 3, 7, 10, 14, 17],     0],
  ['C13',      [0, 4, 7, 10, 14, 21],     0],
  ['C6',       [0, 4, 7, 9],              0],
  ['C69',      [0, 4, 7, 9, 14],          0],
  ['C6/9',     [0, 4, 7, 9, 14],          0],
  ['Csus4',    [0, 5, 7],                 0],
  ['Csus2',    [0, 2, 7],                 0],
  ['C7sus4',   [0, 5, 7, 10],             0],
  ['Cdim',     [0, 3, 6],                 0],
  ['Cdim7',    [0, 3, 6, 9],              0],
  ['Co7',      [0, 3, 6, 9],              0],
  ['Cm7b5',    [0, 3, 6, 10],             0],
  ['Cø7',      [0, 3, 6, 10],             0],
  ['Caug',     [0, 4, 8],                 0],
  ['C+',       [0, 4, 8],                 0],
  ['C7b9',     [0, 4, 7, 10, 13],         0],
  ['C7#9',     [0, 4, 7, 10, 15],         0],
  ['C7#11',    [0, 4, 7, 10, 18],         0],
  ['C7b13',    [0, 4, 7, 10, 20],         0],
  ['C7alt',    [0, 4, 10, 13, 15, 18, 20],0],
  ['Cadd9',    [0, 4, 7, 14],             0],
  ['Cmmaj7',   [0, 3, 7, 11],             0],
  ['C-maj7',   [0, 3, 7, 11],             0],
  ['Cno5',     [0, 4],                    0],
  ['Bb',       [0, 4, 7],                 0],
  ['B(b5)',    [0, 4, 6],                 0],
  ['Gm',       [0, 3, 7],                 0],
]

let failed = 0
for (const [text, intervals, inversion] of cases) {
  const chord = parseChord(text)
  const got = chord.ok ? chord.intervals.join(',') : 'ERR:' + chord.error
  const want = intervals.join(',')
  const invOk = chord.ok && chord.inversion === inversion
  if (got !== want || !invOk) {
    failed++
    console.log(`FAIL ${text}: got [${got}] inv=${chord.inversion} want [${want}] inv=${inversion}`)
  }
}

const roots = [['C', 0], ['C#', 1], ['Db', 1], ['Bb', 10], ['E', 4], ['Fb', 4], ['B#', 0], ['g', 7]]
for (const [text, pc] of roots) {
  const chord = parseChord(text)
  if (!chord.ok || chord.rootPc !== pc) { failed++; console.log(`FAIL root ${text}: ${chord.rootPc} != ${pc}`) }
}

const slash = parseChord('C/E')
if (slash.bassPc !== 4) { failed++; console.log('FAIL slash bass', slash.bassPc) }
const bad = parseChord('Hzz')
if (bad.ok) { failed++; console.log('FAIL expected parse failure for Hzz') }

console.log(failed === 0 ? `chords: all ${cases.length + roots.length + 2} checks passed` : `chords: ${failed} FAILED`)
