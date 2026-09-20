<script setup>
/**
 * The progression library.
 *
 * The list is a page at a time and shows only a name and a length, because it
 * has to work with two thirds of a million progressions in it. Whatever is
 * selected is shown in full on the right, converted and transposed only then --
 * doing that to every row of every page would be work thrown away.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  state,
  saveProgression,
  deleteProgression,
  insertProgression,
  renderProgression,
  progressionPage,
  streamProgressions,
  progressionFacetList,
  refreshBulkCount,
  toast,
  midiForProgression,
  allProgressions,
  treeOf,
  storedGraph,
  buildBulkGraph,
} from '../store.js'
import { summarizeProgression } from '../core/progressions.js'
import { parseScore } from '../core/score.js'
import InfoTip from './InfoTip.vue'
import CatalogueMap from './CatalogueMap.vue'
import DataGrid from './DataGrid.vue'
import { ADAPTERS } from '../core/graphView.js'
import { vDragMidi } from '../core/dragOut.js'
import { pcName } from '../core/chordParser.js'

const PER_PAGE = 12

/*
 * The library as the words in it.
 *
 * The third catalogue, and the test of whether the first two shared properly:
 * if this needs anything but an adapter and four lines, they did not.
 *
 * Progressions have no paths -- their words are the name and the tags -- which
 * is exactly the case the adapter exists for. @see core/graphView.js ADAPTERS
 */
const asGraph = computed(() => state.settings.graph.progressions)
const graph = ref(null)
/** True while the whole library is being read, which happens once. */
const building = ref(false)
const drawn = ref(0)

/*
 * Two libraries, and only one of them fits in memory.
 *
 * The saved progressions are a handful and are graphed on the spot. Chordonomicon
 * is two thirds of a million rows in the database, so it gets the same treatment
 * as the drum catalogue: read once, built once, kept -- and asked for rather
 * than sprung on somebody who opened a view.
 */
const sortBy = ref('')
const sorts = ADAPTERS.progressions.sorts
/** True while a narrowing is being fetched for the graph. */
const reading = ref(false)
/** As many as a tree is worth drawing from. A narrowing is usually thousands. */
const MOST_GRAPH_ROWS = 60000

/*
 * Two libraries, and only one of them fits in memory.
 *
 * The saved progressions are a handful and are built on the spot, which is what
 * lets the filters work on the graph. Chordonomicon is two thirds of a million
 * rows in the database and gets what the drum catalogue gets: read once, built
 * once, kept.
 */

async function drawTheMap() {
  building.value = true
  drawn.value = 0
  try {
    graph.value = await buildBulkGraph('progressions', { onProgress: (n) => { drawn.value = n } })
  } finally {
    building.value = false
  }
}


/** A progression is chosen outright; a group searches for its name. */
function pickNode(node) {
  if (!node) return
  search.value = node.label
}

const search = ref('')
const page = ref(1)
const rows = ref([])
const total = ref(0)
const partial = ref(false)
const loading = ref(false)
const selected = ref(null)

const targetPc = ref(null)
const spelling = ref('auto')
const mode = ref('replace')
const newName = ref('')
/** Whether the little save panel is showing. @see saveCurrent */
const saving = ref(false)

const modes = [
  { title: 'Replace the whole song', value: 'replace' },
  { title: 'On a new line at the end', value: 'append' },
  { title: 'At the cursor', value: 'caret' },
]

const keyOptions = computed(() => [
  { title: 'As written', value: null },
  ...Array.from({ length: 12 }, (_, pc) => ({
    title: pcName(pc, true) === pcName(pc) ? pcName(pc) : `${pcName(pc)} / ${pcName(pc, true)}`,
    value: pc,
  })),
])

/**
 * What the grid shows.
 *
 * The list carried a name and a bar count. There is room for what somebody
 * is actually choosing between -- how long it is, what genre it came from,
 * when -- and a grid is what puts those in line with each other.
 */
