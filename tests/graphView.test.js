// What a catalogue graph looks like, and how the keyboard walks it.
//
// The arithmetic that decides the picture, and the navigation that makes a
// graph worth having over a list -- both testable without a GPU, which is the
// reason they live apart from the renderer.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
function near(label, got, want, slack = 1e-4) {
  if (Math.abs(got - want) > slack) { failed++; console.log(`FAIL ${label}: got ${got} want ~${want}`) }
}

/* ---------------- one engine, three catalogues -------------------------- */
// A drum groove has a path and the path is the whole story. A phrase has no
// path at all. The adapter is the only part that knows which is which.
check('a groove is its path',
      ADAPTERS.drums.textOf({ path: 'Studio/Punk Rock/04.mid' }), 'Studio/Punk Rock/04.mid')

const phrase = { name: 'F# comp 19', kind: 'part', category: 'minor seventh',
                 origin: 'POP909 #024', sourceChord: 'F#m7' }
const words = ADAPTERS.phrases.textOf(phrase)
check('a phrase is what it carries', words.includes('minor seventh'), true)
check('and where it came from', words.includes('POP909'), true)
// The number in "POP909 #024" is *that song*, not a category. Keeping it would
// put eight hundred single-clip nodes on the map, one per song.
check('but not which song', words.includes('024'), false)

check('a progression is its name and its tags',
      ADAPTERS.progressions.textOf({ name: 'ii-V-I', tags: ['jazz', 'bebop'] }),
      'ii-V-I / jazz / bebop')

/* ---------------- how big each word is drawn ---------------------------- */
/*
 * Area, not radius.
 *
 * The commonest word in a real collection carries a hundred thousand clips and
 * the rarest carries eight. Drawn to scale the small ones are invisible and the
 * large ones are the screen; a reader judges area, so the radius goes as the
 * root and the area ends up proportional.
 */
const tags = [
  { tag: 'blues', clips: 10000 },
  { tag: 'shuffle', clips: 2500 },
  { tag: 'bossa', clips: 100 },
]
const sizes = sizesFor(tags, { smallest: 4, largest: 34 })
check('the biggest gets the biggest', sizes[0], 34)
check('the smallest gets the smallest', sizes[2], 4)
check('and nothing is invisible', sizes.every((one) => one >= 4), true)

// Four times the clips is twice the radius, which is four times the area.
const doubled = sizesFor([{ tag: 'a', clips: 100 }, { tag: 'b', clips: 400 }],
                         { smallest: 0, largest: 20 })
near('four times the clips is twice the radius', doubled[1] / 20, 1)
near('and the quarter sits at nought', doubled[0], 0)

check('one word is survivable', sizesFor([{ tag: 'only', clips: 5 }]).length, 1)
check('and none at all', sizesFor([]).length, 0)

/* ---------------- colour ------------------------------------------------ */
// The same word is the same colour in every session and every catalogue, which
// is what makes a map learnable rather than merely pretty.
const once = coloursFor(tags)
const again = coloursFor(tags)
check('colour is deterministic', [...once], [...again])
check('four channels each', once.length, tags.length * 4)
check('and opaque', [once[3], once[7], once[11]], [1, 1, 1])
check('every channel is in range',
      [...once].every((one) => one >= 0 && one <= 1), true)

// Different words, different hues -- otherwise the map is one colour.
const blues = once.slice(0, 3).join()
const bossa = once.slice(8, 11).join()
check('two words are not the same colour', blues === bossa, false)

// A word keeps its colour when the catalogue around it changes, because the
// hue comes from the word rather than from its place in the list.
const reordered = coloursFor([{ tag: 'bossa', clips: 100 }, { tag: 'blues', clips: 10000 }])
near('hue survives reordering', reordered[4], once[0], 0.02)

/* ---------------- a starting arrangement -------------------------------- */
// Cosmos settles from wherever it is put. From random noise the first second
// looks like an explosion; from a ring it collapses inward into something
// recognisable, and with the simulation off it is still a readable picture.
const ring = ringPositions(8, { radius: 100 })
check('two numbers per node', ring.length, 16)
for (let at = 0; at < 8; at++) {
  near(`node ${at} is on the ring`,
       Math.hypot(ring[at * 2], ring[at * 2 + 1]), 100, 0.5)
}
check('nothing is on top of anything else',
      new Set(Array.from({ length: 8 }, (_, at) => `${ring[at * 2]},${ring[at * 2 + 1]}`)).size, 8)
