// Changing the chart without typing it.
//
// The chart is text, so every one of these is a text edit -- which means every
// one of them can be checked here, against real parses, with no browser in the
// way. @see core/chartEdit.js
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/** The token a real parse makes for the nth chord of this chart. */
function chordIn(text, nth = 0) {
  const chords = parseScore(text).tokens.filter((one) => one.type === 'chord')
  return chords[nth]
}
const edit = (text, token, fn, ...rest) => applyEdit(text, fn(text, token, ...rest))

/* ---------------- taking a chord out ---------------------------------- */
/*
 * The space after goes with it. Two spaces where there was one is what
 * actually goes wrong when something is removed from the middle of a line --
 * the parser reads the gap as an empty bar.
 */
check('a chord and the space after it',
      edit('C F G', chordIn('C F G', 1), deleteToken), 'C G')
check('the first chord of a line',
      edit('C F G', chordIn('C F G', 0), deleteToken), 'F G')

// At the end of a line there is no space after to take, so the one before goes
// instead -- otherwise the line keeps a trailing space nobody can see.
check('the last chord of a line',
      edit('C F G', chordIn('C F G', 2), deleteToken), 'C F')

/*
 * Never the bar line.
 *
 * In a barred chart a `|` is how long a bar is, and deleting a chord is not a
 * request to change that. The bar is left standing and empty.
 */
check('a bar line is not a space',
      edit('| Dm7 G7 | C |', chordIn('| Dm7 G7 | C |', 2), deleteToken),
      '| Dm7 G7 | |')
check('and the bar either side of it survives',
      parseScore(edit('| Dm7 G7 | C |', chordIn('| Dm7 G7 | C |', 2), deleteToken))
        .tokens.filter((one) => one.type === 'barline').length, 3)

// What it carried goes with it, rather than being left behind as litter.
check('a chord takes its articulation with it',
      edit('C .Dm7{walkup} G', chordIn('C .Dm7{walkup} G', 1), deleteToken), 'C G')

/* ---------------- writing a different chord --------------------------- */
/*
 * Over the body only. A chord carries the dot that marks a phrase change and
 * the articulation bound to it, and somebody changing Dm7 to G7 has not asked
 * to lose either.
 */
check('the symbol changes',
      edit('C Dm7 G', chordIn('C Dm7 G', 1), setChordSymbol, 'Abmaj7'), 'C Abmaj7 G')
check('and what it carries does not',
      edit('C .Dm7{walkup} G', chordIn('C .Dm7{walkup} G', 1), setChordSymbol, 'G7'),
      'C .G7{walkup} G')
check('nor does a repeat that opens on it',
      edit('|: Dm7 :|', chordIn('|: Dm7 :|', 0), setChordSymbol, 'G7'), '|: G7 :|')
check('writing what is already there is not an edit',
      setChordSymbol('C Dm7 G', chordIn('C Dm7 G', 1), 'Dm7'), null)

/* ---------------- articulations --------------------------------------- */
check('a chord with none gets the dot and the binding',
      edit('C Dm7 G', chordIn('C Dm7 G', 1), setArticulation, 'walkup'),
      'C .Dm7{walkup} G')
check('a chord with one has it changed',
      edit('C .Dm7{walkup} G', chordIn('C .Dm7{walkup} G', 1), setArticulation, 'comp'),
      'C .Dm7{comp} G')
check('and taking it off takes the dot too',
      edit('C .Dm7{walkup} G', chordIn('C .Dm7{walkup} G', 1), removeArticulation),
      'C Dm7 G')
check('taking one off a chord that has none is not an edit',
      removeArticulation('C Dm7 G', chordIn('C Dm7 G', 1)), null)

/* ---------------- one edit, one undo step ----------------------------- */
/*
 * Every operation is a single splice. That is what lets the editor apply it by
 * selecting the range and inserting once, which is what the browser records as
 * one undo step -- and what stops it setting `value`, which throws the whole
 * undo stack away.
 */
