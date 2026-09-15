// The shipped corpus, checked as data rather than as code.
//
// It exists because a slicing mistake is silent: the file parses, the app runs,
// every test passes, and the drums merely sound bad. The first version cut
// loops on the exact bar line -- and drummers play *ahead* of the click, so the
// downbeat routinely landed a pulse or two before the bar it belonged to. It
// went to the end of the previous loop instead of the start of this one.
//
// Measured: 32% of beats flammed on every bar line, a hit at the end and
// another at the downbeat forty milliseconds apart for ever, and another 28%
// had no downbeat at all. Sixty per cent of the corpus was broken by the cut
// rather than by the drummer, and it took somebody saying "these guys kinda
// suck" to find it.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
function atLeast(label, got, want) {
  if (!(got >= want)) { failed++; console.log(`FAIL ${label}: ${got} is below ${want}`) }
}
function atMost(label, got, want) {
  if (!(got <= want)) { failed++; console.log(`FAIL ${label}: ${got} is above ${want}`) }
}

const grooves = GROOVE_DRUMS.grooves
const beats = grooves.filter((g) => g.k === 'beat')
const fills = grooves.filter((g) => g.k === 'fill')

check('the corpus is here', grooves.length > 1000, true)
check('with beats and fills', beats.length > 0 && fills.length > 0, true)
check('attributed', GROOVE_DRUMS.licence, 'CC BY 4.0')
check('and in the kit it was played on', GROOVE_DRUMS.kit, 'roland-td11')
check('counted in jamin pulses', GROOVE_DRUMS.ppqn, 24)

/* ---------------- nothing lands outside its own loop --------------------- */
const spill = grooves.filter((g) => g.v.some(([at]) => at < 0 || at >= g.d))
check('no note lands outside the loop it belongs to', spill.length, 0)

/* ---------------- they are whole performances --------------------------- */
// Nothing is cut. An earlier version sliced these into one, two and four bar
// loops -- a decision about somebody else's material taken without asking, and
// done badly on top of it: cutting on the bar line put the anticipated downbeat
// at the end of the previous loop and left most of the corpus flamming once a
// bar. Each take ships as it was played.
const kinds = new Set(grooves.map((g) => g.k))
check('three kinds and no others', [...kinds].sort(), ['beat', 'fill', 'song'])

const songs = grooves.filter((g) => g.k === 'song')
const short = grooves.filter((g) => g.k === 'beat')
atLeast('the long takes are here as takes', songs.length, 300)
check('and are longer than a pattern', songs.every((g) => g.r > 8), true)
check('while a beat is short enough to loop', short.every((g) => g.r <= 8), true)

// One artefact per performance: 1,150 files in, 1,150 out.
check('one groove per performance', grooves.length, 1150)

// Whose take it is, which a slice had no room for.
const anonymous = grooves.filter((g) => !g.w)
check('every take has a drummer', anonymous.length, 0)

/* ---------------- the loops are whole bars ------------------------------- */
const ragged = grooves.filter((g) => {
  const [num, den] = g.t.split('-').map(Number)
  return g.d !== Math.round(g.r * (num * 4 / den) * 24)
})
check('every loop is a whole number of bars', ragged.length, 0)

/* ---------------- and are actually playable ------------------------------ */
const empty = grooves.filter((g) => !g.v.length)
check('nothing is empty', empty.length, 0)
const silent = grooves.filter((g) => g.v.some(([, , , vel]) => vel < 1 || vel > 127))
check('every hit has a usable velocity', silent.length, 0)
const unordered = grooves.filter((g) => g.v.some(([at], i) => i > 0 && at < g.v[i - 1][0]))
check('every loop is in time order', unordered.length, 0)

/* ---------------- the metadata is the corpus's own ----------------------- */
const badSig = grooves.filter((g) => !/^\d+-\d+$/.test(g.t))
check('every time signature is readable', badSig.length, 0)
const badBpm = grooves.filter((g) => !(g.b >= 40 && g.b <= 320))
check('every tempo is a tempo', badBpm.length, 0)
const noGenre = grooves.filter((g) => !g.g)
check('everything has a genre', noGenre.length, 0)

console.log(failed ? `groove-data: ${failed} FAILED` : 'groove-data: all checks passed')
