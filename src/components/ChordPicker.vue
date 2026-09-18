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
import { computed, ref, watch } from 'vue'
import { WHEEL, QUALITIES, MARKS, chordSymbol } from '../core/chordPicker.js'

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

/** The twelve places, laid around a circle. */
const spokes = computed(() => WHEEL.map((place, at) => {
  const angle = (at / WHEEL.length) * Math.PI * 2 - Math.PI / 2
  return {
    ...place,
    x: 50 + Math.cos(angle) * 39,
    y: 50 + Math.sin(angle) * 39,
  }
}))

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
    <!-- Step one: the root. -->
    <template v-if="!root">
      <div class="jamin-wheel" role="group" aria-label="Choose a root">
        <button
          v-for="place in spokes"
          :key="place.pc"
          type="button"
          class="jamin-spoke"
          :style="{ left: `${place.x}%`, top: `${place.y}%` }"
        >
          <!-- Both spellings where a place has two. The sharp side and the
               flat side of the wheel meet at the bottom, and which one is
               right is a question about the key rather than about the note --
               so both are offered and the one clicked is the one written. -->
          <span
            v-for="name in place.names"
            :key="name"
            class="jamin-spoke-name"
            @click="chooseRoot(name)"
          >{{ name.replace('#', '♯').replace('b', '♭') }}</span>
        </button>
        <div class="jamin-wheel-hub">fifths</div>
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