for (const [what, made] of [
  ['delete', deleteToken('C Dm7 G', chordIn('C Dm7 G', 1))],
  ['retype', setChordSymbol('C Dm7 G', chordIn('C Dm7 G', 1), 'G7')],
  ['bind', setArticulation('C Dm7 G', chordIn('C Dm7 G', 1), 'walkup')],
  ['unbind', removeArticulation('C .Dm7{x} G', chordIn('C .Dm7{x} G', 1))],
]) {
  check(`${what} is one splice`,
        [typeof made.from, typeof made.to, typeof made.text],
        ['number', 'number', 'string'])
  check(`${what} leaves the caret somewhere real`, caretAfter(made) >= made.from, true)
}

/* ---------------- putting something in -------------------------------- */
check('between two chords', applyEdit('C G', insertAt('C G', 2, 'Dm7')), 'C Dm7 G')
check('at the very start', applyEdit('C G', insertAt('C G', 0, 'Dm7')), 'Dm7 C G')
check('at the very end', applyEdit('C G', insertAt('C G', 3, 'Dm7')), 'C G Dm7')
// Where there is already a space, one is enough.
check('no doubled space', applyEdit('C  G', insertAt('C  G', 2, 'Dm7')), 'C Dm7 G')
check('nothing to insert is not an edit', insertAt('C G', 1, '  '), null)

/* ---------------- a drum mark ----------------------------------------- */
const drumChart = 'C [d:funk 138] G'
const drumToken = parseScore(drumChart).tokens.find((one) => one.type === 'drum')
check('the pattern changes',
      applyEdit(drumChart, setDrumPattern(drumChart, drumToken, 'rock 90')),
      'C [d:rock 90] G')
check('and it can be taken out',
      applyEdit(drumChart, deleteToken(drumChart, drumToken)), 'C G')

/* ---------------- the picker only offers what jamin can play ---------- */
/*
 * The reason this file knows about the picker at all.
 *
 * The wheel and the colouring tables are written by hand, and a hand-written
 * table of chord symbols drifts from the parser the moment either changes. A
 * picker that writes an unparseable chord into somebody's chart is worse than
 * having no picker, so every combination it can produce is parsed here.
 */
let offered = 0
for (const place of WHEEL) {
  for (const name of place.names) {
    for (const page of QUALITIES) {
      for (const cell of page) {
        if (cell.more || cell.back) continue
        const symbol = chordSymbol(name, cell.write)
        const read = parseChord(symbol)
        offered++
        if (!read.ok) { failed++; console.log(`FAIL the picker offers ${symbol}, which does not parse`) }
        // And it is the note that was clicked, not some other one.
        else if (read.rootPc !== place.pc) {
          failed++
          console.log(`FAIL ${symbol} reads as pitch class ${read.rootPc}, not ${place.pc}`)
        }
      }
    }
  }
}
check('every root has a name', WHEEL.every((one) => one.names.length >= 1), true)
check('all twelve of them', new Set(WHEEL.map((one) => one.pc)).size, 12)
check('four across and five down, twice', QUALITIES.map((one) => one.length), [20, 20])
// The way on and the way back, so neither page is a dead end.
check('the first page opens the second', QUALITIES[0].filter((one) => one.more).length, 1)
check('and the second comes back', QUALITIES[1].filter((one) => one.back).length, 1)
console.log(`  (${offered} chord symbols offered, all of them parse)`)

/*
 * And the marks, which the chart has to accept even though most are not chords.
 *
 * `N.C.` is the exception and is worth stating rather than working around: the
 * parser does read it, as a chord with no root -- which is exactly what "no
 * chord" is. What matters for all of them is the same thing either way: put
 * one in a chart and the parser does not call it an error.
 */
for (const mark of MARKS) {
  const chart = `C ${mark.write} G`
  const said = parseScore(chart).tokens.filter((one) => one.type === 'error')
  check(`${mark.show} is something a chart can hold`, said.length, 0)
}
check('only N.C. is a chord among them',
      MARKS.filter((one) => parseChord(one.write).ok).map((one) => one.write), ['N.C.'])
check('and it is the rootless one',
      parseChord('N.C.').rootPc, null)

console.log(failed ? `chart-edit: ${failed} FAILED` : 'chart-edit: all checks passed')
