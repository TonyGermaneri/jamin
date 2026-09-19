<script setup>
/**
 * A catalogue as a map, with the map as the whole screen.
 *
 * The graph used to be a panel in a column of a dialog: about a fifth of the
 * window, with a list beside it and a chart showing uselessly around the edges.
 * That is the wrong way round. Three quarters of a million patterns arranged in
 * a tree is the thing worth looking at, and everything else -- which track, what
 * is filtered, what you just clicked -- is annotation that belongs *over* it.
 *
 * So the canvas is the page and this is the glass in front of it: a chrome row
 * at the top, two thin rows of filters under that, and a detail panel down the
 * right when something is chosen. All of it floats, all of it is translucent,
 * and none of it takes a pixel of canvas away -- a fixed canvas behind fixed
 * panels is edge to edge whatever is on top.
 *
 * The books own their own filters and their own idea of what a chosen thing
 * looks like, because those are the only parts that differ between a drum
 * pattern, a phrase and a progression. They arrive as slots.
 */
import { computed } from 'vue'
import CatalogueGraph from './CatalogueGraph.vue'

const props = defineProps({
  /** The tree to draw. @see core/pathTree.js */
  tree: { type: Object, default: null },
  /** Whether the catalogue behind it is still being counted or fetched. */
  busy: { type: Boolean, default: false },
  /** How many things the filters currently match. */
  found: { type: Number, default: 0 },
  /** What this catalogue is called, for the corner. */
  label: { type: String, default: '' },
  /** Which catalogue, so what was left open is remembered per book. */
  book: { type: String, default: '' },
})

const emit = defineEmits(['pick'])

/**
 * The cursor says the map is thinking; the map itself never goes away.
 *
 * Rebuilding used to blank the canvas and put a spinner where the picture had
 * been, so every touch of a filter threw away the thing somebody was reading.
 * The old picture is still true until the new one arrives -- it is simply one
 * filter behind -- so it stays, and the waiting is said in the cursor and in a
 * hairline across the top. @see styles/app.css .jamin-map
 */
const waiting = computed(() => Boolean(props.busy))
</script>

<template>
  <div class="jamin-map" :class="{ 'is-waiting': waiting }">
    <!-- The canvas, edge to edge and behind everything. -->
    <CatalogueGraph
      class="jamin-map-canvas"
      :tree="tree"
      :book="book"
      bare
      @pick="(node, at, path) => emit('pick', node, at, path)"
    />

    <!-- A hairline rather than a spinner over the picture: the map stays
         readable while the next one is worked out. -->
    <div v-if="waiting" class="jamin-map-progress" aria-hidden="true"></div>

    <div class="jamin-map-glass" data-keep-clear="top">
      <!-- Which track, which catalogue, and the way out. -->
      <div v-if="$slots.chrome" class="jamin-map-chrome">
        <slot name="chrome" />
      </div>

      <!-- Thin rows. Every filter is on screen at once rather than behind a
           disclosure, because on a map a filter is how you move, not a setting
           you occasionally change. -->
      <div class="jamin-map-filters">
        <slot name="filters" />
      </div>
    </div>

    <!--
      Everything that floats over the picture rather than over the filters.

      In flow beneath the glass rather than pinned to the top of the screen, so
      the panel starts where the filters end however many rows of them there
      are. Pinned, it covered the last two filters -- which is the kind of thing
      that is obvious in a photograph and invisible in a template.
      @see scripts/shots.py
    -->
    <div class="jamin-map-below">
      <aside v-if="$slots.detail" class="jamin-map-detail" data-keep-clear="right">
        <slot name="detail" />
      </aside>

      <!-- What the filters found, and how much of the map is drawn. The
           second is a fact about the picture rather than about the catalogue,
           and on a map that is worth saying. -->
      <div class="jamin-map-count" data-keep-clear="bottom">
        <strong>{{ found.toLocaleString() }}</strong>
        <span>{{ label }}</span>
        <span v-if="tree && tree.nodes">
          · {{ tree.nodes.length.toLocaleString() }} places
          <template v-if="tree.clips">in {{ tree.clips.toLocaleString() }}</template>
        </span>
      </div>
    </div>
  </div>
</template>
