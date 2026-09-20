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

/* ---------------- a leaf is a clip, not a shared prefix ---------------- */
/*
 * Two things with the same name in the same place are two things.
 *
 * The last level used to be looked up in the same index as the folders above
 * it, so they became one node. A drum library never notices -- a path names a
 * file -- but Impro-Visor files 1,896 licks under 99 names, 345 of them called
 * "minor", and the map drew one dot for all 345. Eighteen per cent of the
 * phrase catalogue was not on it.
 */
const sameName = [
  { path: 'Book/jazz/minor' }, { path: 'Book/jazz/minor' }, { path: 'Book/jazz/minor' },
  { path: 'Book/jazz/blues' }, { path: 'Book/rock/minor' },
]
const kept = buildTree(sameName, { pathOf: (one) => one.path })
check('every clip gets a leaf of its own',
      kept.nodes.filter((one) => one.leaf).length, sameName.length)
// The folders above them are still shared -- that is what a folder is.
check('and the folders above them are still shared',
      kept.nodes.filter((one) => one.label === 'jazz').length, 1)
check('a shared folder counts everything under it',
      kept.nodes.find((one) => one.label === 'jazz').clips, 4)

/* ---------------- nothing has a thousand children --------------------- */
/*
 * Real catalogues are lopsided in ways no taxonomy fixes: one vendor folder
 * holds 1,321 patterns, and a progression genre holds 25,000 with only a
 * decade under it. Drawn, that is a hairball at one point of a readable tree.
 */
const lumpy = []
for (let n = 0; n < 900; n++) lumpy.push({ path: `one/clip ${String(n).padStart(4, '0')}` })
const capped = buildTree(lumpy, { pathOf: (one) => one.path, mostChildren: 32 })

const fanOf = (tree) => {
  const kids = new Map()
  tree.parents.forEach((parent) => {
    if (parent >= 0) kids.set(parent, (kids.get(parent) || 0) + 1)
  })
  return Math.max(tree.parents.filter((one) => one < 0).length, ...kids.values())
}
check('nothing is wider than the limit', fanOf(capped) <= 32, true)
check('and every clip is still drawn',
      capped.nodes.filter((one) => one.leaf && !one.shelf).length, lumpy.length)
// The shelves are structure, and say so, so a reader can tell them from a
// folder somebody named.
check('the shelves know they are shelves',
      capped.nodes.some((one) => one.shelf), true)
check('a shelf counts what is on it',
      capped.nodes.filter((one) => one.shelf).every((one) => one.clips > 0), true)

// Uncapped, the same catalogue is one node with nine hundred lines from it.
check('without the cap it is a hairball',
      fanOf(buildTree(lumpy, { pathOf: (one) => one.path, mostChildren: 0 })), 900)

/* ---------------- a fill is not a groove -------------------------------- */
/*
 * The map used to draw both as the same dot, so the only way to tell a fill
 * from a groove was to click it. The corpora say which -- every row carries a
 * kind -- so the leaf is marked from that and never from its name.
 *
 * Only `true` is written. Three quarters of a million clips are mostly
 * grooves, and `kind: 'beat'` on every one of them would be most of a
 * megabyte of stored map saying the default out loud.
 */
const mixed = buildTree([
  { path: 'Pack/Rock/groove 1.mid', kind: 'beat' },
  { path: 'Pack/Rock/fill 1.mid', kind: 'fill' },
  { path: 'Pack/Rock/groove 2.mid', kind: 'beat' },
], { fillOf: (one) => one.kind === 'fill' })

const marked = mixed.nodes.filter((one) => one.fill)
check('the fill is marked and nothing else is', marked.map((one) => one.label), ['fill 1.mid'])
check('a groove carries no mark at all',
      mixed.nodes.filter((one) => one.leaf).every((one) => one.fill === true || !('fill' in one)),
      true)
check('and a folder is never marked',
      mixed.nodes.filter((one) => !one.leaf).some((one) => one.fill), false)

// Without the option nothing is marked, which is what the other two
// catalogues get: a phrase is not a groove or a fill.
check('no marks when nothing says which is which',
      buildTree([{ path: 'a/b.mid', kind: 'fill' }]).nodes.some((one) => one.fill), false)

