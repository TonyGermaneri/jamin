// The circle of fifths, as geometry.
//
// It was twelve absolutely positioned buttons on a round div; it is a
// drawing now, and a drawing has no elements to click. Everything about
// where a sector is and which one the pointer is in is arithmetic, which
// is the half worth checking: the painting can be looked at and the
// hit-testing cannot.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

const SIZE = 240
const geometry = wheelGeometry(SIZE, WHEEL)

check('a sector per place', geometry.sectors.length, 12)
check('the bands nest', geometry.outer > geometry.split && geometry.split > geometry.hub, true)

/* ---------------- the sectors meet exactly ------------------------------
 *
 * Each is a twelfth, and each begins where the last one ended. A gap is a
 * click that lands on nothing; an overlap is two places answering for the
 * same pixel, and both are invisible in a picture.
 */
const twelfth = (Math.PI * 2) / 12
const widths = geometry.sectors.map((one) => Math.round((one.to - one.from) * 1e6) / 1e6)
check('every sector is a twelfth', new Set(widths).size, 1)
check('and that twelfth is a twelfth', widths[0], Math.round(twelfth * 1e6) / 1e6)
const seams = geometry.sectors.slice(1).every((one, at) =>
  Math.abs(one.from - geometry.sectors[at].to) < 1e-9)
check('and each begins where the last ended', seams, true)

/* ---------------- and the pointer finds them ---------------------------- */
// Dead centre of each sector, in both bands, comes back as that sector.
for (const sector of geometry.sectors) {
  for (const band of [0.5, 0.8]) {
    const away = geometry.hub + (geometry.outer - geometry.hub) * band
    const x = geometry.centre + Math.cos(sector.mid) * away
    const y = geometry.centre + Math.sin(sector.mid) * away
    check(`${sector.name} is found at ${band} out`, sectorAt(geometry, x, y), sector.at)
  }
}

// The first place is at the top, which is where a circle of fifths starts.
check('C is at twelve o clock',
      sectorAt(geometry, geometry.centre, geometry.centre - geometry.outer * 0.9), 0)
// And clockwise from there, because that is the direction fifths go.
check('G is next, clockwise', WHEEL[1].name, 'G')
check('and the wheel really is in fifths',
      WHEEL.every((one, at) => one.pc === (at * 7) % 12), true)

/* ---------------- the hub and the outside are not sectors --------------- */
// The middle is a hole. A click there is a click on nothing rather than on
// whichever place happens to own that angle.
check('the hub answers for nothing',
      sectorAt(geometry, geometry.centre, geometry.centre), -1)
check('and just inside the hub too',
      sectorAt(geometry, geometry.centre + geometry.hub * 0.9, geometry.centre), -1)
check('and outside the wheel',
      sectorAt(geometry, geometry.centre + geometry.outer * 1.1, geometry.centre), -1)

/* ---------------- two rings, and which note is on which ----------------- */
/*
 * The seven naturals ride the outer band and the five accidentals the
 * inner one -- which is the arrangement the wheel has always had and the
 * markup could not express. Drawn, where the sharps and flats live is
 * visible rather than spelled out in a caption.
 */
const away = (one) => Math.hypot(one.x - geometry.centre, one.y - geometry.centre)
const naturals = geometry.sectors.filter((one) => one.natural)
const accidentals = geometry.sectors.filter((one) => !one.natural)
check('seven outside and five inside', [naturals.length, accidentals.length], [7, 5])
check('the naturals sit in the outer band',
      naturals.every((one) => away(one) > geometry.split), true)
check('and the accidentals inside it',
      accidentals.every((one) => away(one) < geometry.split && away(one) > geometry.hub), true)

// Every label is inside the wheel. A name drawn past the rim is a name
// clipped by the canvas, which is the sort of thing only a picture shows.
check('no label falls off the edge',
      geometry.sectors.every((one) => away(one) < geometry.outer), true)

console.log(failed ? `chord-wheel: ${failed} FAILED` : 'chord-wheel: all checks passed')
