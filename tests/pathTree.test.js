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

/* ---------------- what a renderer takes --------------------------------- */
// A library holding four hundred thousand and a clip holding one are the ends.
// The log keeps the libraries from being the whole screen while leaving a
// folder always bigger than its children.
const sizes = treeSizes(tree.nodes, { smallest: 3, largest: 26 })
check('one size per node', sizes.length, tree.nodes.length)
check('the biggest thing is the biggest', sizes[library], 26)
check('and nothing is invisible', [...sizes].every((one) => one >= 3), true)

// Colour says which *level* a node is, because that is what a reader needs
// first in a tree and no two levels share it.
const colours = treeColours(tree.nodes)
check('four channels each', colours.length, tree.nodes.length * 4)
check('and opaque', colours[3], 1)
check('every channel in range', [...colours].every((one) => one >= 0 && one <= 1), true)
const rootHue = colours.slice(0, 3).join()
const leafHue = colours.slice(deep * 4, deep * 4 + 3).join()
check('a root and a leaf are different colours', rootHue === leafHue, false)

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

console.log(failed ? `path-tree: ${failed} FAILED` : 'path-tree: all checks passed')
