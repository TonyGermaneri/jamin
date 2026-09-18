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

/* ---------------- drawn where the renderer can see it ------------------ */
/*
 * cosmos.gl's space runs from 0 to `spaceSize` with the middle at half of it.
 * The layout was drawn around the origin, which is the bottom-left corner, so
 * three quarters of every ring sat outside the space: measured on a tree of
 * 5,046 nodes, 3,780 of them were out of bounds and the whole picture spanned
 * -1680..1680 in an 8192 space. On screen that is a graph that recentres into
 * nothing. Both halves of the fix are checked here: where the middle is, and
 * that the rings shrink to fit however deep the tree is opened.
 */
const SPACE = 8192
const deepClips = []
for (let lib = 0; lib < 4; lib++) {
  for (let a = 0; a < 6; a++) {
    for (let b = 0; b < 6; b++) deepClips.push({ path: `lib${lib}/a${a}/b${b}/clip.mid` })
  }
}
const deepTree = buildTree(deepClips, { pathOf: (one) => one.path })

const outside = (places) => {
  let out = 0
  for (let n = 0; n < places.length; n += 2) {
    if (places[n] < 0 || places[n + 1] < 0 || places[n] > SPACE || places[n + 1] > SPACE) out++
  }
  return out
}

// However much of it is open, all of it is somewhere the renderer can draw.
const everything = new Set(deepTree.nodes.map((_, n) => n))
for (const open of [new Set(), everything]) {
  const slice = visibleSlice(deepTree, open)
  const places = radialPositions(slice, { centre: SPACE / 2, fitRadius: SPACE / 2 - 240 })
  check(`${slice.nodes.length} nodes all inside the space`, outside(places), 0)
  // And the slice's edges address the slice's own points, not the whole
  // tree's -- the renderer holds only what is drawn.
  let beyond = 0
  for (const one of slice.edges) if (one >= slice.nodes.length) beyond++
  check(`${slice.nodes.length} nodes: every edge addresses a drawn point`, beyond, 0)
}

// Told where the middle is, that is where a lone root goes.
const middled = radialPositions(oneRoot, { ringGap: 100, centre: SPACE / 2 })
check('a lone root sits at the middle it was given',
      [Math.round(middled[0]), Math.round(middled[1])], [SPACE / 2, SPACE / 2])

// `fitRadius` is a budget for the whole layout, however deep it goes.
const tight = radialPositions(deepTree, { centre: 0, fitRadius: 1000 })
let furthest = 0
for (let n = 0; n < tight.length; n += 2) {
  furthest = Math.max(furthest, Math.hypot(tight[n], tight[n + 1]))
}
check('nothing is drawn past the radius it was given', furthest <= 1000.001, true)

/* ---------------- opening a folder is additive ------------------------ */
/*
 * The property the whole view rests on: opening a folder must not move
 * anything already on the screen.
 *
 * It used to move everything. Wedges were weighed by the leaves of the slice
 * being drawn, and a closed folder counts as one leaf -- so opening one
 * replaced that single leaf with all its contents, repartitioned every wedge
 * in the tree, and slid every node to somewhere new. Combined with a ring
 * spacing worked out from the visible depth, which changes too, the answer to
 * a double-click was a whole new picture. Weighing by clips fixes the angles
 * and spacing the rings by the whole tree's depth fixes the radii.
 */
const lopsided = []
for (let lib = 0; lib < 4; lib++) {
  // Uneven on purpose: equal branches would hide a repartitioning.
  for (let a = 0; a < 5; a++) {
    for (let b = 0; b < (a + 1) * 2; b++) lopsided.push({ path: `lib${lib}/a${a}/b${b}/clip.mid` })
  }
}
const openTree = buildTree(lopsided, { pathOf: (one) => one.path })
/*
 * Laid out the way the view lays it out: fitted to a radius, curved, and told
 * the whole tree's depth. The uncurved ring-gap path was what this checked
 * first, and it is not the one that ships -- the fitted path had a way of
 * re-spacing every ring as soon as the slice got deeper, which is the same
 * fault wearing a different hat.
 */
