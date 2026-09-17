/**
 * Arranging a catalogue into a shape.
 *
 * A force layout says what is near what and nothing about where. That is
 * exactly right and slightly bleak: every collection settles into the same
 * blob, and a blob is hard to remember. A shape is easy to remember -- you know
 * where the wing is -- and if the arrangement *inside* it still puts related
 * words together, the shape costs nothing and buys a map somebody can hold in
 * their head.
 *
 * So: sample a silhouette into a point cloud, then move the settled layout onto
 * those points **without scrambling it**. The second half is the whole problem.
 * Assigning words to points at random fills the bird and destroys the meaning;
 * what is wanted is a rearrangement that keeps neighbours neighbours.
 *
 * The answer is a space-filling curve. Order the settled positions along a
 * Hilbert curve, order the shape's points along the same curve, and pair them
 * off in order. A Hilbert curve visits space so that points close along the
 * curve are close in the plane -- which is precisely the property needed, in
 * both directions at once. It is O(n log n), deterministic, and needs no
 * optimiser.
 *
 * The shapes are drawn here rather than fetched. Four SVG paths of a few
 * hundred bytes each, so nothing is downloaded, nothing is licensed from
 * anybody, and they are unnamed in the interface -- "Built-in 1" and so on --
 * because naming them invites an argument about whether it really looks like a
 * heron.
 */

/**
 * Where a point falls along a Hilbert curve through a square.
 *
 * `x` and `y` are whole numbers in `0..(2^bits - 1)`. The returned index orders
 * points so that near in the plane is near along the curve, which is the
 * property the whole arrangement rests on.
 *
 * The rotation step is what makes it a Hilbert curve rather than a Z-order one:
 * without it the curve jumps clear across the square four times per level, and
 * points either side of a jump end up far apart in the ordering despite sitting
 * next to each other on screen.
 */
export function hilbert(x, y, bits = 16) {
  let rx = 0
  let ry = 0
  let d = 0
  let a = Math.max(0, Math.round(x))
  let b = Math.max(0, Math.round(y))

  for (let side = 1 << (bits - 1); side > 0; side >>= 1) {
    rx = (a & side) > 0 ? 1 : 0
    ry = (b & side) > 0 ? 1 : 0
    d += side * side * ((3 * rx) ^ ry)

    // Rotate the quadrant so the curve stays continuous across it.
    if (ry === 0) {
      if (rx === 1) {
        a = side - 1 - a
        b = side - 1 - b
      }
      const swap = a
      a = b
      b = swap
    }
  }
  return d
}

/** The smallest box holding every point of a flat `[x, y, x, y, …]` array. */
export function boundsOf(positions) {
  if (!positions || !positions.length) return { left: 0, top: 0, width: 1, height: 1 }
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity

  for (let at = 0; at < positions.length; at += 2) {
    const x = positions[at]
    const y = positions[at + 1]
    if (x < left) left = x
    if (x > right) right = x
    if (y < top) top = y
    if (y > bottom) bottom = y
  }

  return {
    left, top,
    width: Math.max(1e-6, right - left),
    height: Math.max(1e-6, bottom - top),
  }
}

/** The order a set of points falls in along the curve, best-first by index. */
export function alongTheCurve(positions, bits = 12) {
  const box = boundsOf(positions)
  const side = (1 << bits) - 1
  const count = positions.length / 2
  const order = new Array(count)

  for (let at = 0; at < count; at++) {
    const x = ((positions[at * 2] - box.left) / box.width) * side
    const y = ((positions[at * 2 + 1] - box.top) / box.height) * side
    order[at] = { at, d: hilbert(x, y, bits) }
  }

  // Ties broken by index, so the same input always gives the same order -- a
  // layout that shuffles on a tie is a layout nobody can learn.
  order.sort((one, two) => one.d - two.d || one.at - two.at)
  return order.map((one) => one.at)
}

