// A catalogue as the tree it already is.
//
// The first attempt drew words joined by how often they turn up together and it
// was a hairball. The mistake was treating a collection of files as a network.
// It is not one: it is libraries, then folders, then folders, then clips, and
// it has been a tree all along.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

const clips = [
  { path: 'Studio Drummer/Punk Rock/fast.mid', genre: 'Punk', sig: '4-4' },
  { path: 'Studio Drummer/Punk Rock/slow.mid', genre: 'Punk', sig: '4-4' },
  { path: 'Studio Drummer/Jazz/swing.mid', genre: 'Jazz', sig: '4-4' },
  { path: 'Vintage Drummer/Rock/one.mid', genre: 'Rock', sig: '3-4' },
]

const tree = buildTree(clips)

/* ---------------- the shape of it --------------------------------------- */
// Two libraries, three folders, four clips.
check('a node per place in the tree', tree.nodes.length, 9)
check('three levels: library, folder, clip', tree.depth, 3)

// Roots first, then their children, then theirs -- so a renderer drawing the
// first n gets the top of the tree rather than a slice from the middle.
check('the roots come first',
      tree.nodes.slice(0, 2).map((one) => one.label), ['Studio Drummer', 'Vintage Drummer'])
check('and every root has no parent', tree.parents.slice(0, 2), [-1, -1])
check('depth increases down the list',
      tree.nodes.every((one, at) => at === 0 || one.depth >= tree.nodes[at - 1].depth), true)

/*
 * One parent each, so the edge count is the node count less the roots.
 *
 * This is the whole difference from the hairball: a thousand words joined by
 * co-occurrence had twenty thousand edges, and a tree of a million nodes has a
 * million.
 */
check('one edge per node that has a parent', tree.edges.length / 2, tree.nodes.length - 2)

/* ---------------- two folders with the same name are two folders --------- */
/*
 * `Rock` under Studio Drummer and `Rock` under Vintage Drummer are different
 * folders. Joining them asserts a relationship that does not exist, and it is
 * exactly the sort of thing that made the first attempt a hairball.
 */
const twice = buildTree([
  { path: 'A/Rock/one.mid' },
  { path: 'B/Rock/two.mid' },
])
const rocks = twice.nodes.filter((one) => one.label === 'Rock')
check('the same name in two places is two nodes', rocks.length, 2)
check('each with its own clip', rocks.map((one) => one.clips), [1, 1])
// And no edge joins them.
let joined = false
for (let at = 0; at < twice.edges.length; at += 2) {
  const [a, b] = [twice.edges[at], twice.edges[at + 1]]
  if (twice.nodes[a].label === 'Rock' && twice.nodes[b].label === 'Rock') joined = true
}
check('and nothing joins them', joined, false)

// The same folder named twice in one library *is* one folder.
const shared = buildTree([{ path: 'A/Rock/one.mid' }, { path: 'A/Rock/two.mid' }])
check('but one folder mentioned twice is one node',
      shared.nodes.filter((one) => one.label === 'Rock').length, 1)
check('holding both clips',
      shared.nodes.find((one) => one.label === 'Rock').clips, 2)

/* ---------------- how many are under each ------------------------------- */
// A folder is worth drawing at the size of what it holds, and a library holds
// everything beneath it rather than the files directly in it.
const studio = tree.nodes.find((one) => one.label === 'Studio Drummer')
check('a library counts everything beneath it', studio.clips, 3)
check('a folder counts its own',
      tree.nodes.find((one) => one.label === 'Punk Rock').clips, 2)
check('and a clip counts itself',
      tree.nodes.find((one) => one.label === 'fast.mid').clips, 1)
check('only the clips are leaves',
      tree.nodes.filter((one) => one.leaf).length, 4)

/* ---------------- sorting by a facet re-roots it ------------------------- */
/*
 * The same clips, a different tree. With `sortBy: genre` the top level is the
 * genres and the libraries hang underneath whichever genre they are in -- the
 * path is simply prefixed, and everything below works the same way.
 */
