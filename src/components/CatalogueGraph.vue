<script>
/*
 * The probe's way in, registered when this module is evaluated rather than when
 * a component mounts.
 *
 * `<script setup>` becomes the setup function and runs per instance, so hanging
 * it there meant the probe could only see a graph that was already on screen --
 * which is the one case where nobody needs telling it works.
 *
 * @see core/graphView.js measureGraph, native/tools/boot_probe.m
 */
import { Graph as CosmosGraph } from '@cosmos.gl/graph'
import { measureGraph, stressGraph } from '../core/graphView.js'

if (typeof window !== 'undefined') {
  window.__jaminGraphProbe = () => measureGraph(CosmosGraph)
  window.__jaminGraphStress = (sizes) => stressGraph(CosmosGraph, sizes)
}

export default {}
</script>

<script setup>
/**
 * A catalogue, drawn as the tree it already is.
 *
 * The first version drew words joined by how often they turned up together, and
 * it was a hairball -- every word related to every other, a hundred thousand
 * hairlines, no way to tell where you were. The mistake was treating a
 * collection of files as a network. It is not a network. It is libraries, then
 * folders, then folders, then clips.
 *
 * So every node is a place in the tree and every node has exactly one parent.
 * Two folders both called `Rock` in two different libraries are two nodes,
 * because they are two folders. @see core/pathTree.js
 *
 * One component for three collections: everything that knows which collection
 * it is looking at lives in whoever builds the tree.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Graph } from '@cosmos.gl/graph'
import { state } from '../store.js'
import {
  treeSizes, treeColours, trail, childrenOf, rgba, visibleSlice, radialPositions,
} from '../core/pathTree.js'

const props = defineProps({
  /** `{ nodes, edges, parents, depth, truncated }` from core/pathTree.js. */
  tree: { type: Object, default: null },
  /** Where it settled last time, or null. */
  positions: { type: Object, default: null },
  /**
   * Nothing but the canvas.
   *
   * Inside the full-screen map the breadcrumb and the buttons live on the
   * glass in front rather than in a strip above and a strip below, and those
   * two strips are the difference between a canvas that fills the screen and
   * one that nearly does. @see components/CatalogueMap.vue
   */
  bare: { type: Boolean, default: false },
})
const emit = defineEmits(['pick'])

const canvas = ref(null)
/** Shallow: cosmos holds GPU handles and must never be made reactive. */
const engine = shallowRef(null)

/*
 * Which folders are open.
 *
 * The view starts at the libraries and one level down -- about nine hundred
 * nodes on a real catalogue, which is a picture. Eight hundred thousand at once
 * is a wall of dots whatever the layout, so the rest arrives when it is asked
 * for: double-click a node and it unfolds. @see core/pathTree.js visibleSlice
 */
const opened = ref(new Set())

/** What is actually drawn: the tree, cut down to what is open. */
const shown = computed(() =>
  (props.tree ? visibleSlice(props.tree, opened.value) : null))

const nodes = computed(() => (shown.value && shown.value.nodes) || [])
const at = ref(-1)
const along = ref(0)

const where = computed(() => (at.value >= 0 && shown.value ? trail(shown.value, at.value) : []))
const below = computed(() => (at.value >= 0 && shown.value ? childrenOf(shown.value, at.value) : []))

/**
 * The theme's own colours, which the graph is drawn in.
 *
 * `accent` and `accentAlt` are the two ends of the depth ramp, `dim` is what
 * the leaves fade towards and what the edges are drawn in, and `error` marks
 * whatever is selected. A graph in a palette nothing else on screen uses looks
 * like a different program. @see core/pathTree.js treeColours
 */
const theme = computed(() => state.settings.theme)

/*
 * The simulation's dials, in settings rather than in this file.
 *
 * What makes a tree of nine nodes readable is not what makes one of eight
 * hundred thousand readable, and no single set of numbers is right for both.
 * These are the ones cosmos.gl actually takes, named as it names them, so that
 * turning one here means the same thing as turning it in its documentation.
 */
const physics = computed(() => state.settings.graph.physics)


/*
 * How big cosmos's world is.
 *
 * Its space runs from 0 to this in both directions with the middle at half of
 * it, which the layout has to be told (@see core/pathTree.js radialPositions)
 * -- a tree drawn around the origin is a tree drawn around the corner.
 */
