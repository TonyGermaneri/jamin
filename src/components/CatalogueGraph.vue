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


/* ---------------- building it ---------------------------------------- */

function build() {
  if (!canvas.value || !nodes.value.length) return

  engine.value?.destroy?.()

  const graph = new Graph(canvas.value, {
    spaceSize: 8192,
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
    linkWidth: physics.value.linkWidth,
    // The dim colour: the edges are the structure, and structure should be
    // legible without competing with what hangs off it.
    linkColor: rgba(theme.value.dim, 0.38),
    curvedLinks: false,
    fitViewOnInit: true,
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
  graph.setPointPositions(radialPositions(shown.value, { ringGap: 420 }))
  graph.setPointSizes(treeSizes(nodes.value))
  graph.setPointColors(treeColours(nodes.value, {
    from: theme.value.accent, to: theme.value.accentAlt, dim: theme.value.dim,
  }))

  const pairs = new Float32Array(props.tree.edges.length)
  pairs.set(props.tree.edges)
  graph.setLinks(pairs)

  graph.render()
  graph.fitView?.(0)
  engine.value = graph

  stopFollowing()
  followLabels()
}

let lastClick = { at: -1, when: 0 }

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

function choose(index) {
  at.value = index
  along.value = 0
  refreshLabels()
  emit('pick', props.tree.nodes[index], index)
  light(index)
}

/** The branch you are on: this node, the way up, and the way down. */
function light(index) {
  const graph = engine.value
  if (!graph || !props.tree) return
  const kin = [index,
               ...trail(props.tree, index).map((one) => one.at),
               ...childrenOf(props.tree, index).map((one) => one.at)]
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
  const tree = props.tree
  if (!tree) return

  if (event.key === 'Escape') {
    event.preventDefault()
    at.value = -1
    engine.value?.unselectPoints?.()
    engine.value?.fitView?.(300)
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
    const up = tree.parents[at.value]
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

function chooseLabelled() {
  const tree = props.tree
  if (!tree) return []

  const wanted = new Map()
  const budget = state.settings.graph.mostLabels || 60

  // The branch you are on, always. Where you are must be readable even when
  // everything around it is not.
  if (at.value >= 0) {
    for (const one of where.value) wanted.set(one.at, 2)
    for (const one of below.value.slice(0, 12)) wanted.set(one.at, 1)
  }

  // Then the biggest, top-down. Ordered breadth-first already, so walking the
  // front of the list is walking the top of the tree.
  for (let index = 0; index < tree.nodes.length && wanted.size < budget; index++) {
    if (tree.nodes[index].depth > 2) break
    if (!wanted.has(index)) wanted.set(index, 0)
  }

  return [...wanted.keys()].slice(0, budget)
}

function refreshLabels() {
  const graph = engine.value
  const tree = props.tree
  if (!graph || !tree || !showLabels.value) { labels.value = []; return }

  const wanted = chooseLabelled()
  if (!wanted.length) { labels.value = []; return }

  graph.trackPointPositionsByIndices?.(wanted)
  const tracked = graph.getTrackedPointPositionsMap?.()
  if (!tracked) { labels.value = []; return }

  const box = canvas.value ? canvas.value.getBoundingClientRect() : { width: 0, height: 0 }
  const out = []

  for (const index of wanted) {
    const spot = tracked.get(index)
    if (!spot) continue
    const screen = graph.spaceToScreenPosition?.([spot[0], spot[1]])
    if (!screen) continue
    const [x, y] = screen
    // Off screen is not worth a DOM node, and a label half off the edge reads
    // as a different word.
    if (x < -40 || y < -20 || x > box.width + 40 || y > box.height + 20) continue

    const node = tree.nodes[index]
    out.push({
      at: index,
      x: Math.round(x),
      y: Math.round(y),
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
  engine.value?.setZoomTransformByPointPositions?.([index], 400)
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
  engine.value?.fitView?.(300)
}

onMounted(build)
watch(() => props.tree, () => {
  at.value = -1
  along.value = 0
  opened.value = new Set()
  build()
})
// A folder opening or closing is a different tree to draw.
watch(shown, build)
// Re-drawn when the theme changes, because every colour in it came from there.
watch(() => JSON.stringify(theme.value), build)

onBeforeUnmount(() => {
  stopFollowing()
  engine.value?.destroy?.()
  engine.value = null
})
</script>

<template>
  <div class="jamin-graph">
    <!-- Where you are, and the way down. In a tree that is the whole of what
         anybody needs: the levels above, and the children below -- which is
         also exactly what the arrow keys walk. -->
    <div class="jamin-graph-strip">
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

    <div class="jamin-graph-foot">
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
