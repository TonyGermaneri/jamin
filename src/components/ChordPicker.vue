<script setup>
/**
 * Choosing a chord by pointing at one.
 *
 * Two steps, because a chord is two decisions. First the root, off a wheel of
 * fifths -- in fifths rather than chromatically because that is the order
 * chords actually move in, so the neighbours of the one you want are the ones
 * you are most likely to want next. Then the colouring, from a grid grouped by
 * family, with a second page behind the last cell for the rarer ones.
 *
 * Under the wheel, the marks that are not chords at all: hold, repeat the bar,
 * repeat two bars, no chord. They answer the same question -- what goes in
 * this slot -- so they are in the same place, and they skip the second step
 * because there is no colouring to give them.
 *
 * The vocabulary is in @see core/chordPicker.js, and every symbol it can
 * produce is run through the parser by the test suite: a picker that writes a
 * chord jamin cannot play would be worse than no picker.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { WHEEL, QUALITIES, MARKS, chordSymbol } from '../core/chordPicker.js'
import { wheelGeometry, sectorAt, drawWheel } from '../canvas/chordWheel.js'
import { state } from '../store.js'

const props = defineProps({
  /** Where to appear, in client coordinates. */
  at: { type: Object, default: null },
  /** The chord already there, so it can be shown as chosen. */
  current: { type: String, default: '' },
  /** How much room there is, so a short editor gets a smaller picker. */
  height: { type: Number, default: 0 },
})

const emit = defineEmits(['pick', 'close'])

const root = ref('')
const page = ref(0)

// A fresh opening starts at the wheel, whatever the last one ended on.
watch(() => props.at, () => { root.value = ''; page.value = 0 })

/**
 * Small enough to fit.
 *
 * The wheel and a grid want about 380px of height, and the smallest editor a
 * DAW will give the plugin is 480px with chrome in it. Scaling is the honest
 * answer: every part stays in proportion and in the same place, which a
 * re-flowed layout at a breakpoint would not.
 */
const scale = computed(() => {
  const room = props.height || 0
  if (!room || room >= 460) return 1
  return Math.max(0.62, room / 460)
})

/* ---------------- the wheel, drawn ------------------------------------
 *
 * It was twelve absolutely positioned buttons on a round div and looked
 * like it. @see canvas/chordWheel.js for why this is a canvas, and for
 * everything about where the sectors are.
 */
const SIZE = 268

const canvas = ref(null)
const hovered = ref(-1)
const geometry = computed(() => wheelGeometry(SIZE, WHEEL))

function paint() {
  const box = canvas.value
  if (!box) return
  const dpr = Math.min(3, window.devicePixelRatio || 1)
  if (box.width !== SIZE * dpr) {
    box.width = SIZE * dpr
    box.height = SIZE * dpr
  }
  drawWheel(box.getContext('2d'), geometry.value, {
    theme: state.settings.theme,
    hovered: hovered.value,
    chosen: props.current ? props.current.replace(/[^A-G#b].*$/, '') : '',
    dpr,
  })
}

/** Where the pointer is, in the canvas's own coordinates. */
function whereIn(event) {
  const box = canvas.value.getBoundingClientRect()
  return sectorAt(geometry.value,
    ((event.clientX - box.left) / box.width) * SIZE,
    ((event.clientY - box.top) / box.height) * SIZE)
}

function onMove(event) {
  const at = whereIn(event)
  if (at === hovered.value) return
  hovered.value = at
  paint()
}

function onLeave() {
  if (hovered.value < 0) return
  hovered.value = -1
  paint()
}

function onTap(event) {
  const at = whereIn(event)
  if (at >= 0) chooseRoot(WHEEL[at].name)
}

onMounted(paint)
onBeforeUnmount(() => { hovered.value = -1 })
// A fresh opening, a new theme, or coming back from the colour grid: all
// of them arrive with the canvas either new or stale.
watch(() => [props.at, props.current, root.value, JSON.stringify(state.settings.theme)],
  () => nextTick(paint))

function chooseRoot(name) {
  root.value = name
}

function chooseQuality(cell) {
  if (cell.more) { page.value = 1; return }
  if (cell.back) { page.value = 0; return }
  emit('pick', chordSymbol(root.value, cell.write))
}
</script>

<template>
  <div
    v-if="at"
    class="jamin-picker"
    :style="{ left: `${at.x}px`, top: `${at.y}px`, '--jamin-picker-scale': scale }"
    @mousedown.stop
    @click.stop
  >
    <!-- The way out, at every step. Opening this by clicking a chord and
         then deciding against it had no answer but pressing Escape or
         clicking somewhere harmless. -->
    <button type="button" class="jamin-picker-close" aria-label="Cancel"
            @click="emit('close')">×</button>

    <!-- Step one: the root. -->
    <template v-if="!root">
      <div class="jamin-wheel">
        <canvas
          ref="canvas" class="jamin-wheel-canvas"
          :style="{ width: `${SIZE}px`, height: `${SIZE}px` }"
          @mousemove="onMove" @mouseleave="onLeave" @click="onTap"
        ></canvas>

        <!--
          And the same twelve as real buttons, for anything that is not a
          pointer.

          A canvas has nothing in it to tab to or to read out. These sit
          over their own sectors, invisible and focusable, so the drawing
          is what a mouse uses and the buttons are what a keyboard and a
          screen reader use -- rather than the drawing being the only way
          in and the keyboard losing a control it had.
        -->
        <button
          v-for="place in geometry.sectors"
          :key="place.pc"
          type="button"
          class="jamin-wheel-hit"
          :style="{ left: `${place.x}px`, top: `${place.y}px` }"
          @focus="hovered = place.at; paint()"
          @blur="onLeave"
          @click="chooseRoot(place.name)"
        >{{ place.name }}</button>
      </div>

      <!-- And the things that are not chords. -->
      <div class="jamin-marks">
        <button
          v-for="mark in MARKS"
          :key="mark.write"
          type="button"
          class="jamin-mark"
          :title="mark.what"
          @click="emit('pick', mark.write)"
        >{{ mark.show }}</button>
      </div>
    </template>

    <!-- Step two: the colouring. -->
    <template v-else>
      <div class="jamin-picker-head">
        <button type="button" class="jamin-picker-back" @click="root = ''">‹</button>
        <strong>{{ root.replace('#', '♯').replace('b', '♭') }}</strong>
        <span>choose a colour</span>
      </div>
      <div class="jamin-colours">
        <button
          v-for="(cell, at2) in QUALITIES[page]"
          :key="at2"
          type="button"
          class="jamin-colour"
          :class="{ 'is-more': cell.more || cell.back,
                    'is-current': current === chordSymbol(root, cell.write) }"
          @click="chooseQuality(cell)"
        >{{ cell.show }}</button>
      </div>
    </template>
  </div>
</template>
