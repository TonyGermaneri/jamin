let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// --- the sharp/sus ambiguity, which is the whole risk of this dialect ---
check('s after the root is a sharp', normalizeChordonomiconChord('Fs7'), 'F#7')
check('sharp minor', normalizeChordonomiconChord('Csmin7'), 'C#min7')
check('sharp on its own', normalizeChordonomiconChord('Gs'), 'G#')
check('slash bass sharp', normalizeChordonomiconChord('A/Cs'), 'A/C#')
check('sus is not a sharp', normalizeChordonomiconChord('Csus4'), 'Csus4')
check('sus2 is not a sharp', normalizeChordonomiconChord('Asus2'), 'Asus2')
check('sus with a slash bass', normalizeChordonomiconChord('Esus4/Fs'), 'Esus4/F#')
check('sus bass is not a sharp', normalizeChordonomiconChord('Gsus2/A'), 'Gsus2/A')
check('flats are left alone', normalizeChordonomiconChord('Bbmin9'), 'Bbmin9')
check('no3d means no 3rd', normalizeChordonomiconChord('Ano3d'), 'Ano3')
check('sharp and no3d together', normalizeChordonomiconChord('Csno3d'), 'C#no3')
check('plain names pass through', normalizeChordonomiconChord('Amin7'), 'Amin7')

// --- sections become labels on their own lines ---
const song = '<intro_1> C <verse_1> F C E7 Amin <chorus_1> Fs7 Bmin A/Cs'
check('sections split into labelled lines', chordonomiconToChart(song),
  '[intro 1] C\n[verse 1] F C E7 Amin\n[chorus 1] F#7 Bmin A/C#')
check('a song with no sections still converts', chordonomiconToChart('C Amin Fs7'), 'C Amin F#7')
check('empty in, empty out', chordonomiconToChart(''), '')
check('detects the dialect', looksLikeChordonomicon(song), true)
check('does not claim plain text', looksLikeChordonomicon('D-7 G7 Cmaj7'), false)

// --- labels are decoration: they must not consume a bar ---
let score = parseScore('[verse 1] C F', { beatsPerBar: 4 })
check('label takes no time', score.totalPulses, 192)
check('label is its own token type', score.tokens[0].type, 'label')
check('label does not become an event', score.events.length, 2)
score = parseScore(chordonomiconToChart(song), { beatsPerBar: 4 })
check('converted song has no unreadable tokens', score.tokens.filter((t) => t.type === 'error').map((t) => t.text), [])
check('converted song bars', score.events.length, 8)

// --- the real vocabulary must actually parse ---
const bad = []
for (const word of CHORDONOMICON_VOCAB) {
  const chord = parseChord(normalizeChordonomiconChord(word))
  if (!chord.ok) bad.push(word)
}
// `C13b` is malformed in the source data -- a 13 chord with a dangling flat.
// It stays an error token, which is what should happen: the chart shows the
// reader that the import had a bad chord rather than quietly inventing one.
check('only the corrupt source token fails to parse', bad, ['C13b'])
check('that is under 1% of the vocabulary', bad.length / CHORDONOMICON_VOCAB.length < 0.01, true)

// spot-check that the meaning survives, not just that it parses
const meaning = (word) => parseChord(normalizeChordonomiconChord(word)).intervals.join(',')
check('Amin is a minor triad', meaning('Amin'), '0,3,7')
check('Ano3d drops the third', meaning('Ano3d'), '0,7')
check('Asus2 is sus2', meaning('Asus2'), '0,2,7')
check('Fsmin7 is a minor 7', meaning('Fsmin7'), '0,3,7,10')
check('Fsmin7 is rooted on F#', parseChord(normalizeChordonomiconChord('Fsmin7')).rootPc, 6)
check('A/Cs has a C# bass', parseChord(normalizeChordonomiconChord('A/Cs')).bassPc, 1)
check('Bminadd13', meaning('Bminadd13'), '0,3,7,21')
check('Eaug/Gb', meaning('Eaug/Gb'), '0,4,8')

// --- Hugging Face datasets-server envelope pastes straight in ---
const envelope = {
  rows: [
    { row_idx: 0, row: { id: 7, chords: '<verse_1> C Amin F G', main_genre: 'rock', decade: 1970 } },
    { row_idx: 1, row: { id: 8, chords: '<intro_1> Fs7 Bmin', main_genre: 'jazz', decade: 1960 } },
  ],
}
check('unwraps the envelope', unwrapDatasetsServer(envelope).length, 2)
check('not an envelope', unwrapDatasetsServer({ progressions: [] }), null)

let result = parseProgressionImport(JSON.stringify(envelope))
check('imports from the envelope', result.ok, true)
check('converted on the way in', result.progressions[0].text, '[verse 1] C Amin F G')
check('sharps converted', result.progressions[1].text, '[intro 1] F#7 Bmin')
check('named from its metadata', result.progressions[0].name, 'rock 1970s #7')
check('genre and decade become tags', result.progressions[0].tags, ['rock', '1970s'])

// a plain chords string that is NOT the dialect must not be mangled
result = parseProgressionImport([{ name: 'plain', chords: 'Csus4 Fsus2 G' }])
check('plain chord strings are left alone', result.progressions[0].text, 'Csus4 Fsus2 G')

console.log(failed === 0 ? 'importers: all checks passed' : `importers: ${failed} FAILED`)
