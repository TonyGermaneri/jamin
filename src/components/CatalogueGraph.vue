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
import { SHAPES as BUILT_IN_SHAPES, pointsInShape as sampleShape, fitToShape as pourInto } from '../core/shapeLayouts.js'

if (typeof window !== 'undefined') {
  window.__jaminGraphProbe = () => measureGraph(CosmosGraph, {
    SHAPES: BUILT_IN_SHAPES, pointsInShape: sampleShape, fitToShape: pourInto,
  })
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
  ringPositions, sizesFor, coloursFor, neighboursOf, walk, relationships, find,
} from '../core/graphView.js'
import { SHAPES, pointsInShape, fitToShape } from '../core/shapeLayouts.js'

const props = defineProps({
  /** `{ tags, edges }` from core/tagGraph.js. */
  graph: { type: Object, default: null },
  /** Which word is picked, by index, or -1. */
  modelValue: { type: Number, default: -1 },
})
const emit = defineEmits(['update:modelValue', 'pick', 'settled'])

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

  /*
   * Where the words were last time, if anybody knows.
   *
   * A force layout settles somewhere new on every run, and the whole value of a
   * map is knowing where things are -- one that rearranges itself between
   * sessions cannot be learned. So the first settling is the map, and every
   * opening after loads it and runs no physics at all.
   */
  const kept = props.graph.positions
  const known = Boolean(kept) && kept.length === tags.value.length * 2
  graph.setPointPositions(known ? kept.slice() : ringPositions(tags.value.length))
  graph.setPointSizes(sizesFor(tags.value))
  graph.setPointColors(coloursFor(tags.value, { dark: dark.value }))

  // Links as a flat pair list, which is what it wants and what tagGraph
  // already produces.
  const pairs = new Float32Array(edges.value.length * 2)
  edges.value.forEach(([a, b], n) => { pairs[n * 2] = a; pairs[n * 2 + 1] = b })
  graph.setLinks(pairs)

  graph.render()

  if (known) {
    // Nothing to settle: it is already where it belongs.
    engine.value = graph
    graph.fitView?.(0)
    return
  }

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
  settleTimer = setTimeout(() => keepWhereItLanded(), 4000)

  engine.value = graph
}

/**
 * Stop, and hand up where everything ended.
 *
 * This is the moment the arrangement becomes *the* arrangement -- read off the
 * GPU and passed to whoever can store it.
 */
async function keepWhereItLanded() {
  const graph = engine.value
  if (!graph) return
  graph.pause()
  settling.value = false
  const where = await graph.getPointPositions?.()
  if (where && where.length) emit('settled', new Float32Array(where))
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
/*
 * Typing looks a word up.
 *
 * A graph of several hundred words is quick to look *around* and slow to look
 * *up*: the one you want is somewhere in a cloud, and reading labels until it
 * turns up is worse than the list this replaced. So letters narrow, enter goes
 * to the best match, and escape clears -- which makes the graph as fast as a
 * search box for the thing a search box is good at, without giving up the thing
 * it is not.
 */
const typed = ref('')
const found = computed(() => (typed.value ? find(tags.value, typed.value) : []))

let typingTimer = null
function keepTyping(letter) {
  typed.value += letter
  clearTimeout(typingTimer)
  // Long enough to finish a word, short enough that coming back to the graph
  // later starts fresh rather than continuing something half-typed.
  typingTimer = setTimeout(() => { typed.value = '' }, 2500)
}

function onKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (typed.value) { typed.value = '' } else { at.value = { at: -1, from: -1, along: 0 } }
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    if (found.value.length) { jump(found.value[0]); typed.value = '' }
    return
  }

  if (event.key === 'Backspace') {
    event.preventDefault()
    typed.value = typed.value.slice(0, -1)
    return
  }

  // A letter or digit, and nothing held down that would make it a shortcut.
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
      && /[a-z0-9 -]/i.test(event.key)) {
    event.preventDefault()
    keepTyping(event.key.toLowerCase())
    return
  }

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
watch(found, (matches) => {
  const graph = engine.value
  if (!graph) return
  // What was typed, lit up where it sits -- so the shape of the answer is
  // visible before anything is chosen. Nothing typed puts the selection back to
  // whatever is picked.
  if (matches.length) graph.selectPointsByIndices?.(matches)
  else if (at.value.at >= 0) focus(at.value.at)
  else graph.unselectPoints?.()
})

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