const SPACE = 8192

/** How much ink a single edge can have before a thousand of them is a wall. */
function inkForLinks(count) {
  if (count <= 120) return 0.38
  // Halving each time the drawing quadruples, floored so structure never
  // disappears entirely.
  return Math.max(0.05, 0.38 * Math.sqrt(120 / count))
}

/* ---------------- building it ---------------------------------------- */

function build() {
  if (!canvas.value || !nodes.value.length) return

  engine.value?.destroy?.()

  const graph = new Graph(canvas.value, {
    spaceSize: SPACE,
    backgroundColor: 'rgba(0,0,0,0)',
    /*
     * A tree wants different physics from a cloud.
     *
     * Strong springs and low repulsion: each node is held by exactly one parent,
     * so the springs *are* the structure, and letting repulsion dominate turns a
     * tidy hierarchy back into the cloud this replaced. Gravity near nothing, so
     * branches spread rather than collapsing into the middle.
     */
    simulationFriction: physics.value.friction,
    simulationGravity: physics.value.gravity,
    simulationRepulsion: physics.value.repulsion,
    simulationLinkSpring: physics.value.spring,
    simulationLinkDistance: physics.value.linkDistance,
    simulationDecay: physics.value.decay,
    /*
     * `linkWidth` and `linkColor` are not what cosmos.gl calls these.
     *
     * It reads `linkDefaultWidth` / `linkDefaultColor`, and an unknown key in
     * its config is ignored rather than rejected -- so the graph has been
     * drawing its edges at the library's own defaults since the day it was
     * written, and every attempt to tune them did nothing at all. Found by
     * changing the colour, photographing it, and getting the same picture.
     * @see scripts/shots.py
     */
    linkDefaultWidth: physics.value.linkWidth,
    /*
     * The dim colour, and fainter the more there is of it.
     *
     * The edges are the structure, and structure should be legible without
     * competing with what hangs off it. At nine nodes 0.38 is barely visible;
     * at nine hundred, where a thousand near-parallel edges converge on the
     * same parent, the same 0.38 sums into solid grey wedges -- the picture of
     * a real collection was several smears with dots around the rim.
     *
     * So it thins as the drawing fills up. Ink per edge, rather than ink per
     * line, which is what the eye is actually reading.
     */
    linkDefaultColor: rgba(theme.value.dim, 1),
    linkOpacity: inkForLinks(nodes.value.length),
    curvedLinks: false,
    fitViewOnInit: true,
    /*
     * And the simulation never runs.
     *
     * The positions are worked out (@see core/pathTree.js radialPositions), so
     * there is nothing for a simulation to improve -- but cosmos runs one
     * during every zoom transition by default, and every pan, zoom and
     * selection is a zoom transition. The graph drifted off towards the corner
     * while somebody was trying to read it, and chasing it is exactly what a
     * computed layout is supposed to make impossible.
     */
    enableSimulationDuringZoom: false,
    enableDrag: false,
    renderHoveredPointRing: true,
    hoveredPointRingColor: theme.value.accentAlt,
    focusedPointRingColor: theme.value.error,
    onClick: (index) => {
      if (index === undefined || index === null) return
      /*
       * One click picks, two opens.
       *
       * cosmos.gl reports clicks and not double-clicks, so the second one is
       * spotted here: the same node again, soon enough to have been a pair.
       */
      const now = Date.now()
      const again = index === lastClick.at && now - lastClick.when < 380
      lastClick = { at: index, when: now }
      if (again) unfold(index)
      else choose(index)
    },
  })

  /*
   * Worked out rather than settled into.
   *
   * The equal-angle algorithm (Felsenstein, 1989) is the textbook layout for a
   * rooted tree: every subtree gets a wedge of the circle in proportion to the
   * leaves under it. Linear, deterministic, and -- the part that matters --
   * incapable of crossing itself, because a subtree's wedge belongs to that
   * subtree and nothing else is ever placed in it.
   *
   * A force simulation on a tree spends its first seconds untangling something
   * that was never tangled, settles somewhere different every run, and leaves
   * branches crossing. There is nothing here for it to improve.
   * @see core/pathTree.js radialPositions
   */
  engine.value = graph
  drawn = null
  draw(placesFor(shown.value))
  // The last argument is "run the simulation during the transition", and it
  // defaults to true.
  graph.fitView?.(0, undefined, false)

  stopFollowing()
  followLabels()
}

