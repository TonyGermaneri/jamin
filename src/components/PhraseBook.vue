<script setup>
/**
 * The phrase book.
 *
 * One catalogue, not a catalogue and a library: a phrase you captured and a
 * phrase that shipped are the same kind of thing. Nothing is filtered by the
 * chord you are on, because every phrase fits every chord -- they are stored as
 * degrees and re-pointed at whatever they land on -- and nothing is truncated,
 * because a list you cannot reach the end of is not a list.
 */
import { computed, ref, watch } from 'vue'
import {
  state,
  deletePhrase,
  renamePhrase,
  usePhrase,
  bindPhrase,
  currentToken,
  toast,
  ensureLicks as rebuildLicks,
  visibleLicks,
  catalogue,
  treeOf,
  markGraphRows,
  setAccentPhrase,
  midiForPhrase,
  favourite,
  toggleFavourite,
  setPhrasePool,
  placePick,
} from '../store.js'
import { keyPitchClass, phraseCategory, phraseKey, summarize } from '../core/phrases.js'
import { describeLick } from '../core/licks.js'
import CatalogueMap from './CatalogueMap.vue'
import DataGrid from './DataGrid.vue'
import PhraseDetail from './PhraseDetail.vue'
import { ADAPTERS } from '../core/graphView.js'
import { vDragMidi } from '../core/dragOut.js'
import { useRowsThatFit } from '../core/fitRows.js'

/*
 * A map of the catalogue instead of a list of it.
 *
 * Ten thousand phrases is a scroll; the few hundred words they are described by
 * is a picture. Picking a word puts it in the search box, which means the list,
 * the detail pane and the piano roll all carry on working exactly as they did
 * -- the graph is a way of choosing what to search for, not a second catalogue.
 */
const asGraph = computed(() => state.settings.graph.phrases)
const sortBy = ref('')
const sorts = ADAPTERS.phrases.sorts

/*
 * Built from the whole catalogue, and only when the grouping changes.
 *
 * It used to be built from whatever the filters found, so every touch of a
 * dropdown was a different tree with different nodes in different places --
 * the map jumped, and anything anybody had arranged on it went with it. A
 * filter is not a different catalogue. The map is the catalogue and the
 * filter says where to look, which is `marked` below.
 */
const graph = computed(() =>
  (asGraph.value ? treeOf('phrases', catalogue(), sortBy.value) : null))

/** Which of its nodes the filters are pointing at. @see store.markGraphRows */
const marked = computed(() => {
  if (!asGraph.value || !graph.value) return null
  if (matches.value.length === catalogue().length) return null
  return markGraphRows('phrases', graph.value, matches.value, { sortBy: sortBy.value })
})

/** A phrase is chosen outright; a folder searches for its name. */
function pickNode(node) {
  if (!node) return
  if (node.leaf) {
    const found = matches.value.find((one) => one.name === node.label)
    if (found) { pick(found); return }
  }
  search.value = node.label
}

const search = ref('')
const name = ref('')
const renaming = ref(null)
const renameTo = ref('')

const accompany = computed(() => state.settings.accompany)
const target = computed(() => currentToken())
const perChord = computed(() => accompany.value.perChordPhrases)
const category = ref('any')
const musicalKey = ref('any')
const kind = ref('any')
const source = ref('any')
const length = ref('any')
/** Which expansion panel is open; undefined is folded. */
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
const onlyFavourites = ref(false)

/**
 * Facets, built from the catalogue rather than written down.
 *
 * Every one of these is a field the collections actually carry: Impro-Visor
 * labels each entry and files it as a lick, a cell, an idiom or a quote;
 * POP909 says which song a part came from; a captured phrase knows it was
 * captured. There is no genre here and no year, because the phrase sources do
 * not have either -- POP909 ships beats, chords and keys and nothing else.
 * Genre and decade do exist in Chordonomicon, and are filters in the
 * progression library where they are real.
 */
function facet(pick, label) {
  const counts = new Map()
  for (const entry of catalogue()) {
    const value = pick(entry)
    if (value) counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [
    { title: label, value: 'any' },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([name, count]) => ({ title: `${name} (${count})`, value: name })),
  ]
}

/** What kind of thing it is, in the vocabulary's own words. */
const kinds = computed(() => facet((entry) => entry.kind, 'Any kind'))

/** Where it came from. The origin is per-entry -- "POP909 #219" -- so the
    collection is the part before the number. */
const sourceOf = (entry) => String(entry.origin || 'captured here').split(' #')[0]
const sources = computed(() => facet(sourceOf, 'Any source'))