// A shelved catalogue keeps them. The shelves are rebuilt from the nodes, and
// an earlier version of that rebuild dropped everything but label and depth.
const shelved = buildTree(
  Array.from({ length: 300 }, (unused, n) => ({
    path: `one/clip ${String(n).padStart(4, '0')}.mid`,
    kind: n % 3 ? 'beat' : 'fill',
  })),
  { fillOf: (one) => one.kind === 'fill', mostChildren: 16 })
check('shelving does not lose the marks',
      shelved.nodes.filter((one) => one.fill).length, 100)

/* ---------------- finding a node by the path to it ---------------------- */
/*
 * A filter is not a different catalogue.
 *
 * The map used to be rebuilt out of the rows a filter matched, so every
 * touch of a dropdown was a different tree with different indexes in a
 * different arrangement. Marking instead needs the opposite of what the
 * tree does: the tree turns paths into nodes and forgets the paths, and
 * this has to find the node again from the path outside.
 */
const deep = buildTree([
  { path: 'Pack/Rock/fast.mid' },
  { path: 'Pack/Rock/slow.mid' },
  { path: 'Pack/Jazz/swing.mid' },
  { path: 'Other/Rock/one.mid' },
])
const find = pathFinder(deep)

check('a root is found', deep.nodes[find(['Pack'])].label, 'Pack')
check('and a folder inside it', deep.nodes[find(['Pack', 'Rock'])].label, 'Rock')
check('and a clip inside that', deep.nodes[find(['Pack', 'Rock', 'fast.mid'])].label, 'fast.mid')
// Two `Rock` folders in two libraries are two folders, and the path says which.
check('the same name in two libraries is two nodes',
      find(['Pack', 'Rock']) !== find(['Other', 'Rock']), true)
check('a path that is not there is not found', find(['Pack', 'Nope']), -1)
check('and neither is one that stops short of nothing', find(['Nope']), -1)

/* ---------------- shelves are walked through, not into ------------------ */
/*
 * A shelf is the map's own invention -- a range made to stop a folder
 * having a thousand children -- and no path a vendor wrote has `Ab–Ci` in
 * it. So a clip under a shelf has to be found by the path it really has.
 */
const wide = buildTree(
  Array.from({ length: 300 }, (unused, n) =>
    ({ path: `one/clip ${String(n).padStart(4, '0')}.mid` })),
  { mostChildren: 16 })
const inWide = pathFinder(wide)
check('the catalogue really was shelved', wide.nodes.some((one) => one.shelf), true)
check('and a clip under a shelf is still found by its own path',
      wide.nodes[inWide(['one', 'clip 0123.mid'])].label, 'clip 0123.mid')
check('every one of them', Array.from({ length: 300 }, (unused, n) =>
  inWide(['one', `clip ${String(n).padStart(4, '0')}.mid`])).every((at) => at >= 0), true)

/* ---------------- marking lights the way down --------------------------- */
const lit = markPaths(deep, [{ path: 'Pack/Rock/fast.mid' }],
                      (row) => row.path.split('/'))
check('the clip is lit', lit.has(find(['Pack', 'Rock', 'fast.mid'])), true)
// A lit clip inside a dark folder is a clip nobody can find.
check('and so is the folder it is in', lit.has(find(['Pack', 'Rock'])), true)
check('and the library above that', lit.has(find(['Pack'])), true)
check('its neighbour is not', lit.has(find(['Pack', 'Rock', 'slow.mid'])), false)
check('nor the folder beside it', lit.has(find(['Pack', 'Jazz'])), false)
check('nor the other library', lit.has(find(['Other'])), false)
check('three nodes lit -- the clip and the way down to it, no more', lit.size, 3)

// A row the tree has never heard of marks nothing rather than throwing.
check('a path with no node marks nothing',
      markPaths(deep, [{ path: 'Ghost/Rock/none.mid' }],
                (row) => row.path.split('/')).size, 0)

console.log(failed ? `path-tree: ${failed} FAILED` : 'path-tree: all checks passed')