/**
 * The whole layout, centred in cosmos's space and sized to stay inside it.
 *
 * The ring spacing comes from how deep the *whole* tree goes rather than how
 * deep the part on screen goes, so that opening a folder adds a ring instead
 * of re-spacing every ring already drawn. Together with wedges weighed by
 * clips (@see core/pathTree.js radialPositions) that makes opening additive:
 * nothing that is already on screen moves.
 */
function placesFor(slice) {
  // The whole tree's depth, not the slice's: the rings must not re-space when
  // a folder opens. @see core/pathTree.js radialPositions
  const deepest = Math.max(1, ((props.tree && props.tree.depth) || slice.depth) - 1)
  return radialPositions(slice, { centre: SPACE / 2, fitRadius: SPACE / 2 - 240, deepest })
}

/*
 * Where every visible node was last put.
 *
 * Kept so that opening a folder can be an animation from the picture that is
 * on screen rather than a new picture. Indices are into the visible slice and
 * mean nothing once the slice changes, so what is remembered is the position
 * against the node's index in the *whole* tree, which does not move.
 */
let drawn = null
/* The positions actually on screen, and whose they are. Kept so that opening a
   second folder while the first is still opening grows out of the picture as
   it stands rather than as it stood when the first one started. */
let live = null
let liveOrigin = null

/** Take the positions on screen as the ones to grow from next time. */
function settle() {
  if (!live || !liveOrigin) return
  drawn = new Map()
  liveOrigin.forEach((was, index) => {
    drawn.set(was, [live[index * 2], live[index * 2 + 1]])
  })
}

/**
 * Put the current slice on the screen at these positions.
 *
 * Everything the renderer holds is per-point and the points change every time
 * a folder opens, so sizes, colours and links are uploaded together with the
 * positions. The links are the *slice's* -- the whole tree's edge list is
 * numbered against the whole tree, and handing it to a renderer holding nine
 * hundred points is asking it to draw an edge to point 795,983.
 */
function draw(places) {
  const graph = engine.value
  const slice = shown.value
  if (!graph || !slice) return

  graph.setPointPositions(places)
  graph.setPointSizes(treeSizes(slice.nodes))
  graph.setPointColors(treeColours(slice.nodes, {
    from: theme.value.accent, to: theme.value.accentAlt, dim: theme.value.dim,
  }))

  const pairs = new Float32Array(slice.edges.length)
  pairs.set(slice.edges)
  graph.setLinks(pairs)

  graph.render()
  // Belt as well as braces: the config says not to simulate during a zoom, and
  // this says not to simulate at all. Nothing here needs it.
  graph.pause?.()

  live = places
  liveOrigin = slice.origin
  settle()
}

let lastClick = { at: -1, when: 0 }

/* ---------------- opening a folder ------------------------------------
 *
 * Not by drawing the graph again.
 *
 * A folder opening used to tear the renderer down and build a new one from
 * the new slice, so every node on screen was given a fresh position at the
 * same moment and the whole picture rearranged itself. Nothing about that
 * reads as "this folder opened" -- it reads as a different graph arriving,
 * and there is no way to follow a thing you were looking at through it.
 *
 * So the slice changes, the renderer does not, and the difference is walked
 * rather than jumped: what is already on screen slides from where it is to
 * where it now belongs, and what is new starts at the middle of the node it
 * came out of and travels outward to its ring. The node that was opened is
 * the one place on the screen nothing moves, which is what makes it read as
 * that node opening.
 *
 * Eased rather than linear, and a third of a second, because the point is to
 * be followed by an eye rather than to be quick.
 */
const OPENING_MS = 340
let opening = null