check('and no nodes is no positions', ringPositions(0).length, 0)

/* ---------------- who is next to whom ----------------------------------- */
//      blues ——8—— shuffle ——3—— bossa
//        \____________2____________/
const edges = [[0, 1, 8], [1, 2, 3], [0, 2, 2]]
const neighbours = neighboursOf(3, edges)
check('an edge goes both ways', neighbours[1].map((one) => one.at), [0, 2])
check('and the strongest comes first', neighbours[0].map((one) => one.at), [1, 2])
check('with its weight', neighbours[0][0].weight, 8)

// A node related to itself is not a relationship, and by the time an edge list
// reaches here it should not contain one -- but a renderer reading a self-edge
// draws a line from a point to itself, so it is dropped rather than trusted.
check('nothing is next to itself', neighboursOf(2, [[0, 0, 9]])[0].length, 0)

/* ---------------- where the arrow keys go ------------------------------- */
/*
 * Walking edges is what a graph is for, and the thing a mouse does badly: a
 * node's strongest relationship can be anywhere on screen, and finding it by
 * eye in a thousand-node cloud is not finding it.
 */
let where = { at: 0, from: -1, along: 0 }

check('right moves along the neighbours', walk(neighbours, where, 'right').along, 1)
where = walk(neighbours, where, 'right')
check('and wraps round the end', walk(neighbours, where, 'right').along, 0)
check('left goes back', walk(neighbours, where, 'left').along, 0)

// Down steps into whichever neighbour is pointed at.
where = { at: 0, from: -1, along: 0 }
const stepped = walk(neighbours, where, 'down')
check('down goes to the pointed neighbour', stepped.at, 1)
check('remembering where it came from', stepped.from, 0)

/*
 * And up comes back, landing on the edge it arrived by.
 *
 * Without that, going up and down again lands on whichever neighbour happens to
 * be strongest rather than where you were -- which makes the keyboard a way of
 * getting lost rather than a way of looking around.
 */
const returned = walk(neighbours, stepped, 'up')
check('up goes back', returned.at, 0)
check('onto the edge it came by', neighbours[returned.at][returned.along].at, 1)
check('and back down again returns', walk(neighbours, returned, 'down').at, 1)

// Nowhere to go is staying put rather than throwing.
const lonely = neighboursOf(2, [])
check('a node with no neighbours stays', walk(lonely, { at: 0, from: -1, along: 0 }, 'down').at, 0)
check('and right does nothing', walk(lonely, { at: 0, from: -1, along: 0 }, 'right').along, 0)
check('nor does up from nowhere', walk(neighbours, { at: 0, from: -1, along: 0 }, 'up').at, 0)
check('and an unknown key is a no-op', walk(neighbours, { at: 0, from: -1, along: 1 }, 'z').along, 1)

/* ---------------- the line along the top -------------------------------- */
// Both a readout and the keyboard's menu: the same list, in the same order, as
// the arrow keys walk.
const table = [{ tag: 'blues', clips: 10000 }, { tag: 'shuffle', clips: 2500 }, { tag: 'bossa', clips: 100 }]
const strip = relationships(table, neighbours, { at: 0, along: 1 })
check('it names the word', strip.word, 'blues')
check('and how many clips carry it', strip.clips, 10000)
check('its relationships, strongest first', strip.with.map((one) => one.tag), ['shuffle', 'bossa'])
check('with how many clips share both', strip.with[0].clips, 8)
check('and which one the keyboard is on', strip.with.map((one) => one.pointed), [false, true])

const short = relationships(table, neighbours, { at: 0, along: 0 }, 1)
check('a long list is cut', short.with.length, 1)
check('and says how many were left', short.more, 1)

console.log(failed ? `graph-view: ${failed} FAILED` : 'graph-view: all checks passed')
