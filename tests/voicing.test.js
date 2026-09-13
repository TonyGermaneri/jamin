let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// --- voice leading maths ---
check('delta up', signedDelta(0, 4), 4)
check('delta wraps down', signedDelta(0, 11), -1)
check('delta tritone', signedDelta(0, 6), 6)

// C major -> F major: C stays, E->F, G->A  (total movement 3)
let map = minimalMap([0, 4, 7], [5, 9, 0])
check('C->F map', [map.get(0), map.get(4), map.get(7)], [0, 1, 2])

// C major -> A minor: two common tones
map = minimalMap([0, 4, 7], [9, 0, 4])
check('C->Am common tones', [map.get(0), map.get(4), map.get(7)], [0, 0, 2])

// identity
map = minimalMap([0, 4, 7], [0, 4, 7])
check('identity', [map.get(0), map.get(4), map.get(7)], [0, 0, 0])

// different sizes still map everything
map = minimalMap([0, 4, 7], [0, 4, 7, 10, 2])
check('all sources mapped', map.size, 3)

// --- phrase remapping ---
// A C-major arpeggio moved onto F major should become an F-major arpeggio.
let phrase = [60, 64, 67, 72]           // C E G C
let out = remapPhraseNotes(phrase, [0, 4, 7], [5, 9, 0])
check('arpeggio pitch classes', out.map(n => ((n % 12) + 12) % 12).sort((a, b) => a - b), [0, 0, 5, 9])
check('stays in register', out.every(n => Math.abs(n - 66) < 14), true)
check('no note moves far', out.every((n, i) => Math.abs(n - phrase[i]) <= 6), true)

// A passing tone (D, not in C major) travels with its nearest chord tone.
out = remapPhraseNotes([60, 62, 64], [0, 4, 7], [0, 4, 7])
check('identity remap is identity', out, [60, 62, 64])

// contour survives
out = remapPhraseNotes([60, 64, 67], [0, 4, 7], [2, 5, 9])
check('contour ascending', out[0] < out[1] && out[1] < out[2], true)

check('empty phrase', remapPhraseNotes([], [0], [0]), [])
check('clampOctave low', clampOctave(20, 36, 96), 44)
check('clampOctave high', clampOctave(120, 36, 96), 96)

// --- voicings ---
let c = parseChord('C')
let v = realizeChord(c, { octave: 4, smartVoicing: false })
check('C triad notes', v.notes, [60, 64, 67])
// Chords do not carry a bass note of their own any more: there is one bass
// setting, in the phrase book, and it holds a root under everything.
check('and no bass of its own', v.bass, undefined)

v = realizeChord(parseChord('Dii'), { octave: 4, smartVoicing: false })
check('D 2nd inversion', v.notes, [69, 74, 78])

v = realizeChord(parseChord('C7'), { octave: 4, smartVoicing: false })
check('C7', v.notes, [60, 64, 67, 70])

v = realizeChord(parseChord('C/E'), { octave: 4, smartVoicing: false })
check('a slash chord voices the same', v.notes, [60, 64, 67])
check('its bass is the drone\'s business', v.bass, undefined)

// smart voicing should stay near the previous chord
const prev = realizeChord(parseChord('C'), { octave: 4, smartVoicing: false }).notes
const next = realizeChord(parseChord('F'), { octave: 4, smartVoicing: true, previousNotes: prev }).notes
check('F voiced near C', voicingDistance(prev, next) <= voicingDistance(prev, [65, 69, 72]), true)
check('F pitch classes intact', next.map(n => n % 12).sort((a, b) => a - b), [0, 5, 9])

// tall chords get thinned
v = realizeChord(parseChord('C13'), { octave: 4, smartVoicing: false, maxVoices: 4 })
check('thinned to 4', v.notes.length, 4)

console.log(failed === 0 ? 'voicing: all checks passed' : `voicing: ${failed} FAILED`)
