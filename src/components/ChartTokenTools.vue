<script setup>
/**
 * The handful of things you can do to a chord without typing it.
 *
 * Hover a chord and the icons for it appear above it; the same for an
 * articulation, a drum mark, or one of the marks that are neither. Which icons
 * depends on what is under the pointer, and nothing else about the chart
 * changes -- this is a way of doing by clicking what has always been done by
 * typing, not a second way of holding the song.
 *
 * Deliberately mouse-only, with a long press standing in for a hover on a
 * touch screen. There is no keyboard path here on purpose: the keyboard path
 * is to type the chart, which is faster than any menu and is what the editor
 * is for.
 *
 * Positioned from the layout's own token rectangles (@see canvas/layout.js
 * rectForToken), so the icons sit where the text is however the chart is
 * scrolled or scaled -- and vanish with it when it scrolls away.
 */
import { computed } from 'vue'

const props = defineProps({
  /** `{ x, y, w, h }` of the token, in the chart's own coordinates, or null. */
  rect: { type: Object, default: null },
  /** The token under the pointer, or null. */
  token: { type: Object, default: null },
  /** How far the chart is scrolled, so the icons travel with it. */
  scroll: { type: Number, default: 0 },
  /** The height of the chart, so icons near the top flip below the token. */
  height: { type: Number, default: 0 },
})

const emit = defineEmits(['act', 'keep', 'let-go'])

/**
 * What can be done to this thing.
 *
 * A chord carries the most: it can be removed, re-spelled, given an
 * articulation, or have one taken away -- and that last is only offered when
 * there is one, because an icon that does nothing is a lie about the chord.
 * Everything else is a mark of some kind, and a mark can be changed or removed.
 */
const ACTIONS = {
  chord: (token) => [
    { do: 'delete', icon: 'mdi-close', what: 'Remove this chord' },
    { do: 'chord', icon: 'mdi-music-accidental-sharp', what: 'Write a different chord' },
    { do: 'articulate', icon: 'mdi-book-music-outline', what: 'Play an articulation here' },
    ...(token.phraseRef || token.phraseChange
      ? [{ do: 'unarticulate', icon: 'mdi-music-note-off-outline', what: 'Stop the articulation change' }]
      : []),
  ],
  drum: () => [
    { do: 'delete', icon: 'mdi-close', what: 'Remove this drum change' },
    { do: 'drums', icon: 'mdi-circle-multiple-outline', what: 'Play a different pattern' },
  ],
  mark: () => [
    { do: 'delete', icon: 'mdi-close', what: 'Remove this' },
    { do: 'chord', icon: 'mdi-music-accidental-sharp', what: 'Write something else here' },
  ],
}

/** Which family this token belongs to, for the icons above it. */
const family = computed(() => {
  const token = props.token
  if (!token) return null
  if (token.type === 'chord') return 'chord'
  if (token.type === 'drum') return 'drum'
  if (token.type === 'label') return null        // a section name is not a control
  return 'mark'
})

const actions = computed(() =>
  (family.value ? ACTIONS[family.value](props.token) : []))

/**
 * Above the token, or below it when there is no room above.
 *
 * The first line of a chart is at the top of the window, and icons drawn above
 * it would be off the screen -- which is exactly where the chord somebody is
 * most likely to edit first happens to live.
 */
const BAR = 30

/*
 * As big as the text they belong to.
 *
 * The chart sets its own type size to fill the window, so a four-line chart is
 * drawn enormous and a forty-line one small. Icons at a fixed size are lost
 * against the first and overwhelm the second; these take their size from the
 * line they are annotating, which is what `rect.h` already is.
 */
const scale = computed(() => {
  const tall = props.rect ? props.rect.h : 0
  if (!tall) return 1
  return Math.max(0.85, Math.min(2.2, tall / 34))
})

const where = computed(() => {
  const rect = props.rect
  if (!rect) return null
  const top = rect.y - props.scroll
  const bar = BAR * scale.value
  const above = top - bar - 4
  const below = top + rect.h + 4
  const flipped = above < 2
  return {
    left: `${Math.max(2, rect.x + rect.w / 2)}px`,
    top: `${flipped ? below : above}px`,
    flipped,
  }
})

const showing = computed(() => Boolean(where.value && actions.value.length))
</script>

<template>
  <div
    v-if="showing"
    class="jamin-token-tools"
    :class="{ 'is-below': where.flipped }"
    :style="{ left: where.left, top: where.top, '--jamin-tool-scale': scale }"
    @mousedown.stop.prevent
    @mouseenter="emit('keep')"
    @mouseleave="emit('let-go')"
  >
    <button
      v-for="one in actions"
      :key="one.do"
      type="button"
      class="jamin-token-tool"
      :title="one.what"
      :aria-label="one.what"
      @click.stop="emit('act', one.do)"
    >
      <v-icon :size="Math.round(15 * scale)">{{ one.icon }}</v-icon>
    </button>
  </div>
</template>