/**
 * What sort of part it is.
 *
 * Read from the phrase's own name first -- "F# comp 19" is a comp, and POP909's
 * 8,168 parts say so in their names and nowhere else; the `category` they carry
 * is a chord-quality name, which says nothing about how the part behaves. The
 * collection's own label is used when the name is not that shape, so
 * Impro-Visor's "blues" and "dominant-altered" are untouched.
 * @see phraseCategory
 */
const categoryOf = (entry) => phraseCategory(entry) || entry.category
const categories = computed(() => facet(categoryOf, 'Any category'))

/**
 * The key it was played in, from the chord it was played over.
 *
 * Ordered by pitch rather than by count, because a key list that runs C, C#, D
 * is one you can point at, and one that runs G, D, F, A is a puzzle. It is
 * provenance rather than a constraint: a phrase is stored as degrees and plays
 * over any chord in any key, so this narrows the list to a collection's F#
 * recordings -- it does not stop a C phrase from being used over F#.
 */
const keyOf = (entry) => keyPitchClass(phraseKey(entry))
const sharpFirst = (spellings) =>
  [...spellings].sort((a, b) => Number(b.includes('#')) - Number(a.includes('#')) || a.localeCompare(b))
const keys = computed(() => {
  // Counted by pitch, labelled by every spelling that pitch turned up under, so
  // the two collections' F# and Gb are one row reading "F#/Gb".
  const counts = new Map()
  const spellings = new Map()
  for (const entry of catalogue()) {
    const pc = keyOf(entry)
    if (pc === null) continue
    counts.set(pc, (counts.get(pc) || 0) + 1)
    if (!spellings.has(pc)) spellings.set(pc, new Set())
    spellings.get(pc).add(phraseKey(entry))
  }
  return [
    { title: 'Any key', value: 'any' },
    ...[...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pc, count]) => ({
        // Sharp first, then flat, always: sorting the spellings alphabetically
        // gives "Db/C#" but "G#/Ab", and a column that changes convention
        // halfway down reads as a mistake.
        title: `${sharpFirst(spellings.get(pc)).join('/')} (${count.toLocaleString()})`,
        value: String(pc),
      })),
  ]
})

/**
 * Length, in beats -- every length the catalogue actually has, not bands.
 *
 * Bands were a guess at what somebody would want; the lengths are a fact about
 * the data, and there turn out to be few enough of them to list. Each one says
 * how many phrases are that long, so a length with nothing in it is visibly
 * empty before it is chosen.
 */
const lengths = computed(() => {
  const counts = new Map()
  for (const entry of catalogue()) {
    const beats = Math.round((entry.lengthPulses / 24) * 100) / 100
    if (beats > 0) counts.set(beats, (counts.get(beats) || 0) + 1)
  }
  return [
    { title: 'Any length', value: 'any' },
    ...[...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([beats, count]) => ({
        title: `${beats} beat${beats === 1 ? '' : 's'} (${count.toLocaleString()})`,
        value: String(beats),
      })),
  ]
})

/*
 * As many as fit, rather than twelve.
 *
 * Forty-six pixels is what a row measures: two lines of type and the padding
 * either side. @see core/fitRows.js for why this is measured rather than set.
 */
const { box: listBox, rows: perPage } = useRowsThatFit(46, { least: 6, most: 40 })
const page = ref(1)
const selected = ref(null)

const matches = computed(() => {
  if (!state.licks.length && !state.phrases.length) return []
  // Touch the list so starring re-filters while the favourites filter is on.
  const starred = state.favourites.length

  return visibleLicks(search.value).filter((entry) => {
    if (category.value !== 'any' && categoryOf(entry) !== category.value) return false
    if (musicalKey.value !== 'any' && String(keyOf(entry)) !== musicalKey.value) return false
    if (kind.value !== 'any' && entry.kind !== kind.value) return false
    if (source.value !== 'any' && sourceOf(entry) !== source.value) return false
    if (onlyFavourites.value && (!starred || !favourite(entry))) return false
    if (length.value === 'any') return true
    return String(Math.round((entry.lengthPulses / 24) * 100) / 100) === length.value
  })
})

// What a DAW's next/previous articulation control walks, and what the dice
// picks from. The filters are the point: turning a knob through ten thousand
// phrases is not a control, turning it through the 89 pads in F# is.
watch(matches, (list) => setPhrasePool(list), { immediate: true })

/** How many filters are narrowing the list -- shown on the folded panel, so a
    list that is mysteriously short explains itself without being opened. */