const gridColumns = [
  { name: 'name', title: 'Progression', width: 340 },
  { name: 'bars', title: 'Bars', width: 64 },
  { name: 'genre', title: 'Genre', width: 150 },
  { name: 'decade', title: 'Decade', width: 90 },
  { name: 'text', title: 'Chords', width: 520 },
]

/* Bars are counted from the text for the hand-written ones, which carry no
   count -- so it is done once here rather than per repaint. */
const gridRows = computed(() => rows.value.map((one) => ({
  ...one,
  bars: barsOf(one),
  genre: one.genre || '',
  decade: one.decade || '',
})))

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)))

/*
 * Genre and decade are Chordonomicon's own columns -- every imported row
 * carries both -- so they are filters rather than something only visible in a
 * name. They appear once a collection has been imported and not before, since
 * the built-in progressions have neither.
 */
const genre = ref('')
const decade = ref('')
/** Only progressions the same length as the chart, or that go into it evenly. */
const onlyFitting = ref(false)
const facets = ref({ genres: [], decades: [] })
/*
 * Open already, when there is room for them.
 *
 * Folded away is right in the plugin's own editor, where five selects is most
 * of a 480px window and the list is what somebody came for. Full screen it is
 * the wrong default twice over: the filters are the fastest way into a
 * catalogue of this size, and folded they leave a column of nothing beside a
 * list that has plenty of room already.
 *
 * Measured once, on the width the window opens at. Dragging a plugin window
 * about should not fold and unfold a panel somebody is using.
 */
const filtersOpen = ref(
  typeof window !== 'undefined' && window.innerWidth >= 1280 ? 0 : undefined)
const activeFilters = computed(() =>
  [genre.value, decade.value, onlyFitting.value].filter(Boolean).length)

/**
 * How long the chart is, for the fitting switch.
 *
 * A progression fits if it is the same length as the song or goes into it a
 * whole number of times -- a four-bar turnaround under sixteen bars is the same
 * shape four times over, and a five-bar one is a different song.
 */
const songBars = computed(() => Math.round(state.score.bars || 0))

function fitsSong(row) {
  const bars = Math.round(barsOf(row))
  const total = songBars.value
  if (!bars || !total) return false
  return bars === total || total % bars === 0
}

const genreItems = computed(() => [
  { title: 'Any genre', value: '' },
  ...facets.value.genres.map((one) => ({ title: `${one.value} (${one.count.toLocaleString()})`, value: one.value })),
])
const decadeItems = computed(() => [
  { title: 'Any decade', value: '' },
  ...facets.value.decades
    .slice()
    .sort((a, b) => Number(a.value) - Number(b.value))
    .map((one) => ({ title: `${one.value}s (${one.count.toLocaleString()})`, value: one.value })),
])

/**
 * Imported rows carry a bar count from the import, counted cheaply. The
 * hand-written ones do not, so work it out -- a dozen short charts a page is
 * nothing, and it is the only honest number to put next to a name.
 */
function barsOf(row) {
  if (typeof row.bars === 'number') return row.bars
  return Math.round(parseScore(row.text, { beatsPerBar: state.settings.transport.beatsPerBar }).bars * 10) / 10
}
const preview = computed(() => (selected.value ? renderProgression(selected.value, targetPc.value, spelling.value) : ''))

/**
 * Everything the filters match, streamed into the grid.
 *
 * This fetched one page of twelve and a pager walked them. The grid holds
 * the lot, so the rows arrive in batches and it grows -- the first batch is
 * on screen in about the time one page used to take. @see store.js
 * streamProgressions
 */
const streaming = ref(false)
let loadRun = 0

async function load() {
  const mine = ++loadRun
  loading.value = true
  streaming.value = true
  rows.value = []
  try {
    await streamProgressions((batch, count, some) => {
      if (mine !== loadRun) return false
      // A new array each time: the grid remeasures on assignment, not on a
      // push into the one it already has.
      rows.value = rows.value.concat(batch)
      total.value = count
      partial.value = some
      loading.value = false
      if (!selected.value) selected.value = rows.value[0] || null
      return true
    }, search.value, {
      genre: genre.value, decade: decade.value,
      fits: onlyFitting.value ? songBars.value : 0,
    })
  } finally {
    if (mine === loadRun) { loading.value = false; streaming.value = false }
  }
}

