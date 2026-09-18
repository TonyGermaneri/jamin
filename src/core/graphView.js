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
 * How much of a tree this machine will draw, and how quickly.
 *
 * Reported rather than asserted: the answer is about the machine, and a test
 * that fails on a slow laptop teaches nobody anything. What the boot check
 * asserts is only that a tree the size a catalogue actually needs is drawn at
 * all. @see native/tools/boot_probe.m
 *
 * The renderer is imported here rather than passed in, now that it is ours. It
 * was an argument when it was a third-party force-graph engine and this file
 * made a point of not importing one.
 */
export async function stressGraph(sizes = [1000, 5000, 20000, 60000]) {
  const { TreeGraph } = await import('../canvas/treeGraph.js')
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px'
  document.body.appendChild(box)

  const said = []
  try {
    for (const count of sizes) {
      const began = performance.now()
      let graph = null
      try {
        graph = new TreeGraph(box)
        graph.setTree(fakeTree(count), { openTo: 99 })
        // A frame, so what is timed includes painting it.
        await new Promise((drawn) => requestAnimationFrame(drawn))
        said.push(`${count}=${Math.round(performance.now() - began)}ms`)
      } catch (trouble) {
        said.push(`${count}=threw ${(trouble && trouble.name) || trouble}`)
        break
      } finally {
        if (graph) graph.destroy()
      }
    }
  } finally {
    box.remove()
  }
  return said.join(' ')
}

/**
 * That the tree draws at all, in this web view.
 *
 * A canvas that fails to get a context fails silently -- the page renders and
 * the box stays empty -- which is exactly the shape of bug nobody notices
 * until somebody turns the setting on.
 */
export async function measureGraph() {
  const { TreeGraph } = await import('../canvas/treeGraph.js')
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px'
  document.body.appendChild(box)

  try {
    const graph = new TreeGraph(box)
    graph.setTree(fakeTree(64), { openTo: 99 })
    await new Promise((drawn) => requestAnimationFrame(drawn))
    const showing = graph.drawn.length
    const fitted = graph.at.k !== 1
    graph.destroy()
    return `points=${showing} fitted=${fitted}`
  } finally {
    box.remove()
  }
}

/** A tree of a given size, for the probes to draw. */
function fakeTree(count) {
  const nodes = []
  const parents = []
  for (let n = 0; n < count; n++) {
    nodes.push({ label: `n${n}`, depth: n === 0 ? 0 : 1 + (n % 3), clips: count - n, leaf: false })
    parents.push(n === 0 ? -1 : Math.floor((n - 1) / 4))
  }
  return { nodes, parents, depth: 5, truncated: false }
}
