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
import { treeSizes, treeColours, rgba } from '../core/pathTree.js'
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

/* ---------------- what the catalogue knows ---------------------------- */

/**
 * The tree, with each node told how big and what colour it is.
 *
 * Worked out once per tree rather than per frame: size comes from how many
 * clips are under a node and colour from how deep it is, and neither changes
 * because somebody opened a folder.
 */
const dressed = computed(() => {
  const tree = props.tree
  if (!tree || !tree.nodes || !tree.nodes.length) return null

  const sizes = treeSizes(tree.nodes, { smallest: 3, largest: 26 })
  const colours = treeColours(tree.nodes, {
    from: theme.value.accent, to: theme.value.accentAlt, dim: theme.value.dim,
  })
  const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255)

  return {
    parents: tree.parents,
    nodes: tree.nodes.map((one, at) => ({
      ...one,
      size: sizes[at],
      colour: `rgba(${to(colours[at * 4])},${to(colours[at * 4 + 1])},`
        + `${to(colours[at * 4 + 2])},${colours[at * 4 + 3].toFixed(3)})`,
    })),
  }
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
    .filter((one) => !one.leaving)
    .sort((a, b) => (b.node.data.clips || 0) - (a.node.data.clips || 0))

  const out = []
  for (const one of order) {
    if (out.length >= budget) break
    const [x, y] = graph.screenOf(one)
    if (x < -40 || y < -20 || x > wide + 40 || y > tall + 20) continue

    const node = one.node.data
    const text = String(node.label || '')
    if (!text) continue

    // A rough box, eye-measured rather than measured per label: measuring a
    // hundred of them a frame costs a layout each, and being a few pixels out
    // only ever means one more gap.
    const room = 7 * text.length + 14
    let clear = true
    for (const already of out) {
      if (Math.abs(already.x - x) < (already.wide + room) / 2
          && Math.abs(already.y - y) < 15) { clear = false; break }
    }
    if (!clear) continue

    out.push({
      key: node.at,
      x: Math.round(x),
      y: Math.round(y),
      wide: room,
      label: text,
      clips: node.clips,
      depth: node.depth,
      shut: Boolean(one.node._children),
      here: here.value === node,
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
    onPick: (node) => {
      here.value = node
      emit('pick', node, node.at)
      refreshLabels()
    },
    onHover: (node) => { hovering.value = node },
    onOpen: () => refreshLabels(),
  })
  graph.look = {
    link: rgba(theme.value.dim, 0.3),
    linkWidth: 0.9,
    ring: theme.value.error,
  }
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
        const found = graph.root && graph.root.descendants()
          .find((one) => one.data.label === label && one._children)
        if (found) graph.toggle(found)
        return Boolean(found)
      },
      shutOnes: () => (graph.root
        ? graph.root.descendants().filter((one) => one._children).map((one) => one.data.label)
        : []),
    }
  }

  if (dressed.value) graph.setTree(dressed.value, { openTo: 2 })
  refreshLabels()
}

/* ---------------- the buttons ----------------------------------------- */

/** One more level, everywhere, for looking around rather than looking for. */
function openAll() {
  const graph = engine.value
  if (!graph || !graph.root) return
  const shut = graph.root.descendants().filter((one) => one._children)
  for (const one of shut) { one.children = one._children; one._children = null; one.shut = false }
  graph.relayout({ animate: true })
}

function closeAll() {
  const graph = engine.value
  if (!graph || !graph.root) return
  graph.root.each((one) => {
    if (one.depth >= 1 && one.children) {
      one._children = one.children
      one.children = null
      one.shut = true
    }
  })
  here.value = null
  graph.relayout({ animate: true })
}

function fit() {
  engine.value?.fitView?.()
}

/** The way back up, as a line of names. */
const where = computed(() => {
  if (!here.value || !engine.value || !engine.value.root) return []
  const found = engine.value.root.descendants().find((one) => one.data === here.value)
  if (!found) return []
  return found.ancestors().reverse()
    .filter((one) => one.data.at >= 0)
    .map((one) => ({ node: one, label: one.data.label, clips: one.data.clips }))
})

function jump(node) {
  const graph = engine.value
  if (!graph) return
  here.value = node.data
  graph.chosen = node
  graph.zoomToPoint?.(node)
  emit('pick', node.data, node.data.at)
}

/* ---------------- wiring ----------------------------------------------
 *
 * At the end, because a watch source array is read the moment `watch` is
 * called -- naming a ref declared further down reads it then, and a `const`
 * read before its declaration is a ReferenceError rather than an undefined.
 * That has been fallen into three times in this file's history.
 */
onMounted(() => { build(); followLabels() })

watch(dressed, (next) => {
  const graph = engine.value
  if (!graph) return
  here.value = null
  if (next) graph.setTree(next, { openTo: 2 })
  refreshLabels()
})

// Re-drawn when the theme changes, because every colour in it came from there.
watch(() => JSON.stringify(theme.value), build)

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
          @click="jump(one.node)"
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
