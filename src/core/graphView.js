/**
 * What a catalogue graph looks like, and how to walk it.
 *
 * @see pathTree.js turns a catalogue into the tree it already is. This says
 * where each kind of catalogue's tree comes from -- a drum groove has a path, a
 * phrase has none and needs one made out of what it does have -- and what a
 * "group the graph by" choice means for each.
 *
 * Nothing here draws, and the probe at the bottom is the exception that proves
 * it: it needs a canvas, which is why it takes the renderer as an argument
 * rather than importing one.
 */

/**
 * Where a catalogue's tree comes from, per kind of catalogue.
 *
 * Two jobs, and only two. `treePath` says what path a row hangs at: a drum
 * groove has one already and the path is the whole story, a phrase has none at
 * all -- it has a name, a kind and a source -- so one is made out of what it
 * does have. `facet` says what a "group the graph by" choice means, and every
 * value it can answer with has to read as a node name, which is why a length
 * comes back as "4 bars" rather than as 4.
 *
 * Both always answer with a string. An absent field used to come back
 * undefined, which the tree then had to coerce on its behalf.
 *
 * Nothing else in the graph knows which catalogue it is looking at, which is
 * the point: one engine, three datasets, an adapter each.
 */
/** The collection a phrase came from. Per-entry as "POP909 #219", so the
    collection is the part before the number. */
const sourceOf = (one) => String(one.origin || 'captured here').split(' #')[0]

/**
 * What a part does, rather than what it was played over.
 *
 * POP909's parts say this in their own names -- "F# comp 19" is a comp -- and
 * nowhere else. Read the same way the list pane reads it, so the map and the
 * filters agree about what a thing is. @see core/phrases.js phraseCategory
 */
function behaviourOf(one) {
  const name = String(one.name || '')
  const chord = String(one.sourceChord || '')
  if (name.startsWith(chord) && chord) {
    const after = name.charAt(chord.length)
    if (after === ' ' || after === '-' || after === '_') {
      const said = name.slice(chord.length).replace(/[\s_-]+\d+$/, '')
        .split(/[\s_-]+/).filter(Boolean).join(' ').toLowerCase()
      if (said) return said
    }
  }
  return one.kind || 'phrase'
}

/** How many notes sound at once, which is what separates a pad from a line. */
const voicesOf = (one) => (one.voices ? `${one.voices} voices` : '')

export const ADAPTERS = {
  drums: {
    label: 'Drums',
    /** Library first, then the path inside it. */
    treePath: (one) => [one.setId || 'Built in', one.path || one.name || ''].filter(Boolean).join('/'),
    /** What a "sort by" choice means for this catalogue. */
    facet: (one, by) => {
      if (by === 'genre') return one.genre || ''
      if (by === 'bars') return one.bars ? `${one.bars} bar${one.bars === 1 ? '' : 's'}` : ''
      if (by === 'signature') return one.timeSignature || ''
      if (by === 'kind') return one.kind || ''
      return (one.tags || {})[by] || ''
    },
    sorts: [
      { title: 'Folders', value: '' },
      { title: 'Genre', value: 'genre' },
      { title: 'Length', value: 'bars' },
      { title: 'Time signature', value: 'signature' },
      { title: 'Kind', value: 'kind' },
      { title: 'Feel', value: 'feel' },
      { title: 'Played on', value: 'surface' },
      { title: 'Part of a song', value: 'part' },
      { title: 'Era', value: 'era' },
    ],
  },
  phrases: {
    label: 'Articulations',
    /*
     * A phrase has no path, so one is made of what it does have.
     *
     * The first attempt used `origin / kind / category / name`, and on the real
     * catalogue that is two roots, four levels and a thousand phrases hanging
     * off `Major Triad` -- the ball of nothing this was reported as. The fault
     * was reading `category`, which for POP909's 8,168 parts is the quality of
     * the chord the part was played over and says nothing at all about the
     * part. The list pane had worked this out already and the map had not.
     *
     * The two collections are described by different things, so they are filed
     * by different things:
     *
     *   POP909      what the part does -- comp, busy, pad, read out of its own
     *               name (@see core/phrases.js phraseCategory) -- then the
     *               chord quality, then how many voices are playing at once.
     *               8,168 parts over 3 x 15 x 9, and the fan never exceeds
     *               about forty.
     *   Impro-Visor its own labels, which are real and were always fine: what
     *               kind of line it is, then the harmony it is written against.
     *
     * Anything captured here has neither and gets its kind and its key, which
     * is what a captured phrase knows about itself.
     */
    treePath: (one) => [
      sourceOf(one),
      behaviourOf(one),
      one.category || '',
      voicesOf(one),
      one.name || '',
    ].filter(Boolean).join('/'),
    facet: (one, by) => {
      if (by === 'kind') return one.kind || ''
      if (by === 'category') return one.category || ''
      if (by === 'behaviour') return behaviourOf(one)
      if (by === 'voices') return voicesOf(one)
      if (by === 'source') return sourceOf(one)
      return ''
    },
    sorts: [
      { title: 'Source', value: '' },
      { title: 'What it does', value: 'behaviour' },
      { title: 'Kind', value: 'kind' },
      { title: 'Harmony', value: 'category' },
      { title: 'Voices', value: 'voices' },
    ],
  },
  progressions: {
    label: 'Progressions',
    /*
     * Genre, then when, then how long -- the three things a progression row
     * actually carries besides its chords. Length matters more than it looks:
     * a genre and a decade alone leaves tens of thousands of progressions in
     * one heap, and how many bars a sequence runs for is the next thing
     * anybody narrows by. @see capFanOut for what happens when even that
     * leaves a node too wide.
     */
    treePath: (one) => [
      one.genre || 'untagged',
      one.decade ? `${one.decade}s` : '',
      one.bars ? `${one.bars} bar${one.bars === 1 ? '' : 's'}` : '',
      one.name || '',
    ].filter(Boolean).join('/'),
    facet: (one, by) => {
      if (by === 'genre') return one.genre || ''
      if (by === 'decade') return one.decade ? `${one.decade}s` : ''
      if (by === 'bars') return one.bars ? `${one.bars} bar${one.bars === 1 ? '' : 's'}` : ''
      return ''
    },
    sorts: [
      { title: 'Genre', value: '' },
      { title: 'Decade', value: 'decade' },
      { title: 'Length', value: 'bars' },
    ],
  },
}