const activeFilters = computed(() =>
  [category.value !== 'any', musicalKey.value !== 'any', kind.value !== 'any',
   source.value !== 'any', length.value !== 'any', state.ui.lickTexture !== 'any',
   onlyFavourites.value].filter(Boolean).length)

const filtered = computed(() => Boolean(search.value) || activeFilters.value > 0)

/*
 * There is no die here any more.
 *
 * Every track's tab carries one -- @see components/InstanceTabs.vue -- and
 * it does the same thing for the track it is on. Two of them on the same
 * screen is one too many, and this one cost a row of chrome over the list.
 */

function clearFilters() {
  search.value = ''
  category.value = 'any'
  musicalKey.value = 'any'
  kind.value = 'any'
  source.value = 'any'
  length.value = 'any'
  onlyFavourites.value = false
  state.ui.lickTexture = 'any'
}
const total = computed(() => catalogue().length)
/**
 * What the grid shows.
 *
 * The same facts the list carried and in the same order, except that they
 * are columns now rather than a title with things appended to it -- which
 * is the point of a grid. The heart is a column because a canvas cannot
 * hold a button; clicking it toggles, which is what clicking it did.
 */
const gridColumns = [
  { name: 'fav', title: '', width: 30 },
  { name: 'name', title: 'Articulation', width: 260 },
  { name: 'ref', title: 'Write', width: 120 },
  { name: 'category', title: 'Kind', width: 130 },
  { name: 'sourceChord', title: 'Over', width: 80 },
  { name: 'source', title: 'From', width: 200 },
  { name: 'beats', title: 'Beats', width: 64 },
]

/*
 * The columns the grid reads, put onto the row.
 *
 * `matches` is derived, so this maps rather than mutates -- the phrases
 * themselves belong to the catalogue and adding display fields to them
 * would follow them everywhere.
 */
const gridRows = computed(() => matches.value.map((one) => ({
  ...one,
  fav: favourite(one) ? '♥' : '',
  ref: one.id ? `{${one.id}}` : '',
  category: categoryOf(one) || one.kind || '',
  source: sourceOf(one) || '',
  beats: beatsOf(one),
})))

function onGridCell(column, row) {
  if (column !== 'fav') return
  const one = matches.value.find((entry) => entry.id === row.id)
  if (one) toggleFavourite(one)
}

const pageCount = computed(() => Math.max(1, Math.ceil(matches.value.length / perPage.value)))
const list = computed(() => matches.value.slice((page.value - 1) * perPage.value, page.value * perPage.value))

watch([search, category, kind, source, length, onlyFavourites, () => state.ui.lickTexture],
  () => { page.value = 1 })
watch(list, (rows) => {
  if (!rows.some((row) => selected.value && row.id === selected.value.id)) selected.value = rows[0] || null
}, { immediate: true })

const beatsOf = (entry) => Math.round((entry.lengthPulses / 24) * 10) / 10

/*
 * Arrow keys and the wheel walk the whole catalogue, not just the page: the
 * index is into the full list of matches, and the page follows it. Selecting is
 * auditioning -- the phrase goes straight into the song -- so a spin of the
 * wheel is a way of hearing through ten thousand of them.
 */
let useTimer = null

function step(delta) {
  const all = matches.value
  if (!all.length) return
  const at = Math.max(0, all.findIndex((entry) => selected.value && entry.id === selected.value.id))
  const next = Math.min(all.length - 1, Math.max(0, at + delta))
  if (next === at && selected.value) return

  selected.value = all[next]
  page.value = Math.floor(next / perPage.value) + 1

  // Using a phrase reparses the chart and writes to storage, so stepping fast
  // waits for the spinning to stop rather than doing that fifty times a second.
  clearTimeout(useTimer)
  useTimer = setTimeout(() => usePhrase(selected.value), 90)
}

let wheelAcc = 0
function onWheel(event) {
  event.preventDefault()
  wheelAcc += event.deltaY
  // One row per notch, whether that arrives as one big delta or many small ones.
  while (Math.abs(wheelAcc) >= 30) {
    step(wheelAcc > 0 ? 1 : -1)
    wheelAcc -= Math.sign(wheelAcc) * 30
  }
}

