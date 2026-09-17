// Arranging a catalogue into a shape without scrambling what it means.
//
// A force layout says what is near what and nothing about where, so every
// collection settles into the same blob and a blob is hard to remember. A shape
// is easy to remember. The whole problem is moving the layout onto the shape
// while keeping neighbours neighbours -- fill a bird at random and the bird
// costs you the meaning.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- the curve --------------------------------------------- */
/*
 * A Hilbert curve visits a square so that points close along the curve are
 * close in the plane. That is the property the whole arrangement rests on, in
 * both directions at once: order the layout by it, order the shape by it, pair
 * them off, and locality survives the move.
 */
check('the start of the curve', hilbert(0, 0, 4), 0)
check('every cell is visited once',
      new Set(Array.from({ length: 16 }, (_, y) =>
        Array.from({ length: 16 }, (_, x) => hilbert(x, y, 4))).flat()).size, 256)
check('and the indices fill the range',
      Math.max(...Array.from({ length: 16 }, (_, y) =>
        Array.from({ length: 16 }, (_, x) => hilbert(x, y, 4))).flat()), 255)

/*
 * The property that matters, stated carefully.
 *
 * It is tempting to assert that adjacent cells are adjacent along the curve,
 * and that is false of every space-filling curve: the curve enters a square at
 * one corner and leaves at another, so where it crosses between halves two
 * neighbouring cells sit at opposite ends of the ordering. Measured here the
 * worst horizontal step on a 16x16 is 213 out of 255, and the curve is correct.
 *
 * What Hilbert actually guarantees is about the typical step, and the useful
 * statement is the median: moving one cell moves you one place along the curve,
 * most of the time. (Z-order's median is 2, and it is the reason the rotation
 * step in hilbert() exists rather than being left out for simplicity.)
 */
const steps = []
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 15; x++) steps.push(Math.abs(hilbert(x + 1, y, 4) - hilbert(x, y, 4)))
  }
for (let y = 0; y < 15; y++) {
  for (let x = 0; x < 16; x++) steps.push(Math.abs(hilbert(x, y + 1, 4) - hilbert(x, y, 4)))
}
steps.sort((a, b) => a - b)
check('one cell is usually one place along the curve', steps[steps.length >> 1], 1)

/* ---------------- the box round a layout -------------------------------- */
const scattered = new Float32Array([0, 0, 10, 4, -6, 8])
const box = boundsOf(scattered)
check('the left edge', box.left, -6)
check('the top edge', box.top, 0)
check('the width', box.width, 16)
check('the height', box.height, 8)
// Nothing, and a single point, both have to give a box something can divide by.
check('nothing has a box', boundsOf(new Float32Array(0)).width, 1)
check('and one point has no width', boundsOf(new Float32Array([5, 5])).width > 0, true)

/* ---------------- moving a layout onto a shape -------------------------- */
/*
 * Four words in two pairs: two on the left, two on the right. Whatever shape
 * they are poured into, the pairs have to stay pairs -- that is the difference
 * between a rearrangement and a shuffle.
 */
const layout = new Float32Array([
  -100, -100, -90, -95,     // two together, top left
  100, 100, 90, 95,         // two together, bottom right
])

// A shape that is simply a bigger square, sampled at sixteen points.
const square = []
for (let y = 0; y < 4; y++) {
  for (let x = 0; x < 4; x++) square.push(x * 100 - 150, y * 100 - 150)
}
const fitted = fitToShape(layout, new Float32Array(square))

check('every word gets a place', fitted.length, layout.length)
const apart = (a, b) => Math.hypot(fitted[a * 2] - fitted[b * 2], fitted[a * 2 + 1] - fitted[b * 2 + 1])
check('words that were together stay together', apart(0, 1) < apart(0, 2), true)
check('and so does the other pair', apart(2, 3) < apart(1, 3), true)

// Deterministic, because a layout that moves between sessions is one nobody can
// learn -- which is the entire reason for storing it.
check('the same layout twice', [...fitToShape(layout, new Float32Array(square))], [...fitted])

/*
 * More words than the shape has points, and more points than words. The second
 * is the normal case: a silhouette is sampled generously, and the surplus has
 * to be dropped evenly rather than by taking the first n -- which would pack
 * the whole catalogue into one corner of the bird.
 */
const many = new Float32Array(Array.from({ length: 40 }, (_, n) => n))
const spread = fitToShape(many, new Float32Array(square))
check('twenty words into sixteen points is still twenty words', spread.length, 40)
const used = new Set()
for (let at = 0; at < spread.length; at += 2) used.add(`${spread[at]},${spread[at + 1]}`)
check('and they are spread over the shape rather than piled in a corner',
      used.size > 4, true)

check('no words is no positions', fitToShape(new Float32Array(0), new Float32Array(square)).length, 0)
check('and no shape leaves them where they were',
      [...fitToShape(layout, new Float32Array(0))], [...layout])

/* ---------------- the shapes themselves --------------------------------- */
// Unnamed on purpose: naming them invites an argument about whether it really
// looks like a heron, and the point is that a shape is easier to remember than
// a blob.
check('there are four', SHAPES.length, 4)
check('each has an id', SHAPES.every((one) => /^builtin-\d$/.test(one.id)), true)
check('and none of them is named after anything',
      SHAPES.every((one) => !one.name), true)
check('each is a closed path', SHAPES.every((one) => one.path.trim().endsWith('Z')), true)
check('drawn in a hundred-unit box',
      SHAPES.every((one) => !/\d{3,}/.test(one.path.replace(/[A-Za-z]/g, ' '))), true)

// Several subpaths each, which is what gives a shape regions -- a wing, a
// petal, a leaf -- for the curve to fill one at a time.
check('and each has parts',
      SHAPES.every((one) => (one.path.match(/M/g) || []).length >= 4), true)

// There is no canvas here, and that is the point: everything above this line
// is arithmetic, and only the rasteriser needs a browser. What it does with one
// is measured in the plugin's own web view, where a shape that yields too few
// points is a layout that quietly does not happen.
// @see native/tools/boot_probe.m, which pours one for real.
check('sampling without a canvas is empty rather than broken',
      pointsInShape(SHAPES[0].path, 100).length, 0)

console.log(failed ? `shape-layouts: ${failed} FAILED` : 'shape-layouts: all checks passed')