/**
 * How big a graph this machine will actually draw.
 *
 * The catalogue's own map is a few hundred nodes, which is nothing -- but the
 * plan said a million nodes should be reachable and that claim was made from
 * reading rather than from measuring. So this builds progressively larger
 * graphs until one takes too long or throws, and reports where that was.
 *
 * Upload and first frame, not steady-state frame rate: the thing that fails at
 * scale is the texture allocation and the link buffer, and a graph that cannot
 * be uploaded never gets to be slow.
 */
export async function stressGraph(Graph, sizes = [1000, 10000, 100000, 500000, 1000000]) {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:-9999px;width:600px;height:400px'
  document.body.appendChild(box)

  const said = []
  try {
    for (const count of sizes) {
      const began = performance.now()
      let graph = null
      try {
        graph = new Graph(box, { spaceSize: 8192, simulationFriction: 0.9 })

        const points = new Float32Array(count * 2)
        for (let at = 0; at < count; at++) {
          points[at * 2] = (Math.random() - 0.5) * 8000
          points[at * 2 + 1] = (Math.random() - 0.5) * 8000
        }
        const sizes2 = new Float32Array(count).fill(2)
        const colours = new Float32Array(count * 4).fill(0.6)

        // Two links per point, which is the shape a bipartite catalogue graph
        // has and a good deal denser than the tag skeleton this actually draws.
        const links = new Float32Array(count * 4)
        for (let at = 0; at < count; at++) {
          links[at * 4] = at
          links[at * 4 + 1] = (at + 1) % count
          links[at * 4 + 2] = at
          links[at * 4 + 3] = (at + 7) % count
        }

        graph.setPointPositions(points)
        graph.setPointSizes(sizes2)
        graph.setPointColors(colours)
        graph.setLinks(links)
        graph.render()
        graph.start()
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
        graph.pause()

        said.push(`${count}=${Math.round(performance.now() - began)}ms`)
      } catch (trouble) {
        said.push(`${count}=threw:${trouble.name}`)
        break
      } finally {
        try { graph?.destroy() } catch { /* a graph that threw may not destroy */ }
      }

      // Past ten seconds to get one frame up, nothing larger is worth asking.
      if (performance.now() - began > 10000) { said.push(`${count}=too slow, stopping`); break }
    }
  } finally {
    box.remove()
  }
  return said.join(' ')
}

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
    // Any arrangement will do: this measures what the GPU will take, not what
    // the picture looks like. @see pathTree.js for the real layout.
    const began = new Float32Array(tags.length * 2)
    const sizes = new Float32Array(tags.length)
    const colours = new Float32Array(tags.length * 4)
    for (let at = 0; at < tags.length; at++) {
      const angle = (at / tags.length) * Math.PI * 2
      began[at * 2] = Math.cos(angle) * 200
      began[at * 2 + 1] = Math.sin(angle) * 200
      sizes[at] = 6
      colours.set([0.5, 0.6, 0.9, 1], at * 4)
    }
    graph.setPointPositions(began.slice())
    graph.setPointSizes(sizes)
    graph.setPointColors(colours)

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
    return `points=${tags.length} links=${edges.length} readBack=${now ? now.length : 0}`
         + ` moved=${Boolean(moved)}`
  } finally {
    box.remove()
  }
}
