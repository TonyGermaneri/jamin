<script setup>
/**
 * The drum book.
 *
 * The phrase book's sibling, and deliberately shaped like it: a catalogue on the
 * left, what you picked on the right, filters folded away above. A groove is an
 * articulation like any other -- it is only that its notes are instruments
 * rather than pitches, so nothing in here goes near the voice leading.
 *
 * Three tabs, and they are three different jobs. **Grooves** is the catalogue.
 * **Parts** is where a groove is bound to a section of the song, which is the
 * one that does the work. **Kit** is where the note numbers get sorted out,
 * which is a thing nobody wants to think about until the day the snare is a
 * cowbell.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  state,
  toast,
  drumRows,
  favourite,
  toggleFavourite,
  setDrumAccent,
  triggerDrumAccent,
  slotFor,
  cycleGrooveOn,
  assignEverywhere,
  autoFillFrom,
  tapDrum,
  notesFor,
  inboundKitFor,
  inboundMapFor,
  midiForGroove,
  searchDrums,
  drumFacetsFor,
  noteError,
  placePick,
  sectionBars,
  partsItFits,
  clearEverySlot,
  storedGraph,
  buildBulkGraph,
  graphState,
  treeOf,
  drumRowsForGraph,
  markGraphRows,
  streamDrumRows,
  grooveAtIndex,
  aimedElsewhere,
  instanceLabel,
  setDrumVoiceMuted,
  drumVoiceMuted,
  drumMutesFor,
  unmuteEveryDrumVoice,
  grooveForNode,
  previewGroove,
  cancelPreview,
} from '../store.js'
import { summarizeGroove } from '../core/drums.js'
import { DRUM_VOICES, kitById, gmName, TD11_TO_VOICE } from '../core/drumKits.js'
import InfoTip from './InfoTip.vue'
import CatalogueMap from './CatalogueMap.vue'
import DataGrid from './DataGrid.vue'
import { vDragMidi } from '../core/dragOut.js'
import { useRowsThatFit } from '../core/fitRows.js'
import { everyTag } from '../core/drumTags.js'
import { ADAPTERS } from '../core/graphView.js'

const search = ref('')
const kind = ref('any')
const genre = ref('any')
const bars = ref('any')
const signature = ref('any')
// What the folders said. @see core/drumTags.js -- these were found by counting
// 4,415 real paths, not by guessing: what the right hand is on turns up in half
// of them and where in a song a pattern belongs in a fifth.
const feel = ref('any')
const surface = ref('any')
const partTag = ref('any')
const era = ref('any')
const onlyFavourites = ref(false)
/** Only patterns that go into one of the song's parts a whole number of times. */
const onlyFitting = ref(false)
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
const selected = ref(null)
const page = ref(1)
const PER_PAGE = 10

/**
 * What the grid shows, and how wide.
 *
 * The same facts the list carried, in columns rather than stacked -- which
 * is the point of a grid: forty rows of name-over-summary is forty rows you
 * read one at a time, and forty rows of aligned columns is a thing you scan.
 */
const gridColumns = [
  { name: 'name', title: 'Pattern', width: 300 },
  { name: 'kind', title: 'Kind', width: 70 },
  { name: 'genre', title: 'Genre', width: 130 },
  { name: 'bars', title: 'Bars', width: 56 },
  { name: 'timeSignature', title: 'Time', width: 60 },
  { name: 'bpm', title: 'BPM', width: 60 },
  { name: 'feel', title: 'Feel', width: 110 },
  { name: 'surface', title: 'Hands on', width: 120 },
  { name: 'part', title: 'Part', width: 100 },
  { name: 'era', title: 'Era', width: 80 },
  { name: 'folder', title: 'Shelf', width: 320 },
]

const listEl = ref(null)

/**
 * The keys are useless until something has focus, and asking somebody to click
 * a list before the arrow keys work is asking them to discover a rule.
 *
 * Waited for rather than done on the next frame. The default source is now the
 * whole catalogue, which is a database query, so on the frame after the dialog
 * opens there is no list yet to give focus to -- and a focus call into nothing
 * fails silently, which is what a keyboard that has stopped working looks like.
 */
watch(() => state.ui.book === 'drums', (open) => {
  if (!open) return
  let tries = 0
  const take = () => {
    const el = listEl.value && (listEl.value.$el || listEl.value)
    if (el && typeof el.focus === 'function') {
      el.focus({ preventScroll: true })
      return
    }
    if (tries++ < 40) requestAnimationFrame(take)
  }
  requestAnimationFrame(take)
})

/**
 * Which catalogue the list is showing.
 *
 * One source. The corpus that ships with jamin is filed in the database
 * alongside everything imported, so a library is a library and the only
 * question is which one -- or all of them.
 *
 * It was two, and they were different all the way down: the corpus in memory
 * filtered by walking it, an imported library in the database filtered by
 * asking it. Every count had to be added up from two places and every page
 * stitched out of two sources. @see store.shelveTheCorpus
 */
const library = computed({
  get: () => state.drumFilters.source,
  set: (value) => {
    state.drumFilters.source = value
    // Neither 'everything' nor 'built in' names a library, and the query wants
    // a library or nothing -- nothing meaning every one of them.
    state.drumFilters.set = value === EVERYTHING ? '' : value
    state.drumFilters.folder = ''
  },
})

/**
 * Which source, with two that are not one library.
 *
 * `` is every library at once, which is what somebody looking for a groove
 * rather than for a library wants -- and was missing, so a collection of fifty
 * packs could only ever be searched one pack at a time.
 */
const EVERYTHING = 'all'

/**
 * Every library, and the corpus is one of them.
 *
 * There used to be a third thing here -- "Built in", which was not a library
 * but a separate list in memory with its own filtering, its own counting and
 * its own half of every page. @see store.shelveTheCorpus for why it is filed in
 * the database now: so that there is one question with one answer.
 */
const libraries = computed(() => {
  const all = state.drumSets.reduce((sum, set) => sum + (set.count || 0), 0)
  return [
    { title: `Everything (${all.toLocaleString()})`, value: EVERYTHING },
    ...state.drumSets.map((set) => ({
      title: `${set.name} (${(set.count || 0).toLocaleString()})`,
      value: set.id,
    })),
  ]
})

/** How many patterns there are in total, whoever made them. */
const everything = computed(() =>
  state.drumSets.reduce((sum, set) => sum + (set.count || 0), 0))

/**
 * The shelves inside the chosen library, as filters.
 *
 * A vendor's folder names are the only structure a scraped collection has --
 * "1 Bar Fills", "090 BPM", "GM - Blues" -- so they are what somebody actually
 * wants to narrow by. Read from the database's own sampling rather than from
 * the rows on screen, which are one page of several hundred thousand.
 */
const EMPTY_FACETS = {
  folders: [], kinds: [], bars: [], signatures: [],
  genres: [], feels: [], surfaces: [], parts: [], eras: [],
  holds: 0, exact: true,
}
const facets = ref(EMPTY_FACETS)

/**
 * Whether the dropdowns are still being counted.
 *
 * Counting nine facets over three quarters of a million rows is seconds, not
 * milliseconds, and every list is empty until it finishes -- so choosing a
 * library and finding "Any genre" and nothing else reads as a library with no
 * genres in it rather than as a question still being answered. It was reported
 * as exactly that. The lists say they are working now.
 */
const facetsBusy = ref(false)

// Whichever request was asked for last is the only one whose answer counts.
// Changing library twice quickly used to let the slower first answer land on
// top of the second, filling the dropdowns from the library that is no longer
// chosen.
let facetRun = 0

watch(library, async () => {
  const mine = ++facetRun
  facetsBusy.value = true
  facets.value = EMPTY_FACETS
  try {
    // An empty set id means every library, which the facets understand too.
    const counted = await drumFacetsFor(state.drumFilters.set)
    if (mine !== facetRun) return
    facets.value = counted
  } catch (error) {
    // Nine empty dropdowns and no reason is the same picture as a library with
    // nothing in it, which is how this was reported the first time. If the
    // counting falls over, say so where somebody will see it.
    if (mine === facetRun) noteError(error, 'counting what the filters can offer')
  } finally {
    if (mine === facetRun) facetsBusy.value = false
  }
}, { immediate: true })

/** What this groove's library is read as, by name rather than by id. */
const readAs = computed(() => {
  const id = inboundKitFor(selected.value)
  return id ? (kitById(id) || {}).name || '' : ''
})

const shelf = computed({
  get: () => state.drumFilters.folder || '',
  set: (value) => { state.drumFilters.folder = value || '' },
})

/**
 * A dropdown out of a [value, count] tally, in the shape the others use.
 *
 * The count is the count. It used to be a tally of a sample multiplied by a
 * stride, which put `1 bar (494)` over a catalogue of eight hundred thousand --
 * and those numbers added up to exactly the two thousand rows the sampler had
 * looked at. Every one of these fields is indexed now and an index counts its
 * own entries without reading a row. @see core/drumStore.js grooveFacets
 */
function fromFacet(pairs, label, title = (name) => String(name)) {
  return [
    { title: label, value: 'any' },
    ...pairs.map(([name, count]) => ({
      title: `${title(name)} (${count.toLocaleString()})`,
      value: String(name),
    })),
  ]
}