function growInto(slice) {
  const graph = engine.value
  if (!graph || !slice || !slice.nodes.length) return

  // Already on screen. Building the graph draws the first slice itself, and
  // the watcher then fires with that same slice -- which would be a third of a
  // second spent travelling from each node to where it already is.
  if (liveOrigin === slice.origin) return

  // A folder opened while another is still opening: stop there and take the
  // half-travelled picture as the one to grow from, so nothing jumps back.
  if (opening) { cancelAnimationFrame(opening); opening = null; settle() }

  const ends = placesFor(slice)

  // With nothing on screen to grow out of, this is the first draw.
  if (!drawn || !drawn.size) { draw(ends); return }

  const starts = new Float32Array(ends.length)
  for (let index = 0; index < slice.nodes.length; index++) {
    const was = slice.origin[index]
    const held = drawn.get(was)
    if (held) {
      starts[index * 2] = held[0]
      starts[index * 2 + 1] = held[1]
      continue
    }
    // New. Start it inside whichever visible ancestor it came out of, so it
    // emerges from the node that was opened rather than fading in from a
    // place nothing on screen corresponds to.
    let from = slice.parents[index]
    let seed = null
    while (from >= 0 && !seed) {
      seed = drawn.get(slice.origin[from]) || null
      from = slice.parents[from]
    }
    starts[index * 2] = seed ? seed[0] : ends[index * 2]
    starts[index * 2 + 1] = seed ? seed[1] : ends[index * 2 + 1]
  }

  // The sizes, colours and links belong to the new slice from the first frame:
  // only the positions are travelled.
  draw(starts)

  const began = performance.now()
  const ease = (t) => 1 - Math.pow(1 - t, 3)
  const step = () => {
    const through = Math.min(1, (performance.now() - began) / OPENING_MS)
    const much = ease(through)
    const now = new Float32Array(ends.length)
    for (let n = 0; n < ends.length; n++) {
      now[n] = starts[n] + (ends[n] - starts[n]) * much
    }
    engine.value?.setPointPositions?.(now)
    engine.value?.render?.()
    live = now
    if (through < 1) { opening = requestAnimationFrame(step); return }
    opening = null
    // Landed. Where everything ended up is where the next opening starts.
    settle()
  }
  opening = requestAnimationFrame(step)
}

/**
 * Open a folder, or close it again.
 *
 * Indices are into the visible slice, and the open set is in terms of the whole
 * tree -- so it is translated through `origin` before being remembered, or the
 * set would mean something different every time the slice changed.
 */
function unfold(index) {
  const slice = shown.value
  if (!slice || !props.tree) return
  const real = slice.origin[index]
  if (real === undefined) return

  const next = new Set(opened.value)
  if (next.has(real)) next.delete(real)
  else next.add(real)
  opened.value = next
}

/*
 * Everything the renderer hands back is an index into the *visible slice*.
 *
 * It used to be looked up in the whole tree, which is a different numbering
 * the moment anything is folded -- so clicking a node put some unrelated
 * node's name in the aside, lit unrelated points, and labelled the picture
 * with whatever happened to be at those indices. The slice is what is drawn,
 * so the slice is what an index from the drawing means.
 */
function choose(index) {
  const slice = shown.value
  if (!slice || !slice.nodes[index]) return
  at.value = index
  along.value = 0
  refreshLabels()
  emit('pick', slice.nodes[index], slice.origin[index])
  light(index)
}

/** The branch you are on: this node, the way up, and the way down. */
function light(index) {
  const graph = engine.value
  const slice = shown.value
  if (!graph || !slice) return
  const kin = [index,
               ...trail(slice, index).map((one) => one.at),
               ...childrenOf(slice, index).map((one) => one.at)]
  graph.setFocusedPointByIndex?.(index)
  graph.selectPointsByIndices?.(kin)
}

/* ---------------- the keyboard ----------------------------------------
 *
 * A tree navigates like a tree, which is the point of it being one:
 *
 *   ← →   between the children of wherever you are, biggest first
 *   ↓     into the one being pointed at
 *   ↑     up to the parent
 *
 * No remembering where you came from, because in a tree there is nowhere else
 * up leads -- which is what makes this easier to hold than the graph walk it
 * replaced.
 */
