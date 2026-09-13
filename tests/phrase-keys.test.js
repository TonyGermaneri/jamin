// A phrase is stored in one key and played in any. These checks pin down that
// its degrees survive the journey.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
const degreesOf = (notes, rootPc) => notes.map((n) => ((n % 12) - rootPc + 12) % 12)

/* ---------------- normalising on the way in ---------------- */
const played = {
  name: 'over Fm7',
  sourceChord: 'Fm7',
  sourcePcs: parseChord('Fm7').absPcs,
  notes: [65, 68, 72, 75].map((note, i) => ({ at: i * 12, note, velocity: 90, duration: 12 })),
  lengthPulses: 48,
}

const stored = normalizePhrase(played)
check('rooted on C once stored', stored.rootPc, 0)
check('its degrees are unchanged', degreesOf(stored.notes.map((n) => n.note), 0), [0, 3, 7, 10])
check('the chord travels with it', stored.sourcePcs, [0, 3, 7, 10])
check('where it came from is remembered', stored.originalRoot, 5)
check('normalising twice changes nothing', normalizePhrase(stored), stored)
check('the register is not thrown away', stored.notes[0].note >= 55 && stored.notes[0].note <= 72, true)

// an old phrase with no rootPc is migrated from its chord symbol
const legacy = { name: 'old', sourceChord: 'Bbm7', sourcePcs: parseChord('Bbm7').absPcs, notes: [{ at: 0, note: 70, velocity: 90, duration: 12 }] }
check('legacy phrases migrate', normalizePhrase(legacy).rootPc, 0)
check('and land on the right degree', degreesOf(normalizePhrase(legacy).notes.map((n) => n.note), 0), [0])

/* ---------------- playing it in another key ---------------- */
const source = { rootPc: stored.rootPc, pcs: stored.sourcePcs }
const notes = stored.notes.map((n) => n.note)

for (const symbol of ['Cm7', 'Dm7', 'Am7', 'Bbm7', 'F#m7', 'Ebm7']) {
  const chord = parseChord(symbol)
  const out = realizePhrase(notes, source, { rootPc: chord.rootPc, pcs: chord.absPcs }, { range: [40, 96] })
  check(`degrees survive into ${symbol}`, degreesOf(out, chord.rootPc), [0, 3, 7, 10])
}

// A different shape moves as little as possible, but the root stays the root.
const shapes = {
  Dmaj7: [0, 4, 7, 11],
  D7: [0, 4, 7, 10],
  Ddim7: [0, 3, 6, 9],
  Dm: [0, 3, 7, 0],   // no 7th to land on, so the b7 takes the shortest step: to the root
}
for (const [symbol, want] of Object.entries(shapes)) {
  const chord = parseChord(symbol)
  const out = realizePhrase(notes, source, { rootPc: chord.rootPc, pcs: chord.absPcs }, { range: [40, 96] })
  check(`${symbol} keeps the root and moves the rest least`, degreesOf(out, chord.rootPc), want)
}

// Contour is never inverted by any of this.
for (const symbol of ['Dm7', 'Abm7', 'Bmaj7', 'G7']) {
  const chord = parseChord(symbol)
  const out = realizePhrase(notes, source, { rootPc: chord.rootPc, pcs: chord.absPcs }, { range: [40, 96] })
  const rising = out.every((note, i) => i === 0 || note >= out[i - 1])
  if (!rising) { failed++; console.log(`FAIL contour broken over ${symbol}: ${out}`) }
}

/* ---------------- register follows the previous chord ---------------- */
const anchorHigh = [84, 87, 91, 94]
const anchorLow = [48, 51, 55, 58]
const chordD = parseChord('Dm7')
const target = { rootPc: chordD.rootPc, pcs: chordD.absPcs }
const high = realizePhrase(notes, source, target, { anchor: anchorHigh, range: [36, 96] })
const low = realizePhrase(notes, source, target, { anchor: anchorLow, range: [36, 96] })
check('it follows an anchor upward', high[0] > low[0], true)
check('the degrees are the same either way', degreesOf(high, 2), degreesOf(low, 2))
check('high placement is near its anchor', Math.abs(high[0] - anchorHigh[0]) <= 12, true)
check('low placement is near its anchor', Math.abs(low[0] - anchorLow[0]) <= 12, true)

check('anchorOctave with no anchor leaves things alone', anchorOctave([60, 64], null, [40, 96]), [60, 64])
check('anchorOctave pulls a phrase to its anchor', anchorOctave([60, 64], [84, 88], [36, 100]), [84, 88])
check('anchorOctave respects the range', anchorOctave([60, 64], [120, 124], [36, 96]).every((n) => n <= 96), true)

/* ---------------- a lick is the same in every key ---------------- */
// Two phrases identical in shape but written in different keys must produce the
// same notes over the same target chord.
const inG = normalizePhrase({
  sourceChord: 'Gm7',
  sourcePcs: parseChord('Gm7').absPcs,
  notes: [67, 70, 74, 77].map((note, i) => ({ at: i * 12, note, velocity: 90, duration: 12 })),
})
const fromF = realizePhrase(notes, source, target, { range: [40, 96] })
const fromG = realizePhrase(inG.notes.map((n) => n.note), { rootPc: 0, pcs: inG.sourcePcs }, target, { range: [40, 96] })
check('same shape, different source key, same result', degreesOf(fromF, 2), degreesOf(fromG, 2))

