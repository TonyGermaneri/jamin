<script>
/*
 * The probe's way in, registered when this module is evaluated rather than when
 * a component mounts.
 *
 * `<script setup>` becomes the setup function and runs per instance, so hanging
 * it there meant the probe could only see a graph that was already on screen --
 * which is the one case where nobody needs telling it works.
 *
 * It cannot live in core/graphView.js: that file is pure arithmetic and is
 * tested by concatenating it into JavaScriptCore, where importing a WebGL
 * renderer would be importing a renderer into a machine with no canvas.
 * @see core/graphView.js measureGraph, native/tools/boot_probe.m
 */
import { Graph as CosmosGraph } from '@cosmos.gl/graph'
import { measureGraph } from '../core/graphView.js'

if (typeof window !== 'undefined') {
  window.__jaminGraphProbe = () => measureGraph(CosmosGraph)
}

export default {}
</script>

<script setup>
/**
 * A catalogue, drawn as the words in it.
 *
 * One component for three collections. Everything that knows which collection
 * it is looking at lives in an adapter (@see core/graphView.js ADAPTERS); this
 * knows about nodes, edges and a canvas.
 *
 * The words are the nodes. Clips are not drawn here at all -- three quarters of
 * a million points is a hairball whatever the frame rate, and the structure a
 * person can actually read is the few hundred words and the thousands of edges
 * between them. Picking a word is how you reach its clips, which is what the
 * list beside it is for.
 *
 * Drawn by cosmos.gl, which runs the force simulation in fragment shaders --
 * the only part of this that could not be written here in an afternoon, and the
 * reason the plugin's WebGL2 float-texture support was measured before any of
 * it was planned. @see native/tools/boot_probe.m
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Graph } from '@cosmos.gl/graph'
import { state } from '../store.js'
import {
  ringPositions, sizesFor, coloursFor, neighboursOf, walk, relationships,
} from '../core/graphView.js'

const props = defineProps({
  /** `{ tags, edges }` from core/tagGraph.js. */
  graph: { type: Object, default: null },
  /** Which word is picked, by index, or -1. */
  modelValue: { type: Number, default: -1 },
})
const emit = defineEmits(['update:modelValue', 'pick'])

const canvas = ref(null)
/** Shallow: cosmos holds GPU handles and must never be made reactive. */
const engine = shallowRef(null)
const settling = ref(false)

const tags = computed(() => (props.graph && props.graph.tags) || [])
const edges = computed(() => (props.graph && props.graph.edges) || [])
const near = computed(() => neighboursOf(tags.value.length, edges.value))

/** Where the keyboard is: a word, where it came from, and which edge it points
    along. @see core/graphView.js walk */
const at = ref({ at: -1, from: -1, along: 0 })

const strip = computed(() =>
  (at.value.at >= 0 ? relationships(tags.value, near.value, at.value) : null))

const dark = computed(() => state.settings.display.theme !== 'light')

/* ---------------- building it ---------------------------------------- */

function build() {
  if (!canvas.value || !tags.value.length) return

  engine.value?.destroy?.()

  const graph = new Graph(canvas.value, {
    spaceSize: 4096,
    backgroundColor: 'rgba(0,0,0,0)',
    // Enough repulsion to open the hubs out, enough friction to stop it
    // wandering. A map that never settles cannot be learned.
    simulationFriction: 0.85,
    simulationGravity: 0.12,
    simulationRepulsion: 0.9,
    simulationLinkSpring: 0.7,
    simulationLinkDistance: 12,
    linkWidth: 0.6,
    linkColor: dark.value ? 'rgba(180,190,220,0.18)' : 'rgba(40,60,110,0.16)',
    curvedLinks: false,
    fitViewOnInit: true,
    enableDrag: false,
    renderHoveredPointRing: true,
    hoveredPointRingColor: dark.value ? '#9db4ff' : '#3D4E8C',
    focusedPointRingColor: dark.value ? '#ffd479' : '#A8543A',
    onClick: (index) => { if (index !== undefined && index !== null) choose(index) },
  })

  graph.setPointPositions(ringPositions(tags.value.length))
  graph.setPointSizes(sizesFor(tags.value))
  graph.setPointColors(coloursFor(tags.value, { dark: dark.value }))

  // Links as a flat pair list, which is what it wants and what tagGraph
  // already produces.
  const pairs = new Float32Array(edges.value.length * 2)
  edges.value.forEach(([a, b], n) => { pairs[n * 2] = a; pairs[n * 2 + 1] = b })
  graph.setLinks(pairs)

  graph.render()
  graph.start()
  settling.value = true

  /*
   * Stopped, rather than left running.
   *
   * A live simulation is a map that moves under the pointer, and the whole
   * value of this view is learning where things are. It settles once, for a few
   * seconds, and then holds still.
   */
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    engine.value?.pause?.()
    settling.value = false
  }, 4000)

  engine.value = graph
}