function onKey(event) {
  if (!shown.value || !shown.value.nodes.length) return

  if (event.key === 'Escape') {
    event.preventDefault()
    at.value = -1
    engine.value?.unselectPoints?.()
    engine.value?.fitView?.(300, undefined, false)
    return
  }

  if (!/^Arrow/.test(event.key)) return
  event.preventDefault()

  if (at.value < 0) {
    // Nothing chosen yet: any arrow starts at the biggest library.
    let biggest = -1
    nodes.value.forEach((one, index) => {
      if (one.depth !== 0) return
      if (biggest < 0 || one.clips > nodes.value[biggest].clips) biggest = index
    })
    if (biggest >= 0) choose(biggest)
    return
  }

  const kids = below.value

  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    if (!kids.length) return
    const step = event.key === 'ArrowRight' ? 1 : -1
    along.value = (along.value + step + kids.length) % kids.length
    return
  }

  if (event.key === 'ArrowDown') {
    const into = kids[along.value]
    if (into) { choose(into.at); look(into.at) }
    return
  }

  if (event.key === 'ArrowUp') {
    const up = shown.value ? shown.value.parents[at.value] : -1
    if (up >= 0) { choose(up); look(up) }
  }
}

/* ---------------- labels ------------------------------------------------
 *
 * A graph of coloured dots is a picture of a catalogue that tells you nothing
 * about the catalogue. The names are the content; the dots are only where the
 * names are.
 *
 * Drawn as HTML over the canvas rather than into it. Text in WebGL means a
 * glyph atlas and a shader, and the number of labels worth showing at once is
 * about sixty -- which is nothing for the DOM and a great deal of machinery for
 * a GPU.
 *
 * Which sixty is the whole question. Everything is unreadable and the top level
 * alone is useless once you have gone into something, so: the branch you are on
 * always, then the biggest things near the top, then whatever is left of the
 * budget spent on the largest nodes on screen.
 */
const labels = ref([])
const showLabels = computed(() => state.settings.graph.labels)
let labelFrame = null

/*
 * Which nodes are worth naming, most worth it first.
 *
 * Biggest first, by what is under them, rather than shallowest first. The old
 * order walked the breadth-first list and stopped dead at the third level --
 * so on a real catalogue every name belonged to a library or a top shelf and
 * the whole of the picture below that was unlabelled dots. Most of a map with
 * no text on it is a pretty picture of nothing.
 *
 * Sorted once per slice rather than once per frame: the label pass runs on
 * every frame and sorting nine hundred nodes sixty times a second to get the
 * same answer would be silly.
 */
const nameable = computed(() => {
  const tree = shown.value
  if (!tree || !tree.nodes.length) return []
  const order = tree.nodes.map((one, at) => at)
  order.sort((a, b) => (tree.nodes[b].clips - tree.nodes[a].clips)
    || (tree.nodes[a].depth - tree.nodes[b].depth))
  return order
})

/**
 * The candidates, in the order they get to claim room.
 *
 * More of them than can possibly be drawn, on purpose. Which labels fit is a
 * question about where the dots ended up on screen, and only the pass that
 * places them knows that -- so this offers plenty and lets collision decide,
 * rather than choosing sixty in advance and watching most of them be thrown
 * away for overlapping. @see refreshLabels
 */
function chooseLabelled() {
  const tree = shown.value
  if (!tree || !tree.nodes.length) return []

  const wanted = new Set()

  // The branch you are on, always and first. Where you are must be readable
  // even when everything around it is not.
  if (at.value >= 0) {
    for (const one of where.value) wanted.add(one.at)
    for (const one of below.value.slice(0, 12)) wanted.add(one.at)
  }

  const budget = state.settings.graph.mostLabels || 120
  const offer = Math.min(nameable.value.length, budget * 6)
  for (let n = 0; n < offer; n++) wanted.add(nameable.value[n])

  return [...wanted]
}

