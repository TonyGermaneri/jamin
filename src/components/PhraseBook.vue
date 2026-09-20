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
  setHolding,
  bindPhrase,
  currentToken,
  toast,
  ensureLicks as rebuildLicks,
  defaultVocabularyUrl,
  importMidiPhrases,
  visibleLicks,
  catalogue,
  treeOf,
  setAccentPhrase,
  midiForPhrase,
  triggerAccent,
  favourite,
  toggleFavourite,
  randomSongPhrase,
  instanceLabel,
  setInstancePhrase,
  setPhrasePool,
  placePick,
} from '../store.js'
import { keyPitchClass, phraseCategory, phraseKey, summarize } from '../core/phrases.js'
import { describeLick } from '../core/licks.js'
import InfoTip from './InfoTip.vue'
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
 * Built from whatever the filters found, every time they change.
 *
 * Ten thousand phrases is small enough to rebuild on the spot, which is what
 * makes the filters work *on* the graph rather than beside it.
 */
const graph = computed(() =>
  (asGraph.value ? treeOf('phrases', matches.value, sortBy.value) : null))

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
const vocabUrl = ref('')
const vocabFile = ref(null)
const midiFile = ref(null)
const midiBars = ref(1)

/** Which instance the book is pointed at; this one until told otherwise. The
    tabs that choose it belong to the shell around this. @see ArticulationBook */
const aimedAt = computed(() => state.ui.targetInstance || state.roster.me)

/** True when the tab open is somebody else's track. */
const elsewhere = computed(() => state.host.active && aimedAt.value && aimedAt.value !== state.roster.me)

const accompany = computed(() => state.settings.accompany)
const report = computed(() => state.lickReport)
const defaultVocab = computed(() => defaultVocabularyUrl())
const target = computed(() => currentToken())
const perChord = computed(() => accompany.value.perChordPhrases)
const playing = computed(() => state.songPhrase)
const accentId = computed(() => state.accentPhrase)
const isAccent = (entry) => !!entry && state.accentPhrase === (entry.id || entry.name)
const accent = computed(() => matches.value.find((entry) => entry.id === state.accentPhrase) ||
  catalogue().find((entry) => entry.id === state.accentPhrase) || null)
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

/**
 * A phrase at random, from the filtered list rather than the whole catalogue.
 *
 * The filters are what make this worth having: ten thousand phrases at random is
 * a shrug, but one of the 362 pads in F# is a suggestion. It is also the reason
 * the die sits next to the list and not in the settings.
 */
function rollPhrase() {
  const pool = matches.value
  if (!pool.length) return

  const pick = pool[Math.floor(Math.random() * pool.length)]
  if (!pick) return

  selected.value = pick
  if (elsewhere.value) {
    setInstancePhrase(aimedAt.value, pick.id || pick.name)
    toast(`${pick.name} → ${instanceLabel(aimedAt.value)}`)
  } else {
    randomSongPhrase([pick])
  }
}

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

/** How long a heard chord runs before its phrase comes round again. */
const LIVE_BARS = [
  { title: 'one bar', value: 1 },
  { title: 'two bars', value: 2 },
  { title: 'four bars', value: 4 },
]

const SPEEDS = [
  { title: '1/16×', value: 0.0625 },
  { title: '1/8×', value: 0.125 },
  { title: '1/4×', value: 0.25 },
  { title: '1/3×', value: 0.3333 },
  { title: '1/2×', value: 0.5 },
  { title: '2/3×', value: 0.6667 },
  { title: '1× as played', value: 1 },
  { title: '1.5×', value: 1.5 },
  { title: '2×', value: 2 },
  { title: '3×', value: 3 },
  { title: '4×', value: 4 },
]

watch(
  () => [state.ui.book === 'phrases', state.ui.phrasesTab],
  ([open, tab]) => {
    if (open && (tab === 'catalogue' || tab === 'sources')) rebuildLicks()
  },
  { immediate: true }
)

