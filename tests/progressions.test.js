let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// --- transposition keeps every character it is not responsible for ---
check('up a fourth', transposeChart('D-7 G7 Cmaj7', 5), 'G-7 C7 Fmaj7')
check('no shift is a no-op', transposeChart('D-7 G7', 0), 'D-7 G7')
check('wraps past B', transposeChart('A- B- C', 3), 'C- D- D#')
check('keeps inversions', transposeChart('Dii C7iii', 2), 'Eii D7iii')
check('keeps commas and bar lines', transposeChart('F,F- C | G', 2), 'G,G- D | A')
check('keeps newlines', transposeChart('C F\nG C', 2), 'D G\nA D')
check('keeps the phrase dot and binding', transposeChart('.C7{walk} F', 2), '.D7{walk} G')
check('moves a slash bass too', transposeChart('C/E F/A', 2), 'D/F# G/B')
check('keeps extensions and alterations', transposeChart('C7b9 G7alt Cmaj7#11', 1), 'C#7b9 G#7alt C#maj7#11')
check('keeps %', transposeChart('C % F', 2), 'D % G')
check('leaves unreadable words alone', transposeChart('C Hzz F', 2), 'D Hzz G')
check('flat spelling is kept flat', transposeChart('Bb7 Eb7', 2), 'C7 F7')
check('sharp side when asked', transposeChart('C F', 1, { preferFlat: false }), 'C# F#')
check('flat side when asked', transposeChart('C F', 1, { preferFlat: true }), 'Db Gb')
check('12 semitones is identity', transposeChart('C-7 F#7', 12), 'C-7 F#7')

// transposing and back again returns the same chords
const round = transposeChart(transposeChart('D-7 G7 Cmaj7 F#-7b5', 7), 5)
check('round trip', round, 'D-7 G7 Cmaj7 F#-7b5')

// --- keys ---
check('first root', firstRoot('D-7 G7 C'), 2)
check('first root skips junk', firstRoot('Hzz G7'), 7)
check('no root at all', firstRoot('   '), null)
check('shift to a named root', shiftToRoot('D-7 G7 Cmaj7', 7), 5)
check('uses flats', usesFlats('Bb7 Eb7'), true)
check('uses sharps', usesFlats('F#7 C#7'), false)

// --- every built-in parses cleanly ---
let bad = []
for (const item of BUILTIN_PROGRESSIONS) {
  const score = parseScore(item.text, { beatsPerBar: 4 })
  const errors = score.tokens.filter((t) => t.type === 'error')
  if (errors.length) bad.push(`${item.name}: ${errors.map((e) => e.text).join(' ')}`)
}
check('built-in progressions all parse', bad, [])
check('built-ins are transposable', BUILTIN_PROGRESSIONS.every((i) => {
  const moved = transposeChart(i.text, 3)
  return parseScore(moved).tokens.filter((t) => t.type === 'error').length === 0
}), true)

// --- naming ---
check('clean name', cleanName('  ii–V–I   major  '), 'ii–V–I major')
check('unique name', uniqueProgressionName([{ name: 'Blues' }], 'Blues'), 'Blues 2')
check('unique name again', uniqueProgressionName([{ name: 'Blues' }, { name: 'Blues 2' }], 'Blues'), 'Blues 3')
check('unique name passes through', uniqueProgressionName([], 'Blues'), 'Blues')

// --- import is forgiving about shape ---
let result = parseProgressionImport('{"format":"jamin.progressions","progressions":[{"name":"A","text":"C F"}]}')
check('our own export', [result.ok, result.progressions[0].text], [true, 'C F'])

result = parseProgressionImport([{ title: 'Bare array', chords: ['D-7', 'G7', 'C'] }])
check('bare array with a chords list', [result.ok, result.progressions[0].name, result.progressions[0].text],
  [true, 'Bare array', 'D-7 G7 C'])

result = parseProgressionImport({ items: [{ label: 'X', progression: 'A- F C G', genre: 'pop' }] })
check('items + progression + genre', [result.ok, result.progressions[0].text, result.progressions[0].tags], [true, 'A- F C G', ['pop']])

result = parseProgressionImport([{ name: 'objects', chords: [{ chord: 'C' }, { chord: 'G' }] }])
check('chords as objects', result.progressions[0].text, 'C G')

result = parseProgressionImport([{ name: 'no chords anywhere' }])
check('entry with nothing usable is skipped', [result.ok, result.skipped], [false, ['no chords anywhere']])

check('not json', parseProgressionImport('nope{').ok, false)
check('json but wrong shape', parseProgressionImport('{"a":1}').ok, false)

// --- export round trip ---
const exported = exportProgressions([{ name: 'A', text: 'C F', tags: ['x'], source: 's', builtin: true }])
const back = parseProgressionImport(exported)
check('export round trip', [back.ok, back.progressions[0].name, back.progressions[0].text, back.progressions[0].tags],
  [true, 'A', 'C F', ['x']])
check('export drops the builtin flag', exported.includes('builtin'), false)

// --- enharmonic spelling follows the destination key, not the source ---
check('F is a flat key', preferFlatForRoot(5), true)
check('Bb is a flat key', preferFlatForRoot(10), true)
check('Eb is a flat key', preferFlatForRoot(3), true)
check('D is a sharp key', preferFlatForRoot(2), false)
check('E is a sharp key', preferFlatForRoot(4), false)
check('C is a sharp key', preferFlatForRoot(0), false)

// D-7 G7 Cmaj7 into F should read Bb7 / Ebmaj7, never A#7 / D#maj7.
const toF = transposeChart('D-7 G7 Cmaj7', shiftToRoot('D-7 G7 Cmaj7', 5), { preferFlat: preferFlatForRoot(5) })
check('ii-V-I into F', toF, 'F-7 Bb7 Ebmaj7')
const toE = transposeChart('D-7 G7 Cmaj7', shiftToRoot('D-7 G7 Cmaj7', 4), { preferFlat: preferFlatForRoot(4) })
check('ii-V-I into E', toE, 'E-7 A7 Dmaj7')
const toAb = transposeChart('D-7 G7 Cmaj7', shiftToRoot('D-7 G7 Cmaj7', 8), { preferFlat: preferFlatForRoot(8) })
check('ii-V-I into Ab', toAb, 'Ab-7 Db7 Gbmaj7')
check('targeting the root it is already in changes nothing', shiftToRoot('D-7 G7 Cmaj7', 2), 0)


console.log(failed === 0 ? 'progressions: all checks passed' : `progressions: ${failed} FAILED`)