function refreshLabels() {
  const graph = engine.value
  const tree = shown.value
  if (!graph || !tree || !tree.nodes.length || !showLabels.value) { labels.value = []; return }

  const wanted = chooseLabelled()
  if (!wanted.length) { labels.value = []; return }

  graph.trackPointPositionsByIndices?.(wanted)
  const tracked = graph.getTrackedPointPositionsMap?.()
  if (!tracked) { labels.value = []; return }

  const box = canvas.value ? canvas.value.getBoundingClientRect() : { width: 0, height: 0 }
  const out = []
  // Counted in labels actually drawn. Spending it on candidates instead meant
  // asking for sixty and getting a dozen, because most of them overlapped
  // something already placed.
  const budget = state.settings.graph.mostLabels || 120

  for (const index of wanted) {
    if (out.length >= budget) break
    const spot = tracked.get(index)
    if (!spot) continue
    const screen = graph.spaceToScreenPosition?.([spot[0], spot[1]])
    if (!screen) continue
    const [x, y] = screen
    // Off screen is not worth a DOM node, and a label half off the edge reads
    // as a different word.
    if (x < -40 || y < -20 || x > box.width + 40 || y > box.height + 20) continue

    const node = tree.nodes[index]
    /*
     * Not on top of one another.
     *
     * Two names in the same place are not two names, they are a smudge --
     * "Impro-Visor" and "POP909" printed over each other read as neither. The
     * ones that matter are chosen first (@see chooseLabelled: where you are,
     * then the biggest), so the first to claim a patch of screen keeps it and
     * whatever would have landed on top is simply not drawn.
     *
     * A rough box: eye-measured from the rendered text rather than measured
     * per label, because measuring sixty labels a frame costs a layout each
     * and being a few pixels out only ever means one more gap.
     */
    const wide = 7 * String(node.label || '').length + 14
    let clear = true
    for (const already of out) {
      if (Math.abs(already.x - x) < (already.wide + wide) / 2
          && Math.abs(already.y - y) < 15) { clear = false; break }
    }
    if (!clear) continue

    out.push({
      at: index,
      x: Math.round(x),
      y: Math.round(y),
      wide,
      label: node.label,
      clips: node.clips,
      depth: node.depth,
      leaf: node.leaf,
      here: index === at.value,
    })
  }

  labels.value = out
}

/** Follow the simulation while it is moving, and stop when it stops. */
function followLabels() {
  refreshLabels()
  labelFrame = requestAnimationFrame(followLabels)
}

function stopFollowing() {
  if (labelFrame) cancelAnimationFrame(labelFrame)
  labelFrame = null
}

function look(index) {
  // Positions, a duration, a scale, padding, and *do not simulate*. Without the
  // last one the graph slides away while you are looking at it.
  engine.value?.zoomToPointByIndex?.(index, 400, undefined, true, false)
}

function jump(index) {
  choose(index)
  look(index)
}

/** Everything one level deeper, for looking around rather than looking for. */
function openAll() {
  const tree = props.tree
  if (!tree) return
  const next = new Set(opened.value)
  for (const was of shown.value.origin) {
    if (tree.childAt[was + 1] > tree.childAt[was]) next.add(was)
  }
  opened.value = next
}

function closeAll() {
  opened.value = new Set()
  at.value = -1
}

function fit() {
  engine.value?.fitView?.(300, undefined, false)
}

/*
 * How much of it to show before anybody asks.
 *
 * Two levels of a tree is nine dots and a caption -- technically a graph, and
 * useless: it says the catalogue has two sources without saying anything about
 * what is in them. A map is worth looking at when there is enough of it on
 * screen to see shape in, so this opens branches biggest-first until there is.
 *
 * By node count rather than by depth, because depth means something different
 * in every catalogue: two levels of the drum tree is eight hundred nodes and
 * two levels of the phrase tree is nine. Around this many is what a 1920-wide
 * canvas holds while each dot is still separately visible.
 */
const ENOUGH = 900

function openEnough() {
  if (!props.tree) return
  const next = new Set()

  /*
   * A rank at a time, shallowest first.
   *
   * Opening the biggest nodes wherever they are looks sensible and is not: in
   * a real collection the biggest are all inside the same two libraries, so
   * the view opened one branch eleven levels deep and left the other
   * forty-seven libraries as unopened dots. A map of a catalogue that shows
   * one corner of it.
   *
   * Breadth-first opens every library, then every shelf in every library, and
   * stops at the rank that would go past the budget -- so what is on screen is
   * as much of the whole thing as fits, at an even depth, which is what makes
   * the shape of it readable.
   */
  for (let rank = 0; rank < 12; rank++) {
    const slice = visibleSlice(props.tree, next)
    if (slice.nodes.length >= ENOUGH) break

    let shallowest = Infinity
    for (const one of slice.nodes) {
      if (one.hidden > 0 && one.depth < shallowest) shallowest = one.depth
    }
    if (shallowest === Infinity) break

    // What this rank would cost, before paying for it: half a rank drawn is a
    // lopsided picture, which is the thing being avoided.
    let coming = 0
    slice.nodes.forEach((one) => {
      if (one.hidden > 0 && one.depth === shallowest) coming += one.hidden
    })
    if (rank && slice.nodes.length + coming > ENOUGH * 1.6) break

    slice.nodes.forEach((one, at) => {
      if (one.hidden > 0 && one.depth === shallowest) next.add(slice.origin[at])
    })
  }
  opened.value = next
}

