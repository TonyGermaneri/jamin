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
import { measureGraph, stressGraph } from '../core/graphView.js'

if (typeof window !== 'undefined') {
  window.__jaminGraphProbe = () => measureGraph()
  window.__jaminGraphStress = (sizes) => stressGraph(sizes)
}

export default {}
</script>

<script setup>
/**
 * A catalogue, explored as the tree it already is.
 *
 * The first version drew words joined by how often they turned up together and
 * was a hairball; the second drew the tree but rebuilt the picture every time
 * a folder opened, which is not exploring a hierarchy so much as being handed
 * a new one. This is the collapsible tree: double-click a node and its
 * children grow out of it, double-click again and they fold back in, and
 * nothing on screen ever disappears to make that happen.
 *
 * The drawing, the layout and the collapse state belong to @see
 * canvas/treeGraph.js. What is left here is what the *catalogue* knows: how
 * big each node should be, what colour, what it is called, and what picking
 * one means.
 *
 * One component for three collections: everything that knows which collection
 * it is looking at lives in whoever builds the tree.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { state } from '../store.js'
import { rgba } from '../core/pathTree.js'
import { TreeGraph } from '../canvas/treeGraph.js'

const props = defineProps({
  /** `{ nodes, edges, parents, depth, truncated }` from core/pathTree.js. */
  tree: { type: Object, default: null },
  /**
   * Nothing but the canvas.
   *
   * Inside the full-screen map the breadcrumb and the buttons live on the
   * glass in front rather than in a strip above and a strip below, and those
   * two strips are the difference between a canvas that fills the screen and
   * one that nearly does. @see components/CatalogueMap.vue
   */
  bare: { type: Boolean, default: false },
  /** Which catalogue this is, so what was left open is remembered per book. */
  book: { type: String, default: '' },
})
const emit = defineEmits(['pick'])

const box = ref(null)
/** Shallow: the renderer holds a canvas and a d3 zoom behaviour, and making
    either reactive would be proxying a great deal of nothing. */
const engine = shallowRef(null)

const here = ref(null)          // the node last picked
const hovering = ref(null)
const labels = ref([])
const drawnCount = ref(0)

const showLabels = computed(() => state.settings.graph.labels)

/**
 * The theme's own colours, which the graph is drawn in.
 *
 * `accent` and `accentAlt` are the two ends of the depth ramp, `dim` is what
 * the leaves fade towards and what the edges are drawn in. A graph in a
 * palette nothing else on screen uses looks like a different program.
 */
const theme = computed(() => state.settings.theme)

/** The dials, as the settings hold them. @see core/settings.js graph.look */
const look = computed(() => state.settings.graph.look || {})

/**
 * The theme and the dials, handed to the renderer.
 *
 * The colours come from the theme and nowhere else -- a map in a palette
 * nothing else on screen uses looks like a different program -- and the
 * ground is black rather than the theme's surface, because a glow has only
 * as much contrast as the dark behind it.
 */
function dress(graph) {
  if (!graph) return
  graph.look = {
    ...graph.look,
    ...look.value,
    link: rgba(theme.value.dim, 0.3),
    ring: theme.value.error,
    from: theme.value.accent,
    to: theme.value.accentAlt,
    dim: theme.value.dim,
    ground: '#000000',
  }
  graph.retune()
}

/* ---------------- what the catalogue knows ---------------------------- */

/**
 * The tree, handed over as it came out of the database.
 *
 * It used to be "dressed" here first: every node given a size and a colour,
 * which on a real catalogue meant allocating 932,299 objects and three
 * Float32Arrays to draw nineteen dots. That was most of the 3.9 seconds the
 * window took to open. The renderer now works out a node's size and colour at
 * the moment it becomes visible, so this passes the arrays straight through
 * and the cost is the size of what is shown.
 * @see canvas/treeGraph.js, scripts/graph_perf.py
 */
const source = computed(() => {
  const tree = props.tree
  if (!tree || !tree.nodes || !tree.nodes.length) return null
  return tree
})

/* ---------------- the names over the dots ----------------------------- */
/*
 * A graph of coloured dots is a picture of a catalogue that tells you nothing
 * about the catalogue. The names are the content; the dots are only where the
 * names are.
 *
 * Drawn as HTML over the canvas rather than into it: text in WebGL or in
 * canvas means measuring and clipping by hand, and the number of labels worth
 * showing at once is about a hundred -- nothing for the DOM.
 */