/**
 * What the folders said, as filters.
 *
 * These are the facets nobody would think to ask for and the counting found:
 * what the right hand is on turns up in half of all paths, and where in a song
 * a pattern belongs in a fifth of them. @see core/drumTags.js
 */
/**
 * A dropdown that is never mysteriously empty.
 *
 * Where the catalogue has counted values, those are offered with their counts.
 * Where it has none -- an empty library, or the built-in corpus, which carries
 * no surface or feel at all -- the whole vocabulary is offered instead, so the
 * control says what it is for rather than being a blank box or vanishing.
 * Whether it can actually narrow anything is said next to it. @see tagHint
 */
function tagOptions(counted, kind, label) {
  if (counted && counted.length) return fromFacet(counted, label)
  return [{ title: label, value: 'any' }, ...everyTag(kind).map((name) => ({ title: name, value: name }))]
}

const feels = computed(() => tagOptions(facets.value.feels, 'feel', 'Any feel'))
const surfaces = computed(() => tagOptions(facets.value.surfaces, 'surface', 'Played on anything'))
const partTags = computed(() => tagOptions(facets.value.parts, 'part', 'Any part of a song'))
const eras = computed(() => tagOptions(facets.value.eras, 'era', 'Any era'))

/**
 * Whether a filter has anything to work with here, and why not.
 *
 * Hiding a control that cannot do anything leaves somebody looking for a filter
 * that is not there; showing one that silently matches nothing is worse. So it
 * is shown, and it says.
 */
function tagHint(counted) {
  if (counted && counted.length) return ''
  if (!state.drumSets.length) return 'Nothing imported yet'
  return 'Nothing in this library says'
}

const shelves = computed(() => [
  { title: 'Every shelf', value: '' },
  ...facets.value.folders.map(([name, count]) => ({
    title: `${name || '(the top of it)'} (${count.toLocaleString()})`,
    value: name,
  })),
])

/**
 * One place that asks the database.
 *
 * Every filter goes through here when a library is chosen, so changing any of
 * them is one query rather than each control running its own. The built-in
 * corpus never comes here -- it is in memory and filtering it is a walk.
 */
/**
 * Every length that goes into one of this song's parts a whole number of times.
 *
 * Which is all "only what fits" means: a two-bar groove fits an eight-bar verse
 * four times, a three-bar one does not fit at all. @see core/drums.js fitsBars
 * decides it from the groove's length and nothing else -- so the question can
 * be put to an index rather than asked of every row.
 */
function lengthsThatFit() {
  const lengths = new Set()
  for (const section of parts.value) {
    for (let n = 1; n <= section.bars; n++) {
      if (section.bars % n === 0) lengths.add(n)
    }
  }
  return [...lengths].sort((a, b) => a - b)
}

/*
 * The catalogue as the words in it.
 *
 * Built by reading every path once, which is about twenty seconds over three
 * quarters of a million -- so it is asked for and kept, never sprung on
 * somebody who opened a view. The same rule as the filter indexes.
 */
const asGraph = computed(() => state.settings.graph.drums)

/*
 * As many patterns as there is room for.
 *
 * Ten, because the smallest editor a DAW gives the plugin is 480px tall. Full
 * screen that is ten rows and most of a screen of nothing, over a catalogue of
 * three quarters of a million. A drum row is seventy-one pixels: a name, a
 * summary line and the row of part pills under it. @see core/fitRows.js
 */
const { box: listBox, rows: rowsThatFit } = useRowsThatFit(71, { least: 6, most: 30 })

// The list already has a ref, for scrolling the selected row into view. One
// element, one ref: this hands the same element to the measurer.
watch(listEl, (el) => { listBox.value = el }, { immediate: true })

watch(rowsThatFit, (many) => {
  // There is no list on the map, so there is nothing to fit rows to -- and
  // this used to re-run the whole query anyway, the moment the book opened,
  // on top of the one onMounted had already started. Two searches over three
  // quarters of a million rows for a list that is not on screen: 5.6 of the
  // 3.4 seconds the book took to open, concurrently. @see scripts/graph_perf.py
  if (asGraph.value) return
  if (state.drumFilters.perPage === many) return
  state.drumFilters.perPage = many
  state.drumFilters.page = 1
  searchDrums(null, null, 'rows-fit')
}, { immediate: false })
const graph = ref(null)
/** True while the whole catalogue is being read, which happens once. */
const building = ref(false)
/** True while a narrowing is being fetched, which is quick. */
const reading = ref(false)
const drawn = ref(0)

/**
 * How the tree is rooted.
 *
 * Folders by default, which is how the catalogue is actually arranged. Choose a
 * facet and that becomes the top level instead, with the folders underneath it
 * -- the same clips, a different tree. @see core/pathTree.js
 */
const sortBy = ref('')
const sorts = computed(() => (ADAPTERS.drums.sorts || []))

/**
 * Filtered, the tree is built from what the filters found; unfiltered, from the
 * stored one.
 *
 * Three quarters of a million rows cannot be fetched on every keystroke, and a
 * few thousand can -- so the whole catalogue is built once and kept, and any
 * narrowing of it is built on the spot out of the rows the filters returned.
 * That is what makes the filters work on the graph rather than beside it.
 *
 * `filtered` is the one the list already uses -- declared further down, which
 * is fine because this only runs when something changes.
 */

/** `missing`, `stale`, or empty when the map is in step. @see store.graphState */
const mapIsOld = ref('')
/** Why it is stale: `changed` (the catalogue moved) or `shape` (the map can
    hold something the drawn one cannot). @see store.graphState */
const mapWhy = ref('')

async function drawTheMap() {
  mapIsOld.value = ''
  mapWhy.value = ''
  building.value = true
  drawn.value = 0
  try {
    graph.value = await buildBulkGraph('drums', { onProgress: (n) => { drawn.value = n } })
  } finally {
    building.value = false
  }
}


/**
 * Picking a place in the tree.
 *
 * A clip is chosen outright; a folder searches for its name, which narrows the
 * list beside the graph to what is under it.
 */
/**
 * A node on the map, picked.
 *
 * Two things were wrong with this and they had the same cause: it treated
 * picking as searching. A leaf was looked for among `state.drumHits`, which
 * is the ten rows the list happens to be showing, so a file almost never
 * resolved and clicking one did nothing; and anything else went into the
 * search box, which is a filter -- so the tree was rebuilt and refitted, and
 * the camera jumped away from the thing that had just been clicked.
 *
 * Picking is not searching. A branch shows what is under it; a leaf is
 * fetched from the database by the path the map already knows, and becomes
 * the pattern in the panel, with its part pills and its piano roll. Nothing
 * about the filters moves, so nothing about the picture moves.
 */
const node = ref(null)

async function pickNode(picked, at, path) {
  if (!picked) return
  node.value = { ...picked, path: path || [] }

  if (!picked.leaf) {
    // A branch is not a pattern. The panel says what is under it, and the
    // map is where you go further in.
    selected.value = null
    return
  }

  const groove = await grooveForNode(path || [], picked.label)
  if (!groove) {
    node.value = { ...node.value, missing: true }
    return
  }

  selected.value = groove
  if (autoSelect.value) assignEverywhere(groove)
  if (autoPreview.value) previewGroove(groove)
}

const filterValues = () => {
  const some = (value) => (value === 'any' ? '' : value)
  return {
    text: search.value,
    kind: some(kind.value),
    bars: bars.value === 'any' ? 0 : Number(bars.value),
    signature: some(signature.value),
    genre: some(genre.value),
    feel: some(feel.value),
    surface: some(surface.value),
    part: some(partTag.value),
    era: some(era.value),
  }
}

/*
 * One query per filter change or page turn, for one page of rows.
 *
 * The list used to hold the first four hundred matches and page through those
 * in the browser, so a filter matching forty thousand patterns offered
 * thirty-three pages and there was no way to reach the thirty-fourth. The
 * database pages now, and says exactly how many there are.
 *
 * The built-in corpus is in memory and comes first, so when both are showing
 * the database is asked for whatever is left of the page after the corpus has
 * filled what it can.
 */
function ask({ fresh = false, why = 'ask' } = {}) {
  // Filters go down only when they have changed. Passing them again on a page
  // turn is how the store learns the question is new, and a new question throws
  // away where the last page ended -- which is the whole of what makes turning
  // to page eighty thousand cost the same as turning to page two.
  searchDrums(fresh ? filterValues() : null, {
    offset: Math.max(0, (page.value - 1) * PER_PAGE),
    // No rows on the map: there is no list to put them in. The count is
    // shown and the count is what an index answers without reading a row,
    // so asking for a page of grooves as well is a page of work thrown
    // away. @see store.runDrumSearch
    limit: asGraph.value ? 0 : PER_PAGE,
  }, why)
}

/*
 * Not during setup.
 *
 * `ask()` reads how much of the first page the built-in corpus fills, and that
 * is a computed declared further down -- a `const` used before its declaration
 * is a ReferenceError rather than an undefined, so an immediate watcher here
 * threw "Cannot access 'Y' before initialization" and the book rendered
 * nothing. Moving the declarations up only moved the problem, because they in
 * turn read things declared below them.
 *
 * Setup is not the right moment anyway. The first query belongs to the book
 * being opened, which is what onMounted and the open watcher are for.
 */