watch(() => [state.ui.progressions, page.value, search.value, genre.value, decade.value,
             onlyFitting.value, songBars.value,
             state.progressions.length, state.bulk.count],
  ([open]) => { if (open) load() }, { immediate: true })
watch([search, genre, decade, onlyFitting], () => { page.value = 1 })

// The facets are a scan, so they are read once the dialog opens and once the
// count changes, rather than on every keystroke.
watch(() => [state.ui.progressions, state.bulk.count], async ([open]) => {
  if (!open) return
  facets.value = await progressionFacetList()
}, { immediate: true })

/*
 * The same walking as the catalogue, with one difference: selecting a
 * progression never inserts it. Auditioning a phrase is harmless; replacing the
 * whole chart because the wheel moved is not.
 */
function step(delta) {
  if (!rows.value.length) return
  const at = Math.max(0, rows.value.findIndex((row) => selected.value && row.name === selected.value.name))
  const next = at + delta

  if (next < 0) {
    if (page.value > 1) { page.value -= 1; selected.value = null }
    return
  }
  if (next >= rows.value.length) {
    if (page.value < pageCount.value) { page.value += 1; selected.value = null }
    return
  }
  selected.value = rows.value[next]
}

let wheelAcc = 0
function onWheel(event) {
  event.preventDefault()
  wheelAcc += event.deltaY
  while (Math.abs(wheelAcc) >= 30) {
    step(wheelAcc > 0 ? 1 : -1)
    wheelAcc -= Math.sign(wheelAcc) * 30
  }
}

function insert() {
  if (!selected.value) return
  insertProgression(selected.value, { mode: mode.value, targetPc: targetPc.value, spelling: spelling.value })
}

/**
 * One progression at random, and applied.
 *
 * Drawn from everything the filters match rather than from the page on screen:
 * the library runs to hundreds of thousands of rows and the visible twelve are
 * an accident of where you happened to have scrolled to. So it picks a row
 * number and fetches that one, which is one query rather than a download.
 */
async function rollProgression() {
  if (!total.value) return
  loading.value = true
  try {
    const at = Math.floor(Math.random() * total.value)
    const result = await progressionPage(at, 1, search.value,
                                         { genre: genre.value, decade: decade.value })
    const pick = result.rows && result.rows[0]
    if (!pick) return

    selected.value = pick
    // Shown as well as applied: a progression that appears in the chart with
    // nothing selected leaves you unable to say what you just got.
    page.value = Math.floor(at / PER_PAGE) + 1
    insertProgression(pick, { mode: mode.value, targetPc: targetPc.value, spelling: spelling.value })
  } finally {
    loading.value = false
  }
}

function saveCurrent(text, label) {
  if (saveProgression(newName.value || label, text)) {
    newName.value = ''
    saving.value = false
  }
}


/*
 * Last in the file, deliberately.
 *
 * This reads refs declared all over the setup, and a `const` used before its
 * declaration is a ReferenceError rather than an undefined -- which is a
 * component that renders nothing and says why only in the console. Two earlier
 * attempts put it near the top and threw exactly that.
 */
/**
 * The tree for whatever is being looked at.
 *
 * Unfiltered and with a bulk library imported, it is the stored one -- drawn
 * now if there is not one yet, rather than offered behind a button.
 *
 * Filtered, it is built from everything the filters match, asked for again
 * rather than taken from `rows`, which is the page the list is showing. A tree
 * of twelve progressions looks like a working graph and is a lie about the
 * library.
 */
let drawing = 0