function refreshLabels() {
  const graph = engine.value
  if (!graph || !showLabels.value) { labels.value = []; return }

  const budget = state.settings.graph.mostLabels || 140
  const wide = graph.width
  const tall = graph.height

  /*
   * Biggest first, so the labels that survive are the ones worth having.
   *
   * Which ones fit is a question about where the dots landed, so plenty are
   * offered and collision decides -- the budget counts labels actually drawn
   * rather than attempted. Choosing a hundred in advance and watching most of
   * them be thrown away for overlapping is how the map came to have almost no
   * text on it.
   */
  const order = graph.drawn
    .slice()
    .sort((a, b) => (b.clips || 0) - (a.clips || 0))

  const out = []
  for (const one of order) {
    if (out.length >= budget) break
    const [x, y] = graph.screenOf(one)
    if (x < -40 || y < -20 || x > wide + 40 || y > tall + 20) continue

    if (look.value.nodeInfo === 'none') break
    const text = String(one.label || '')
    if (!text) continue

    // A rough box, eye-measured rather than measured per label: measuring a
    // hundred of them a frame costs a layout each, and being a few pixels out
    // only ever means one more gap.
    const room = 7 * text.length + 14
    const above = y - (one.r * graph.at.k + 9)
    let free = true
    for (const already of out) {
      if (Math.abs(already.x - x) < (already.wide + room) / 2
          && Math.abs(already.y - above) < 15) { free = false; break }
    }
    if (!free) continue

    /*
     * Clear of the node and of its glow.
     *
     * A fixed offset put the name inside the halo of anything big, where it
     * washed out against its own node -- the first photograph of this had
     * eighteen labels on it and perhaps four that could be read. The offset
     * is the drawn radius, so a big node pushes its name further out and a
     * pinprick keeps it close.
     */
    const clear = one.r * graph.at.k + 9

    out.push({
      key: one.at,
      x: Math.round(x),
      y: Math.round(y - clear),
      wide: room,
      label: text,
      clips: one.clips,
      depth: one.depth,
      shut: one.shut && look.value.nodeInfo !== 'name',
      here: here.value === one.at,
    })
  }

  labels.value = out
  drawnCount.value = graph.drawn.length
}

/** Follow the picture while it is moving, and rest when it is still. */
let following = 0
function followLabels() {
  refreshLabels()
  following = requestAnimationFrame(followLabels)
}

/* ---------------- building it ----------------------------------------- */

function build() {
  if (!box.value) return
  engine.value?.destroy?.()

  const graph = new TreeGraph(box.value, {
    onPick: (seat) => {
      here.value = seat.at
      /*
       * With the path to it, which is what makes a node resolvable.
       *
       * A leaf of the tree is one clip, and the only thing the tree knows
       * about it is the labels along the way down. Without them the book was
       * reduced to looking the name up among the rows the list happened to
       * be showing, so clicking a file did nothing.
       */
      emit('pick', graph.source.nodes[seat.at], seat.at,
        graph.ancestorsOf(seat.at).map((up) => graph.source.nodes[up].label))
      refreshLabels()
    },
    onHover: (seat) => { hovering.value = seat ? seat.label : null },
    onOpen: () => { remember(); refreshLabels() },
  })
  dress(graph)
  engine.value = graph

  /*
   * A way in for the harness.
   *
   * "Does the picture survive a node being opened" is a question about what
   * is on screen between one frame and the next, which no screenshot can
   * answer -- so the check opens one and watches the count.
   * @see scripts/shots.py
   */
  if (typeof window !== 'undefined') {
    window.__jaminTreeProbe = {
      showing: () => graph.drawn.length,
      open: (label) => {
        const found = graph.drawn.find((one) => one.label === label && one.shut)
        if (found) graph.toggle(found.at)
        return Boolean(found)
      },
      shutOnes: () => graph.drawn.filter((one) => one.shut).map((one) => one.label),
      // Actually childless, which `shutOnes` does not say: an open branch is
      // not shut either, and a check that took "not shut" for "leaf" was
      // clicking the root and reporting success.
      leaves: () => graph.drawn.filter((one) => !graph.hasChildren(one.at))
        .map((one) => one.label),
      // How far down the picture currently goes, so the harness can say that
      // a catalogue opens at its top level rather than pouring its second
      // level onto the screen.
      deepest: () => graph.drawn.reduce((most, one) => Math.max(most, one.depth), 0),
      labels: () => labels.value.length,
      // Where each node ended up on screen, which is the only way to tell a
      // node that is missing from one drawn underneath its neighbour, or one
      // pushed off the edge by a fit that did not know about the chrome.
      places: () => graph.drawn.map((one) => {
        const [x, y] = graph.screenOf(one)
        return { label: one.label, x: Math.round(x), y: Math.round(y) }
      }),
      // Where the camera is, so a check can say that opening a node did not
      // move it. Nothing else can tell the difference between a graph that
      // grew and one that was rebuilt around the thing you clicked.
      camera: () => ({ x: Math.round(graph.at.x), y: Math.round(graph.at.y),
        k: Math.round(graph.at.k * 1000) / 1000 }),
    }
  }

  /*
   * The top level, and whatever was left open last time.
   *
   * Two levels was chosen so the first sight of a catalogue had some shape to
   * it, and on a small library that is true. On a real one the second level
   * is thousands of nodes: the shape it gives is a solid band, which is not
   * shape, and every label worth reading is culled for collision by the ones
   * that are not.
   *
   * So a catalogue opens at its top level, plus whichever nodes were open
   * when it was last looked at -- somebody who left a folder open comes back
   * to it open. @see store.js graphOpen
   */
  if (source.value) graph.setTree(source.value, { open: remembered() })
  refreshLabels()
}

