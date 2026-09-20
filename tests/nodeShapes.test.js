// What a node on the map is drawn as.
//
// A groove loops for a section and a fill happens once at the end of one, and
// they were the same dot. The thing that has to hold is that shape says *what*
// a clip is while size still says *how much* is under it -- so every shape has
// to cover the same ink as the circle it replaces. Otherwise a square groove
// reads as a bigger node than a round one, which on this map is a wrong number
// rather than a taste.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/*
 * A canvas context that records the outline instead of painting it.
 *
 * `traceShape` speaks nothing but moveTo/lineTo/arc/closePath, so this is the
 * whole of what it needs -- and the points it collects are exactly what the
 * area below is measured from.
 */
function recorder() {
  const path = []
  return {
    path,
    arc: (x, y, r) => {
      // The shoelace formula wants a polygon, so the circle becomes a very
      // fine one. 720 sides is within a millionth of the true area.
      for (let i = 0; i < 720; i++) {
        const angle = (i / 720) * Math.PI * 2
        path.push([x + Math.cos(angle) * r, y + Math.sin(angle) * r])
      }
    },
    moveTo: (x, y) => path.push([x, y]),
    lineTo: (x, y) => path.push([x, y]),
    closePath: () => {},
  }
}

/** The area inside a traced outline, by the shoelace formula. */
function areaOf(name, r) {
  const ctx = recorder()
  traceShape(ctx, name, 0, 0, r)
  const p = ctx.path
  let sum = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]
    const [x2, y2] = p[(i + 1) % p.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

const R = 10
const circle = Math.PI * R * R

/* ---------------- every shape covers the same ink ----------------------- */
for (const { value, title } of NODE_SHAPES) {
  const area = areaOf(value, R)
  const off = Math.abs(area - circle) / circle
  check(`${title} covers a circle's area (off by ${(off * 100).toFixed(2)}%)`, off < 0.005, true)
}

/* ---------------- and they are actually different shapes ---------------- */
// Equal areas would also be satisfied by six circles, which would be the
// setting doing nothing. Corner counts tell them apart.
function corners(name) {
  const ctx = recorder()
  traceShape(ctx, name, 0, 0, R)
  return ctx.path.length
}
check('a square has four corners', corners('square'), 4)
check('a diamond has four', corners('diamond'), 4)
check('a triangle has three', corners('triangle'), 3)
check('a hexagon has six', corners('hexagon'), 6)
check('a five-pointed star has ten', corners('star'), 10)

// The square and the diamond are the same square turned. Same corner count,
// same area, different outline -- which is the whole distinction.
const square = (() => { const c = recorder(); traceShape(c, 'square', 0, 0, R); return c.path })()
const diamond = (() => { const c = recorder(); traceShape(c, 'diamond', 0, 0, R); return c.path })()
check('the diamond is the square turned, not the square',
      JSON.stringify(square) !== JSON.stringify(diamond), true)
// Axis-aligned: the square's corners are all off both axes, the diamond's are
// all on one of them.
const near = (n) => Math.abs(n) < 1e-9
check('the square sits square to the page', square.every(([x, y]) => !near(x) && !near(y)), true)
check('and the diamond stands on a point', diamond.every(([x, y]) => near(x) || near(y)), true)

/* ---------------- an unknown name draws something ----------------------- */
// A map with holes in it is worse than a map that ignored a setting, so a
// name nothing recognises falls back rather than tracing nothing.
check('an unknown shape falls back to the circle',
      Math.abs(areaOf('trapezoid', R) - circle) / circle < 0.005, true)

/* ---------------- the menu offers what can be drawn --------------------- */
check('the menu lists every shape that can be drawn',
      NODE_SHAPES.every((one) => areaOf(one.value, R) > 0), true)
check('and every one of them has a name to show',
      NODE_SHAPES.every((one) => typeof one.title === 'string' && one.title.length > 0), true)
check('the circle is among them', NODE_SHAPES.some((one) => one.value === 'circle'), true)
check('and so is the square', NODE_SHAPES.some((one) => one.value === 'square'), true)

console.log(failed ? `node-shapes: ${failed} FAILED` : 'node-shapes: all checks passed')