/**
 * Move a settled layout onto a shape, keeping neighbours together.
 *
 * Both sets are ordered along the same curve and paired off in order. Because
 * the curve preserves locality in both directions, two words that ended up near
 * each other in the force layout land near each other in the shape -- so the
 * clusters the collection actually has become the regions of the bird, without
 * anybody deciding which cluster is the wing.
 *
 * `shape` may hold more points than there are words, which is the normal case:
 * a silhouette is sampled generously and the surplus is dropped evenly along
 * the curve so the thinning does not hollow out one end of it.
 */
export function fitToShape(positions, shape) {
  const count = positions.length / 2
  const available = shape.length / 2
  if (!count || !available) return new Float32Array(positions)

  const fromOrder = alongTheCurve(positions)
  const toOrder = alongTheCurve(shape)

  const out = new Float32Array(count * 2)
  for (let n = 0; n < count; n++) {
    // Spread across the whole of the shape's ordering rather than taking the
    // first `count` of it, which would pack everything into one end.
    const pick = toOrder[Math.min(available - 1, Math.floor((n * available) / count))]
    const word = fromOrder[n]
    out[word * 2] = shape[pick * 2]
    out[word * 2 + 1] = shape[pick * 2 + 1]
  }
  return out
}

/**
 * The silhouettes, as SVG path data.
 *
 * Drawn here rather than fetched: a few hundred bytes each, nothing
 * downloaded, nothing licensed from anybody. They are deliberately unnamed in
 * the interface -- naming them invites an argument about whether it really
 * looks like a heron, and the point is that a shape is easier to remember than
 * a blob, not that it is a good drawing of a bird.
 *
 * Each is authored in a 100×100 box so the sampler needs no per-shape scaling.
 */
export const SHAPES = [
  {
    id: 'builtin-1',
    /* A bird with its wings out: body, two wings, a tail and a head. Separate
       subpaths, so the sampler finds five regions and the curve fills them in
       an order that keeps each one whole. */
    path: 'M50 44 C58 44 62 50 62 58 C62 70 56 80 50 86 C44 80 38 70 38 58 C38 50 42 44 50 44 Z'
        + 'M38 56 C26 48 12 40 4 26 C18 28 32 34 40 44 Z'
        + 'M62 56 C74 48 88 40 96 26 C82 28 68 34 60 44 Z'
        + 'M46 84 L50 98 L54 84 Z'
        + 'M50 44 C46 40 46 32 50 28 C54 32 54 40 50 44 Z',
  },
  {
    id: 'builtin-2',
    /* A flower: six petals round a middle. The petals are separate, so related
       words gather into one petal rather than smearing across the bloom. */
    path: 'M50 50 m0 -10 a10 10 0 1 0 0.1 0 Z'
        + 'M50 38 C42 22 46 8 50 2 C54 8 58 22 50 38 Z'
        + 'M60 44 C76 34 90 38 96 42 C90 48 76 54 60 44 Z'
        + 'M60 56 C76 66 90 62 96 58 C90 52 76 46 60 56 Z'
        + 'M50 62 C58 78 54 92 50 98 C46 92 42 78 50 62 Z'
        + 'M40 56 C24 66 10 62 4 58 C10 52 24 46 40 56 Z'
        + 'M40 44 C24 34 10 38 4 42 C10 48 24 54 40 44 Z',
  },
  {
    id: 'builtin-3',
    /* A fountain: a basin, a rising column, and three falling arcs. */
    path: 'M18 86 C18 78 32 74 50 74 C68 74 82 78 82 86 C82 94 68 98 50 98 C32 98 18 94 18 86 Z'
        + 'M46 74 L46 34 L54 34 L54 74 Z'
        + 'M50 30 C50 18 44 8 34 2 C40 16 40 26 46 32 Z'
        + 'M50 30 C50 18 56 8 66 2 C60 16 60 26 54 32 Z'
        + 'M50 28 C44 20 44 10 50 2 C56 10 56 20 50 28 Z'
        + 'M24 70 C18 56 20 42 28 32 C28 48 28 60 32 70 Z'
        + 'M76 70 C82 56 80 42 72 32 C72 48 72 60 68 70 Z',
  },
  {
    id: 'builtin-4',
    /* A plant: a stem with leaves in pairs, widest at the bottom. */
    path: 'M47 98 L47 20 L53 20 L53 98 Z'
        + 'M47 84 C32 84 18 78 8 66 C24 62 40 68 48 80 Z'
        + 'M53 84 C68 84 82 78 92 66 C76 62 60 68 52 80 Z'
        + 'M47 62 C34 62 22 56 14 46 C28 42 42 48 48 58 Z'
        + 'M53 62 C66 62 78 56 86 46 C72 42 58 48 52 58 Z'
        + 'M47 42 C36 42 26 37 20 29 C32 26 44 31 48 39 Z'
        + 'M53 42 C64 42 74 37 80 29 C68 26 56 31 52 39 Z'
        + 'M50 20 C44 14 44 6 50 0 C56 6 56 14 50 20 Z',
  },
]