/* ---------------- the buttons ----------------------------------------- */

/** One more level, everywhere, for looking around rather than looking for. */
function openAll() {
  engine.value?.openMore?.()
  refreshLabels()
}

function closeAll() {
  here.value = null
  engine.value?.closeAll?.()
  refreshLabels()
}

function fit() {
  engine.value?.fitView?.()
}

/** The way back up, as a line of names. */
const where = computed(() => {
  const graph = engine.value
  if (here.value === null || !graph || !graph.source) return []
  return graph.ancestorsOf(here.value).map((at) => ({
    at,
    label: graph.source.nodes[at].label,
    clips: graph.source.nodes[at].clips,
  }))
})

function jump(at) {
  const graph = engine.value
  if (!graph) return
  here.value = at
  graph.chosen = at
  graph.zoomToPoint?.(at)
  emit('pick', graph.source.nodes[at], at,
    graph.ancestorsOf(at).map((up) => graph.source.nodes[up].label))
}

/* ---------------- what was left open ----------------------------------
 *
 * A catalogue is somewhere somebody is working, not a picture they glance
 * at: having opened three folders down to the shelf they are auditioning
 * from, closing the window and losing it is the same as never having opened
 * it. The open set is the whole of the state -- it is what `setTree` takes
 * back -- so remembering it is remembering the arrangement.
 */
function remembered() {
  const kept = state.settings.graph.open || {}
  const mine = kept[props.book]
  return Array.isArray(mine) ? mine : null
}

function remember() {
  const graph = engine.value
  if (!graph || !props.book) return
  const kept = { ...(state.settings.graph.open || {}) }
  kept[props.book] = [...graph.open]
  state.settings.graph.open = kept
}

/* ---------------- wiring ----------------------------------------------
 *
 * At the end, because a watch source array is read the moment `watch` is
 * called -- naming a ref declared further down reads it then, and a `const`
 * read before its declaration is a ReferenceError rather than an undefined.
 * That has been fallen into three times in this file's history.
 */
onMounted(() => { build(); followLabels() })

watch(source, (next) => {
  const graph = engine.value
  if (!graph) return
  here.value = null
  if (next) graph.setTree(next, { open: remembered() })
  refreshLabels()
})

// Re-drawn when the theme changes, because every colour in it came from there.
watch(() => JSON.stringify(theme.value), build)

// A dial moved. Applied in place -- nothing already on screen moves because
// somebody dragged a slider, the picture just starts behaving differently.
watch(look, () => { dress(engine.value); refreshLabels() }, { deep: true })

onBeforeUnmount(() => {
  cancelAnimationFrame(following)
  engine.value?.destroy?.()
  engine.value = null
})
</script>

<template>
  <div class="jamin-graph" :class="{ 'is-bare': bare }">
    <!-- Where you are, and the way back. In a tree that is the whole of what
         anybody needs. -->
    <div v-if="!bare" class="jamin-graph-strip">
      <template v-if="where.length">
        <button
          v-for="(one, n) in where" :key="n"
          type="button"
          class="jamin-graph-crumb"
          :class="{ 'is-here': n === where.length - 1 }"
          :title="`${one.clips.toLocaleString()} beneath this`"
          @click="jump(one.at)"
        >{{ one.label }}</button>
      </template>
      <span v-else class="jamin-graph-hint">
        Double-click a node to open it · drag to pan · scroll to zoom
      </span>
    </div>

    <div ref="box" class="jamin-graph-wrap">
      <!-- The names, over the canvas. The dots say where things are and the
           names say what they are. -->
      <div v-if="showLabels" class="jamin-graph-labels" aria-hidden="true">
        <span
          v-for="one in labels" :key="one.key"
          class="jamin-graph-label"
          :class="{ 'is-here': one.here, 'is-leaf': !one.shut, 'is-root': one.depth <= 1 }"
          :style="{ left: `${one.x}px`, top: `${one.y}px` }"
        >{{ one.label }}<i v-if="one.shut">{{ one.clips.toLocaleString() }}</i></span>
      </div>
    </div>

    <div v-if="!bare" class="jamin-graph-foot">
      <span>
        {{ drawnCount.toLocaleString() }} showing
        <span v-if="tree">of {{ tree.nodes.length.toLocaleString() }}</span>
      </span>
      <span class="jamin-graph-spacer"></span>
      <button type="button" @click="openAll">Open one more level</button>
      <button type="button" @click="closeAll">Collapse</button>
      <button type="button" @click="fit">Fit</button>
    </div>
  </div>
</template>