let settleTimer = null

function choose(index) {
  at.value = { at: index, from: -1, along: 0 }
  emit('update:modelValue', index)
  emit('pick', tags.value[index])
  focus(index)
}

/** Light up the chosen word and whatever it is related to. */
function focus(index) {
  const graph = engine.value
  if (!graph) return
  const related = (near.value[index] || []).map((one) => one.at)
  graph.setFocusedPointByIndex?.(index)
  graph.selectPointsByIndices?.([index, ...related])
}

/* ---------------- the keyboard ----------------------------------------
 *
 * Walking edges is what a graph is for and the thing a mouse does badly: a
 * word's strongest relationship can be anywhere on screen, and finding it by
 * eye in a thousand-word cloud is not finding it.
 *
 *   ← →   along this word's relationships, strongest first
 *   ↓     into the one being pointed at
 *   ↑     back where you came from, onto the edge you arrived by
 */
function onKey(event) {
  const key = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key]
  if (!key || at.value.at < 0) return
  event.preventDefault()

  const next = walk(near.value, at.value, key)
  const moved = next.at !== at.value.at
  at.value = next

  if (moved) {
    emit('update:modelValue', next.at)
    emit('pick', tags.value[next.at])
    focus(next.at)
    engine.value?.setZoomTransformByPointPositions?.([next.at], 400)
  }
}

/** Jump straight to a related word from the strip, which is the same list the
    arrow keys walk and therefore the same thing done with a mouse. */
function jump(index) {
  at.value = { at: index, from: at.value.at, along: 0 }
  emit('update:modelValue', index)
  emit('pick', tags.value[index])
  focus(index)
  engine.value?.setZoomTransformByPointPositions?.([index], 400)
}

function fit() {
  engine.value?.fitView?.(300)
}

/** Settle it again, for when the arrangement is worth another look. */
function restir() {
  const graph = engine.value
  if (!graph) return
  graph.start()
  settling.value = true
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => { graph.pause(); settling.value = false }, 4000)
}

onMounted(build)
watch(() => props.graph, build)
watch(dark, build)

onBeforeUnmount(() => {
  clearTimeout(settleTimer)
  engine.value?.destroy?.()
  engine.value = null
})
</script>

<template>
  <div class="jamin-graph">
    <!-- What this word is related to, strongest first. Both a readout and the
         keyboard's menu: the same list, in the same order, as ← and → walk. -->
    <div class="jamin-graph-strip">
      <template v-if="strip">
        <strong class="jamin-graph-word">{{ strip.word }}</strong>
        <span class="jamin-graph-count">{{ strip.clips.toLocaleString() }}</span>
        <span class="jamin-graph-with">with</span>
        <button
          v-for="one in strip.with" :key="one.at"
          type="button"
          class="jamin-graph-rel"
          :class="{ 'is-pointed': one.pointed }"
          :title="`${one.clips.toLocaleString()} share both — click, or press ↓`"
          @click="jump(one.at)"
        >{{ one.tag }}<i>{{ one.clips.toLocaleString() }}</i></button>
        <span v-if="strip.more" class="jamin-graph-more">+{{ strip.more }} more</span>
      </template>
      <span v-else class="jamin-graph-hint">
        Click a word to see what it is related to — then ← → to walk its relationships, ↓ to follow one, ↑ to come back
      </span>
    </div>

    <div
      ref="canvas"
      class="jamin-graph-canvas"
      tabindex="0"
      role="application"
      :aria-label="`${tags.length} words in this catalogue`"
      @keydown="onKey"
    ></div>

    <div class="jamin-graph-foot">
      <span>{{ tags.length.toLocaleString() }} words · {{ edges.length.toLocaleString() }} relationships</span>
      <span v-if="settling" class="jamin-graph-settling">settling…</span>
      <span class="jamin-graph-spacer"></span>
      <button type="button" @click="fit">Fit</button>
      <button type="button" @click="restir">Re-settle</button>
    </div>
  </div>
</template>