onMounted(() => { openEnough(); build() })
watch(() => props.tree, () => {
  at.value = -1
  along.value = 0
  openEnough()
  build()
})
// A folder opening or closing is the same graph with more of it showing, so
// it grows into the new shape rather than being built again. And it does not
// re-fit: the view belongs to whoever is looking through it.
watch(shown, (slice) => growInto(slice))
// Re-drawn when the theme changes, because every colour in it came from there.
watch(() => JSON.stringify(theme.value), build)

onBeforeUnmount(() => {
  if (opening) cancelAnimationFrame(opening)
  opening = null
  stopFollowing()
  engine.value?.destroy?.()
  engine.value = null
})
</script>

<template>
  <div class="jamin-graph" :class="{ 'is-bare': bare }">
    <!-- Where you are, and the way down. In a tree that is the whole of what
         anybody needs: the levels above, and the children below -- which is
         also exactly what the arrow keys walk. -->
    <div v-if="!bare" class="jamin-graph-strip">
      <template v-if="where.length">
        <button
          v-for="(one, n) in where" :key="one.at"
          type="button"
          class="jamin-graph-crumb"
          :class="{ 'is-here': n === where.length - 1 }"
          :title="`${one.clips.toLocaleString()} beneath this`"
          @click="jump(one.at)"
        >{{ one.label }}</button>

        <span v-if="below.length" class="jamin-graph-with">›</span>
        <button
          v-for="(one, n) in below.slice(0, 10)" :key="`down-${one.at}`"
          type="button"
          class="jamin-graph-rel"
          :class="{ 'is-pointed': n === along }"
          :title="`${one.clips.toLocaleString()} beneath — click, or press ↓`"
          @click="jump(one.at)"
        >{{ one.label }}<i>{{ one.clips.toLocaleString() }}</i></button>
        <span v-if="below.length > 10" class="jamin-graph-more">
          +{{ (below.length - 10).toLocaleString() }} more
        </span>
      </template>
      <span v-else class="jamin-graph-hint">
        Click a library, or press an arrow key — then ← → between folders, ↓ to go in, ↑ to come back
      </span>
    </div>

    <div class="jamin-graph-wrap">
      <div
        ref="canvas"
        class="jamin-graph-canvas"
        tabindex="0"
        role="application"
        :aria-label="`${nodes.length} places in this catalogue`"
        @keydown="onKey"
      ></div>

      <!-- The names, over the canvas. The dots say where things are and the
           names say what they are; without these it is a picture of a
           catalogue that tells you nothing about the catalogue. -->
      <div class="jamin-graph-labels" aria-hidden="true">
        <span
          v-for="one in labels" :key="one.at"
          class="jamin-graph-label"
          :class="{ 'is-here': one.here, 'is-leaf': one.leaf, 'is-root': one.depth === 0 }"
          :style="{ left: `${one.x}px`, top: `${one.y}px` }"
        >{{ one.label }}<i v-if="!one.leaf">{{ one.clips.toLocaleString() }}</i></span>
      </div>
    </div>

    <div v-if="!bare" class="jamin-graph-foot">
      <span>
        {{ nodes.length.toLocaleString() }} nodes · {{ tree ? tree.depth : 0 }} levels
        <span v-if="tree && tree.truncated" class="jamin-graph-settling">· too large to draw whole</span>
      </span>
      <span class="jamin-graph-spacer"></span>
      <button type="button" @click="openAll">Open one more level</button>
      <button type="button" @click="closeAll">Collapse</button>
      <button type="button" @click="fit">Fit</button>
    </div>
  </div>
</template>