watch(
  () => [library.value, shelf.value, search.value, kind.value, bars.value, signature.value,
         genre.value, feel.value, surface.value, partTag.value, era.value,
         onlyFavourites.value, onlyFitting.value],
  () => {
    /*
     * One query, not two.
     *
     * Setting the page back to one is itself watched, so a filter change
     * fired this *and* the page watcher below -- two searches over three
     * quarters of a million rows for one act. Measured on opening the drum
     * book: 5.4 seconds of searching where 2.7 would do.
     *
     * The page watcher is left to do the asking when the page really moves;
     * when it is already on one there is nothing to move and this asks.
     */
    if (page.value === 1) ask({ fresh: true, why: 'filters' })
    else { freshNext = true; page.value = 1 }
  }
)

/** Whether the page change that is about to fire came from a filter. */
let freshNext = false

watch(page, () => {
  const fresh = freshNext
  freshNext = false
  ask(fresh ? { fresh: true, why: 'page-fresh' } : { why: 'page' })
})
onMounted(() => ask({ fresh: true, why: 'mounted' }))

const drums = computed(() => state.drums)
const settings = computed(() => state.settings.drums)

/** Built from the catalogue rather than written down, as the phrase book's are. */
function facet(pick, label) {
  const counts = new Map()
  for (const groove of drums.value) {
    const value = pick(groove)
    if (value || value === 0) counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [
    { title: label, value: 'any' },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([name, count]) => ({ title: `${name} (${count.toLocaleString()})`, value: String(name) })),
  ]
}

const kinds = computed(() => fromFacet(facets.value.kinds, 'Beats and fills'))
const genres = computed(() => fromFacet(facets.value.genres, 'Any genre'))

/** Length in bars, which is the filter that decides whether a groove fits. */
const barCounts = computed(() =>
  fromFacet(facets.value.bars, 'Any length', (n) => `${n} bar${n === '1' || n === 1 ? '' : 's'}`))

/** Time signature. Nearly all of the corpus is in four, which is worth seeing
    rather than discovering when a groove in seven will not sit in the bar. */
const signatures = computed(() => fromFacet(facets.value.signatures, 'Any time signature'))

/**
 * How many patterns the filters are showing. Exactly, and all of them.
 *
 * One number from one place. It used to be the length of an in-memory list plus
 * a count from the database, because the corpus and an imported library were
 * two different kinds of thing filtered two different ways -- which is how the
 * tab came to say "Grooves (1,150)" over a catalogue of three quarters of a
 * million. @see store.shelveTheCorpus
 */
const found = computed(() => state.drumSearch.total)

/** The page, exactly as the database sent it. */
/**
 * Every row the filters match, streamed in.
 *
 * `state.drumHits` is the page the store last fetched -- ten rows, because
 * that is what the pager asked for. The grid wants the lot, and it wants it
 * without waiting eight seconds for three quarters of a million of them, so
 * they arrive in batches and this grows. @see store.js streamDrumRows
 *
 * The tag fields are lifted onto the row as they land. The grid reads
 * `row[name]` and the tags live a level down in `row.tags`; lifting them
 * once here beats a formatter that digs for them on every repaint, and
 * leaves the groove itself intact for everything that already takes one --
 * choosing it, dragging it out, playing it.
 */
const everyRow = ref([])
const streaming = ref(false)
let loading = 0

function flatten(groove) {
  const tags = groove.tags || {}
  groove.feel = tags.feel || ''
  groove.surface = tags.surface || ''
  groove.part = tags.part || ''
  groove.era = tags.era || ''
  return groove
}

async function loadEveryRow() {
  const mine = ++loading
  everyRow.value = []
  streaming.value = true
  try {
    await streamDrumRows((rows) => {
      if (mine !== loading) return false
      // A new array each time: handing the grid the same one with more in
      // it leaves its scroll bar describing the length it last measured.
      everyRow.value = everyRow.value.concat(rows.map(flatten))
      return true
    })
  } finally {
    if (mine === loading) streaming.value = false
  }
}

const list = computed(() => everyRow.value)

const activeFilters = computed(() =>
  [kind.value !== 'any', genre.value !== 'any',
   Boolean(shelf.value), bars.value !== 'any',
   signature.value !== 'any', feel.value !== 'any', surface.value !== 'any',
   partTag.value !== 'any', era.value !== 'any',
   onlyFavourites.value, onlyFitting.value].filter(Boolean).length)

/** The song's parts and how long each is, for the fitting switch to explain
    itself -- "fits the song" is meaningless without saying what the song is. */
const parts = computed(() => sectionBars())

const filtered = computed(() => Boolean(search.value) || activeFilters.value > 0)

/**
 * Whether anything at all narrows the catalogue, the library included.
 *
 * `filtered` deliberately leaves the library out: it is what decides
 * whether the *list* is showing a filtered view, and which library you are
 * in is a place rather than a filter there.
 *
 * On the map it is a filter like any other, and leaving it out meant the
 * marks were only computed when something else was also on -- so choosing
 * a library dimmed nothing, and it appeared to work only in company.
 * Which it did: the marks are read from `state.drumFilters`, and the
 * library is in there, so a second filter would bring the library's effect
 * along with it. @see refreshMarks
 */
const narrowed = computed(() => filtered.value || Boolean(state.drumFilters.set))

function clearFilters() {
  search.value = ''
  kind.value = 'any'
  genre.value = 'any'
  bars.value = 'any'
  signature.value = 'any'
  shelf.value = ''
  feel.value = 'any'
  surface.value = 'any'
  partTag.value = 'any'
  era.value = 'any'
  onlyFavourites.value = false
  onlyFitting.value = false
}

/**
 * How many pages there are, which the pager now says on its own.
 *
 * `found` is exact in every case but one: a free-text search with no facet set
 * has no index to narrow it, so it walks the catalogue and stops at a fixed
 * number of rows. `state.drumSearch.exact` is false there, and the page count
 * is a floor rather than a total -- which is the honest thing for a pager to
 * do, since the pages it offers all exist.
 */
const pageCount = computed(() => Math.max(1, Math.ceil(found.value / PER_PAGE)))

/**
 * One at random from what the filters are showing.
 *
 * A random *page*, then a row on it, because the answer is not in the browser:
 * picking uniformly out of forty thousand means fetching the one row at that
 * offset, which is what the database is for. 2,399 grooves is a shrug; the 60
 * two-bar funk beats is a suggestion.
 */
/**
 * One at random out of everything the filters found.
 *
 * It used to work out which page the chosen index fell on, fetch that page,
 * and take the row from it. Every row is here now, so it is an index into an
 * array -- and on the map, where the rows are not streamed, it falls back to
 * asking the database for the one it wants.
 */
async function roll() {
  if (!found.value) return
  const pool = list.value
  if (pool.length) {
    choose(pool[Math.floor(Math.random() * pool.length)])
    return
  }
  const one = await grooveAtIndex(Math.floor(Math.random() * found.value))
  if (one) choose(one)
}

/** Picking a groove, which in auto-select mode also places it. */
function choose(groove) {
  selected.value = groove

  // Opened to put a pattern into the chart, or to change one already in it:
  // choosing writes it there and the book has done its job. @see store.js
  // placePick
  if (placePick('drums', groove.name)) {
    state.ui.book = null
    return
  }

  if (autoSelect.value) assignEverywhere(groove)
  if (autoPreview.value) previewGroove(groove)
}

/**
 * The groove as a grid, the way a piano roll shows one.
 *
 * Voice names down the left where the keys would be, sixteenths across. It
 * answers the question a list of names cannot -- what is actually in this
 * groove -- and it is how you see that a beat is riding rather than on the hat
 * without playing it.
 *
 * Only the voices this groove uses get a row. Fourteen rows of mostly nothing
 * is a wall; four rows is a beat you can read.
 */
const STEPS_PER_BAR = 16

/*
 * The kit, top to bottom as it sits behind a drummer, and always drawn.
 *
 * Every one of these gets a row whether the pattern uses it or not: the thing
 * most worth knowing about a beat is often that there is *no* ride in it, and
 * a row that comes and goes cannot say that.
 *
 * The percussion cannot work that way. There are twenty-six more voices since
 * General MIDI's percussion was given somewhere to go, and forty rows of
 * mostly nothing is the wall this arrangement exists to avoid -- so those are
 * drawn only where they are played. @see core/drumKits.js KIT_VOICES
 */
const VOICE_ORDER = [
  'crash1', 'crash2', 'ride', 'rideBell', 'hatOpen', 'hatClosed', 'hatPedal',
  'tomHigh', 'tomMid', 'tomFloor', 'snare', 'snareRim', 'sideStick', 'kick',
]

/**
 * The selected groove with its notes actually in it.
 *
 * A row from a library the plugin points at carries no notes -- it is an index
 * entry, and the file is read when something needs to play it. The preview needs
 * them too, so it asks for them the same way and draws once they arrive.
 */
const resolved = ref(null)

watch(selected, async (groove) => {
  if (!groove || !groove.byReference) {
    resolved.value = groove
    return
  }
  resolved.value = null
  const whole = await notesFor(groove)
  // Something else may have been picked while the file was being read.
  if (selected.value === groove) resolved.value = whole
}, { immediate: true })

/** Why this pattern has no notes to show, when that is the reason. @see notesFor */
const unreadable = computed(() => (resolved.value && resolved.value.unreadable) || '')