function commitRename(entry) {
  if (renaming.value !== entry.id) return
  const next = renamePhrase(entry.name, renameTo.value)
  if (next) toast(`Renamed to ${next}`)
  renaming.value = null
}

async function rebuild(options) {
  await rebuildLicks(options)
  const r = state.lickReport
  if (r && !r.error) toast(`${r.total + (r.parts || 0)} in the catalogue`)
}

async function openVocabulary(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  await rebuild({ text: await file.text() })
  event.target.value = ''
}

async function openMidi(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  importMidiPhrases(new Uint8Array(await file.arrayBuffer()), {
    segmentBars: midiBars.value,
    trackFilter: /piano|accomp|keys|chord/i,
  })
  event.target.value = ''
  state.ui.phrasesTab = 'catalogue'
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
  <v-card-title class="d-flex align-center">
        <v-icon size="18" class="mr-2">mdi-book-music-outline</v-icon>
        <span class="text-body-1">Phrase book</span>
        <v-chip v-if="assigningTo" size="small" class="ml-3" color="primary" variant="tonal"
                closable @click:close="state.ui.assignTo = -1">
          for {{ assigningTo }}
        </v-chip>
        <v-spacer />
        <span v-if="playing" class="text-caption text-medium-emphasis mr-3">playing “{{ playing }}”</span>
        <!-- One at random from whatever the filters are showing, which is what
             makes it useful: narrow to "F# pad" and the die stays inside it. -->
        <v-btn icon size="small" variant="text" class="mr-1"
               :disabled="!matches.length"
               aria-label="A random phrase from this list" @click="rollPhrase">
          <v-icon size="19">mdi-dice-5-outline</v-icon>
          <v-tooltip activator="parent" location="bottom">
            A random phrase from the {{ matches.length.toLocaleString() }} the filters are showing
          </v-tooltip>
        </v-btn>
      </v-card-title>

      <v-tabs v-model="state.ui.phrasesTab">
        <v-tab value="catalogue">Catalogue ({{ total }})</v-tab>
        <v-tab value="playback">Playback</v-tab>
        <v-tab value="sources">Sources</v-tab>
        <v-tab value="about">How it works</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="state.ui.phrasesTab">
          <!-- Catalogue: list on the left, the one you picked on the right -->
          <v-window-item value="catalogue">
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
                    arrow or scroll to hear your way through · right-click to make it the accent
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
          </v-window-item>

          <!-- Playback ---------------------------------------------------- -->
          <v-window-item value="playback">
            <!-- Mr. Accompany Me, which is the thing this book is for. It used
                 to wait for a chord to be written down and record what was
                 played over it; now it hears what is played and answers it. -->
            <div class="mb-3">
              <div class="d-flex align-center">
                <v-switch v-model="accompany.listen" density="compact" hide-details
                          color="primary" label="Listen to what I play" />
                <InfoTip>
                  Notes come in, the chord they make is named, and that chord is played back
                  through a phrase — all while the keys are still down. Nothing is recorded and
                  nothing is kept: what you hear is what is being held, and letting go ends it.
                  <br /><br />
                  The phrase it uses is the chart's own — whatever the chord under the playhead is
                  playing — so it sounds like the song rather than like a second program. An armed
                  accent beats that, as an accent beats everything.
                  <br /><br />
                  A chord is named whether or not the transport is rolling, but it can only be
                  <em>played</em> while it is: a phrase is a rhythm, and a stopped transport has no
                  time to lay one on.
                </InfoTip>
              </div>

              <div v-if="accompany.listen" class="ml-8">
                <v-radio-group v-model="accompany.liveMode" density="compact" hide-details
                               class="mb-2">
                  <v-radio value="merge" label="Play over the chart" />
                  <v-radio value="override" label="My chords replace the chart's" />
                </v-radio-group>
                <div class="text-caption text-medium-emphasis mb-2">
                  <span v-if="accompany.liveMode === 'override'">
                    While you are holding something the chart's harmony gives way. The drums and
                    the pedal still follow the song — they follow the song, not your hands.
                  </span>
                  <span v-else>
                    The chart plays its own chords and you play over the top, which is what a
                    second player in the room is.
                  </span>
                </div>
                <v-select v-model="accompany.liveBars" :items="LIVE_BARS" density="compact"
                          hide-details label="A held chord lasts" style="max-width: 260px" />
                <div class="text-caption text-medium-emphasis mt-1">
                  A written chord knows how long it lasts because the bar says so. A held one lasts
                  until your hands move, so it is given a length and comes round again.
                </div>

                <!-- Hold. The foot is the ordinary way to reach it, so the
                     binding sits with the thing it holds rather than in a
                     list of controllers somewhere else. -->
                <div class="d-flex align-center flex-wrap ga-2 mt-4">
                  <v-btn
                    size="small"
                    :variant="state.ui.holding ? 'flat' : 'tonal'"
                    :color="state.ui.holding ? 'primary' : undefined"
                    class="text-none"
                    @click="setHolding(!state.ui.holding)"
                  >{{ state.ui.holding ? 'Holding — let go' : 'Hold the chord' }}</v-btn>
                  <v-btn
                    size="small"
                    :variant="state.ui.learningHold ? 'flat' : 'text'"
                    :color="state.ui.learningHold ? 'secondary' : undefined"
                    class="text-none"
                    @click="state.ui.learningHold = !state.ui.learningHold"
                  >{{ state.ui.learningHold ? 'Move a control…' : 'Bind to MIDI' }}</v-btn>
                  <span v-if="state.settings.midi.holdCc !== null" class="text-caption">
                    CC {{ state.settings.midi.holdCc }}<span
                      v-if="state.settings.midi.holdCc === 64"> — the sustain pedal</span>
                    <v-btn size="x-small" variant="text" class="text-none"
                           @click="state.settings.midi.holdCc = null">clear</v-btn>
                  </span>
                </div>
                <div class="text-caption text-medium-emphasis mt-1">
                  Your hands can come off the chord and it goes on playing, so the other one is
                  free. A new chord takes over and is held in its turn; letting go of Hold is what
                  ends it. Lifting the pedal while the keys are still down does nothing — you have
                  not stopped playing the chord.
                </div>
              </div>
            </div>

            <v-divider class="mb-3" />

            <v-row dense>
              <v-col cols="12" md="6">
                <v-select v-model="accompany.speed" :items="SPEEDS" label="Speed" />
                <div class="text-caption text-medium-emphasis mt-1 mb-4">
                  How fast a phrase runs over the chords. At 1× it plays at the rate it was
                  performed, whatever a chord's length.
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Octave — {{ accompany.octave }}</div>
                <v-slider v-model="accompany.octave" :min="1" :max="7" :step="1" />
                <div class="text-caption text-medium-emphasis mt-1 mb-4">
                  Where a phrase sits when it is not following the register of the chord before it.
                </div>
              </v-col>

              <v-col cols="12">
                <v-divider class="mb-3" />
                <v-switch v-model="accompany.bass" label="Bass note — a held root under everything" />
                <div class="text-caption text-medium-emphasis mb-2">
                  Held for the whole chord, under a phrase or a plain chord alike, and a slash
                  chord puts its own note in the bass.
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">
                  {{ accompany.bassOctaves }} octave{{ accompany.bassOctaves === 1 ? '' : 's' }} down
                </div>
                <v-slider v-model="accompany.bassOctaves" :min="0" :max="3" :step="1" :disabled="!accompany.bass" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch
                  v-model="accompany.doubleBass"
                  :disabled="!accompany.bass"
                  label="Double bass — the same root an octave lower again"
                />
              </v-col>

              <v-col cols="12">
                <v-divider class="mb-3" />
                <div class="d-flex align-center">
                  <v-switch v-model="accompany.pedal" label="Hold pedal for chord" hide-details />
                  <InfoTip>
                    Sustain (CC 64) goes down as each chord starts and lifts on the change, so a
                    chord rings for its full length without smearing into the next one. It follows
                    whatever is sounding — the chord channel, and the accompaniment channel when a
                    phrase is playing.
                    <br /><br />
                    <code>[n.p]</code> and <code>[n.p.]</code> mean the same as <code>[np]</code>.
                    A mark beats this switch from where it appears; this switch is what applies
                    before the first one.
                  </InfoTip>
                </div>
                <div class="text-caption text-medium-emphasis mb-2 mt-1">
                  Or write <code>[p]</code> in the chart to hold it from there,
                  <code>[np]</code> to lift it.
                </div>
              </v-col>

              <v-col cols="12">
                <v-divider class="my-3" />
                <div class="text-body-2 mb-1">Accent</div>
                <div class="text-caption text-medium-emphasis mb-2">
                  <span v-if="accent"><strong>{{ accent.name }}</strong> — right-click any phrase
                    in the catalogue to change it.</span>
                  <span v-else>None yet. Right-click a phrase in the catalogue to choose one.</span>
                  <InfoTip>
                    It replaces the phrase on the next chord rather than playing over the top of
                    it, and waits for the chord change to do it — so pressing this half a bar
                    early means the same thing as pressing it a beat early. Press it again to
                    cancel.
                  </InfoTip>
                </div>
                <div class="d-flex align-center flex-wrap mb-2" style="gap: 8px">
                  <v-btn size="small" :prepend-icon="state.ui.accentArmed ? 'mdi-flash' : 'mdi-flash-outline'"
                         :color="state.ui.accentArmed ? 'warning' : undefined" :disabled="!accent" @click="triggerAccent">
                    {{ state.ui.accentArmed ? 'Armed — cancel' : 'Play it on the next chord' }}
                  </v-btn>
                  <v-btn
                    size="small"
                    :variant="state.ui.learningAccent ? 'flat' : 'text'"
                    :color="state.ui.learningAccent ? 'secondary' : undefined"
                    @click="state.ui.learningAccent = !state.ui.learningAccent"
                  >
                    {{ state.ui.learningAccent ? 'Move a control…' : 'Bind to MIDI' }}
                  </v-btn>
                  <span v-if="state.settings.midi.accentCc !== null" class="text-caption">
                    CC {{ state.settings.midi.accentCc }}
                    <v-btn size="x-small" variant="text" @click="state.settings.midi.accentCc = null">clear</v-btn>
                  </span>
                </div>
              </v-col>
              <v-col cols="12">
                <v-divider class="mb-3" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch v-model="accompany.enabled" label="Play phrases at all" />
                <v-switch v-model="accompany.keepRegister" label="Follow the register of the chord before" />
                <v-switch v-model="accompany.snapNonChordTones" label="Snap to chord notes" />
                <div class="text-caption text-medium-emphasis">
                  Anything not in the chord moves to the nearest note that is. Off, a passing
                  tone stays where the harmony put it, which is more faithful to the phrase and
                  less certain to fit.
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="accompany.fit"
                  :items="[
                    { title: 'Keep the rhythm, follow the chart', value: 'follow' },
                    { title: 'Keep the rhythm, restart each chord', value: 'restart' },
                    { title: 'Stretch to fit the chord', value: 'stretch' },
                  ]"
                  label="When the phrase and the chord are different lengths"
                />
                <div class="text-caption text-medium-emphasis mt-1">
                  Stretching changes the phrase's tempo; speed above is the deliberate way to do that.
                </div>
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Sources ----------------------------------------------------- -->
          <v-window-item value="sources">
            <div class="text-caption text-medium-emphasis mb-1">
              Two-handed parts cut from
              <a href="https://github.com/music-x-lab/POP909-Dataset" target="_blank" rel="noreferrer">POP909</a>
              (MIT), and single-line licks, cells and idioms from
              <a href="https://github.com/Impro-Visor/Impro-Visor" target="_blank" rel="noreferrer">Impro-Visor</a>
              (GPL-2.0-or-later).
              <span v-if="report && !report.error">
                <strong>{{ report.parts }}</strong> parts and <strong>{{ report.total }}</strong> licks,
                built here in {{ report.ms }}ms.
              </span>
            </div>

            <div class="d-flex flex-wrap align-center my-3" style="gap: 8px">
              <v-btn size="small" :loading="state.licksLoading" @click="rebuild({ force: true })">
                Rebuild from Impro-Visor
              </v-btn>
              <v-btn size="small" variant="text" @click="vocabFile && vocabFile.click()">Open a .voc file…</v-btn>
              <input ref="vocabFile" type="file" accept=".voc,text/plain" style="display: none" @change="openVocabulary" />
            </div>
            <div class="d-flex align-center mb-2" style="gap: 8px">
              <v-text-field v-model="vocabUrl" label="…or a vocabulary URL" :placeholder="defaultVocab" density="compact" hide-details />
              <v-btn size="x-small" :disabled="!vocabUrl.trim()" @click="rebuild({ url: vocabUrl.trim() })">Load</v-btn>
            </div>
            <v-alert v-if="report && report.error" type="warning" variant="tonal" density="compact" class="mb-4 text-caption">
              {{ report.error }}
            </v-alert>

            <v-divider class="my-4" />
            <div class="text-caption text-medium-emphasis mb-2">
              A recorded keyboard part is a run of phrases already: this cuts one at the chord
              changes and reads the chord off the notes, so you get two hands, real voicings and
              real rhythm rather than a single line.
            </div>
            <div class="d-flex align-center flex-wrap" style="gap: 8px">
              <v-btn size="small" prepend-icon="mdi-import" @click="midiFile && midiFile.click()">
                Import a MIDI file…
              </v-btn>
              <input ref="midiFile" type="file" accept=".mid,.midi,audio/midi" style="display: none" @change="openMidi" />
              <v-select
                v-model="midiBars"
                :items="[{ title: 'One bar each', value: 1 }, { title: 'Two bars each', value: 2 }, { title: 'Four bars each', value: 4 }]"
                label="Cut into"
                style="max-width: 180px"
              />
            </div>
          </v-window-item>

          <!-- How it works ------------------------------------------------ -->
          <v-window-item value="about">
            <div class="text-body-2" style="line-height: 1.7">
              <p class="mb-3">
                A phrase is one chord's worth of playing, stored rooted on C — as degrees
                measured from the chord it was played over, rather than the notes that were
                played. Capture something over F minor 7 and it is filed as root, ♭3, 5, ♭7.
              </p>
              <p class="mb-3">
                Putting it over a chord happens in that order, and the order matters. The root
                goes first, so the degrees stay intact. Only if the new chord is a different
                <em>shape</em> does minimal-movement voice leading get involved, and by then both
                chords share a root, so the root stays the root. Last, the octave is chosen to
                sit nearest to where the phrase was over the previous chord.
              </p>
              <p class="mb-3">
                That is why nothing here is filtered by the chord you are on: every phrase fits
                every chord. The rhythm is never touched either — it runs at the rate it was
                played and keeps time with the chart, and a chord decides only the harmony for
                the stretch of time it occupies.
              </p>
              <p class="mb-3">
                One phrase plays for the whole song by default. Turn on
                <em>per-chord articulations</em> in settings and it instead applies from the
                chord it is bound to until the next chord wearing a dot — the dot you see above
                a chord is literally the <code>.</code> in the text.
              </p>
            </div>
          </v-window-item>
        </v-window>
      </v-card-text>
</template>