const wholeDepth = Math.max(1, openTree.depth - 1)
const laidOut = (slice) => radialPositions(slice, {
  centre: SPACE / 2, fitRadius: SPACE / 2 - 240, deepest: wholeDepth,
})
const spotsOf = (slice, places) => {
  const out = new Map()
  slice.origin.forEach((was, index) => out.set(was, [places[index * 2], places[index * 2 + 1]]))
  return out
}

const openSet = new Set()
let wasShown = visibleSlice(openTree, openSet)
let wasAt = spotsOf(wasShown, laidOut(wasShown))
let everMoved = 0
let everGrew = 0

for (let round = 0; round < 5; round++) {
  // Whatever the biggest closed thing on screen is, which is what somebody
  // double-clicks.
  let pick = -1
  wasShown.nodes.forEach((one, index) => {
    if (!one.hidden) return
    if (pick < 0 || one.clips > wasShown.nodes[pick].clips) pick = index
  })
  if (pick < 0) break
  openSet.add(wasShown.origin[pick])

  const nowShown = visibleSlice(openTree, openSet)
  const nowAt = spotsOf(nowShown, laidOut(nowShown))
  if (nowShown.nodes.length > wasShown.nodes.length) everGrew++

  for (const [was, [x, y]] of wasAt) {
    const now = nowAt.get(was)
    if (!now) continue
    if (Math.hypot(now[0] - x, now[1] - y) > 0.5) everMoved++
  }
  wasShown = nowShown
  wasAt = nowAt
}

check('opening a folder actually adds nodes', everGrew, 5)
check('and moves nothing that was already drawn', everMoved, 0)

// A node's share of the circle is what is under it in the catalogue, not what
// happens to be unfolded -- which is why the above holds.
const justRoots = visibleSlice(openTree, new Set())
const allOpen = visibleSlice(openTree, new Set(openTree.nodes.map((_, n) => n)))
const angleOf = (slice, places, was) => {
  const index = slice.origin.indexOf(was)
  return Math.atan2(places[index * 2 + 1] - SPACE / 2, places[index * 2] - SPACE / 2)
}
const aRoot = justRoots.origin[0]
check('a root keeps its bearing however much is open',
      Math.abs(angleOf(justRoots, laidOut(justRoots), aRoot)
               - angleOf(allOpen, laidOut(allOpen), aRoot)) < 1e-6, true)

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

/* ---------------- several roots are not all the centre ---------------- */
/*
 * The radius is the depth times the ring gap, so at depth zero every root is
 * the same point. One root belongs there; forty-nine drum libraries drawn on
 * top of one another do not, and neither do the phrase catalogue's two
 * sources -- which is what "Impro-Visor" and "POP909" printed over each other
 * in the middle of the map turned out to be.
 */
const manyRoots = buildTree(
  ['A', 'B', 'C', 'D'].flatMap((lib) => [{ path: `${lib}/one.mid` }, { path: `${lib}/two.mid` }]),
  { pathOf: (one) => one.path })
const spread = radialPositions(manyRoots, { ringGap: 100, centre: 0 })
const roots = manyRoots.nodes
  .map((one, at) => ({ at, depth: one.depth }))
  .filter((one) => manyRoots.parents[one.at] < 0)
check('four libraries, four roots', roots.length, 4)
const where = roots.map((one) => `${Math.round(spread[one.at * 2])},${Math.round(spread[one.at * 2 + 1])}`)
check('and none of them is on top of another', new Set(where).size, 4)
check('none of them is at the centre either',
      roots.every((one) => Math.hypot(spread[one.at * 2], spread[one.at * 2 + 1]) > 1), true)

// A single root still belongs in the middle, with its children around it.
const lone = buildTree([{ path: 'A/one.mid' }, { path: 'A/two.mid' }], { pathOf: (o) => o.path })
const around = radialPositions(lone, { ringGap: 100, centre: 0 })
check('one root is still the centre', Math.hypot(around[0], around[1]) < 1, true)

console.log(failed ? `path-tree: ${failed} FAILED` : 'path-tree: all checks passed')