/**
 * A shape, as a cloud of points inside it.
 *
 * Rasterised rather than solved: the path is drawn to an offscreen canvas and
 * the filled pixels are sampled. That handles overlapping subpaths, holes and
 * curves without a scrap of geometry, and it is exact -- the fill rule the
 * browser uses is the fill rule the shape was drawn with.
 *
 * Sampled on a jittered grid rather than uniformly at random. Pure random
 * sampling clumps, and clumps in the cloud become clumps in the layout that
 * mean nothing; a jittered grid covers evenly while still looking unplanned.
 *
 * Returns a flat `[x, y, …]` array, or an empty one where there is no canvas to
 * draw on -- which is every test environment, and the reason nothing else here
 * needs one.
 */
export function pointsInShape(path, wanted = 4000, { size = 512, seed = 1 } = {}) {
  if (typeof document === 'undefined') return new Float32Array(0)

  let canvas
  try {
    canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
  } catch {
    return new Float32Array(0)
  }

  const paint = canvas.getContext('2d', { willReadFrequently: true })
  if (!paint) return new Float32Array(0)

  paint.fillStyle = '#fff'
  paint.scale(size / 100, size / 100)
  paint.fill(new Path2D(path))

  let pixels
  try {
    pixels = paint.getImageData(0, 0, size, size).data
  } catch {
    return new Float32Array(0)
  }

  /*
   * A grid fine enough to yield more than is wanted.
   *
   * How much of the box a silhouette fills is not knowable in advance, and it
   * varies enormously: a flower covers most of its square, a plant is mostly
   * stem. Sampling once at a step guessed from the *area of the box* gave 221
   * points where 600 were asked for, and a shape with fewer points than there
   * are words is a shape that quietly does not happen.
   *
   * So it samples, and if it came up short it halves the step and samples
   * again. Two or three passes at most -- each one quadruples the yield, and
   * the loop is bounded by a step of one pixel.
   */
  const gather = (step) => {
    const out = []
    let random = seed >>> 0
    const next = () => {
      // A small deterministic generator, so the same shape gives the same cloud
      // every time and a stored layout keeps meaning what it meant.
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      return random / 0xffffffff
    }

    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        const jitterX = Math.min(size - 1, Math.floor(x + next() * step))
        const jitterY = Math.min(size - 1, Math.floor(y + next() * step))
        if (pixels[(jitterY * size + jitterX) * 4 + 3] > 128) {
          // Into the space the layout lives in, centred on nothing in particular.
          out.push((jitterX / size - 0.5) * 2400, (jitterY / size - 0.5) * 2400)
        }
      }
    }
    return out
  }

  let step = Math.max(1, Math.floor(size / Math.sqrt(wanted * 2.2)))
  let out = gather(step)
  while (out.length / 2 < wanted && step > 1) {
    step = Math.max(1, step >> 1)
    out = gather(step)
  }

  return new Float32Array(out)
}
