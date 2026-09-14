// A collection names itself. These checks pin down what a phrase's own name is
// allowed to say about it -- and, just as much, what it is not.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

const of = (name, sourceChord) => phraseCategory({ name, sourceChord })
const keyOf = (sourceChord) => phraseKey({ sourceChord })

/* ---------------- the shape POP909 uses, which is the whole point ---------- */
check('a chord, a category and a number', of('F# comp 19', 'F#'), 'comp')
check('busy', of('C busy 5', 'C'), 'busy')
check('pad', of('C pad 1', 'C'), 'pad')
check('a minor chord is still a prefix', of('Cm comp 1', 'Cm'), 'comp')
check('so is a suspension', of('Gsus4 pad 2', 'Gsus4'), 'pad')
check('so is a seventh', of('F#maj7 busy 12', 'F#maj7'), 'busy')

// sanitizeName replaces every space with a hyphen on the way into the book, so
// the same name arrives in two spellings and both have to read the same.
check('hyphens read as spaces', of('F#-comp-19', 'F#'), 'comp')
check('underscores too', of('F#_comp_19', 'F#'), 'comp')

/* ---------------- more than one word, and no number ------------------------ */
check('several words survive', of('C minor pentatonic', 'C'), 'minor pentatonic')
check('a missing number is fine', of('C lydian', 'C'), 'lydian')
check('case is not a category', of('C Comp 3', 'C'), 'comp')

/* ---------------- what must NOT be read as a category ---------------------- */
// Both of these are real names in the shipped vocabulary. A looser rule -- take
// the first word, or anything that looks like a pitch -- invents a category for
// each of them, and the dropdown fills up with one-entry categories.
check('a name that is not this shape says nothing', of('Major 2-5', 'Dm7'), '')
check('nor does a label of its own', of('dominant-altered', 'C7'), '')
check('a chord that only looks like a prefix', of('Cm7 blues', 'C'), '')
check('the chord alone is not a category', of('C', 'C'), '')
check('no chord, no claim', of('C comp 19', ''), '')
check('no name, no claim', of('', 'C'), '')

// The chord symbol goes into a regular expression. One containing a character
// with a meaning of its own must not change what is matched.
check('a chord with a bracket in it is literal', of('C(add9) comp 2', 'C(add9)'), 'comp')
check('and does not match something else', of('Cxadd9y comp 2', 'C(add9)'), '')

/* ---------------- the key, as its own chord spells it ---------------------- */
check('a plain root', keyOf('C'), 'C')
check('a sharp root', keyOf('F#maj7'), 'F#')
check('a flat root stays flat', keyOf('Bb7'), 'Bb')
check('quality is not part of the key', keyOf('Em'), 'E')
check('nor is a slash bass', keyOf('G/B'), 'G')
check('nothing to read', keyOf(''), '')
check('not a chord at all', keyOf('lick'), '')

/* ---------------- one key, however it is spelled -------------------------- */
// The two shipped collections disagree: POP909 writes every black note sharp,
// Impro-Visor writes most of them flat. They are the same twelve keys.
check('sharps', keyPitchClass('F#'), 6)
check('and their flats are the same key', keyPitchClass('Gb'), 6)
check('Ab is G#', keyPitchClass('Ab'), keyPitchClass('G#'))
check('naturals', keyPitchClass('C'), 0)
check('B is eleven', keyPitchClass('B'), 11)
check('not a key', keyPitchClass('H'), null)
check('nothing is not a key', keyPitchClass(''), null)

console.log(failed ? `phrase-names: ${failed} FAILED` : 'phrase-names: all checks passed')
