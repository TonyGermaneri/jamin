// What goes on the clipboard: a chart anyone can read, with the phrase marks
// off. jamin's own copy of the text travels beside it under its own type.
let failed = 0
function check(label, got, want) {
  if (got !== want) { failed++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }
}
check('a bound chord loses its mark', stripPhraseMarks('.C7{walk} F G'), 'C7 F G')
check('a bare dot goes too', stripPhraseMarks('.C{riff} F .G A'), 'C F G A')
check('a no-chord bar keeps its dots', stripPhraseMarks('C N.C. F'), 'C N.C. F')
check('bar lines survive', stripPhraseMarks('| .Dm7{a} G7 | Cmaj7 |'), '| Dm7 G7 | Cmaj7 |')
check('repeats survive', stripPhraseMarks(':.C7{walk} F:2'), ':C7 F:2')
check('several lines', stripPhraseMarks('.C{a} F\n.G{b} Am'), 'C F\nG Am')
check('nothing to strip', stripPhraseMarks('Cmaj7 A-7'), 'Cmaj7 A-7')
check('empty', stripPhraseMarks(''), '')
check('null is survivable', stripPhraseMarks(null), '')
check('a slash chord keeps its slash', stripPhraseMarks('.Abmaj7/C{x} G'), 'Abmaj7/C G')
console.log(failed === 0 ? 'clipboard: all checks passed' : `clipboard: ${failed} FAILED`)
