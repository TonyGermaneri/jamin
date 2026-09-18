// Which note map a pile of drum MIDI was written for.
//
// Deterministic, and deliberately about the *core kit* rather than the whole
// histogram. Measured across 760 packs and three quarters of a million files,
// almost everything is General MIDI where it counts and vendor-specific
// everywhere else: a sixties drummer library puts its kick on 36, its snare on
// 38 and its hats on 42 exactly as the standard says, then hangs its own
// articulations off 92 and 97 where the standard has nothing. Judging such a
// pack by its full range calls it unknown; judging it by its kick and snare
// calls it what it is.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- an ordinary General MIDI kit -------------------------- */
const rock = { 36: 400, 38: 380, 42: 900, 46: 60, 49: 20, 51: 100, 47: 30, 50: 20 }
check('a plain kit is General MIDI', classifyKit(rock).kit, 'gm')
check('and it can play nearly all of it', classifyKit(rock).coverage > 0.9, true)

/* ---------------- a vendor library with its own extras ------------------ */
// The real shape of most of the collection: General MIDI at the core with
// articulations hung off notes the standard never defined. It is still a
// General MIDI kit and calling it unknown would help nobody.
const sixties = { 38: 134, 36: 129, 42: 100, 51: 88, 97: 74, 44: 61, 92: 49, 60: 48, 31: 47, 43: 43 }
check('a vendor library is still General MIDI', classifyKit(sixties).kit, 'gm')
check('and says so', classifyKit(sixties).reason.includes('General MIDI'), true)
// But it is honest about how much of it we can play.
check('while admitting what it cannot play', classifyKit(sixties).coverage < 0.85, true)

/* ---------------- a Roland kit ------------------------------------------ */
// Two things together, never one. The hi-hat edges *and* toms where Roland
// puts them: 48 and 45 rather than 50 and 47.
const roland = { 36: 300, 38: 280, 42: 500, 22: 400, 26: 90, 44: 200, 48: 60, 45: 40, 43: 30, 51: 90 }
check('the edges plus Roland toms is a Roland kit', classifyKit(roland).kit, 'vdrums')
check('and nothing is translated for it', classifyKit(roland).coverage > 0.9, true)

// The trap. Plenty of vendors use 22 and 26 for the hi-hat edge and are
// otherwise General MIDI -- 66,101 files in the collection do exactly that.
// Calling them Roland would move every tom on every one of them.
const edgesButGmToms = { 36: 300, 38: 280, 42: 500, 22: 120, 26: 40, 50: 80, 47: 60, 43: 30 }
check('hat edges alone are not a Roland kit', classifyKit(edgesButGmToms).kit, 'gm')

/* ---------------- hand percussion --------------------------------------- */
/*
 * Congas, bongos and agogo, living between 60 and 81 -- and General MIDI reads
 * every one of them.
 *
 * This test has asserted three different states of the world. First that a
 * percussion pack came back "General MIDI" with a coverage of nothing, which
 * was true and useless. Then that it came back with a poor coverage honestly
 * reported, which was the best that could be done while the vocabulary had
 * fourteen drum-kit voices and no conga.
 *
 * Now the vocabulary carries the whole of General MIDI percussion, so the
 * answer is simply right: these files are General MIDI, all of it is readable,
 * and the classifier can say so without hedging. Counted over the real
 * collection, this is 14.6% of every note that used to be dropped in silence.
 * @see core/drumKits.js DRUM_VOICES
 */
const congas = { 61: 300, 62: 200, 63: 180, 64: 150, 67: 90, 68: 60 }
check('hand percussion is General MIDI', classifyKit(congas).kit, 'gm')
check('and every note of it can be played', classifyKit(congas).coverage, 1)
check('and it says so without hedging', classifyKit(congas).confidence, 1)
check('and gives the reason', /percussion/.test(classifyKit(congas).reason), true)

// A kit that mostly can be read is still named. Most drum MIDI really is
// General MIDI, and saying so is not the same fault in reverse.
const mostlyGm = { 36: 400, 38: 380, 42: 600, 46: 90, 50: 40, 47: 30, 43: 25, 61: 20 }
check('a pack General MIDI can read is General MIDI', classifyKit(mostlyGm).kit, 'gm')
check('all of which it can play', classifyKit(mostlyGm).coverage, 1)

/* ---------------- and things it will not name --------------------------- */
// A pad map with nothing where a kit belongs. Still given one, because a
// library with no map is a library whose notes move whenever the track's drum
// instrument changes -- and the selector is right there to correct it.
const pads = { 5: 300, 6: 200, 10: 100, 116: 80, 97: 60 }
check('a pad map is still given a map', Boolean(classifyKit(pads).kit), true)
check('and it says why', classifyKit(pads).reason.includes('standard kit'), true)
check('and admits it reads almost none of it', classifyKit(pads).coverage < 0.2, true)

check('nothing at all is survivable', classifyKit({}).kit, 'gm')
check('and honest about it', classifyKit({}).confidence, 0)
check('so is rubbish', classifyKit(null).coverage, 0)

/* ---------------- the verdict is stable --------------------------------- */
// Deterministic means the same histogram always gives the same answer, and
// scale does not change it -- a pack sampled at thirty files and at three
// hundred must be called the same thing.
const scaled = Object.fromEntries(Object.entries(rock).map(([k, v]) => [k, v * 37]))
check('ten times the sample is the same verdict', classifyKit(scaled).kit, classifyKit(rock).kit)
check('and the same coverage',
      Math.round(classifyKit(scaled).coverage * 1000), Math.round(classifyKit(rock).coverage * 1000))

/* ---------------- and never nothing -------------------------------------
 *
 * The invariant the whole thing rests on. A library with no map is a library
 * whose notes move whenever somebody changes the track's drum instrument, which
 * is a fact about the track being used to answer a question about the files.
 */
for (const shape of [rock, sixties, roland, congas, pads, mostlyGm, {}, null])
  check('every verdict names a kit', Boolean(classifyKit(shape).kit), true)

console.log(failed ? `kit-classify: ${failed} FAILED` : 'kit-classify: all checks passed')
