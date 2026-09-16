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
import { computed, ref, watch } from 'vue'
import {
  state,
  toast,
  drumRows,
  setGrooveFor,
  forgetDrumBinding,
  grooveById,
  favourite,
  toggleFavourite,
  setDrumAccent,
  triggerDrumAccent,
  slotFor,
  cycleGrooveOn,
  assignEverywhere,
  autoFillFrom,
  tapDrum,
  refreshDrumSets,
  importDrumFolder,
  cancelDrumImport,
  forgetDrumSet,
  setDrumSetKit,
  importDrumFolderByReference,
  notesFor,
  inboundKitFor,
  midiForGroove,
  searchDrums,
  drumFacetsFor,
  sectionBars,
  partsItFits,
  clearEverySlot,
} from '../store.js'
// The in-memory text search, which is not the store's searchDrums: that one
// asks the database. Both are needed and they are not the same thing.
import { searchDrums as searchGrooveList, summarizeGroove } from '../core/drums.js'
import { DRUM_KITS, DRUM_VOICES, kitById, gmName, mapDrumNote, TD11_TO_VOICE } from '../core/drumKits.js'
import InfoTip from './InfoTip.vue'
import { vDragMidi } from '../core/dragOut.js'
import { everyTag } from '../core/drumTags.js'

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
const filtersOpen = ref(undefined)
const selected = ref(null)
const page = ref(1)
const PER_PAGE = 12

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
watch(() => state.ui.drums, (open) => {
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
 * Two sources, and they cannot be one. The bundled corpus is 1,150 patterns in
 * memory and is filtered by walking it. An imported library can be three
 * quarters of a million and lives in the database, so it is filtered by asking
 * the database and what comes back is a page of answers. Merging them into one
 * array would mean holding the second one, which is the thing that cannot be
 * done.
 *
 * So the library is a choice: the built-in corpus, or one of the libraries that
 * was imported. `state.drumFilters.set` is where that choice lives, because it
 * is also what the database query needs.
 */
const library = computed({
  get: () => state.drumFilters.source,
  set: (value) => {
    state.drumFilters.source = value
    // Neither 'everything' nor 'built in' names a library, and the query wants
    // a library or nothing -- nothing meaning every one of them.
    state.drumFilters.set = value === BUILT_IN || value === EVERYTHING ? '' : value
    state.drumFilters.folder = ''
  },
})

/**
 * Which source, with two that are not one library.
 *
 * `builtin` is the shipped corpus, in memory. `` is every imported library at
 * once, which is what somebody looking for a groove rather than for a library
 * wants -- and was missing, so a collection of fifty packs could only ever be
 * searched one pack at a time.
 */
const EVERYTHING = 'all'
const BUILT_IN = 'builtin'

const libraries = computed(() => {
  const inLibraries = state.drumSets.reduce((sum, set) => sum + (set.count || 0), 0)
  return [
    { title: `Everything (${(state.drums.length + inLibraries).toLocaleString()})`, value: EVERYTHING },
    { title: `Built in (${state.drums.length.toLocaleString()})`, value: BUILT_IN },
    ...state.drumSets.map((set) => ({
      title: `${set.name} (${(set.count || 0).toLocaleString()})`,
      value: set.id,
    })),
  ]
})

/** Whether the catalogue is being searched at all. */
const imported = computed(() => library.value !== BUILT_IN)

/** Whether the corpus that ships with jamin is part of what is showing. */
const builtinShowing = computed(() => library.value === EVERYTHING || library.value === BUILT_IN)

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
  holds: 0, stride: 1, exact: true,
}
const facets = ref(EMPTY_FACETS)

watch(library, async (which) => {
  facets.value = EMPTY_FACETS
  // An empty set id means every library, which the facets understand too.
  if (which !== BUILT_IN) facets.value = await drumFacetsFor(state.drumFilters.set)
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
 * The count is marked as an estimate when the library was too big to count and
 * was sampled instead. `Progressive (429)` over forty thousand patterns is a
 * worse answer than `Progressive (~41,000)`: both are approximate and only one
 * of them admits it. @see core/drumStore.js grooveFacets
 */
function fromFacet(pairs, label, title = (name) => String(name)) {
  const about = facets.value.exact === false ? '~' : ''
  return [
    { title: label, value: 'any' },
    ...pairs.map(([name, count]) => ({
      title: `${title(name)} (${about}${count.toLocaleString()})`,
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
  if (!imported.value) return 'The built-in corpus does not say'
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
watch(
  () => [library.value, shelf.value, search.value, kind.value, bars.value, signature.value,
         genre.value, feel.value, surface.value, partTag.value, era.value],
  () => {
    if (!imported.value) return
    const some = (value) => (value === 'any' ? '' : value)
    searchDrums({
      text: search.value,
      kind: some(kind.value),
      bars: bars.value === 'any' ? 0 : Number(bars.value),
      signature: some(signature.value),
      genre: some(genre.value),
      feel: some(feel.value),
      surface: some(surface.value),
      part: some(partTag.value),
      era: some(era.value),
    })
  },
  { immediate: true }
)

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

const kinds = computed(() => imported.value
  ? fromFacet(facets.value.kinds, 'Beats and fills')
  : facet((groove) => groove.kind, 'Beats and fills'))
const genres = computed(() => imported.value
  ? fromFacet(facets.value.genres, 'Any genre')
  : facet((groove) => groove.genre, 'Any genre'))

/** Length in bars, which is the filter that decides whether a groove fits. */
const barCounts = computed(() => {
  if (imported.value) {
    return fromFacet(facets.value.bars, 'Any length', (n) => `${n} bar${n === '1' || n === 1 ? '' : 's'}`)
  }
  const counts = new Map()
  for (const groove of drums.value) counts.set(groove.bars, (counts.get(groove.bars) || 0) + 1)
  return [
    { title: 'Any length', value: 'any' },
    ...[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([n, count]) => ({
      title: `${n} bar${n === 1 ? '' : 's'} (${count.toLocaleString()})`,
      value: String(n),
    })),
  ]
})

/** Time signature. Nearly all of the corpus is in four, which is worth seeing
    rather than discovering when a groove in seven will not sit in the bar. */
const signatures = computed(() => imported.value
  ? fromFacet(facets.value.signatures, 'Any time signature')
  : facet((groove) => groove.timeSignature, 'Any time signature'))

const matches = computed(() => {
  const starred = state.favourites.length
  // Already narrowed by the database, which did the kind, length, signature and
  // text itself over rows this page never held. What is left is the two filters
  // that depend on things only the page knows: the chart, and the stars.
  /*
   * Two sources, and `Everything` is both of them.
   *
   * They cannot be one list underneath -- the shipped corpus is in memory and
   * an imported catalogue is three quarters of a million rows in a database --
   * but that is jamin's problem and not anybody else's. Everything means
   * everything: the corpus first, because it is the one that is always there,
   * then whatever the catalogue found.
   */
  const fromCatalogue = imported.value
    ? state.drumHits.filter((groove) => {
      if (onlyFavourites.value && (!starred || !favourite(groove))) return false
      if (onlyFitting.value && !partsItFits(groove).length) return false
      return true
    })
    : []

  if (!builtinShowing.value) return fromCatalogue

  const fromCorpus = searchGrooveList(drums.value, search.value).filter((groove) => {
    if (kind.value !== 'any' && groove.kind !== kind.value) return false
    if (genre.value !== 'any' && groove.genre !== genre.value) return false
    if (bars.value !== 'any' && String(groove.bars) !== bars.value) return false
    if (signature.value !== 'any' && groove.timeSignature !== signature.value) return false
    if (onlyFavourites.value && (!starred || !favourite(groove))) return false
    if (onlyFitting.value && !partsItFits(groove).length) return false
    return true
  })

  return [...fromCorpus, ...fromCatalogue]
})

const activeFilters = computed(() =>
  [kind.value !== 'any', genre.value !== 'any',
   imported.value && Boolean(shelf.value), bars.value !== 'any',
   signature.value !== 'any', feel.value !== 'any', surface.value !== 'any',
   partTag.value !== 'any', era.value !== 'any',
   onlyFavourites.value, onlyFitting.value].filter(Boolean).length)

/** The song's parts and how long each is, for the fitting switch to explain
    itself -- "fits the song" is meaningless without saying what the song is. */
const parts = computed(() => sectionBars())

const filtered = computed(() => Boolean(search.value) || activeFilters.value > 0)

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

/** A search of an imported library hands back a page of a much longer answer,
    and past a certain size it samples rather than counts. Saying "showing 400
    of about 41,000" beats letting either number stand in for the other. */
const capped = computed(() =>
  imported.value && (!state.drumSearch.exact || state.drumSearch.total > matches.value.length))

const pageCount = computed(() => Math.max(1, Math.ceil(matches.value.length / PER_PAGE)))
const list = computed(() => matches.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE))
watch(matches, () => { page.value = 1 })

/** One at random from what the filters are showing, which is what makes a die
    worth having: 2,399 grooves is a shrug, the 60 two-bar funk beats is a
    suggestion. */
function roll() {
  const pool = matches.value
  if (!pool.length) return
  choose(pool[Math.floor(Math.random() * pool.length)])
}

/** Picking a groove, which in auto-select mode also places it. */
function choose(groove) {
  selected.value = groove
  if (autoSelect.value) assignEverywhere(groove)
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

  for (const note of groove.notes || []) {
    const voice = TD11_TO_VOICE[note.note]
    if (!voice) continue
    if (!used.has(voice)) used.set(voice, new Array(steps).fill(0))
    const step = Math.min(steps - 1, Math.floor(note.at / perStep))
    // The loudest hit in the cell, so a ghost note next to an accent does not
    // hide it.
    used.get(voice)[step] = Math.max(used.get(voice)[step], note.velocity || 1)
  }

  const empty = new Array(steps).fill(0)
  const rows = VOICE_ORDER.map((id) => ({
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
  if (!roll || !playing.running || !roll.lengthPulses) return null

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
  gliding.value = now !== null && before !== null && now >= before
})

const folderInput = ref(null)

/** Bytes, as somebody would say them. */
function inGigabytes(bytes) {
  const mb = (bytes || 0) / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

/** Everything the sampling found, minus the pitch list, which is machinery
    rather than something to read. */
function setFacts(set) {
  const { pitches, ...rest } = set.facts || {}
  return rest
}

/**
 * How much of a library the kit it is set to cannot play.
 *
 * A pack written for one sampler and played through another loses notes in
 * silence: nothing errors, the pattern is simply thinner than it should be. The
 * pitches the sampling saw are kept for exactly this, so the number is live
 * against whichever kit the library is set to.
 */
function unplayable(set) {
  const pitches = (set.facts && set.facts.pitches) || []
  if (!pitches.length) return null

  const map = set.kit ? kitById(set.kit).map : chosenKit.value.map
  const lost = pitches.filter((pitch) => mapDrumNote(pitch, map) === null)
  return { lost: lost.length, total: pitches.length,
           percent: Math.round(100 * lost.length / pitches.length) }
}

function pickFolder() {
  if (folderInput.value) folderInput.value.click()
}

async function onFolderPicked(event) {
  const files = event.target.files
  if (!files || !files.length) return
  // The folder's own name, from the first file's path -- a directory picker
  // gives no other way to know what was chosen.
  const first = files[0].webkitRelativePath || files[0].name
  await importDrumFolder(files, first.split('/')[0] || 'library')
  event.target.value = ''
}

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

/** Move through the whole filtered list rather than the page, and follow it. */
function step(by) {
  const pool = matches.value
  if (!pool.length) return

  const at = pool.findIndex((groove) => selected.value && groove.id === selected.value.id)
  const next = Math.min(pool.length - 1, Math.max(0, at < 0 ? 0 : at + by))

  selected.value = pool[next]
  page.value = Math.floor(next / PER_PAGE) + 1
}

function turnPage(by) {
  page.value = Math.min(pageCount.value, Math.max(1, page.value + by))
}

/*
 * The wheel walks the catalogue, the same as the phrase and progression books.
 *
 * One groove per notch whether the browser sends that as one big delta or as a
 * stream of small ones, and it walks the whole of what the filters found rather
 * than the page -- three quarters of a million patterns is not something to
 * page through twelve at a time.
 */
let wheelAcc = 0
function onWheel(event) {
  event.preventDefault()
  wheelAcc += event.deltaY
  while (Math.abs(wheelAcc) >= 30) {
    step(wheelAcc > 0 ? 1 : -1)
    wheelAcc -= Math.sign(wheelAcc) * 30
  }
}

/** 1-9 are the first nine parts and 0 is the tenth, as tabs and windows have
    numbered things for thirty years. */
function assignToPartNumber(digit) {
  if (!selected.value) return
  const row = liveRows.value[digit === 0 ? 9 : digit - 1]
  if (row) cycleGrooveOn(row.name, selected.value)
}

function onKey(event) {
  if (event.key >= '0' && event.key <= '9') {
    event.preventDefault()
    assignToPartNumber(Number(event.key))
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
const boundGrooves = computed(() => rows.value.filter((row) => row.groove).length)
const boundFills = computed(() => rows.value.filter((row) => row.fill).length)

/** Both slots at once, which is what "start this part again" means. */
function clearPart(row) {
  setGrooveFor(row.name, null, 'groove')
  setGrooveFor(row.name, null, 'fill')
  toast(`${partLabel(row)} cleared`)
}

const partLabel = (row) => (row.wholeSong ? 'The whole song' : row.name)
const grooveName = (id) => (grooveById(id) ? grooveById(id).name : null)

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

function setNote(voice, value) {
  const note = Math.round(Number(value))
  const custom = { ...(settings.value.customMap || {}) }
  if (!Number.isFinite(note) || note < 0 || note > 127 || note === chosenKit.value.map[voice]) {
    delete custom[voice]
  } else {
    custom[voice] = note
  }
  settings.value.customMap = custom
}

/**
 * How much of the bundled corpus lands on each voice.
 *
 * Counted once from what is loaded. It is here because when a drum sounds
 * wrong, the first question is how much of the music goes through it -- the
 * hi-hat foot is 11.7% of every note in the corpus, so a wrong sample there is
 * heard constantly, and the crash at 0.7% is a curiosity.
 */
const voiceShares = computed(() => {
  const counts = new Map()
  let total = 0
  for (const groove of state.drums) {
    for (const note of groove.notes) {
      const voice = TD11_TO_VOICE[note.note]
      if (!voice) continue
      counts.set(voice, (counts.get(voice) || 0) + 1)
      total++
    }
  }
  return { counts, total }
})

function voiceShare(id) {
  const { counts, total } = voiceShares.value
  const hits = counts.get(id) || 0
  if (!hits || !total) return ''
  const share = (100 * hits) / total
  return `${share < 0.1 ? '<0.1' : share.toFixed(1)}%`
}

const overridden = computed(() => Object.keys(settings.value.customMap || {}).length)
function resetMap() {
  settings.value.customMap = {}
  toast(`Back to ${chosenKit.value.name}`)
}
</script>

<template>
  <!-- The whole width: a row of grooves carries a pill per part, and parts are
       what a song has several of. @see styles/app.css .jamin-drums -->
  <v-dialog v-model="state.ui.drums" width="98vw" max-width="none" scrollable
            class="jamin-book jamin-drums">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon size="18" class="mr-2">mdi-circle-multiple-outline</v-icon>
        <span class="text-body-1">Drum book</span>
        <v-spacer />
        <span v-if="waiting" class="text-caption text-warning mr-3">
          {{ waiting }} part{{ waiting === 1 ? '' : 's' }} with no groove
        </span>
        <v-btn icon size="small" variant="text" class="mr-1" :disabled="!matches.length"
               aria-label="A random groove from this list" @click="roll">
          <v-icon size="19">mdi-dice-5-outline</v-icon>
          <v-tooltip activator="parent" location="bottom">
            One of the {{ matches.length.toLocaleString() }} the filters are showing
          </v-tooltip>
        </v-btn>
        <v-btn icon="mdi-close" size="small" variant="text" @click="state.ui.drums = false" />
      </v-card-title>

      <v-tabs v-model="state.ui.drumsTab">
        <v-tab value="grooves">Grooves ({{ drums.length.toLocaleString() }})</v-tab>
        <v-tab value="parts">Parts</v-tab>
        <v-tab value="sets">
          Libraries<span v-if="state.drumSets.length"> ({{ state.drumSets.length }})</span>
        </v-tab>
        <v-tab value="kit">Kit</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="state.ui.drumsTab">
          <!-- Grooves: the catalogue ------------------------------------- -->
          <v-window-item value="grooves">
            <v-row class="jamin-book-row">
              <v-col cols="12" md="7" class="jamin-book-col">
                <v-text-field
                  v-model="search" density="compact" hide-details clearable
                  prepend-inner-icon="mdi-magnify" label="Search" class="mb-2 flex-grow-0"
                />

                <div class="d-flex align-center flex-wrap mb-2 flex-grow-0" style="gap: 8px">
                  <v-switch
                    v-model="autoSelect" density="compact" hide-details color="primary"
                    label="Auto-select"
                  />
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


                <!-- No longer gives way when the filters open: they are on
                     the other side now and take nothing from the list. -->
                <v-list v-if="list.length" ref="listEl" density="compact"
                        class="py-0 jamin-book-scroll"
                        tabindex="0"
                        style="outline: none"
                        @keydown="onKey"
                        @keydown.down.prevent="step(1)"
                        @keydown.up.prevent="step(-1)"
                        @keydown.left.prevent="turnPage(-1)"
                        @keydown.right.prevent="turnPage(1)"
                        @keydown.space.prevent="assignEverywhere(selected)"
                        @keydown.page-down.prevent="step(PER_PAGE)"
                        @keydown.page-up.prevent="step(-PER_PAGE)"
                        @keydown.home.prevent="step(-matches.length)"
                        @keydown.end.prevent="step(matches.length)"
                        @wheel="onWheel">
                  <!-- Drag a groove straight onto a track. Not an HTML5 drag:
                       the web view starts its own on dragstart and JUCE then
                       refuses to start one. @see core/dragOut.js -->
                  <v-list-item
                    v-for="groove in list" :key="groove.id"
                    v-drag-midi="() => midiForGroove(groove)"
                    :active="selected && selected.id === groove.id"
                    class="px-2" @click="choose(groove)"
                  >
                    <template #prepend>
                      <v-icon size="16" :color="groove.kind === 'fill' ? 'warning' : undefined">
                        {{ groove.kind === 'fill' ? 'mdi-flash-outline' : 'mdi-circle-multiple-outline' }}
                      </v-icon>
                    </template>
                    <v-list-item-title class="text-body-2">{{ groove.name }}</v-list-item-title>
                    <v-list-item-subtitle class="text-caption">
                      {{ groove.bars }} bar{{ groove.bars === 1 ? '' : 's' }} ·
                      {{ groove.timeSignature }} · {{ groove.bpm }}bpm
                      <span v-if="groove.substyle">· {{ groove.substyle }}</span>
                      <span v-if="groove.drummer">· {{ groove.drummer }}</span>
                      <span v-if="onlyFitting && partsItFits(groove).length" class="text-primary">
                        · fits {{ partsItFits(groove).map((p) => p.name === ' song' ? 'the song' : p.name).join(', ') }}
                      </span>
                    </v-list-item-subtitle>
                    <!-- One pill per part, on their own line: a song with eight
                         sections is eight pills, and squeezed onto the end of
                         the name they crowd out the name.

                         Three states, cycled by clicking: not playing, this
                         part's groove, this part's fill (with a bolt on it).
                         Any pattern can be either -- what a library calls a
                         pattern is a guess from its file name, and a guess is
                         not a rule. -->
                    <div v-if="liveRows.length" class="jamin-drum-pills">
                      <v-chip
                        v-for="(row, index) in liveRows" :key="row.name"
                        size="x-small" label
                        :variant="slotFor(row.name, groove) ? 'flat' : 'outlined'"
                        :color="chipColour(slotFor(row.name, groove))"
                        :class="{ 'is-playing': row.name === playingSection }"
                        :title="chipTitle(row, groove, index)"
                        @click.stop="cycleGrooveOn(row.name, groove)"
                      >
                        <v-icon v-if="slotFor(row.name, groove) === 'fill'" start size="11">
                          mdi-flash
                        </v-icon>
                        {{ pillLabel(row, index) }}
                      </v-chip>
                    </div>

                    <template #append>
                      <v-btn icon size="x-small" variant="text"
                             :color="favourite(groove) ? 'error' : undefined"
                             :aria-label="`Favourite ${groove.name}`"
                             @click.stop="toggleFavourite(groove)">
                        <v-icon size="16">{{ favourite(groove) ? 'mdi-heart' : 'mdi-heart-outline' }}</v-icon>
                      </v-btn>
                    </template>
                  </v-list-item>
                </v-list>

                <div v-else class="text-caption text-medium-emphasis pa-4">
                  <span v-if="state.drumReport.error">
                    The catalogue would not load — {{ state.drumReport.error }}
                  </span>
                  <span v-else-if="!drums.length">Loading the grooves…</span>
                  <span v-else>Nothing matches.</span>
                  <div v-if="filtered" class="mt-2">
                    <v-btn size="x-small" variant="text" @click="clearFilters">Clear the filters</v-btn>
                  </div>
                </div>

                <div class="d-flex align-center flex-grow-0 mt-1">
                  <v-pagination v-if="pageCount > 1" v-model="page" :length="pageCount"
                                :total-visible="5" density="compact" size="small" />
                  <v-spacer />
                  <span class="text-caption text-medium-emphasis">
                    <span class="jamin-keyhint mr-2">
                      <kbd>↑↓</kbd> groove · <kbd>←→</kbd> page ·
                      <kbd>1–0</kbd> cycle part · <kbd>space</kbd> all
                    </span>
                    <template v-if="state.drumUpgrading">
                      <v-progress-circular indeterminate size="12" width="2" class="mr-1" />
                      Rebuilding the catalogue's index, once
                    </template>
                    <template v-else-if="imported">
                      <span v-if="capped">
                        showing {{ matches.length.toLocaleString() }} of about
                        {{ state.drumSearch.total.toLocaleString() }}
                      </span>
                      <span v-else>{{ matches.length.toLocaleString() }} found</span>
                    </template>
                    <template v-else>
                      {{ matches.length.toLocaleString() }} of {{ drums.length.toLocaleString() }}
                    </template>
                  </span>
                </div>
              </v-col>

              <!-- What you picked -->
              <v-col cols="12" md="5" class="jamin-book-col">
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
                      <span class="text-medium-emphasis mr-2">{{ matches.length.toLocaleString() }}</span>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <v-row dense>
                        <v-col cols="12">
                          <v-select v-model="library" :items="libraries" label="Library"
                                    :hint="state.drumSets.length ? '' : 'Point at a folder on the Libraries tab to add more'"
                                    :persistent-hint="!state.drumSets.length"
                                    density="compact" />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="kind" :items="kinds" label="Kind"
                                    density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="genre" :items="genres" label="Genre"
                                    density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="bars" :items="barCounts" label="Length"
                                    density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="signature" :items="signatures" label="Time signature"
                                    density="compact" hide-details />
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
                                    density="compact" />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="feel" :items="feels" label="Feel"
                                    :hint="tagHint(facets.feels)" persistent-hint
                                    density="compact" />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="partTag" :items="partTags" label="Part of a song"
                                    :hint="tagHint(facets.parts)" persistent-hint
                                    density="compact" />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="era" :items="eras" label="Era"
                                    :hint="tagHint(facets.eras)" persistent-hint
                                    density="compact" />
                        </v-col>
                        <v-col v-if="imported" cols="12">
                          <v-select v-model="shelf" :items="shelves" label="Folder it came from"
                                    density="compact" hide-details />
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
                <div v-else class="jamin-book-scroll pa-1">
                  <div class="text-body-2 mb-1">{{ selected.name }}</div>
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
                        <button
                          type="button" class="jamin-roll-name"
                          :class="{ 'is-struck': playingVoices.has(row.id) }"
                          :title="`Hear the ${row.name.toLowerCase()} — ${gmName(noteFor(row.id))}`"
                          @click="tapDrum(noteFor(row.id))"
                        >{{ row.name }}</button>
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
                    <div class="jamin-roll-foot text-caption text-medium-emphasis">
                      {{ preview.bars }} bar{{ preview.bars === 1 ? '' : 's' }} ·
                      sixteenths · click a name to hear it
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
          <v-window-item value="parts">
            <div class="text-caption text-medium-emphasis mb-3">
              Every <code>[Section]</code> in the chart, and what the drums do there.
              <InfoTip>
                A fill goes in the bar before every section change, which is what a drum chart has
                meant since long before there were corpora to draw on — write
                <code>[d:nofill]</code> in a section to stop it, or switch it off for the whole song
                in Settings. A part whose marker is deleted from the chart keeps its groove and is
                marked below rather than thrown away, because charts get rewritten and losing an
                assignment to a retyped label would be its own small disaster.
              </InfoTip>
            </div>

            <v-table density="compact">
              <thead>
                <tr>
                  <th class="text-caption">Part</th>
                  <th class="text-caption">Groove</th>
                  <th class="text-caption">Fill out of it</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.name" :class="{ 'text-medium-emphasis': row.stale }">
                  <td class="text-body-2">
                    {{ partLabel(row) }}
                    <v-chip v-if="row.stale" size="x-small" variant="tonal" class="ml-2">
                      not in the chart
                    </v-chip>
                  </td>
                  <!-- A clear against each slot rather than one at the end of
                       the row. There are two things bound here and one button
                       could only ever undo one of them, which is why the fill
                       could be set and never taken off again. -->
                  <td class="text-caption">
                    <div class="d-flex align-center" style="gap: 4px">
                      <span v-if="row.groove">{{ grooveName(row.groove) || 'a groove that is gone' }}</span>
                      <span v-else class="text-warning">nothing yet</span>
                      <v-btn v-if="row.groove" icon size="x-small" variant="text"
                             :aria-label="`Clear the groove on ${partLabel(row)}`"
                             title="Take this groove off"
                             @click="setGrooveFor(row.name, null, 'groove')">
                        <v-icon size="14">mdi-close</v-icon>
                      </v-btn>
                    </div>
                  </td>
                  <td class="text-caption">
                    <div class="d-flex align-center" style="gap: 4px">
                      <span v-if="row.fill">{{ grooveName(row.fill) || 'a fill that is gone' }}</span>
                      <span v-else class="text-medium-emphasis">whatever suits</span>
                      <v-btn v-if="row.fill" icon size="x-small" variant="text"
                             :aria-label="`Clear the fill on ${partLabel(row)}`"
                             title="Take this fill off"
                             @click="setGrooveFor(row.name, null, 'fill')">
                        <v-icon size="14">mdi-close</v-icon>
                      </v-btn>
                    </div>
                  </td>
                  <td class="text-right">
                    <v-btn v-if="row.groove || row.fill" size="x-small" variant="text"
                           @click="clearPart(row)">clear both</v-btn>
                    <v-btn v-if="row.stale" icon size="x-small" variant="text" color="error"
                           :aria-label="`Forget ${row.name}`" @click="forgetDrumBinding(row.name)">
                      <v-icon size="16">mdi-delete-outline</v-icon>
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>

            <div v-if="!rows.length" class="text-caption text-medium-emphasis pa-4">
              No parts yet. Write <code>[Intro]</code>, <code>[Verse]</code>, <code>[Chorus]</code>
              on their own in the chart and they appear here.
            </div>
          </v-window-item>

          <!-- Libraries: somebody's own MIDI, read from where it lives ---- -->
          <v-window-item value="sets">
            <div class="text-caption text-medium-emphasis mb-3">
              <span v-if="state.host.active">
                Point jamin at a folder of drum MIDI. The files stay where they are and play from
                there.
              </span>
              <span v-else>Add a folder of drum MIDI and it reads what is in it.</span>
              <InfoTip>
                <span v-if="state.host.active">
                  Point at one pack and it becomes one library. Point at a folder with fifty
                  packs in it and each becomes its own library, because that is the level a
                  vendor's name is at, and a note map belongs to a vendor rather than to a
                  collection. Everything below a pack is its shelves.
                  <br /><br />
                  Stopping leaves what has been read where it is; starting again carries on from
                  the pack it stopped in rather than beginning over.
                  <br /><br />
                  A plugin can reach the filesystem, so a library is pointed at rather than
                  swallowed: what is kept here is an index — what each pattern is called, how long
                  it is, what shelf it sits on — and the notes stay in the file, read at the moment
                  something needs to play them. Half a gigabyte of MIDI becomes a few tens of
                  megabytes of index, and what plays is the original rather than a copy of it.
                  <br /><br />
                  Move or rename the folder and the patterns stop playing, which is the price of
                  not copying it.
                  <br /><br />
                </span>
                Nothing imported is ever redistributed: it is read from where it already is on
                this machine, kept in this browser's own database, and never leaves. The bundled
                corpus is the only one that can legally travel with the program — a library you
                bought is yours to use and not ours to ship.
                <br /><br />
                Files are read whole. A pattern is whatever the file is, because a library of
                authored loops is already a whole number of bars and cutting it up would only
                make it worse.
              </InfoTip>
            </div>

            <div class="d-flex align-center flex-wrap mb-4" style="gap: 8px">
              <!-- Inside a plugin the filesystem is right there, so the library
                   is pointed at rather than swallowed: the database keeps an
                   index and the notes stay in the files. A web page has no path
                   to point at and has to take a copy. -->
              <v-btn v-if="state.host.active" size="small" variant="tonal"
                     prepend-icon="mdi-folder-open-outline"
                     :disabled="state.drumImport.running" @click="importDrumFolderByReference">
                Point at a folder
              </v-btn>
              <v-btn v-else size="small" variant="tonal" prepend-icon="mdi-folder-open-outline"
                     :disabled="state.drumImport.running" @click="pickFolder">
                Add a folder
              </v-btn>
              <input ref="folderInput" type="file" webkitdirectory directory multiple
                     style="display: none" @change="onFolderPicked" />

              <template v-if="state.drumImport.running">
                <!-- Packs, because that is the only count known before the
                     work starts. The tree below each is walked while it is read
                     rather than measured first, so folders and files are
                     reported as they are found rather than as a fraction. -->
                <v-progress-circular
                  v-if="!state.drumImport.packs" indeterminate size="18" width="2" />
                <v-progress-circular
                  v-else size="18" width="2"
                  :model-value="100 * state.drumImport.packsDone / state.drumImport.packs"
                />
                <span class="text-caption">
                  <template v-if="state.drumImport.packs > 1">
                    {{ state.drumImport.pack || state.drumImport.name }} —
                    library {{ state.drumImport.packsDone + 1 }} of
                    {{ state.drumImport.packs }} ·
                    {{ state.drumImport.shelvesDone.toLocaleString() }} folders ·
                    {{ state.drumImport.read.toLocaleString() }} read
                  </template>
                  <template v-else>
                    {{ state.drumImport.name }} —
                    {{ state.drumImport.read.toLocaleString() }}<template
                      v-if="state.drumImport.total"> of
                      {{ state.drumImport.total.toLocaleString() }}</template>
                  </template>
                  <span v-if="state.drumImport.skipped">
                    · {{ state.drumImport.skipped.toLocaleString() }} skipped
                  </span>
                  <span v-if="state.drumImport.packsKept">
                    · {{ state.drumImport.packsKept.toLocaleString() }} already here
                  </span>
                </span>
                <v-btn size="x-small" variant="text" @click="cancelDrumImport">Stop</v-btn>
              </template>
            </div>

            <!-- Taking a library out is minutes of work for a large one, and
                 a window that has not changed looks like a window that has
                 hung. -->
            <div v-if="state.drumRemoval.running" class="mb-3">
              <div class="d-flex align-center mb-1" style="gap: 8px">
                <v-progress-circular indeterminate size="16" width="2" color="error" />
                <span class="text-caption">
                  Removing {{ state.drumRemoval.name }} —
                  {{ state.drumRemoval.done.toLocaleString() }}<span v-if="state.drumRemoval.total">
                    of {{ state.drumRemoval.total.toLocaleString() }}</span> patterns
                </span>
              </div>
              <v-progress-linear
                v-if="state.drumRemoval.total"
                :model-value="100 * state.drumRemoval.done / state.drumRemoval.total"
                color="error" height="4" rounded
              />
            </div>

            <v-table v-if="state.drumSets.length" density="compact">
              <thead>
                <tr>
                  <th class="text-caption">Library</th>
                  <th class="text-caption">Patterns</th>
                  <th class="text-caption">Kit its notes were written for</th>
                  <th class="text-caption">What it says about itself</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr v-for="set in state.drumSets" :key="set.id">
                  <td class="text-body-2">
                    {{ set.name }}
                    <div v-if="set.byReference || set.partial"
                         class="text-caption text-medium-emphasis" :title="set.root">
                      <span v-if="set.byReference">played from disk</span>
                      <span v-if="set.byReference && set.partial"> · </span>
                      <span v-if="set.partial">stopped part way</span>
                    </div>
                  </td>
                  <td class="text-caption">{{ (set.count || 0).toLocaleString() }}</td>
                  <td style="min-width: 190px">
                    <v-select
                      :model-value="set.kit || ''"
                      :items="[{ title: `Whatever the Kit tab says (${chosenKit.name})`, value: '' },
                               ...DRUM_KITS.map((k) => ({ title: k.name, value: k.id }))]"
                      density="compact" hide-details variant="plain"
                      @update:model-value="setDrumSetKit(set.id, $event)"
                    />
                  </td>
                  <td class="text-caption text-medium-emphasis">
                    <!-- The number that says whether the kit above is right.
                         A library played through the wrong map loses notes in
                         silence; nothing else would tell you. -->
                    <div v-if="unplayable(set)" class="mb-1">
                      <span :class="unplayable(set).percent > 10 ? 'text-warning' : ''">
                        {{ unplayable(set).lost }} of {{ unplayable(set).total }} sounds
                        have nowhere to go on this kit
                        <span v-if="unplayable(set).percent > 10">— try another map</span>
                      </span>
                    </div>
                    <!-- Why, when the classifier gave up. A pack of chromatic
                         runs is how a sample library indexes itself and is not a
                         kit; an empty box does not say that. -->
                    <div v-if="set.kitReason" class="mb-1 text-medium-emphasis">
                      No map could be worked out — {{ set.kitReason }}
                    </div>
                    <!-- What the classifier made of the shelves inside. A pack
                         disagrees with itself often enough that this is worth
                         showing rather than hiding behind one setting. -->
                    <div v-if="set.folders" class="mb-1">
                      {{ set.folders.toLocaleString() }} shelves<span
                        v-if="Object.keys(set.folderKits || {}).length">,
                        {{ Object.keys(set.folderKits).length.toLocaleString() }} with a map of
                        their own</span>
                    </div>
                    <span v-for="(value, key) in setFacts(set)" :key="key" class="mr-2">
                      <strong>{{ key }}</strong> {{ value }}
                    </span>
                  </td>
                  <td class="text-right">
                    <v-btn icon size="x-small" variant="text" color="error"
                           :disabled="state.drumRemoval.running"
                           :aria-label="`Remove ${set.name}`" @click="forgetDrumSet(set.id)">
                      <v-icon size="16">mdi-delete-outline</v-icon>
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>

            <div v-if="state.drumSets.length && state.drumStorage.quota"
                 class="text-caption text-medium-emphasis mt-2">
              The catalogue is using {{ inGigabytes(state.drumStorage.usage) }} of the
              {{ inGigabytes(state.drumStorage.quota) }} this machine will give it.
            </div>

            <div v-else-if="!state.drumSets.length" class="text-caption text-medium-emphasis pa-4">
              No libraries yet. The bundled corpus is on the Grooves tab and works without any.
            </div>
          </v-window-item>

          <!-- Kit: where the drums actually are -------------------------- -->
          <v-window-item value="kit">
            <v-select
              v-model="kit" :items="DRUM_KITS.map((k) => ({ title: k.name, value: k.id }))"
              label="Kit" density="compact" hide-details class="mb-2"
            />
            <div class="text-caption text-medium-emphasis mb-4">
              {{ chosenKit.notes }}
              <InfoTip>
                The corpus was played on a Roland TD-11 and its note numbers are not General MIDI —
                48 is a high tom there and a hi-mid tom in GM, 58 is a floor tom rim and a
                vibraslap. So nothing is sent as it was recorded: every groove is read into a
                vocabulary of fourteen voices and written back out to whichever kit is chosen here.
                If a drum is silent or wrong, this table is where it is fixed.
              </InfoTip>
            </div>

            <v-table density="compact">
              <thead>
                <tr>
                  <th />
                  <th class="text-caption">Voice</th>
                  <th class="text-caption">How often</th>
                  <th class="text-caption">Note</th>
                  <th class="text-caption">General MIDI calls it</th>
                  <th class="text-caption">{{ chosenKit.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="voice in DRUM_VOICES" :key="voice.id"
                    :class="{ 'is-struck': playingVoices.has(voice.id) }">
                  <td style="width: 34px">
                    <!-- Hit it. A table of numbers cannot answer "what is
                         actually on 42"; hitting it can, and it works with the
                         transport stopped, which is when somebody is checking. -->
                    <v-btn icon size="x-small" variant="text"
                           :aria-label="`Hear the ${voice.name.toLowerCase()}`"
                           @click="tapDrum(noteFor(voice.id))">
                      <v-icon size="16">mdi-play-circle-outline</v-icon>
                    </v-btn>
                  </td>
                  <td class="text-body-2">
                    <v-icon size="12" class="jamin-kit-dot">mdi-circle</v-icon>
                    {{ voice.name }}
                  </td>
                  <!-- How much of the corpus lands on this voice, because a
                       wrong sample on a common one is a wrong record and a
                       wrong sample on a rare one is a curiosity. The hi-hat
                       foot is one note in eight, which is why it is the first
                       place to look when something sounds wrong. -->
                  <td class="text-caption text-medium-emphasis" style="width: 96px">
                    <span v-if="voiceShare(voice.id)">{{ voiceShare(voice.id) }}</span>
                  </td>
                  <td style="width: 120px">
                    <v-text-field
                      :model-value="noteFor(voice.id)" type="number" min="0" max="127"
                      density="compact" hide-details variant="plain"
                      @update:model-value="setNote(voice.id, $event)"
                    />
                  </td>
                  <!-- The name, not just the number. A mapping that sends the
                       rimshot to "Electric Snare" is obviously wrong the moment
                       the words are on screen and nearly impossible to notice
                       from the numbers -- which is exactly how it shipped. -->
                  <td class="text-caption text-medium-emphasis">{{ gmName(noteFor(voice.id)) }}</td>
                  <td class="text-caption text-medium-emphasis">
                    {{ chosenKit.map[voice.id] }}
                    <span v-if="noteFor(voice.id) !== chosenKit.map[voice.id]" class="text-warning">
                      — changed
                    </span>
                  </td>
                </tr>
              </tbody>
            </v-table>

            <div class="d-flex align-center mt-3">
              <span class="text-caption text-medium-emphasis">
                <span v-if="overridden">{{ overridden }} voice{{ overridden === 1 ? '' : 's' }} changed from {{ chosenKit.name }}</span>
                <span v-else>Unchanged from {{ chosenKit.name }}</span>
              </span>
              <v-spacer />
              <v-btn v-if="overridden" size="small" variant="text" @click="resetMap">
                Back to {{ chosenKit.name }}
              </v-btn>
            </div>
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
