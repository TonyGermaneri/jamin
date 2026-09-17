/**
 * What a catalogue graph looks like, and how to walk it.
 *
 * @see tagGraph.js turns a catalogue into nodes and edges. This turns those into
 * the flat arrays a renderer uploads, and answers the two questions an
 * interface asks of a graph: what is next to this, and where do the arrow keys
 * go.
 *
 * Still no drawing. Everything here is arithmetic on typed arrays, which is
 * what makes the parts that decide the picture testable without a GPU.
 */

/**
 * Where a catalogue's words come from, per kind of catalogue.
 *
 * A drum groove has a path and the path is the whole story. A phrase has no
 * path at all -- it has a name, a kind, a source and the chord it was played
 * over -- so the adapter's one job is to say what text stands in for a path.
 *
 * Nothing else in the graph knows which catalogue it is looking at, which is
 * the point: one engine, three datasets, an adapter each.
 */
export const ADAPTERS = {
  drums: {
    label: 'Drums',
    textOf: (one) => one.path || one.name || '',
    nameOf: (one) => one.name || '',
    detail: (one) => `${one.bars} bar${one.bars === 1 ? '' : 's'} · ${one.timeSignature} · ${one.bpm}bpm`,
  },
  phrases: {
    label: 'Articulations',
    // A phrase's words are the ones it actually carries. `origin` is
    // "POP909 #024" and the number is that song rather than a category, so the
    // collection name is taken and the number left behind.
    textOf: (one) => [
      one.name, one.kind, one.category,
      String(one.origin || '').split(' #')[0],
      one.sourceChord,
    ].filter(Boolean).join(' / '),
    nameOf: (one) => one.name || '',
    detail: (one) => `${one.kind} · ${(one.notes || []).length} notes`,
  },
  progressions: {
    label: 'Progressions',
    textOf: (one) => [one.name, ...(one.tags || [])].filter(Boolean).join(' / '),
    nameOf: (one) => one.name || '',
    detail: (one) => (one.tags || []).join(' · '),
  },
}

/**
 * A starting arrangement, before any physics.
 *
 * A ring rather than a random scatter. Cosmos settles from wherever it is put,
 * and from random noise the first second looks like an explosion; from a ring
 * ordered by how many clips each word carries, the big words start spread
 * evenly around the outside and the layout collapses inward into something
 * recognisable. It also means a graph with the simulation switched off is still
 * a readable picture rather than a pile.
 */
export function ringPositions(count, { radius = 1200 } = {}) {
  const out = new Float32Array(count * 2)
  for (let at = 0; at < count; at++) {
    const turn = (at / Math.max(1, count)) * Math.PI * 2
    // The commonest words first, so they land opposite each other rather than
    // adjacent -- a golden-angle offset keeps neighbours in the list from
    // becoming neighbours on the ring.
    const spiral = at * 2.399963
    out[at * 2] = Math.cos(turn + spiral * 0.0001) * radius
    out[at * 2 + 1] = Math.sin(turn + spiral * 0.0001) * radius
  }
  return out
}

/**
 * How big each word is drawn: by how many clips carry it.
 *
 * Square root rather than linear. The commonest word in a real collection
 * carries a hundred thousand clips and the rarest carries eight, and drawn to
 * scale the small ones are invisible and the large ones are the screen. Area is
 * what a reader judges, so the radius goes as the root and the *area* is what
 * ends up proportional.
 */
export function sizesFor(tags, { smallest = 4, largest = 34 } = {}) {
  const out = new Float32Array(tags.length)
  if (!tags.length) return out

  const most = Math.sqrt(Math.max(...tags.map((one) => one.clips)))
  const least = Math.sqrt(Math.min(...tags.map((one) => one.clips)))
  const span = Math.max(1e-6, most - least)

  tags.forEach((one, at) => {
    const where = (Math.sqrt(one.clips) - least) / span
    out[at] = smallest + where * (largest - smallest)
  })
  return out
}

/**
 * Colour, from the word itself.
 *
 * Deterministic: the same word is the same colour in every session and in every
 * catalogue, so the map is learnable. Hue from a hash of the word, and the
 * lightness from how common it is -- the hubs sit darker and denser, the leaves
 * lighter, so the eye finds structure before it reads a single label.
 */