const byGenre = buildTree(clips, { facetOf: (one) => one.genre })
check('the roots are the genres',
      byGenre.nodes.filter((one) => one.depth === 0).map((one) => one.label).sort(),
      ['Jazz', 'Punk', 'Rock'])
check('and it is one level deeper', byGenre.depth, tree.depth + 1)
check('with the same clips at the bottom',
      byGenre.nodes.filter((one) => one.leaf).length, 4)

// A library appearing under two genres is two nodes, for the same reason two
// folders called Rock are.
check('a library in two genres appears under each',
      byGenre.nodes.filter((one) => one.label === 'Studio Drummer').length, 2)

// A clip with nothing to sort by is not dropped -- a filter that offers a genre
// and a tree that hides everything without one disagree about one catalogue.
const missing = buildTree([{ path: 'A/x.mid' }, { path: 'A/y.mid', genre: 'Jazz' }],
                          { facetOf: (one) => one.genre })
check('a clip with no value gets a level that says so',
      missing.nodes.filter((one) => one.depth === 0).map((one) => one.label).sort(),
      ['(none)', 'Jazz'])

/* ---------------- where you are, and the way down ----------------------- */
const deep = tree.nodes.findIndex((one) => one.label === 'fast.mid')
check('the trail is the path', trail(tree, deep).map((one) => one.label),
      ['Studio Drummer', 'Punk Rock', 'fast.mid'])

const library = tree.nodes.findIndex((one) => one.label === 'Studio Drummer')
check('the children are the folders, biggest first',
      childrenOf(tree, library).map((one) => one.label), ['Punk Rock', 'Jazz'])
check('and a leaf has none', childrenOf(tree, deep), [])
check('and nothing is a child of nowhere', childrenOf(tree, -1), [])

/*
 * Found by index rather than by looking.
 *
 * Scanning every node's parent is fine for nine nodes and quadratic for eight
 * hundred thousand -- and the label pass asks this twice a frame, so at full
 * scale it was two scans of the whole tree sixty times a second. A check script
 * doing it once per node never finished.
 */
check('every node has a slice of the child list',
      tree.childAt.length, tree.nodes.length + 1)
check('and the slices cover every node that has a parent',
      tree.childList.length, tree.nodes.length - 2)
check('the offsets never go backwards',
      [...tree.childAt].every((one, at) => at === 0 || one >= tree.childAt[at - 1]), true)
// Every child appears under exactly one parent, which is what a tree means.
check('and every child is listed once',
      new Set(tree.childList).size, tree.childList.length)

/* ---------------- what a renderer takes --------------------------------- */
// A library holding four hundred thousand and a clip holding one are the ends.
// The log keeps the libraries from being the whole screen while leaving a
// folder always bigger than its children.
const sizes = treeSizes(tree.nodes, { smallest: 3, largest: 26 })
check('one size per node', sizes.length, tree.nodes.length)
check('the biggest thing is the biggest', sizes[library], 26)
check('and nothing is invisible', [...sizes].every((one) => one >= 3), true)

/*
 * Colour says which *level* a node is, because that is what a reader needs
 * first in a tree and no two levels share it -- and it says it in the theme's
 * own colours, because a graph in a palette nothing else on screen uses looks
 * like a different program.
 */
const theme = { from: '#7c5cff', to: '#22d3ee', dim: '#5b6480' }
const colours = treeColours(tree.nodes, theme)
check('four channels each', colours.length, tree.nodes.length * 4)
check('and opaque', colours[3], 1)
check('every channel in range', [...colours].every((one) => one >= 0 && one <= 1), true)

const rootColour = colours.slice(0, 3).join()
const leafColour = colours.slice(deep * 4, deep * 4 + 3).join()
check('a root and a leaf are different colours', rootColour === leafColour, false)

// Compared with a tolerance: the colours are kept in a Float32Array and the
// expectation is a double, so they differ in the eighth decimal place and
// always will.
const sameColour = (label, got, want) => {
  const off = [0, 1, 2].some((n) => Math.abs(got[n] - want[n]) > 1e-6)
  if (off) { failed++; console.log(`FAIL ${label}: got ${[...got].slice(0, 3)} want ${want}`) }
}