/**
 * The groove as a piano roll, with the whole keyboard down the side.
 *
 * Every voice gets a row, not only the ones this pattern uses. It used to show
 * the used ones alone, which reads well and answers the wrong question: the
 * rows moved as you walked the list, so two grooves could not be compared, and
 * the thing you most want to know about a beat -- that there is *no* ride in it
 * -- had no row to be absent from. A fixed keyboard makes the silence visible.
 *
 * Which is why it scrolls: fourteen rows is taller than the space, and the
 * alternative to scrolling is throwing rows away again.
 */
const preview = computed(() => {
  const groove = resolved.value
  if (!groove) return null

  const steps = Math.max(1, groove.bars * STEPS_PER_BAR)
  const perStep = groove.lengthPulses / steps
  const used = new Map()

  /*
   * Read with the library's own map, not with the corpus's.
   *
   * This looked every note up in the Roland table whatever library it came
   * from, which is the table the *shipped* corpus was played on. An imported
   * General MIDI pack's tambourine is note 54, which the Roland kit does not
   * have -- so it was not drawn, and the roll quietly disagreed with what the
   * player would sound. @see store.js inboundMapFor
   */
  const reading = inboundMapFor(groove) || TD11_TO_VOICE

  for (const note of groove.notes || []) {
    const voice = reading[note.note]
    if (!voice) continue
    if (!used.has(voice)) used.set(voice, new Array(steps).fill(0))
    const step = Math.min(steps - 1, Math.floor(note.at / perStep))
    // The loudest hit in the cell, so a ghost note next to an accent does not
    // hide it.
    used.get(voice)[step] = Math.max(used.get(voice)[step], note.velocity || 1)
  }

  const empty = new Array(steps).fill(0)
  // The kit always, then whatever percussion this pattern actually plays, in
  // the order the vocabulary names it.
  const percussion = DRUM_VOICES
    .map((one) => one.id)
    .filter((id) => !VOICE_ORDER.includes(id) && used.has(id))
  const rows = [...VOICE_ORDER, ...percussion].map((id) => ({
    id,
    name: (DRUM_VOICES.find((voice) => voice.id === id) || {}).name || id,
    cells: used.get(id) || empty,
    plays: used.has(id),
  }))

  return { steps, rows, bars: groove.bars, perBar: STEPS_PER_BAR,
           lengthPulses: groove.lengthPulses }
})

/**
 * Where the transport is inside this pattern's loop, as a fraction across.
 *
 * The playhead runs the length of the song and the pattern is a loop a couple
 * of bars long, so the line is the playhead taken modulo the loop -- and the
 * loop is locked to the song's bars exactly as the player locks it, or the line
 * would drift against what is actually being heard. A three-bar pattern in a
 * four-four song repeats every four bars, not every three. @see drums.layOutGroove
 *
 * Null when nothing is rolling, which is when there is no line to draw rather
 * than a line at nought.
 */
const transport = computed(() => {
  const roll = preview.value
  const playing = state.playing
  if (!roll) return null

  /*
   * A preview with no transport under it moves the line itself.
   *
   * Stopped, there is no song position to take modulo anything: the store
   * plays the pattern off a timer and reports how far through the pass it
   * is, which is already the fraction this wants. @see store.js playOwnPreview
   */
  if (state.drumPreview.at !== null) return state.drumPreview.at

  if (!playing.running || !roll.lengthPulses) return null

  const bar = playing.barPulses || 0
  const step = bar > 0
    ? Math.max(bar, Math.ceil(roll.lengthPulses / bar) * bar)
    : roll.lengthPulses
  const into = ((playing.pulse % step) + step) % step

  // Past the end of a pattern shorter than its own slot: the loop has finished
  // and is waiting for the next bar, so there is nothing to point at.
  if (into >= roll.lengthPulses) return null
  return into / roll.lengthPulses
})

/*
 * Whether the line may glide to where it is going.
 *
 * The playhead is sampled about eight times a second, which over a two-bar loop
 * is a line that hops in thirty steps rather than travelling. A transition the
 * length of the sample interval turns the hops back into movement -- but only
 * while it is going forwards. At the loop point the line would spend a tenth of
 * a second sweeping right to left across the whole pattern, which looks like the
 * music ran backwards, so the wrap is taken as a jump.
 */
const gliding = ref(false)
watch(transport, (now, before) => {
  // Not while we are driving it ourselves: a preview with no transport moves
  // the line every thirty milliseconds, and easing that over a hundred and
  // twenty leaves it permanently behind the drum it is pointing at.
  gliding.value = state.drumPreview.at === null
    && now !== null && before !== null && now >= before
})







/** The part the playhead is in, so its pill can say so. @see store.syncDrumsPlaying */
const playingSection = computed(() => state.playing.section)

/** The drums struck since the last frame, for the kit table. */
const playingVoices = computed(() => new Set(state.playing.voices))

/**
 * A part's name, short enough for a pill, with the key that reaches it.
 *
 * The number is on the pill rather than in a tooltip: telling somebody the
 * number keys choose a part is useless if finding out which number means
 * hovering over each one in turn. Ten is the last one that gets a key, because
 * there are only ten digits.
 */
/** Off, the part's groove, the part's fill. @see slotFor */
function chipColour(slot) {
  return slot === 'fill' ? 'warning' : slot === 'groove' ? 'primary' : undefined
}

/** What it is doing, and what the next click will do about it -- the whole
    point of a control with three states is that the third one is findable. */
function chipTitle(row, groove, index) {
  const where = row.wholeSong ? 'the whole song' : row.name
  const slot = slotFor(row.name, groove)
  const first = groove.kind === 'fill' ? 'fill' : 'groove'
  const second = first === 'fill' ? 'groove' : 'fill'
  const next = !slot ? first : slot === first ? second : 'nothing'

  const now = slot === 'groove' ? `plays through ${where}`
            : slot === 'fill' ? `leads out of ${where}`
            : `does not play ${where}`
  const then = next === 'groove' ? `play it through ${where}`
             : next === 'fill' ? `lead out of ${where} with it`
             : `take it off ${where}`

  return `${groove.name} ${now}. Click to ${then}`
        + (index < 10 ? ` — or press ${(index + 1) % 10}` : '')
}

function pillLabel(row, index) {
  const name = row.wholeSong ? 'Song' : row.name
  const short = name.length > 9 ? `${name.slice(0, 8)}…` : name
  return index < 10 ? `${(index + 1) % 10} ${short}` : short
}

/* ---------------- the keyboard ----------------
 *
 * Two and a half thousand grooves is a list nobody wants to mouse through, and
 * binding one to each part of a song is a lot of small clicks in a small
 * window. So the list takes the keys:
 *
 *   ↑ ↓        move through the grooves, turning the page as it goes
 *   ← →        the page
 *   1 … 9 0    round that part's three states: off, its groove, its fill
 *   space      put it on every part
 *
 * Arrowing browses and never binds, even with auto-select on: auto-select is
 * about clicking, and an arrow key that rewrote every binding as it passed
 * would make the list unusable to look through. Space is the keyboard's way of
 * saying the same thing deliberately.
 */

/**
 * Move through the list.
 *
 * It used to turn pages at either end, because the browser only held ten
 * rows and the rest of the answer was in the database. The grid holds the
 * whole answer, so there are no ends to reach any more -- only the two the
 * list actually has. @see components/DataGrid.vue
 */
function step(by) {
  const pool = list.value
  if (!pool.length) return
  const at = pool.findIndex((groove) => selected.value && groove.id === selected.value.id)
  const next = Math.max(0, Math.min(pool.length - 1, (at < 0 ? 0 : at) + by))
  selected.value = pool[next]
}


/*
 * The wheel walks the catalogue, the same as the phrase and progression books.
 *
 * One groove per notch whether the browser sends that as one big delta or as a
 * stream of small ones, and it walks the whole of what the filters found rather
 * than the page -- three quarters of a million patterns is not something to
 * page through twelve at a time.
 */

/** 1-9 are the first nine parts and 0 is the tenth, as tabs and windows have
    numbered things for thirty years. */
function assignToPartNumber(digit) {
  if (!selected.value) return
  const row = liveRows.value[digit === 0 ? 9 : digit - 1]
  if (row) cycleGrooveOn(row.name, selected.value)
}

/**
 * The book's own shortcuts, over whichever row the grid is on.
 *
 * The grid brings the arrows, the wheel, page up and down, home and end --
 * everything about moving through a list. These are about what a pattern is
 * *for*: a digit puts it on that numbered part, space puts it on all of
 * them. They were on the list this replaced and would otherwise have gone
 * with it. @see components/DataGrid.vue
 */
function onGridKey(event, row) {
  if (row && row !== selected.value) selected.value = row

  if (event.key >= '0' && event.key <= '9') {
    event.preventDefault()
    assignToPartNumber(Number(event.key))
    return
  }
  if (event.key === ' ' || event.code === 'Space') {
    event.preventDefault()
    if (selected.value) assignEverywhere(selected.value)
  }
}

/**
 * Auto-select: one click puts a groove on every part.
 *
 * Most songs have one feel, so binding the same beat to five sections one at a
 * time is five clicks to say one thing. With this on, clicking a row says it
 * once -- a beat goes on every section's groove, a fill on every section's fill,
 * decided by what the thing is rather than by which button was pressed.
 */