async function refreshTree() {
  if (!asGraph.value) return
  const mine = ++drawing
  /*
   * `'any'` is not what an unset filter is.
   *
   * These two hold `''` when nothing is chosen -- that is the value on the
   * "Any genre" item -- so comparing against `'any'` was true whichever way it
   * was set, and the unfiltered branch below could never be reached. With a
   * bulk library in, every opening of the map re-queried and rebuilt instead
   * of using the one that had been built and stored for exactly this.
   *
   * `activeFilters` already knows what counts as set, and is what the panel
   * shows; one answer, in one place.
   */
  const narrowed = Boolean(search.value) || activeFilters.value > 0

  if (state.bulk.count > 0 && !narrowed && !sortBy.value) {
    const kept = await storedGraph('progressions')
    if (mine !== drawing) return
    if (kept) { graph.value = kept; return }
    await drawTheMap()
    return
  }

  if (state.bulk.count > 0 && narrowed) {
    reading.value = true
    try {
      // Everything the filters match, not the page of it on screen.
      const found = await progressionPage(0, MOST_GRAPH_ROWS, search.value,
                                          { genre: genre.value,
                                            decade: decade.value,
                                            fits: onlyFitting.value ? songBars.value : 0 })
      if (mine !== drawing) return
      graph.value = treeOf('progressions', found.rows, sortBy.value)
    } finally {
      if (mine === drawing) reading.value = false
    }
    return
  }

  graph.value = treeOf('progressions', allProgressions(), sortBy.value)
}

// Not during setup: `rows` is declared below, and a const used before its
// declaration is a ReferenceError. @see components/DrumBook.vue for the same
// trap, fallen into twice.
// Getters, not the refs: a watch source array is built when `watch` is called,
// so naming `rows` in it reads a const declared further down.
watch([asGraph, sortBy, () => state.bulk.count, () => rows.value,
       () => search.value, () => genre.value, () => decade.value, () => onlyFitting.value],
      refreshTree)
onMounted(refreshTree)

</script>