export function coloursFor(tags, { dark = false } = {}) {
  const out = new Float32Array(tags.length * 4)
  if (!tags.length) return out

  const most = Math.log1p(Math.max(...tags.map((one) => one.clips)))

  tags.forEach((one, at) => {
    let hash = 0x811c9dc5
    for (let i = 0; i < one.tag.length; i++) {
      hash ^= one.tag.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    const weight = Math.log1p(one.clips) / Math.max(1e-6, most)
    const [r, g, b] = fromHsl((hash % 360) / 360,
                              0.42 + 0.2 * weight,
                              dark ? 0.72 - 0.22 * weight : 0.56 - 0.18 * weight)
    out[at * 4] = r
    out[at * 4 + 1] = g
    out[at * 4 + 2] = b
    out[at * 4 + 3] = 1
  })
  return out
}

/** HSL to RGB, each 0..1. The one piece of colour arithmetic worth having. */
function fromHsl(h, s, l) {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

/**
 * Who is next to whom, as a list per node.
 *
 * Built once from the edge list, because every question the interface asks --
 * what to show along the top, where the arrow keys go, what to light up when
 * something is picked -- is this same question, and answering it by scanning
 * ten thousand edges each time is ten thousand scans a second.
 *
 * Each node's neighbours come back heaviest first, so the strongest
 * relationship is the first thing offered and the first thing an arrow key
 * reaches.
 */
export function neighboursOf(count, edges) {
  const near = Array.from({ length: count }, () => [])
  for (const [a, b, weight] of edges) {
    if (a === b) continue
    near[a].push({ at: b, weight })
    near[b].push({ at: a, weight })
  }
  for (const list of near) list.sort((one, two) => two.weight - one.weight)
  return near
}

/**
 * Where an arrow key goes.
 *
 * Walking edges is what a graph is *for*, and it is the thing a mouse does
 * badly: a node's strongest relationship may be anywhere on screen, and finding
 * it by eye in a thousand-node cloud is not finding it.
 *
 * So left and right move along the current node's neighbours, ordered by
 * strength, and up and down step into and out of one. `from` is where the walk
 * came from, which is what makes `up` mean anything -- otherwise going back is
 * indistinguishable from going to the strongest neighbour of wherever you are.
 */
export function walk(near, { at, from = -1, along = 0 }, key) {
  const here = near[at] || []

  if (key === 'right' || key === 'left') {
    if (!here.length) return { at, from, along }
    const step = key === 'right' ? 1 : -1
    const next = (along + step + here.length) % here.length
    return { at, from, along: next }
  }

  if (key === 'down') {
    const into = here[along]
    if (!into) return { at, from, along }
    return { at: into.at, from: at, along: 0 }
  }

  if (key === 'up') {
    if (from < 0) return { at, from, along }
    // Back where it came from, landing on the edge it arrived by -- so going
    // up and then down again returns to where you were rather than to
    // whichever neighbour happens to be strongest.
    const back = (near[from] || []).findIndex((one) => one.at === at)
    return { at: from, from: -1, along: back < 0 ? 0 : back }
  }

  return { at, from, along }
}

/**
 * The line along the top: what this word is related to, strongest first.
 *
 * `along` is which of them the keyboard is pointing at, so the strip is both a
 * readout and the keyboard's menu -- the same list, and the same order, as the
 * arrow keys walk.
 */
export function relationships(tags, near, { at, along = 0 }, limit = 12) {
  const here = (near[at] || []).slice(0, limit)
  return {
    word: tags[at] ? tags[at].tag : '',
    clips: tags[at] ? tags[at].clips : 0,
    with: here.map((one, index) => ({
      tag: tags[one.at] ? tags[one.at].tag : '',
      at: one.at,
      clips: one.weight,
      pointed: index === along,
    })),
    more: Math.max(0, (near[at] || []).length - here.length),
  }
}

/**
 * Draw a small graph and report what happened, for the boot probe.
 *
 * cosmos.gl runs its simulation in fragment shaders, and whether that works is
 * a fact about the host's WebKit rather than about the library. A canvas that
 * fails to get a context fails *silently* -- the page renders, the box stays
 * empty -- which is the shape of bug nobody notices until somebody turns the
 * setting on months later.
 *
 * So the probe builds one, runs the simulation, reads the positions back, and
 * checks they moved. @see native/tools/boot_probe.m
 */
export async function measureGraph(Graph) {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:-9999px;width:400px;height:300px'
  document.body.appendChild(box)

  try {
    const tags = Array.from({ length: 64 }, (_, n) => ({ tag: `w${n}`, clips: 8 + n * 3 }))
    const edges = []
    for (let a = 0; a < tags.length; a++) {
      edges.push([a, (a + 1) % tags.length, 5])
      edges.push([a, (a + 7) % tags.length, 2])
    }

    const graph = new Graph(box, {
      spaceSize: 1024, fitViewOnInit: true, simulationFriction: 0.8,
    })
    const began = ringPositions(tags.length, { radius: 200 })
    graph.setPointPositions(began.slice())
    graph.setPointSizes(sizesFor(tags))
    graph.setPointColors(coloursFor(tags))

    const pairs = new Float32Array(edges.length * 2)
    edges.forEach(([a, b], n) => { pairs[n * 2] = a; pairs[n * 2 + 1] = b })
    graph.setLinks(pairs)
    graph.render()
    graph.start()

    /*
     * Waited for rather than timed.
     *
     * A fixed pause is a coin toss on a loaded machine: at 700ms this reported
     * `moved=false` on one run and `moved=true` on the next, which is a test
     * that fails for reasons having nothing to do with the code. So it asks
     * until the answer is yes, and gives up at a point well past any plausible
     * first tick.
     */
    let now = null
    let moved = false
    for (let tries = 0; tries < 40 && !moved; tries++) {
      await new Promise((done) => setTimeout(done, 100))
      now = await graph.getPointPositions?.()
      moved = Boolean(now) && [...now].some((one, at) => Math.abs(one - began[at]) > 0.5)
    }
    graph.pause()

    graph.destroy()
    return `points=${tags.length} links=${edges.length} readBack=${now ? now.length : 0} moved=${Boolean(moved)}`
  } finally {
    box.remove()
  }
}

/**
 * Finding a word by typing it.
 *
 * A graph of several hundred words is quick to look around and slow to look
 * *up*: the word you want is somewhere in a cloud and reading labels until you
 * find it is worse than a list. So typing narrows, and the ranking is the one
 * that matches how people type -- what they typed is usually the start of the
 * word, occasionally inside it, and the commonest word wins a tie because it is
 * the one more likely meant.
 *
 * Returns node indices, best first.
 */
export function find(tags, query, limit = 12) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return []

  const scored = []
  tags.forEach((one, at) => {
    const word = one.tag
    if (word === needle) scored.push({ at, rank: 0, clips: one.clips })
    else if (word.startsWith(needle)) scored.push({ at, rank: 1, clips: one.clips })
    else if (word.includes(needle)) scored.push({ at, rank: 2, clips: one.clips })
  })

  scored.sort((a, b) => a.rank - b.rank || b.clips - a.clips)
  return scored.slice(0, limit).map((one) => one.at)
}