// The top of the tree is the theme's first accent.
sameColour('a root is the first accent', colours.slice(0, 3), toRgb('#7c5cff'))

// Change the theme and the graph changes with it, which is the whole point.
const other = treeColours(tree.nodes, { from: '#ff2e97', to: '#00e5ff', dim: '#7a4b86' })
sameColour('another theme is another graph', other.slice(0, 3), toRgb('#ff2e97'))

/*
 * And the leaves fade towards the dim colour.
 *
 * They are most of a catalogue -- three quarters of a million of the eight
 * hundred thousand nodes -- so at full strength they are the entire picture and
 * the structure above them is invisible.
 */
const folder = tree.nodes.findIndex((one) => one.label === 'Punk Rock')
const far = (at) => Math.hypot(...[0, 1, 2].map((n) =>
  colours[at * 4 + n] - toRgb(theme.dim)[n]))
check('a leaf sits nearer the dim colour than its folder', far(deep) < far(folder), true)

/* ---------------- reading a colour ------------------------------------- */
check('six digits', toRgb('#7c5cff'), [124 / 255, 92 / 255, 255 / 255])
check('three digits', toRgb('#fff'), [1, 1, 1])
check('without a hash', toRgb('000000'), [0, 0, 0])
// Unreadable is mid grey: visible and obviously wrong beats invisible and
// puzzling.
check('rubbish is grey', toRgb('not a colour'), [0.5, 0.5, 0.5])
check('and nothing is too', toRgb(null), [0.5, 0.5, 0.5])
check('with an alpha, for the things that take strings',
      rgba('#7c5cff', 0.5), 'rgba(124,92,255,0.5)')

// Each level on its own ring, so a force layout starts tidy rather than knotted.
const rings = ringsByDepth(tree.nodes, { spacing: 100 })
check('two numbers per node', rings.length, tree.nodes.length * 2)
check('a root sits at the middle', Math.hypot(rings[0], rings[1]) < 1, true)
check('and a leaf sits further out',
      Math.hypot(rings[deep * 2], rings[deep * 2 + 1]) > 150, true)

/* ---------------- and it stops before it runs out of room --------------- */
// A tree cannot be built larger than a renderer will take, and stopping is
// better than a page that dies half way through drawing.
const huge = buildTree(
  Array.from({ length: 500 }, (_, n) => ({ path: `lib/${n}/clip.mid` })),
  { mostNodes: 20 }
)
check('it stops at the ceiling', huge.nodes.length <= 20, true)
check('and says that it did', huge.truncated, true)
check('while an ordinary tree does not', tree.truncated, false)

check('nothing at all is survivable', buildTree([]).nodes.length, 0)
check('and produces no edges', buildTree([]).edges.length, 0)
check('a clip with no path is skipped', buildTree([{ path: '' }]).nodes.length, 0)

/* ---------------- only what was asked for ------------------------------- */
/*
 * Opening eight hundred thousand nodes at once is a wall of dots whatever the
 * layout. The top two levels of a real catalogue are about nine hundred nodes,
 * which is a picture; everything below is detail nobody has asked for yet.
 */
const shallow = visibleSlice(tree)
check('the roots and one level down', shallow.nodes.length, 5)
check('which is the libraries and their folders',
      shallow.nodes.map((one) => one.label).sort(),
      ['Jazz', 'Punk Rock', 'Rock', 'Studio Drummer', 'Vintage Drummer'])
check('and it is still a tree', shallow.edges.length / 2, shallow.nodes.length - 2)

// A folder whose children are folded up is drawn as an end, and says how many
// are inside it.
const folded = shallow.nodes.find((one) => one.label === 'Punk Rock')
check('a folded folder reads as an end', folded.leaf, true)
check('and says how many are inside', folded.hidden, 2)

