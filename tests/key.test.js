let failed = 0
function check(label, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }
}
const keyOf = (text) => {
  const found = detectKey(parseScore(text, { beatsPerBar: 4 }))
  return found ? found.name : null
}

check('ii-V-I in C', keyOf('D-7 G7 Cmaj7 Cmaj7'), 'C')
check('ii-V-I in F', keyOf('G-7 C7 Fmaj7 Fmaj7'), 'F')
check('ii-V-I in Eb', keyOf('F-7 Bb7 Ebmaj7 Ebmaj7'), 'Eb')
check('ii-V-I in A', keyOf('B-7 E7 Amaj7 Amaj7'), 'A')
check('12-bar blues in C', keyOf('C7 F7 C7 C7 F7 F7 C7 C7 G7 F7 C7 G7'), 'C')
check('12-bar blues in Bb', keyOf('Bb7 Eb7 Bb7 Bb7 Eb7 Eb7 Bb7 Bb7 F7 Eb7 Bb7 F7'), 'Bb')
check('Andalusian cadence is minor', keyOf('A- G F E7 A- G F E7'), 'Am')
check('minor ii-V-i', keyOf('D-7b5 G7b9 C-maj7 C-maj7'), 'Cm')
check('pop I-V-vi-IV', keyOf('C G A- F'), 'C')
check('the same shape in G', keyOf('G D E- C'), 'G')
check('So What is D dorian, read as its relative', keyOf('D-7 D-7 D-7 D-7'), 'Dm')
check('a single major chord', keyOf('C'), 'C')

// Confidence, and the edges
const clear = detectKey(parseScore('D-7 G7 Cmaj7 Cmaj7', { beatsPerBar: 4 }))
const murky = detectKey(parseScore('C7 Db7 D7 Eb7 E7 F7 Gb7 G7 Ab7 A7 Bb7 B7', { beatsPerBar: 4 }))
check('a cadence is more confident than a chromatic climb', clear.confidence > murky.confidence, true)
check('confidence stays in range', clear.confidence >= 0 && clear.confidence <= 1, true)

check('an empty chart has no key', detectKey(parseScore('')), null)
check('a chart of nothing but rests has no key', detectKey(parseScore('N.C. N.C.', { beatsPerBar: 4 })), null)
check('unreadable chords do not crash it', typeof keyOf('Hzz Zzz C'), 'string')

// Spelling follows the key
check('F major is spelled flat', preferFlatKey(5, 'major'), true)
check('D major is spelled sharp', preferFlatKey(2, 'major'), false)
check('D minor follows F major', preferFlatKey(2, 'minor'), true)
check('B minor follows D major', preferFlatKey(11, 'minor'), false)

console.log(failed === 0 ? 'key: all checks passed' : `key: ${failed} FAILED`)