const autoSelect = ref(false)

/**
 * Auto-preview: picking one plays it, without reaching for the button.
 *
 * Hunting through a catalogue is listening, not reading -- the name of a
 * groove says almost nothing and the roll says a little more, and the only
 * thing that answers "is this the one" is hearing it. With this on, a
 * pattern sounds the moment it is picked, which turns walking the map into
 * auditioning it.
 *
 * Separate from auto-select on purpose, and the pairing is the point:
 * auto-select is a decision, auto-preview is a question. Most of the
 * hunting is done with this on and that off.
 *
 * It is `previewGroove`, the same call the button makes -- so with the
 * transport stopped it plays at once and with it rolling it waits for the
 * next bar line. @see store.js previewGroove
 */
const autoPreview = ref(false)

/* ---------------- parts ---------------- */
const rows = computed(() => drumRows())
const liveRows = computed(() => rows.value.filter((row) => !row.stale))
const waiting = computed(() => rows.value.filter((row) => !row.stale && !row.groove).length)

/*
 * How much is bound, for the two clear buttons to say.
 *
 * Counted over every row rather than the live ones, because that is what the
 * buttons clear: a part whose marker has been deleted from the chart is still
 * bound and still plays if the label comes back.
 */
/*
 * Whose drums these are.
 *
 * The book can be pointed at a track this window does not own, and then it is
 * showing that track's bindings and every change is a request rather than a
 * change. Said out loud, because "bound" and "asked track 3 to bind" are
 * different promises: the second one waits until that track's window opens,
 * since only the page that owns a track holds the grooves to compile.
 */
const elsewhere = computed(() => aimedElsewhere())
const whose = computed(() => instanceLabel(state.ui.targetInstance))

const boundGrooves = computed(() => rows.value.filter((row) => row.groove).length)
const boundFills = computed(() => rows.value.filter((row) => row.fill).length)



/* ---------------- the kit ---------------- */
const kit = computed({
  get: () => settings.value.kit,
  set: (id) => { settings.value.kit = id },
})
const chosenKit = computed(() => kitById(kit.value))

/** What a voice will actually play: the kit, unless it has been overridden. */
function noteFor(voice) {
  const custom = settings.value.customMap || {}
  return custom[voice] ?? chosenKit.value.map[voice]
}




/**
 * Erasing the lot, confirmed by a second press rather than by a dialog.
 *
 * A plugin web view has no dialog to confirm with -- `window.confirm` answers
 * false the instant it is asked -- so the button asks by changing what it says
 * and waiting. @see store.rollSong for the same problem solved with an undo;
 * this one cannot be undone, so it asks first.
 */
/**
 * A key is a switch, and shift makes it an audition.
 *
 * Hearing the drum was what the key did before and is the lesser of the two
 * jobs: taking one out is a thing somebody does while the song plays, over and
 * over, and hearing one is a thing they do once when the kit looks wrong.
 */
function onKeyClick(event, voice) {
  if (event.shiftKey) { tapDrum(noteFor(voice)); return }
  setDrumVoiceMuted(voice, !drumVoiceMuted(voice))
}

/** How many drums are out, for the button that brings them all back. */
const silenced = computed(() => Object.values(drumMutesFor()).filter(Boolean).length)







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
 * Unfiltered it is the stored one, and if there is not a stored one it is drawn
 * now rather than offered behind a button -- a view that opens onto an
 * invitation to press something is a view that has decided not to do its job.
 * It takes about twenty seconds once, and says so while it happens.
 *
 * Filtered, it is built from the rows the filters match -- all of them, asked
 * for again rather than taken from `state.drumHits`, which is the page the list
 * is showing. A tree of ten clips looks like a working graph and is a lie about
 * the catalogue. @see store.drumRowsForGraph
 */
let drawing = 0

/**
 * What the filters are pointing at, by node index. Null is everything.
 *
 * @see store.js markGraphRows
 */
const marked = ref(null)

async function refreshTree() {
  if (!asGraph.value) return
  const mine = ++drawing

  if (!sortBy.value) {
    /*
     * Never rebuild because a window opened.
     *
     * Drawing the map of a real catalogue reads three quarters of a million
     * rows and takes the better part of twenty seconds. This used to do it
     * silently whenever there was no stored map -- so opening the book after
     * an import was ten to fifteen seconds of an empty window, every time,
     * with nothing to say why. And nothing ever threw the old map away, so
     * once there was one it stayed wrong: importing a second library left a
     * map drawn from the first, and picking a pattern in it said the map was
     * older than the library, which it was.
     *
     * The map is drawn at import now, where the wait is already being had.
     * What is left here is the case where it is missing or out of step
     * anyway -- an older session, a library removed by hand -- and that is a
     * question rather than a decision. @see store.js graphState
     */
    const said = await graphState('drums')
    if (mine !== drawing) return

    const kept = await storedGraph('drums')
    if (mine !== drawing) return
    if (kept) graph.value = kept

    if (said.how !== 'current') {
      // Small enough that drawing it is quicker than reading the question.
      if (said.quick) { await drawTheMap() }
      else {
        mapIsOld.value = said.how
        mapWhy.value = said.why || ''
        return
      }
      if (mine !== drawing) return
    }

    await refreshMarks(mine, { bulk: true })
    return
  }

  /*
   * Grouped by something, which really is a different tree.
   *
   * "Sort by genre" re-roots the catalogue: the genres become the top level
   * and every library hangs under the genre it is in. That is a different
   * map of the same catalogue rather than a filtered view of one, so it is
   * built -- and built from everything, not from what the filters match,
   * or the layout would move every time a dropdown did. @see store.treeOf
   */
  reading.value = true
  try {
    const rows = await drumRowsForGraph(60000, { everything: true })
    if (mine !== drawing) return
    graph.value = treeOf('drums', rows, sortBy.value)
    await refreshMarks(mine, { bulk: false })
  } finally {
    if (mine === drawing) reading.value = false
  }
}

/**
 * Which nodes the filters light up.
 *
 * Read as rows and turned into node indexes, because a filter is a
 * question about clips and a map is made of places. Nothing here touches
 * the tree: the map does not move when a filter changes, which is the
 * whole point.
 *
 * Capped at the same sixty thousand rows the map used to be *built* from.
 * On a catalogue where a filter matches more than that, the folders are
 * all lit long before the cap -- the first few hundred rows reach every
 * branch there is -- and what goes unlit is individual clips deep inside
 * folders that are mostly still closed.
 */
async function refreshMarks(mine, { bulk }) {
  if (!narrowed.value) { marked.value = null; return }
  const rows = await drumRowsForGraph()
  if (mine !== drawing) return
  marked.value = markGraphRows('drums', graph.value, rows,
    { sortBy: sortBy.value, bulk })
}

/*
 * Not during setup.
 *
 * `filtered` is declared further down, and a `const` used before its
 * declaration is a ReferenceError rather than an undefined -- an immediate
 * watcher here threw "Cannot access 'd' before initialization" and the book
 * rendered nothing. The same trap the first query fell into.
 */
/*
 * Getters, not the refs themselves.
 *
 * A watch source array is built the moment `watch` is called, so naming a ref
 * in it *reads* that ref -- and `filtered` is declared further down. Wrapped in
 * a function it is read when the watcher runs, which is after setup. The
 * previous version threw "Cannot access 'd' before initialization" and rendered
 * nothing.
 */
/*
 * The filters themselves, not the page of rows they produced.
 *
 * `state.drumHits` was in here because `filtered` is a boolean -- going from
 * Rock to Jazz does not change it -- and the list changing was a convenient
 * proxy for the filters changing. It is a bad proxy: the list changes on
 * every page turn and on every search, so opening the book re-read the whole
 * stored map three times and the unfiltered map does not depend on the list
 * at all. Measured: 2,605ms of the 3,393ms it took to open.
 *
 * So the watcher reads what the tree is actually built from. @see
 * scripts/graph_perf.py
 */
const graphFilters = computed(() => JSON.stringify([
  library.value, shelf.value, search.value, kind.value, bars.value,
  signature.value, genre.value, feel.value, surface.value, partTag.value,
  era.value, onlyFavourites.value, onlyFitting.value,
]))

/*
 * A filter changes the marks; the grouping changes the tree.
 *
 * Split, because they are different costs. Marking reads the rows and
 * recolours what is on screen; building reads them and lays the whole
 * thing out again. Running the second for the first is what made every
 * touch of a dropdown throw the picture away.
 */
watch([asGraph, sortBy], refreshTree)
watch(graphFilters, () => {
  if (!asGraph.value || !graph.value) return
  refreshMarks(drawing, { bulk: !sortBy.value })
})

/*
 * And the list's rows, which follow the same filters.
 *
 * Not on the map: there is no list there, and streaming three quarters of a
 * million rows into nothing is the kind of work that makes a window feel
 * slow for no visible reason.
 */
watch([asGraph, graphFilters], () => {
  if (asGraph.value) { everyRow.value = []; streaming.value = false; loading++; return }
  loadEveryRow()
}, { immediate: true })

/*
 * A way in for the harness.
 *
 * The filters are refs inside this component, not state on the store, so
 * there is no way to change one from outside -- which meant the performance
 * harness spent three runs timing a filter it had never actually applied,
 * and reporting the wait as the cost. Setting them through the same refs the
 * controls are bound to is exactly what clicking the control does.
 * @see scripts/graph_perf.py
 */