/**
 * Settle it again, and keep wherever it lands.
 *
 * The stored arrangement is the one anybody has learned, so replacing it is
 * something to ask for rather than something that happens -- which is what this
 * button is. Worth it after a catalogue grows, when the old map is a map of
 * something smaller.
 */
/*
 * The same arrangement, poured into a shape.
 *
 * A settled layout says what is near what and nothing about where, so every
 * collection looks like the same blob and a blob is hard to remember. A shape
 * is easy to remember -- you know where the wing is -- and because the words
 * are moved onto it along a space-filling curve rather than at random, what was
 * near stays near. @see core/shapeLayouts.js
 *
 * Unnamed, because naming them invites an argument about whether it really
 * looks like a heron.
 */
const shapes = SHAPES.map((one, at) => ({ id: one.id, label: `Built-in ${at + 1}`, path: one.path }))
const shaped = ref('')

function pourInto(which) {
  const graph = engine.value
  if (!graph) return

  shaped.value = which

  if (!which) {
    // Back to however it settled, which is the arrangement the collection
    // actually has rather than one it was poured into.
    const kept = props.graph.positions
    if (kept && kept.length === tags.value.length * 2) {
      graph.setPointPositions(kept.slice())
      graph.render()
      graph.fitView?.(300)
    }
    return
  }

  const shape = shapes.find((one) => one.id === which)
  if (!shape) return

  const cloud = pointsInShape(shape.path, Math.max(2000, tags.value.length * 3))
  if (!cloud.length) return

  // From wherever it is now, so pouring one shape into another keeps the
  // arrangement rather than starting from the ring each time.
  const now = props.graph.positions && props.graph.positions.length === tags.value.length * 2
    ? props.graph.positions
    : ringPositions(tags.value.length)

  graph.setPointPositions(fitToShape(now, cloud))
  graph.render()
  graph.fitView?.(400)
  // Held still: a shape the simulation is allowed to pull at stops being a
  // shape within a second.
  graph.pause()
  settling.value = false
}

function restir() {
  const graph = engine.value
  if (!graph) return
  graph.start()
  settling.value = true
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => keepWhereItLanded(), 4000)
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
        Click a word, or start typing one — then ← → to walk its relationships, ↓ to follow one, ↑ to come back
      </span>
    </div>

    <!-- What is being typed, and what it found. Shown over the canvas rather
         than in a box of its own: it is a thing that appears for a second and
         a control that is always there would say the graph needs one. -->
    <div class="jamin-graph-wrap">
      <div v-if="typed" class="jamin-graph-typed">
        <span class="jamin-graph-typing">{{ typed }}</span>
        <template v-if="found.length">
          <em>{{ tags[found[0]].tag }}</em>
          <span v-if="found.length > 1">and {{ found.length - 1 }} more · enter</span>
        </template>
        <span v-else>nothing</span>
      </div>

    <div
      ref="canvas"
      class="jamin-graph-canvas"
      tabindex="0"
      role="application"
      :aria-label="`${tags.length} words in this catalogue`"
      @keydown="onKey"
    ></div>
    </div>

    <div class="jamin-graph-foot">
      <span>{{ tags.length.toLocaleString() }} words · {{ edges.length.toLocaleString() }} relationships</span>
      <span v-if="settling" class="jamin-graph-settling">settling…</span>
      <span class="jamin-graph-spacer"></span>
      <label class="jamin-graph-layout">
        Layout
        <select :value="shaped" @change="pourInto($event.target.value)">
          <option value="">Settled</option>
          <option v-for="one in shapes" :key="one.id" :value="one.id">{{ one.label }}</option>
        </select>
      </label>
      <button type="button" @click="fit">Fit</button>
      <button type="button" @click="restir">Re-settle</button>
    </div>
  </div>
</template>