function pick(entry) {
  selected.value = entry
  clearTimeout(useTimer)

  // Opened to put one into the chart: picking writes it there and the book has
  // done its job. @see store.js placePick
  if (placePick('phrases', entry.name)) {
    state.ui.book = null
    return
  }

  // Opened by right-clicking a chord: picking assigns to that chord and the
  // book has done its job. Otherwise picking is auditioning, and the book
  // stays open so you can keep walking the list.
  if (state.ui.assignTo >= 0) {
    bindPhrase(entry.id || entry.name, state.ui.assignTo)
    state.ui.assignTo = -1
    state.ui.book = null
    return
  }

  usePhrase(entry)
}

// The catalogue is all there is now, so opening the book is the whole of
// the question this used to ask about tabs.
watch(
  () => state.ui.book === 'phrases',
  (open) => { if (open) rebuildLicks() },
  { immediate: true }
)

function commitRename(entry) {
  if (renaming.value !== entry.id) return
  const next = renamePhrase(entry.name, renameTo.value)
  if (next) toast(`Renamed to ${next}`)
  renaming.value = null
}

/** A small piano roll, so a phrase is recognisable without playing it. */
function roll(phrase, width = 120, height = 34) {
  const notes = phrase.notes
  if (!notes || !notes.length) return []
  const length = phrase.lengthPulses || Math.max(...notes.map((n) => n.at + n.duration)) || 1
  const low = Math.min(...notes.map((n) => n.note))
  const high = Math.max(...notes.map((n) => n.note))
  const span = Math.max(6, high - low + 1)
  // Inset, so the top and bottom notes sit inside the box rather than on its edge.
  const pad = 3
  const usable = height - pad * 2
  return notes.map((note) => ({
    x: (note.at / length) * width,
    w: Math.max(2, (note.duration / length) * width),
    y: pad + usable - ((note.note - low + 1) / span) * usable,
    h: Math.max(2, usable / span - 1),
    o: 0.35 + (note.velocity / 127) * 0.65,
  }))
}

const describe = (entry) => (entry.notes ? describeLick(entry) : summarize(entry))

/** The chord this was opened for, if it was opened by right-clicking one. */
const assigningTo = computed(() => {
  const token = state.ui.assignTo >= 0 ? state.score.tokens[state.ui.assignTo] : null
  return token ? token.body : null
})
</script>