// Open it and its children appear -- and only its.
const punk = tree.nodes.findIndex((one) => one.label === 'Punk Rock')
const opened = visibleSlice(tree, new Set([punk]))
check('opening one shows its children', opened.nodes.length, 7)
check('including them by name', opened.nodes.some((one) => one.label === 'fast.mid'), true)
check('but not another folder\'s', opened.nodes.some((one) => one.label === 'swing.mid'), false)
check('and the opened one is no longer an end',
      opened.nodes.find((one) => one.label === 'Punk Rock').leaf, false)

// Carried back to the whole tree, so a selection means something outside the
// slice it was made in.
check('every visible node knows where it came from',
      opened.origin.length, opened.nodes.length)
check('and points at the same thing',
      tree.nodes[opened.origin[0]].label, opened.nodes[0].label)

check('nothing is survivable', visibleSlice(null).nodes.length, 0)

/* ---------------- where everything goes -------------------------------- */
/*
 * The equal-angle algorithm (Felsenstein, 1989): every subtree gets a wedge of
 * the circle in proportion to the leaves under it, and each node sits at the
 * middle of its own wedge one ring further out than its parent.
 *
 * The property worth testing is the one a force simulation cannot give: a
 * subtree's wedge belongs to that subtree and nothing else is ever placed in
 * it, so branches cannot cross.
 */
const spots = radialPositions(tree, { ringGap: 100 })
check('two numbers per node', spots.length, tree.nodes.length * 2)

const radius = (at) => Math.hypot(spots[at * 2], spots[at * 2 + 1])
// In 0..2pi rather than -pi..pi. Wedges are handed out from zero going round,
// so comparing them in atan2's range puts the second half of the circle below
// the first and makes every comparison wrong at the seam.
const angle = (at) =>
  (Math.atan2(spots[at * 2 + 1], spots[at * 2]) + Math.PI * 2) % (Math.PI * 2)

// Depth is the ring, so a child is always one ring further out than its parent.
tree.parents.forEach((parent, child) => {
  if (parent < 0) return
  const right = Math.abs(radius(child) - radius(parent) - 100) < 1
  if (!right) { failed++; console.log(`FAIL ${tree.nodes[child].label} is not one ring out`) }
})

/*
 * The wedges do not overlap, which is what stops branches crossing.
 *
 * Studio Drummer holds three clips and Vintage Drummer one, so they get three
 * quarters and one quarter of the circle -- and everything under each stays
 * inside its own share.
 */
const studioAt = tree.nodes.findIndex((one) => one.label === 'Studio Drummer')
const vintageAt = tree.nodes.findIndex((one) => one.label === 'Vintage Drummer')
const under = (root) => {
  const out = []
  tree.nodes.forEach((one, at) => {
    let here = at
    while (here >= 0) { if (here === root) { out.push(at); break } here = tree.parents[here] }
  })
  return out
}
const studioAngles = under(studioAt).filter((at) => at !== studioAt).map(angle)
const vintageAngles = under(vintageAt).filter((at) => at !== vintageAt).map(angle)
check('one library\'s branch does not reach into the other\'s',
      Math.max(...studioAngles) < Math.min(...vintageAngles), true)

// A bigger subtree gets a bigger wedge, which is the whole idea.
check('three clips take more of the circle than one',
      (Math.max(...studioAngles) - Math.min(...studioAngles))
      > (Math.max(...vintageAngles) - Math.min(...vintageAngles) || 0), true)

// Deterministic: the same tree is the same picture, every time.
check('the same tree twice', [...radialPositions(tree, { ringGap: 100 })], [...spots])

// A single root sits in the middle rather than out on the first ring.
const oneRoot = buildTree([{ path: 'A/x.mid' }, { path: 'A/y.mid' }])
const alone = radialPositions(oneRoot, { ringGap: 100 })
check('a lone root is at the centre', Math.hypot(alone[0], alone[1]) < 1, true)

check('no nodes is no positions', radialPositions(buildTree([])).length, 0)

console.log(failed ? `path-tree: ${failed} FAILED` : 'path-tree: all checks passed')
