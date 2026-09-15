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

check('the corpus is here', grooves.length > 2000, true)
check('with beats and fills', beats.length > 0 && fills.length > 0, true)
check('attributed', GROOVE_DRUMS.licence, 'CC BY 4.0')
check('and in the kit it was played on', GROOVE_DRUMS.kit, 'roland-td11')
check('counted in jamin pulses', GROOVE_DRUMS.ppqn, 24)

/* ---------------- nothing lands outside its own loop --------------------- */
const spill = grooves.filter((g) => g.v.some(([at]) => at < 0 || at >= g.d))
check('no note lands outside the loop it belongs to', spill.length, 0)

/* ---------------- and the loop point does not flam ----------------------- */
// The whole point. A hit two pulses before the loop point and another on the
// downbeat are forty milliseconds apart at 120bpm, which is a flam -- and it
// repeats every single bar.
const flamming = beats.filter((g) => {
  const ats = g.v.map(([at]) => at)
  return ats.some((at) => at >= g.d - 2) && ats.some((at) => at <= 1)
})
check('no beat flams at its loop point', flamming.length, 0)

// And most of them start where a loop should start.
const onDownbeat = beats.filter((g) => g.v.some(([at]) => at === 0))
atLeast('four in five beats start on the downbeat',
        Math.round(100 * onDownbeat.length / beats.length), 80)

// A beat whose downbeat was pushed off the end entirely is the other half of
// the same fault, and is rarer still.
const headless = beats.filter((g) => !g.v.some(([at]) => at <= 2))
atMost('almost none has lost its downbeat',
       Math.round(100 * headless.length / beats.length), 5)

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