<template>
  <!--
        No title, no tabs, no die.

        Everything that used to sit above the list said something that was
        already on screen or somewhere better: the name of the book is on
        the tab that opened it, the die is on that tab too, what is playing
        is in the chart, and Playback belongs with the rest of the settings.
        Four rows of chrome over a list, and a list is what somebody came
        for. The only thing kept is the chord badge, because that is not a
        label -- it says the next phrase picked is going onto that chord,
        and there is nowhere else to say it.
      -->
      <v-card-title v-if="assigningTo" class="d-flex align-center py-2">
        <v-chip size="small" color="primary" variant="tonal"
                closable @click:close="state.ui.assignTo = -1">
          for {{ assigningTo }}
        </v-chip>
      </v-card-title>

      <v-card-text>
        <!-- The catalogue: list on the left, the one you picked on the right.
             `jamin-book-body` is what the v-window used to do: pass the
             card's height down to the row instead of shrink-wrapping it.
             @see styles/app.css -->
        <div class="jamin-book-body">
            <!--
              The map, when that is what is being looked at.

              Not a panel in a column of it: the canvas is the page and the
              filters, the chrome and whatever is chosen float over the top.
              @see components/CatalogueMap.vue
            -->
            <CatalogueMap
              v-if="asGraph"
              :tree="graph"
              book="phrases"
              :busy="state.licksLoading"
              :marked="marked"
              :found="matches.length"
              label="phrases"
              @pick="pickNode"
            >
              <template #filters>
                <v-text-field v-model="search" label="Search" prepend-inner-icon="mdi-magnify"
                              clearable density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="sortBy" :items="sorts"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="category" :items="categories"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="musicalKey" :items="keys"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="source" :items="sources"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="kind" :items="kinds"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="length" :items="lengths"
                          density="compact" variant="solo-filled" flat hide-details />
              </template>

              <template #detail>
                <PhraseDetail :phrase="selected" :per-chord="perChord" :target="target" />
              </template>
            </CatalogueMap>

            <v-row v-else class="jamin-book-row">
              <!-- The list gets the room. Everything you set rather than read
                   lives on the right, so the only thing competing for height is
                   the thing there are ten thousand of. -->
              <v-col cols="12" md="8" lg="9" class="jamin-book-col">

                <div v-if="state.licksLoading && !list.length" class="text-caption text-medium-emphasis py-8 text-center">
                  Loading the catalogue…
                </div>
                <div v-else-if="!list.length" class="text-caption text-medium-emphasis py-8 text-center">
                  Nothing matches.
                  <div v-if="filtered" class="mt-2">
                    <v-btn size="x-small" variant="text" @click="clearFilters">Clear the filters</v-btn>
                  </div>
                </div>

                <!--
                  Every match, drawn on a canvas.

                  The phrase book already held them all -- `matches` is the
                  whole filtered set and the list only ever showed a slice of
                  it -- so the pager was cutting up something that was
                  already in hand. @see components/DataGrid.vue
                -->
                <DataGrid
                  v-else
                  class="jamin-book-scroll"
                  :rows="gridRows"
                  :columns="gridColumns"
                  :chosen="selected"
                  @pick="pick"
                  @use="(one) => usePhrase(one)"
                  @cell="onGridCell"
                  @context="(one) => setAccentPhrase(one.id || one.name)"
                />

                <!-- The foot of the list, attached to it rather than floating
                     in the space under it. @see styles/app.css -->
                <div class="jamin-book-foot d-flex align-center flex-wrap" style="gap: 12px">
                  <span class="text-caption text-medium-emphasis">
                    <strong>{{ matches.length.toLocaleString() }}</strong> of
                    {{ total.toLocaleString() }}
                    <template v-if="filtered">
                      · <a href="#" @click.prevent="clearFilters">clear filters</a>
                    </template>
                  </span>
                  <v-spacer />
                  <span class="text-caption text-medium-emphasis d-none d-xl-block">
                    <!-- The wheel scrolls the list rather than walking it, which
                         is what a wheel does over a grid; the arrows are what
                         move the selection. @see components/DataGrid.vue -->
                    arrow down the list to hear your way through · right-click to make it the accent
                  </span>
                </div>
              </v-col>

              <!-- Everything you set, and then what you picked -->
              <v-col cols="12" md="4" lg="3" class="jamin-book-col"
                     :class="{ 'jamin-filters-open': filtersOpen !== undefined }">
                <v-text-field v-model="search" label="Search" prepend-inner-icon="mdi-magnify" clearable
                              density="compact" hide-details class="mb-2 flex-grow-0" />

                <!-- Folded away by default: five selects is a lot of the window
                     to spend on controls nobody has reached for yet, and the
                     editor is whatever height the DAW left over. -->
                <v-expansion-panels v-model="filtersOpen" variant="accordion"
                                    class="mb-2 flex-grow-0 jamin-book-filters">
                  <v-expansion-panel>
                    <v-expansion-panel-title class="text-caption py-0">
                      <v-icon size="16" class="mr-2">mdi-filter-variant</v-icon>
                      <span v-if="activeFilters">{{ activeFilters }} filter{{ activeFilters === 1 ? '' : 's' }}</span>
                      <span v-else>Filters</span>
                      <v-spacer />
                      <span class="text-medium-emphasis mr-2">{{ matches.length.toLocaleString() }}</span>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <!-- Six of them, two to a row. Three to a row fits, and
                           then "minor pentatonic (1)" is an ellipsis and the
                           filter you are looking for is the one you cannot
                           read. The panel folds away, so the height is only
                           spent while somebody is using it. -->
                      <v-row dense>
                        <v-col cols="6">
                          <v-select v-model="category" :items="categories" label="Category"
                                    density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="musicalKey" :items="keys" label="Key"
                                    density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="source" :items="sources" label="Source" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="kind" :items="kinds" label="Kind" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="length" :items="lengths" label="Length" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select
                            v-model="state.ui.lickTexture"
                            :items="[
                              { title: 'Any texture', value: 'any' },
                              { title: 'Two hands', value: 'hands' },
                              { title: 'Single line', value: 'line' },
                            ]"
                            label="Texture"
                            density="compact"
                            hide-details
                          />
                        </v-col>
                        <v-col cols="12">
                          <v-switch
                            v-model="onlyFavourites"
                            density="compact"
                            hide-details
                            color="error"
                            :label="`Favourites only (${state.favourites.length})`"
                          />
                        </v-col>
                        <v-col v-if="activeFilters" cols="12" class="text-right">
                          <v-btn size="x-small" variant="text" @click="clearFilters">Clear them</v-btn>
                        </v-col>
                      </v-row>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>


                <div class="jamin-book-scroll jamin-book-detail">
                  <PhraseDetail :phrase="selected" :per-chord="perChord" :target="target" />
                </div>
              </v-col>
            </v-row>
        </div>
      </v-card-text>
</template>