/* ---------------- a two-handed phrase keeps its hands apart ---------------- */
// Left hand low, right hand a chord three octaves up: the sort of thing you get
// from a real keyboard part rather than a single-line lick.
const twoHands = normalizePhrase({
  sourceChord: 'Fm7',
  sourcePcs: parseChord('Fm7').absPcs,
  rootPc: 5,
  notes: [41, 48, 72, 75, 79].map((note, i) => ({ at: i * 6, note, velocity: 90, duration: 24 })),
})
const spread = (list) => Math.max(...list) - Math.min(...list)
const original = twoHands.notes.map((n) => n.note)

// Same shape: pure transposition, so the spread is preserved exactly.
for (const symbol of ['Dm7', 'Bbm7', 'Abm7']) {
  const chord = parseChord(symbol)
  const out = realizePhrase(original, { rootPc: 0, pcs: twoHands.sourcePcs },
    { rootPc: chord.rootPc, pcs: chord.absPcs }, { range: [28, 100] })
  check(`${symbol}: both hands survive`, out.length, 5)
  check(`${symbol}: the spread is preserved exactly`, spread(out), spread(original))
  check(`${symbol}: the left hand stays below the right`, out[0] < out[2] && out[1] < out[2], true)
  check(`${symbol}: nothing is folded into the middle`, new Set(out).size, 5)
}

// A different shape moves individual degrees a semitone, so the spread may
// change by that much -- but the hands must not collapse into each other.
const toMajor = realizePhrase(original, { rootPc: 0, pcs: twoHands.sourcePcs },
  { rootPc: 4, pcs: parseChord('Emaj7').absPcs }, { range: [28, 100] })
check('a shape change keeps the texture', Math.abs(spread(toMajor) - spread(original)) <= 2, true)
check('and the hands stay apart', toMajor[0] < toMajor[2] && toMajor[1] < toMajor[2], true)

// A narrow range must shift the block, not squash it.
const squeezed = realizePhrase(original, { rootPc: 0, pcs: twoHands.sourcePcs },
  { rootPc: 2, pcs: parseChord('Dm7').absPcs }, { range: [60, 72] })
check('a range too narrow still keeps the shape', spread(squeezed), spread(original))

// Anchoring moves the whole block.
const anchored = anchorOctave([40, 47, 71, 74], [64, 67, 71], [28, 100])
check('anchoring shifts as a block', spread(anchored), 34)


/* ---------------- snapping to chord notes ---------------- */
check('a chord tone is left alone', snapToChord([60, 64, 67], [0, 4, 7]), [60, 64, 67])
check('a passing tone moves to the nearest', snapToChord([62], [0, 4, 7]), [60])
check('upward when that is nearer', snapToChord([66], [0, 4, 7]), [67])
check('across an octave boundary', snapToChord([71], [0, 4, 7]), [72])
check('and below one', snapToChord([61], [0, 4, 7]), [60])
check('an empty chord snaps nothing', snapToChord([62], []), [62])
check('the register is kept', snapToChord([84, 86], [0, 4, 7]).every((n) => n > 80), true)

// The gap this was written for: a phrase moved between two chords of the same
// shape never reaches the mapping, so its passing tones were never snapped.
const withPassing = [60, 62, 64, 66, 67]      // C D E F# G over C major
const fromC = { rootPc: 0, pcs: parseChord('C').absPcs }
const toF = parseChord('F')
const loose = realizePhrase(withPassing, fromC, { rootPc: toF.rootPc, pcs: toF.absPcs },
  { range: [40, 96], snapNonChordTones: false })
const snapped = realizePhrase(withPassing, fromC, { rootPc: toF.rootPc, pcs: toF.absPcs },
  { range: [40, 96], snapNonChordTones: true })
const outside = (list) => list.filter((n) => !new Set(toF.absPcs).has(((n % 12) + 12) % 12)).length
check('same shape, unsnapped, keeps its passing tones', outside(loose) > 0, true)
check('same shape, snapped, has none', outside(snapped), 0)
check('snapping does not change how many notes there are', snapped.length, withPassing.length)
check('nor the contour', snapped.every((n, i) => i === 0 || n >= snapped[i - 1]), true)

// And it still works when the shape does change.
const toDm7 = parseChord('Dm7')
const across = realizePhrase(withPassing, fromC, { rootPc: toDm7.rootPc, pcs: toDm7.absPcs },
  { range: [40, 96], snapNonChordTones: true })
check('different shape, snapped, has none outside either',
  across.filter((n) => !new Set(toDm7.absPcs).has(((n % 12) + 12) % 12)).length, 0)

// Snapping is idempotent: doing it twice changes nothing.
check('snapping twice is snapping once', snapToChord(snapToChord(withPassing, [0, 4, 7]), [0, 4, 7]),
  snapToChord(withPassing, [0, 4, 7]))


console.log(failed === 0 ? 'phrase-keys: all checks passed' : `phrase-keys: ${failed} FAILED`)