if (typeof window !== 'undefined') {
  const dials = {
    // `library` included: on the map it is a filter like any other, and
    // leaving it out of the harness is how it went unchecked that choosing
    // one dimmed nothing. @see narrowed
    library, genre, kind, bars, signature, feel, surface, partTag, era, shelf, search,
  }
  window.__jaminBookProbe = {
    filter: (name, value) => {
      if (!dials[name]) return false
      dials[name].value = value
      return true
    },
    busy: () => Boolean(state.drumBusy || reading.value || facetsBusy.value),
    found: () => state.drumHits.length,
  }
}
onMounted(refreshTree)

</script>

<template>
  <!-- The title strip, which the map does without.

       Forty pixels of "Drum book" over a view whose whole job is to fill the
       screen, on top of the window chrome that already says which book this
       is. What was actually useful on it -- the count, the warning, the dice
       -- sits on the glass with the filters instead. -->
  <v-card-title v-if="!asGraph" class="d-flex align-center">
        <v-icon size="18" class="mr-2">mdi-circle-multiple-outline</v-icon>
        <span class="text-body-1">Drum book</span>
        <!-- Whose drums. Every change below is a request when it is not this
             window's own track, and a request is a different promise from a
             change. -->
        <v-chip v-if="elsewhere" size="small" class="ml-3" color="primary" variant="tonal">
          {{ whose }}
          <v-tooltip activator="parent" location="bottom">
            Showing {{ whose }}’s drums. Changes are sent to that track — only the window
            that owns it holds the grooves to compile, so one made while its window is shut
            arrives when it opens.
          </v-tooltip>
        </v-chip>
        <v-spacer />
        <span v-if="waiting" class="text-caption text-warning mr-3">
          {{ waiting }} part{{ waiting === 1 ? '' : 's' }} with no groove
        </span>
        <v-btn icon size="small" variant="text" class="mr-1" :disabled="!found"
               aria-label="A random groove from this list" @click="roll">
          <v-icon size="19">mdi-dice-5-outline</v-icon>
          <v-tooltip activator="parent" location="bottom">
            One of the {{ found.toLocaleString() }} the filters are showing
          </v-tooltip>
        </v-btn>
      </v-card-title>

      <v-tabs v-if="!asGraph" v-model="state.ui.drumsTab">
        <!-- Everything there is, not the half of it this page used to be able
             to count. @see store.shelveTheCorpus -->
        <v-tab value="grooves">Grooves ({{ everything.toLocaleString() }})</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="state.ui.drumsTab">
          <!-- Grooves: the catalogue ------------------------------------- -->
          <v-window-item value="grooves">
            <!--
              The catalogue as a map, filling the screen.

              @see components/CatalogueMap.vue. The aside here is deliberately
              shorter than the one beside the list: a map is for finding a
              pattern among three quarters of a million, and the mutes, the
              transport and the whole keyboard are for working on one you have
              already found.
            -->
            <CatalogueMap
              v-if="asGraph"
              :tree="graph"
              book="drums"
              :marked="marked"
              :busy="building || reading || state.drumBusy"
              :found="found"
              label="patterns"
              @pick="pickNode"
            >
              <template #filters>
                <!-- What the title strip used to carry, on the line it can
                     share with the filters rather than on one of its own. -->

                <v-text-field v-model="search" label="Search" prepend-inner-icon="mdi-magnify"
                              clearable density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="library" :items="libraries"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="sortBy" :items="sorts"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="kind" :items="kinds" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="genre" :items="genres" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="bars" :items="barCounts" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="signature" :items="signatures" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="feel" :items="feels" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="surface" :items="surfaces" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="partTag" :items="partTags" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="era" :items="eras" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <v-select v-model="shelf" :items="shelves" :loading="facetsBusy"
                          density="compact" variant="solo-filled" flat hide-details />
                <!-- Picking on the map puts the pattern into every part at
                     once, rather than into the panel to be dropped by hand.
                     Here rather than in the settings because it is turned on
                     and off while hunting, not configured once. -->
                <v-switch v-model="autoSelect" density="compact" hide-details
                          color="primary" label="Auto-select"
                          class="jamin-map-switch" />
                <!-- And hearing it, which is the other half of hunting. A
                     name says almost nothing and the roll says a little
                     more; the only thing that answers "is this the one" is
                     playing it. @see store.js previewGroove -->
                <v-switch v-model="autoPreview" density="compact" hide-details
                          color="primary" label="Auto-preview"
                          class="jamin-map-switch" />
              </template>

              <template #detail>
                <!-- The map does not describe the catalogue any more. Asked
                     rather than acted on: redrawing it reads three quarters
                     of a million rows, and a window that silently spends
                     twenty seconds looks broken. -->
                <v-alert v-if="mapIsOld" type="warning" variant="tonal" density="compact"
                         class="mb-3">
                  <div class="text-body-2 mb-2">
                    <span v-if="mapIsOld === 'missing'">There is no map of this catalogue yet.</span>
                    <span v-else-if="mapWhy === 'shape'">This map was drawn before jamin could
                      tell a fill from a groove, so every clip on it is drawn as a groove.
                      Redrawing it fixes that; nothing else about it is out of date.</span>
                    <span v-else>The map is out of date — the catalogue has changed since
                      it was drawn.</span>
                  </div>
                  <!-- And if the last attempt was made and could not be kept,
                       say so. Without this a map that was drawn perfectly and
                       refused by the database looked exactly like one that had
                       never been drawn, and Rebuild did the same thing again
                       every time. @see store.js buildBulkGraph -->
                  <div v-if="state.graphTrouble" class="text-caption mb-2">
                    It was drawn last time and could not be kept:
                    {{ state.graphTrouble }}.
                  </div>
                  <div class="d-flex ga-2">
                    <v-btn size="small" variant="flat" color="warning" class="text-none"
                           :loading="building" @click="drawTheMap">Rebuild</v-btn>
                    <v-btn size="small" variant="text" class="text-none"
                           @click="mapIsOld = ''">Cancel</v-btn>
                  </div>
                  <div v-if="building" class="text-caption mt-2">
                    {{ drawn.toLocaleString() }} read
                  </div>
                </v-alert>

                <div v-if="!node && !selected"
                     class="text-caption text-medium-emphasis py-6 text-center">
                  Pick anything on the map to see what is in it.
                </div>

                <!-- What was picked, whether or not it turned out to be a
                     pattern. A branch is a place in the catalogue and saying
                     how much is under it is the useful thing to say; a leaf
                     is one pattern and everything below applies. -->
                <template v-else>
                  <div v-if="node" class="mb-3">
                    <div class="text-body-1">{{ node.label }}</div>
                    <div class="text-caption text-medium-emphasis">
                      <span v-if="!node.leaf">
                        {{ (node.clips || 0).toLocaleString() }}
                        pattern{{ node.clips === 1 ? '' : 's' }} under this
                      </span>
                      <span v-else-if="node.missing" class="text-warning">
                        not in the database — the map is older than the library
                      </span>
                      <span v-else>{{ summarizeGroove(selected) }}</span>
                    </div>
                    <div v-if="node.path && node.path.length > 1"
                         class="text-caption text-disabled mt-1">
                      {{ node.path.slice(0, -1).join(' › ') }}
                    </div>
                  </div>

                  <template v-if="selected">
                    <div v-if="unreadable" class="text-caption text-warning mb-3">
                      Its notes are in the file on disk, and {{ unreadable }}
                    </div>
                    <div v-else-if="preview" class="jamin-map-roll mb-3">
                      <div v-for="row in preview.rows" :key="row.id" class="jamin-map-roll-row">
                        <span class="jamin-map-roll-name">{{ row.name }}</span>
                        <span class="jamin-map-roll-cells">
                          <i v-for="(velocity, step) in row.cells" :key="step"
                             :class="{ 'is-hit': velocity > 0 }" />
                        </span>
                      </div>
                      <!-- One line down the whole grid rather than one per row:
                           it says where in the pattern you are, which is a
                           property of the pattern and not of the hi-hat. The
                           names take a fixed 62px and the gap 6, so the cells
                           start 68 in. @see transport -->
                      <b v-if="transport !== null" class="jamin-map-roll-head"
                         :class="{ 'is-gliding': gliding }"
                         :style="{ left: `calc(68px + (100% - 68px) * ${transport})` }" />
                    </div>

                    <!--
                      Hear it before deciding.

                      Stopped, it plays at once. Rolling, it waits for the
                      next bar line and the roll shows when that is, because
                      a pattern dropped into the middle of a bar tells you
                      nothing about whether it fits. @see store.js previewGroove
                    -->
                    <div class="d-flex align-center ga-2 mb-3">
                      <v-btn size="small" variant="tonal" class="text-none"
                             :prepend-icon="state.drumPreview.waiting ? 'mdi-timer-sand'
                               : state.drumPreview.at !== null ? 'mdi-stop' : 'mdi-play'"
                             @click="state.drumPreview.at !== null
                               ? cancelPreview() : previewGroove(selected)">
                        {{ state.drumPreview.waiting ? 'On the next bar'
                          : state.drumPreview.at !== null ? 'Playing' : 'Preview' }}
                      </v-btn>
                      <span v-if="state.drumPreview.waiting"
                            class="text-caption text-medium-emphasis">
                        bar {{ state.drumPreview.atBar }}
                      </span>
                      <v-btn v-if="state.drumPreview.waiting" size="x-small" variant="text"
                             class="text-none" @click="cancelPreview">Cancel</v-btn>
                    </div>

                    <!-- The same pills as the list, because they are the same
                         act: this pattern, in that part, as its groove or as
                         its fill. A map you can look at but not play from is
                         a picture of a catalogue. -->
                    <div v-if="liveRows.length" class="jamin-drum-pills mb-3">
                      <v-chip
                        v-for="(row, index) in liveRows" :key="row.name"
                        size="x-small" label
                        :variant="slotFor(row.name, selected) ? 'flat' : 'outlined'"
                        :color="chipColour(slotFor(row.name, selected))"
                        :class="{ 'is-playing': row.name === playingSection }"
                        :title="chipTitle(row, selected, index)"
                        @click.stop="cycleGrooveOn(row.name, selected)"
                      >
                        <v-icon v-if="slotFor(row.name, selected) === 'fill'" start size="11">
                          mdi-flash
                        </v-icon>
                        {{ pillLabel(row, index) }}
                      </v-chip>
                    </div>
                    <div v-else class="text-caption text-disabled mb-3">
                      Write some parts into the chart and they appear here to drop this into.
                    </div>
                  </template>
                </template>
              </template>
            </CatalogueMap>

            <v-row v-else class="jamin-book-row">
              <v-col cols="12" md="8" lg="9" class="jamin-book-col">
                <v-text-field
                  v-model="search" density="compact" hide-details clearable
                  prepend-inner-icon="mdi-magnify" label="Search" class="mb-2 flex-grow-0"
                />

                <div class="d-flex align-center flex-wrap mb-2 flex-grow-0" style="gap: 8px">
                  <v-switch
                    v-model="autoSelect" density="compact" hide-details color="primary"
                    label="Auto-select"
                  />
                  <v-switch
                    v-model="autoPreview" density="compact" hide-details color="primary"
                    label="Auto-preview"
                  />
                  <InfoTip>
                    With this on, picking a pattern plays it — stopped it sounds at once,
                    rolling it waits for the next bar line, the same as the Preview button.
                    Auto-select is a decision and this is a question, which is why they are
                    two switches.
                  </InfoTip>
                  <InfoTip>
                    With this on, clicking a groove puts it on every part at once. Most songs
                    have one feel, so binding the same beat to five sections one at a time is five
                    clicks to say one thing.
                    <br /><br />
                    Which slot it lands in follows what the pattern is called — something named
                    like a fill becomes every section's fill, anything else becomes their groove.
                    That is a starting guess, not a rule: the pills still put any pattern in
                    either slot.
                  </InfoTip>

                  <v-spacer />

                  <v-btn size="small" variant="tonal"
                         :disabled="!selected || !liveRows.length"
                         prepend-icon="mdi-auto-fix"
                         @click="autoFillFrom(selected)">
                    Auto-fill
                  </v-btn>
                  <InfoTip location="left">
                    Takes the pattern you have chosen, gives it to every part that has no groove
                    yet, and finds each part a fill to lead out of — same genre, same time signature,
                    nearest tempo, chosen separately per part so the song does not leave every
                    section with the same flurry.
                    <br /><br />
                    Parts you have already decided are left alone. The corpus does not pair its
                    beats and fills — they were recorded in separate sessions — so the fill is
                    matched rather than looked up.
                  </InfoTip>
                </div>


                <!--
                  Every row, drawn on a canvas.

                  This was a list of ten with a pager under it, because ten
                  thousand list items is a scroll of jank and three quarters
                  of a million is a dead tab. Paging is what a list does when
                  it cannot hold what it is showing; a canvas grid can, so
                  the pager is gone and the rows are simply all there.

                  The wheel and the keyboard come with the component --
                  arrows, page up and down, home and end -- and Enter means
                  "use this one", as it does everywhere else in jamin.
                  @see components/DataGrid.vue
                -->
                <DataGrid
                  v-if="list.length"
                  class="jamin-book-scroll"
                  :rows="list"
                  :columns="gridColumns"
                  :chosen="selected"
                  @pick="choose"
                  @use="assignEverywhere"
                  @key="onGridKey"
                />

                <div v-if="streaming" class="text-caption text-medium-emphasis mt-1">
                  <v-progress-circular indeterminate size="12" width="2" class="mr-1" />
                  {{ list.length.toLocaleString() }} of {{ found.toLocaleString() }} loaded
                </div>

                <div class="d-flex align-center flex-grow-0 mt-1">
                  <v-spacer />
                  <!-- Transient, and the only thing here worth a line of text:
                       a wait nobody asked for looks like a hang. -->
                  <span v-if="state.drumUpgrading" class="text-caption text-medium-emphasis ml-2">
                    <v-progress-circular indeterminate size="12" width="2" class="mr-1" />
                    Rebuilding the catalogue's index, once
                  </span>
                </div>
              </v-col>

              <!-- What you picked -->
              <v-col cols="12" md="4" lg="3" class="jamin-book-col">
                <!-- The filters live here rather than above the list.
                     Folded away over the list they still took a line, and
                     opened they took a third of the window from the one thing
                     there are three quarters of a million of. On this side they
                     cost the list nothing. -->
                <v-expansion-panels v-model="filtersOpen" variant="accordion"
                                    class="mb-3 flex-grow-0 jamin-book-filters">
                  <v-expansion-panel>
                    <v-expansion-panel-title class="text-caption py-0">
                      <v-icon size="16" class="mr-2">mdi-filter-variant</v-icon>
                      <span v-if="activeFilters">
                        {{ activeFilters }} filter{{ activeFilters === 1 ? '' : 's' }}
                      </span>
                      <span v-else>Filters</span>
                      <v-spacer />
                      <!-- Visible with the panel shut, which is how it is most
                           of the time: the count below is the last answer until
                           the new one lands. -->
                      <v-progress-circular v-if="facetsBusy || state.drumBusy" indeterminate
                                           size="13" width="2" class="mr-2" />
                      <span class="text-medium-emphasis mr-2">{{ found.toLocaleString() }}</span>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <v-row dense>
                        <v-col cols="12">
                          <v-select v-model="library" :items="libraries" label="Library"
                                    :hint="state.drumSets.length ? '' : 'Point at a folder on the Libraries tab to add more'"
                                    :persistent-hint="!state.drumSets.length"
                                    density="compact" />
                        </v-col>
                        <!-- How the graph is rooted. Folders by default, which
                             is how the catalogue is arranged; choose a facet
                             and that becomes the top level with the folders
                             underneath. @see core/pathTree.js -->
                        <v-col v-if="asGraph" cols="12">
                          <v-select v-model="sortBy" :items="sorts" label="Group the graph by"
                                    density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="kind" :items="kinds" label="Kind"
                                    :loading="facetsBusy" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="genre" :items="genres" label="Genre"
                                    :loading="facetsBusy" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="bars" :items="barCounts" label="Length"
                                    :loading="facetsBusy" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="signature" :items="signatures" label="Time signature"
                                    :loading="facetsBusy" density="compact" hide-details />
                        </v-col>

                        <!-- What the folders said. Found by counting 4,415 real
                             paths rather than by guessing: what the right hand
                             is on is in half of them. @see core/drumTags.js

                             All of them shown whatever the source. A control
                             that appears and disappears with the library is one
                             somebody goes looking for and cannot find. -->
                        <v-col cols="6">
                          <v-select v-model="surface" :items="surfaces" label="Played on"
                                    :hint="tagHint(facets.surfaces)" persistent-hint
                                    :loading="facetsBusy" density="compact" />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="feel" :items="feels" label="Feel"
                                    :hint="tagHint(facets.feels)" persistent-hint
                                    :loading="facetsBusy" density="compact" />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="partTag" :items="partTags" label="Part of a song"
                                    :hint="tagHint(facets.parts)" persistent-hint
                                    :loading="facetsBusy" density="compact" />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="era" :items="eras" label="Era"
                                    :hint="tagHint(facets.eras)" persistent-hint
                                    :loading="facetsBusy" density="compact" />
                        </v-col>
                        <v-col cols="12">
                          <v-select v-model="shelf" :items="shelves" label="Folder it came from"
                                    :loading="facetsBusy" density="compact" hide-details />
                        </v-col>

                        <v-col cols="12">
                          <v-switch v-model="onlyFavourites" density="compact" hide-details
                                    color="error"
                                    :label="`Favourites only (${state.favourites.length})`" />
                          <div class="d-flex align-center">
                            <v-switch v-model="onlyFitting" density="compact" hide-details
                                      color="primary" :disabled="!parts.length"
                                      label="Only what fits the song" />
                            <InfoTip>
                              Keeps the patterns that go into one of this song's parts a whole
                              number of times. A two-bar groove fits an eight-bar verse four times;
                              a three-bar one does not fit at all and would be cut off mid-phrase
                              every time round, which is what makes a loop sound like a mistake
                              rather than a part.
                              <br /><br />
                              <span v-if="parts.length">
                                This song:
                                <span v-for="one in parts" :key="one.name" class="mr-2">
                                  {{ one.name === ' song' ? 'the whole song' : one.name }}
                                  {{ one.bars }} bars
                                </span>
                              </span>
                              <span v-else>There is nothing in the chart to fit yet.</span>
                            </InfoTip>
                          </div>
                        </v-col>
                        <v-col v-if="activeFilters" cols="12" class="text-right">
                          <v-btn size="x-small" variant="text" @click="clearFilters">Clear them</v-btn>
                        </v-col>
                      </v-row>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>

                <!-- The list is about to change, or the counts above are. Four
                     pixels above the rows, which is where somebody is already
                     looking when they have just asked a question of eight
                     hundred thousand patterns. -->
                <v-progress-linear v-if="state.drumBusy || facetsBusy" indeterminate
                                   color="primary" height="3"
                                   class="mb-2 flex-grow-0" rounded />

                <!--
                  A catalogue imported before the dropdowns were counted at
                  import has to be counted once. Offered rather than done
                  behind somebody's back: it is minutes on a large collection,
                  and a wait nobody asked for looks like a hang.
                  @see store.js prepareDrumFilters
                -->
                <v-alert
                  v-if="state.drumPreparing.running"
                  type="info" variant="tonal" density="compact"
                  class="mb-2 flex-grow-0 text-caption"
                >
                  <v-progress-linear indeterminate color="info" height="2" class="mb-2" rounded />
                  Counting what the filters can offer —
                  {{ state.drumPreparing.name }}
                  ({{ state.drumPreparing.done + 1 }} of {{ state.drumPreparing.of }}<span
                    v-if="state.drumPreparing.rows"
                  >, {{ state.drumPreparing.rows.toLocaleString() }} read</span>).
                  This happens once.
                </v-alert>

                <!-- Two buttons rather than one. Starting a song over means
                     clearing the grooves and keeping the fills about as often
                     as the other way round, and one button that did both would
                     be the one nobody dares press. Both are undoable from the
                     toast, which is the only kind of confirmation a plugin web
                     view can actually show. -->
                <div class="d-flex align-center flex-wrap mb-3 flex-grow-0" style="gap: 6px">
                  <v-btn size="x-small" variant="tonal"
                         prepend-icon="mdi-close-circle-outline"
                         :disabled="!boundGrooves"
                         @click="clearEverySlot('groove')">
                    Clear grooves<span v-if="boundGrooves"> ({{ boundGrooves }})</span>
                  </v-btn>
                  <v-btn size="x-small" variant="tonal"
                         prepend-icon="mdi-flash-off"
                         :disabled="!boundFills"
                         @click="clearEverySlot('fill')">
                    Clear fills<span v-if="boundFills"> ({{ boundFills }})</span>
                  </v-btn>
                  <InfoTip location="left">
                    Takes every part's groove off, or every part's fill, in one go — including
                    parts whose marker you have since deleted from the chart, which are still
                    bound and would otherwise quietly come back the next time you retyped the
                    label.
                    <br /><br />
                    Both can be undone from the message that appears.
                  </InfoTip>
                </div>

                <div v-if="!selected" class="text-caption text-medium-emphasis pa-2">
                  Pick a groove to see what it is and bind it to a part of the song.
                </div>
                <!-- A column rather than a scroll box, so the roll inside it
                     can be the thing that takes the leftover height. -->
                <div v-else class="jamin-book-scroll pa-1 d-flex flex-column">
                  <div class="text-body-2 mb-1">
                    {{ selected.name }}
                    <span class="text-caption text-medium-emphasis jamin-mono ml-1">
                      {{ '{' + selected.id + '}' }}
                    </span>
                  </div>
                  <div class="text-caption text-medium-emphasis mb-3">
                    {{ summarizeGroove(selected) }}
                    <!-- Worked out from the notes at import and kept on the
                         library. Shown because a mapping that happens silently
                         looks like a mapping that did not happen. -->
                    <div v-if="readAs">
                      read as {{ readAs }} · played through {{ chosenKit.name }}
                      <InfoTip>
                        Two different questions, and they were being answered with one setting.
                        <br /><br />
                        <strong>Read as</strong> is what numbering this library's files are written
                        in — a fact about the files, worked out from the notes themselves when the
                        library was imported and kept on it. Change it per library on the Libraries
                        tab if the guess is wrong; a shelf inside a library can carry its own, and
                        does when a pack disagrees with itself.
                        <br /><br />
                        <strong>Played through</strong> is the drum instrument on this track, which
                        is the Kit tab and applies to everything.
                      </InfoTip>
                    </div>
                  </div>

                  <!-- An index row whose file could not be read draws as
                       fourteen empty rows, which is precisely what a pattern
                       with no notes in it draws as. The two are not the same
                       thing and the difference is usually a drive that is not
                       plugged in, so say which this is. -->
                  <v-alert v-if="unreadable" type="warning" variant="tonal"
                           density="compact" class="mb-3 text-caption">
                    The notes for this pattern are in the file on disk, and
                    {{ unreadable }}
                  </v-alert>
                  <div v-else-if="selected && selected.byReference && !resolved"
                       class="mb-3 d-flex align-center text-caption text-medium-emphasis">
                    <v-progress-circular indeterminate size="14" width="2" class="mr-2" />
                    Reading it from the library…
                  </div>

                  <!-- What is actually in it, against the whole keyboard.
                       Every voice gets a row whether or not this pattern uses
                       it: the rows used to move as you walked the list, so two
                       grooves could not be compared and the thing most worth
                       knowing about a beat -- that there is no ride in it --
                       had no row to be absent from. It scrolls because
                       fourteen rows is taller than the space, and the
                       alternative to scrolling is throwing rows away again. -->
                  <div v-if="preview" class="jamin-roll mb-3">
                    <div class="jamin-roll-keys">
                      <div v-for="row in preview.rows" :key="row.id" class="jamin-roll-row"
                           :class="{ 'is-silent': !row.plays }">
                        <!-- The key is the switch. Clicking it takes that drum
                             out of the whole song and clicking again brings it
                             back, landing on a bar line -- which is where a
                             drummer drops the hat rather than wherever the
                             mouse was. Shift-click to hear it instead. -->
                        <button
                          type="button" class="jamin-roll-name"
                          :class="{ 'is-struck': playingVoices.has(row.id),
                                    'is-silenced': drumVoiceMuted(row.id) }"
                          :title="drumVoiceMuted(row.id)
                            ? `${row.name} is out — click to bring it back (shift-click to hear it)`
                            : `Click to take the ${row.name.toLowerCase()} out of the song`
                              + ` (shift-click to hear it — ${gmName(noteFor(row.id))})`"
                          @click="onKeyClick($event, row.id)"
                        >
                          <v-icon v-if="drumVoiceMuted(row.id)" size="11" class="mr-1">
                            mdi-volume-off
                          </v-icon>{{ row.name }}
                        </button>
                        <span class="jamin-roll-cells">
                          <i
                            v-for="(velocity, step) in row.cells" :key="step"
                            class="jamin-roll-cell"
                            :class="{
                              'is-hit': velocity > 0,
                              'is-accent': velocity > 95,
                              'is-beat': step % preview.perBar === 0,
                              'is-quarter': step % 4 === 0,
                            }"
                            :style="velocity ? { opacity: 0.35 + 0.65 * (velocity / 127) } : null"
                          />
                          <!-- Where the transport is inside this pattern's
                               loop, locked to the song's bars the same way the
                               player locks it -- a line that drifted against
                               what is being heard would be worse than none. -->
                          <b v-if="transport !== null" class="jamin-roll-head"
                             :class="{ 'is-gliding': gliding }"
                             :style="{ left: `${transport * 100}%` }" />
                        </span>
                      </div>
                    </div>
                    <div class="jamin-roll-foot text-caption text-medium-emphasis d-flex align-center">
                      <span>
                        {{ preview.bars }} bar{{ preview.bars === 1 ? '' : 's' }} · sixteenths ·
                        click a drum to take it out
                      </span>
                      <v-spacer />
                      <v-btn v-if="silenced" size="x-small" variant="text"
                             @click="unmuteEveryDrumVoice()">
                        {{ silenced }} out — bring back
                      </v-btn>
                    </div>
                  </div>

                  <div class="d-flex align-center flex-wrap mb-3" style="gap: 6px">
                    <v-btn size="x-small" variant="tonal"
                           :color="state.drumAccent === selected.id ? 'warning' : undefined"
                           @click="setDrumAccent(state.drumAccent === selected.id ? null : selected)">
                      {{ state.drumAccent === selected.id ? 'The accent' : 'Make it the accent' }}
                    </v-btn>
                    <v-btn v-if="state.drumAccent" size="x-small" variant="text"
                           :color="state.ui.drumAccentArmed ? 'warning' : undefined"
                           :prepend-icon="state.ui.drumAccentArmed ? 'mdi-flash' : 'mdi-flash-outline'"
                           @click="triggerDrumAccent">
                      {{ state.ui.drumAccentArmed ? 'Armed — cancel' : 'On the next section' }}
                    </v-btn>
                    <InfoTip>
                      The accent replaces the groove on the next section rather than playing over
                      it, and waits for the section change to do it — so arming it halfway through
                      a verse means the same thing as arming it a bar early. A drummer changes
                      groove at a section, not in the middle of one.
                    </InfoTip>
                  </div>

                </div>
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Parts: what plays where ------------------------------------ -->
        </v-window>
      </v-card-text>
</template>