<template>
  <!-- The whole screen, like the other two. A library of several hundred
       thousand progressions is not a thing to read through a letterbox.
       @see components/ArticulationBook.vue -->
  <v-dialog
    v-model="state.ui.progressions"
    fullscreen
    :scrim="false"
    transition="dialog-bottom-transition"
    scrollable
    class="jamin-book"
    :class="{ 'jamin-book-mapped': asGraph }"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon size="18" class="mr-2">mdi-bookshelf</v-icon>
        <span class="text-body-1">Progression library</span>
        <v-spacer />
        <span class="text-caption text-medium-emphasis mr-3">{{ total.toLocaleString() }} progressions</span>
        <v-btn icon size="small" variant="text" class="mr-1"
               :disabled="!total || loading"
               aria-label="A random progression from this list" @click="rollProgression">
          <v-icon size="19">mdi-dice-5-outline</v-icon>
          <v-tooltip activator="parent" location="bottom">
            One of the {{ total.toLocaleString() }} the filters are showing, picked and applied
          </v-tooltip>
        </v-btn>
        <!--
          Saving the chart, which used to be a tab of its own.

          A tab is for a place you go; this is one field and one button,
          done in a second and not come back to. It cost a third of the
          chrome over the library for something nobody reads. The two other
          tabs are gone too: Import / export was already a sentence pointing
          at Settings.
        -->
        <v-menu v-model="saving" :close-on-content-click="false" location="bottom end">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon size="small" variant="text" class="mr-1"
                   :disabled="!state.text.trim()"
                   aria-label="Save this chart as a progression">
              <v-icon size="19">mdi-content-save-outline</v-icon>
              <v-tooltip activator="parent" location="bottom">
                Save this chart as a progression
              </v-tooltip>
            </v-btn>
          </template>
          <v-card min-width="360" class="pa-3">
            <v-text-field v-model="newName" label="Name" density="compact"
                          placeholder="ii–V–I in Eb" hide-details class="mb-3"
                          @keyup.enter="saveCurrent(state.text, 'Chart')" />
            <pre class="jamin-mono text-caption mb-3"
                 style="white-space: pre-wrap; max-height: 140px; overflow: auto; opacity: .85"
              >{{ state.text }}</pre>
            <v-btn size="small" block class="text-none" :disabled="!state.text.trim()"
                   @click="saveCurrent(state.text, 'Chart')">
              Save the whole chart
            </v-btn>
          </v-card>
        </v-menu>

        <v-btn icon="mdi-close" size="small" variant="text" @click="state.ui.progressions = false" />
      </v-card-title>

      <v-card-text>
        <div class="jamin-book-body">
            <!-- The library as a map, filling the screen.
                 @see components/CatalogueMap.vue -->
            <CatalogueMap
              v-if="asGraph"
              :tree="graph"
              book="progressions"
              :busy="building || reading"
              :found="total"
              label="progressions"
              @pick="pickNode"
            >
              <template #filters>
                <v-text-field v-model="search" label="Search" prepend-inner-icon="mdi-magnify"
                              clearable density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="sortBy" :items="sorts"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="genre" :items="genreItems"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="decade" :items="decadeItems"
                          density="compact" variant="solo-filled" flat hide-details />
              </template>

              <template #detail>
                <div v-if="!selected" class="text-caption text-medium-emphasis py-6 text-center">
                  Pick a progression to see its chords.
                </div>
                <div v-else>
                  <div class="text-body-1 mb-1">{{ selected.name }}</div>
                  <div class="text-caption text-medium-emphasis mb-3">
                    {{ selected.bars }} bar{{ selected.bars === 1 ? '' : 's' }}
                    <span v-if="selected.genre"> · {{ selected.genre }}</span>
                    <span v-if="selected.decade"> · {{ selected.decade }}s</span>
                  </div>
                  <pre class="jamin-map-chords">{{ preview }}</pre>
                </div>
              </template>
            </CatalogueMap>

            <v-row v-else class="jamin-book-row">
              <v-col cols="12" md="6" class="jamin-book-col"
                     :class="{ 'jamin-filters-open': filtersOpen !== undefined }">
                <v-text-field v-model="search" label="Search" prepend-inner-icon="mdi-magnify" clearable
                              density="compact" hide-details class="mb-2 flex-grow-0" />

                <v-expansion-panels v-if="facets.genres.length || facets.decades.length"
                                    v-model="filtersOpen" variant="accordion"
                                    class="mb-2 flex-grow-0 jamin-book-filters">
                  <v-expansion-panel>
                    <v-expansion-panel-title class="text-caption py-0">
                      <v-icon size="16" class="mr-2">mdi-filter-variant</v-icon>
                      <span v-if="activeFilters">{{ activeFilters }} filter{{ activeFilters === 1 ? '' : 's' }}</span>
                      <span v-else>Filters</span>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <v-row dense>
                        <v-col cols="7">
                          <v-select v-model="genre" :items="genreItems" label="Genre" density="compact" hide-details />
                        </v-col>
                        <v-col cols="5">
                          <v-select v-model="decade" :items="decadeItems" label="Decade" density="compact" hide-details />
                        </v-col>
                        <v-col cols="12">
                          <div class="d-flex align-center">
                            <v-switch v-model="onlyFitting" density="compact" hide-details color="primary"
                                      :disabled="!songBars"
                                      :label="songBars ? `Only what fits ${songBars} bars` : 'Only what fits the song'" />
                            <InfoTip>
                              Keeps the progressions that are the same length as this chart, or
                              that go into it a whole number of times — a four-bar turnaround under
                              sixteen bars is the same shape four times over, and a five-bar one is
                              a different song.
                              <br /><br />
                              The harmony may still be nothing like yours. This is only about
                              length, which is the part that can be checked.
                            </InfoTip>
                          </div>
                        </v-col>
                      </v-row>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>



                <!--
                  `v-if`, not `v-else-if`.

                  This was chained to the graph block that used to sit between
                  it and the filters, and when the graph moved out to the
                  full-screen map the chain did not break -- it re-attached to
                  the filter panel above, which has a `v-if` of its own. So the
                  list rendered only when the filters did *not*, which is to
                  say only when the library had no genres or decades to offer.
                  Import anything and the filter panel appears and the list
                  vanishes: rows, a count, working filters, and nothing to
                  show for them.

                  Syntactically valid the whole time, which is why lint is
                  quiet about it and why the screenshot of this view looked
                  correct -- the harness had no library imported, so the
                  filters were absent and the list appeared. @see scripts/shots.py
                -->
                <!--
                  Every match, drawn on a canvas.

                  Six hundred thousand progressions is not something to page
                  through twelve at a time, and a canvas grid does not need
                  to: it paints the rows on screen and no others.
                  @see components/DataGrid.vue
                -->
                <DataGrid
                  v-if="rows.length"
                  class="jamin-book-scroll"
                  :rows="gridRows"
                  :columns="gridColumns"
                  :chosen="selected"
                  keyed="name"
                  @pick="(one) => { selected = one }"
                  @use="(one) => { selected = one; insert() }"
                />
                <div v-else-if="loading" class="text-caption text-medium-emphasis py-6 text-center">Loading…</div>
                <div v-else class="text-caption text-medium-emphasis py-6 text-center">Nothing matches “{{ search }}”.</div>

                <div v-if="streaming" class="text-caption text-medium-emphasis mt-1">
                  <v-progress-circular indeterminate size="12" width="2" class="mr-1" />
                  {{ rows.length.toLocaleString() }} of {{ total.toLocaleString() }} loaded
                </div>

                <div class="text-caption text-medium-emphasis text-center">
                  <!-- The wheel scrolls the list; the arrows move the
                       selection. @see components/DataGrid.vue -->
                  Click the list, then arrow down it. Nothing is inserted until you say so.
                </div>
                <div v-if="partial" class="text-caption text-medium-emphasis text-center">
                  Showing the first matches found; searching every one of
                  {{ state.bulk.count.toLocaleString() }} would take a while.
                </div>
              </v-col>

              <!-- The aside -->
              <v-col cols="12" md="6" class="jamin-book-col">
                <div v-if="!selected" class="text-caption text-medium-emphasis py-8 text-center">
                  Pick one from the list.
                </div>
                <div v-else class="jamin-book-scroll">
                  <div class="text-body-1 mb-1">{{ selected.name }}</div>
                  <div class="text-caption text-medium-emphasis mb-1">
                    {{ summarizeProgression(selected, state.settings.transport.beatsPerBar) }}
                  </div>
                  <div class="mb-3">
                    <span v-if="selected.builtin" class="text-caption text-medium-emphasis mr-2">built in</span>
                    <span v-for="tag in selected.tags || []" :key="tag" class="text-caption text-medium-emphasis mr-2">
                      {{ tag }}
                    </span>
                    <span
                      v-if="selected.source && !selected.builtin"
                      class="text-caption text-medium-emphasis"
                    >{{ selected.source }}</span>
                  </div>

                  <pre
                    class="jamin-mono text-caption pa-3 mb-3"
                    style="white-space: pre-wrap; max-height: 190px; overflow: auto; background: rgba(255,255,255,0.04); border-radius: 6px; line-height: 1.6"
                  >{{ preview }}</pre>

                  <v-row dense class="mb-1">
                    <v-col cols="6"><v-select v-model="targetPc" :items="keyOptions" label="Transpose to" /></v-col>
                    <v-col cols="6">
                      <v-select
                        v-model="spelling"
                        :disabled="targetPc === null"
                        :items="[{ title: 'Auto', value: 'auto' }, { title: '♯', value: 'sharps' }, { title: '♭', value: 'flats' }]"
                        label="Spell"
                      />
                    </v-col>
                    <v-col cols="12"><v-select v-model="mode" :items="modes" label="Insert" /></v-col>
                  </v-row>

                  <div class="d-flex align-center" style="gap: 8px">
                    <v-btn size="small" color="primary" @click="insert">Insert</v-btn>
                    <v-btn
                      v-if="!selected.builtin && !selected.bulk"
                      size="small"
                      variant="text"
                      @click="deleteProgression(selected.name)"
                    >
                      Delete
                    </v-btn>
                  </div>
                </div>
              </v-col>
            </v-row>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
