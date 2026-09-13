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

/* ---------------- alternative spellings ---------------- */
function spelled(label, text, wantIntervals, wantRoot) {
  const chord = parseChord(text)
  const got = chord.ok ? chord.intervals.join(',') : 'ERR:' + chord.error
  if (got !== wantIntervals.join(',') || (wantRoot !== undefined && chord.rootPc !== wantRoot)) {
    failed++
    console.log(`FAIL ${label} (${text}): got [${got}] root=${chord.rootPc} want [${wantIntervals}] root=${wantRoot}`)
  }
}

// `s` as a sharp, and the one place it could be misread
spelled('s is a sharp', 'Fs', [0, 4, 7], 6)
spelled('s with a suffix', 'Fs7', [0, 4, 7, 10], 6)
spelled('s and min', 'Csmin7', [0, 3, 7, 10], 1)
spelled('As5 is A# with no third', 'As5', [0, 7], 10)
spelled('A#5 spelled with a hash', 'A#5', [0, 7], 10)
spelled('sus is not a sharp', 'Fsus4', [0, 5, 7], 5)
spelled('sus2 is not a sharp', 'Asus2', [0, 2, 7], 9)
spelled('bare sus is sus4', 'Csus', [0, 5, 7], 0)
spelled('sharp then sus', 'Cssus4', [0, 5, 7], 1)
spelled('hash then sus', 'C#sus4', [0, 5, 7], 1)
spelled('uppercase S', 'FS7', [0, 4, 7, 10], 6)
spelled('s does not eat a minor', 'Gsmin', [0, 3, 7], 8)
if (parseChord('A/Cs').bassPc !== 1) { failed++; console.log('FAIL s in a slash bass') }
if (parseChord('Esus4/Fs').bassPc !== 6) { failed++; console.log('FAIL sus with a sharp bass') }
if (parseChord('Gsus2/A').bassPc !== 9) { failed++; console.log('FAIL sus bass left alone') }

// the sus family means exactly what it says
spelled('sus', 'Gsus', [0, 5, 7], 7)
spelled('sus2', 'Gsus2', [0, 2, 7], 7)
spelled('sus4', 'Gsus4', [0, 5, 7], 7)
spelled('7sus4', 'G7sus4', [0, 5, 7, 10], 7)

// Chordonomicon's "no 3rd"
spelled('no3d', 'Ano3d', [0, 7], 9)
spelled('no3', 'Ano3', [0, 7], 9)

// Harte notation
spelled('harte major', 'C:maj', [0, 4, 7], 0)
spelled('harte minor', 'C:min', [0, 3, 7], 0)
spelled('harte dominant', 'C:7', [0, 4, 7, 10], 0)
spelled('harte major 7', 'C:maj7', [0, 4, 7, 11], 0)
spelled('harte minor 7', 'C:min7', [0, 3, 7, 10], 0)
spelled('harte half diminished', 'C:hdim7', [0, 3, 6, 10], 0)
spelled('harte diminished 7', 'C:dim7', [0, 3, 6, 9], 0)
spelled('harte minor major 7', 'C:minmaj7', [0, 3, 7, 11], 0)
spelled('harte major 6', 'C:maj6', [0, 4, 7, 9], 0)
spelled('harte minor 6', 'C:min6', [0, 3, 7, 9], 0)
spelled('harte ninth', 'C:9', [0, 4, 7, 10, 14], 0)
spelled('harte major ninth', 'C:maj9', [0, 4, 7, 11, 14], 0)
spelled('harte sus2', 'C:sus2', [0, 2, 7], 0)
spelled('harte sus4', 'C:sus4', [0, 5, 7], 0)
spelled('harte root only', 'C:1', [0], 0)
spelled('harte power chord', 'C:5', [0, 7], 0)
// parenthesised degrees are additions, not extensions
spelled('harte added ninth', 'C:maj(9)', [0, 4, 7, 14], 0)
spelled('harte altered ninth', 'C:7(#9)', [0, 4, 7, 10, 15], 0)
spelled('harte omission', 'C:maj(*5)', [0, 4], 0)
spelled('harte sus4 with a flat seven', 'C:sus4(b7)', [0, 5, 7, 10], 0)
// degree basses, Harte only
if (parseChord('C:maj/5').bassPc !== 7) { failed++; console.log('FAIL harte degree bass') }
if (parseChord('C:7/b7').bassPc !== 10) { failed++; console.log('FAIL harte flat degree bass') }
if (parseChord('C:maj/E').bassPc !== 4) { failed++; console.log('FAIL harte note-name bass') }

// no chord
for (const word of ['N', 'NC', 'N.C.', 'n.c.']) {
  const chord = parseChord(word)
  if (!chord.ok || !chord.silent || chord.intervals.length) {
    failed++
    console.log(`FAIL no-chord ${word}`)
  }
}

/* ---------------- the ambiguities, pinned down ---------------- */
// An accidental always belongs to the root.
spelled('Bb5 is a B-flat power chord', 'Bb5', [0, 7], 10)
spelled('B(b5) is B with a flat fifth', 'B(b5)', [0, 4, 6], 11)
// Six-nine is a chord, not a degree bass.
spelled('C6/9 is six-nine', 'C6/9', [0, 4, 7, 9, 14], 0)
if (parseChord('C6/9').bassPc !== null) { failed++; console.log('FAIL C6/9 grew a bass note') }
// `mi` is minor; use `-i` or `mini` for the inversion.
if (parseChord('Cmi').inversion !== 0) { failed++; console.log('FAIL Cmi is minor') }
if (parseChord('Cmini').inversion !== 1) { failed++; console.log('FAIL Cmini is an inversion') }
// A plain `(9)` without Harte's colon keeps its old meaning.
spelled('paren nine without a colon', 'C(9)', [0, 4, 7, 10, 14], 0)


console.log(failed === 0 ? 'chords: all checks passed' : `chords: ${failed} FAILED`)
