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
  boundTo,
  toggleGrooveOn,
  assignEverywhere,
  autoFillFrom,
  tapDrum,
} from '../store.js'
import { searchDrums, summarizeGroove } from '../core/drums.js'
import { DRUM_KITS, DRUM_VOICES, kitById, gmName, TD11_TO_VOICE } from '../core/drumKits.js'
import InfoTip from './InfoTip.vue'

const search = ref('')
const kind = ref('any')
const genre = ref('any')
const bars = ref('any')
const signature = ref('any')
const onlyFavourites = ref(false)
const filtersOpen = ref(undefined)
const selected = ref(null)
const page = ref(1)
const PER_PAGE = 12

const listEl = ref(null)

/** The keys are useless until something has focus, and asking somebody to click
    a list before the arrow keys work is asking them to discover a rule. */
watch(() => state.ui.drums, (open) => {
  if (!open) return
  requestAnimationFrame(() => {
    const el = listEl.value && (listEl.value.$el || listEl.value)
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true })
  })
})

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

const kinds = computed(() => facet((groove) => groove.kind, 'Beats and fills'))
const genres = computed(() => facet((groove) => groove.genre, 'Any genre'))

/** Length in bars, which is the filter that decides whether a groove fits. */
const barCounts = computed(() => {
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
const signatures = computed(() => facet((groove) => groove.timeSignature, 'Any time signature'))

const matches = computed(() => {
  const starred = state.favourites.length
  return searchDrums(drums.value, search.value).filter((groove) => {
    if (kind.value !== 'any' && groove.kind !== kind.value) return false
    if (genre.value !== 'any' && groove.genre !== genre.value) return false
    if (bars.value !== 'any' && String(groove.bars) !== bars.value) return false
    if (signature.value !== 'any' && groove.timeSignature !== signature.value) return false
    if (onlyFavourites.value && (!starred || !favourite(groove))) return false
    return true
  })
})

const activeFilters = computed(() =>
  [kind.value !== 'any', genre.value !== 'any', bars.value !== 'any',
   signature.value !== 'any', onlyFavourites.value].filter(Boolean).length)

const filtered = computed(() => Boolean(search.value) || activeFilters.value > 0)

function clearFilters() {
  search.value = ''
  kind.value = 'any'
  genre.value = 'any'
  bars.value = 'any'
  signature.value = 'any'
  onlyFavourites.value = false
}

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

const preview = computed(() => {
  const groove = selected.value
  if (!groove || !groove.notes.length) return null

  const steps = Math.max(1, groove.bars * STEPS_PER_BAR)
  const perStep = groove.lengthPulses / steps
  const used = new Map()

  for (const note of groove.notes) {
    const voice = TD11_TO_VOICE[note.note]
    if (!voice) continue
    if (!used.has(voice)) used.set(voice, new Array(steps).fill(0))
    const step = Math.min(steps - 1, Math.floor(note.at / perStep))
    // The loudest hit in the cell, so a ghost note next to an accent does not
    // hide it.
    used.get(voice)[step] = Math.max(used.get(voice)[step], note.velocity || 1)
  }

  const rows = VOICE_ORDER.filter((id) => used.has(id)).map((id) => ({
    id,
    name: (DRUM_VOICES.find((voice) => voice.id === id) || {}).name || id,
    cells: used.get(id),
  }))

  return { steps, rows, beats: groove.beatsPerBar * groove.bars }
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
 *   1 … 9 0    put this groove on that part, or take it off again
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

/** 1-9 are the first nine parts and 0 is the tenth, as tabs and windows have
    numbered things for thirty years. */
function assignToPartNumber(digit) {
  if (!selected.value) return
  const row = liveRows.value[digit === 0 ? 9 : digit - 1]
  if (row) toggleGrooveOn(row.name, selected.value)
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

function assign(row, what) {
  if (!selected.value) {
    toast('Choose a groove first')
    return
  }
  setGrooveFor(row.name, selected.value.id, what)
  toast(`${selected.value.name} → ${row.wholeSong ? 'the whole song' : row.name}`)
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
                    With this on, clicking a groove puts it on every part at once — a beat becomes
                    every section's groove, a fill becomes every section's fill. Most songs have
                    one feel, so binding the same beat to five sections one at a time is five
                    clicks to say one thing. The pills still work either way.
                  </InfoTip>

                  <v-spacer />

                  <v-btn size="small" variant="tonal"
                         :disabled="!selected || selected.kind === 'fill' || !liveRows.length"
                         prepend-icon="mdi-auto-fix"
                         @click="autoFillFrom(selected)">
                    Auto-fill
                  </v-btn>
                  <InfoTip location="left">
                    Takes the beat you have chosen, gives it to every part that has no groove yet,
                    and finds each part a fill to lead out of — same genre, same time signature,
                    nearest tempo, chosen separately per part so the song does not leave every
                    section with the same flurry.
                    <br /><br />
                    Parts you have already decided are left alone. The corpus does not pair its
                    beats and fills — they were recorded in separate sessions — so the fill is
                    matched rather than looked up.
                  </InfoTip>
                </div>

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
                      <v-row dense>
                        <v-col cols="6">
                          <v-select v-model="kind" :items="kinds" label="Kind" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="genre" :items="genres" label="Genre" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="bars" :items="barCounts" label="Length" density="compact" hide-details />
                        </v-col>
                        <v-col cols="6">
                          <v-select v-model="signature" :items="signatures" label="Time signature"
                                    density="compact" hide-details />
                        </v-col>
                        <v-col cols="12">
                          <v-switch v-model="onlyFavourites" density="compact" hide-details color="error"
                                    :label="`Favourites only (${state.favourites.length})`" />
                        </v-col>
                        <v-col v-if="activeFilters" cols="12" class="text-right">
                          <v-btn size="x-small" variant="text" @click="clearFilters">Clear them</v-btn>
                        </v-col>
                      </v-row>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>

                <v-list v-if="list.length" ref="listEl" density="compact"
                        class="py-0 jamin-book-scroll"
                        :class="{ 'jamin-filters-open': filtersOpen !== undefined }"
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
                        @keydown.end.prevent="step(matches.length)">
                  <v-list-item
                    v-for="groove in list" :key="groove.id"
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
                    </v-list-item-subtitle>
                    <!-- One pill per part, on their own line: a song with eight
                         sections is eight pills, and squeezed onto the end of
                         the name they crowd out the name. Lit is bound; a beat
                         goes in the groove slot and a fill in the fill slot,
                         because that is what they are. -->
                    <div v-if="liveRows.length" class="jamin-drum-pills">
                      <v-chip
                        v-for="(row, index) in liveRows" :key="row.name"
                        size="x-small" label
                        :variant="boundTo(row.name, groove) ? 'flat' : 'outlined'"
                        :color="boundTo(row.name, groove)
                          ? (groove.kind === 'fill' ? 'warning' : 'primary')
                          : undefined"
                        :class="{ 'is-playing': row.name === playingSection }"
                        :title="`${groove.name} ${boundTo(row.name, groove) ? 'plays' : 'does not play'} `
                              + `${row.wholeSong ? 'the whole song' : row.name}`
                              + (index < 10 ? ` — press ${(index + 1) % 10}` : '')"
                        @click.stop="toggleGrooveOn(row.name, groove)"
                      >{{ pillLabel(row, index) }}</v-chip>
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
                      <kbd>1–0</kbd> part · <kbd>space</kbd> all
                    </span>
                    {{ matches.length.toLocaleString() }} of {{ drums.length.toLocaleString() }}
                  </span>
                </div>
              </v-col>

              <!-- What you picked -->
              <v-col cols="12" md="5" class="jamin-book-col">
                <div v-if="!selected" class="text-caption text-medium-emphasis pa-2">
                  Pick a groove to see what it is and bind it to a part of the song.
                </div>
                <div v-else class="jamin-book-scroll pa-1">
                  <div class="text-body-2 mb-1">{{ selected.name }}</div>
                  <div class="text-caption text-medium-emphasis mb-3">
                    {{ summarizeGroove(selected) }}
                  </div>

                  <!-- What is actually in it. The names sit where a piano roll
                       puts its keys, and only the drums this groove uses get a
                       row -- fourteen rows of mostly nothing is a wall. -->
                  <div v-if="preview" class="jamin-roll mb-3">
                    <div v-for="row in preview.rows" :key="row.id" class="jamin-roll-row">
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
                            'is-beat': step % 4 === 0,
                          }"
                          :style="velocity ? { opacity: 0.35 + 0.65 * (velocity / 127) } : null"
                        />
                      </span>
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

                  <div class="text-caption mb-1">Bind it to</div>
                  <v-list density="compact" class="py-0">
                    <v-list-item v-for="row in rows" :key="row.name" class="px-1">
                      <v-list-item-title class="text-body-2">
                        {{ partLabel(row) }}
                        <span v-if="row.stale" class="text-caption text-medium-emphasis">— not in the chart</span>
                      </v-list-item-title>
                      <template #append>
                        <v-btn size="x-small" variant="tonal" class="mr-1"
                               @click="assign(row, 'groove')">Groove</v-btn>
                        <v-btn size="x-small" variant="text"
                               :disabled="selected.kind !== 'fill'"
                               @click="assign(row, 'fill')">Fill</v-btn>
                      </template>
                    </v-list-item>
                  </v-list>
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
                  <td class="text-caption">
                    <span v-if="row.groove">{{ grooveName(row.groove) || 'a groove that is gone' }}</span>
                    <span v-else class="text-warning">nothing yet</span>
                  </td>
                  <td class="text-caption">
                    <span v-if="row.fill">{{ grooveName(row.fill) || 'a fill that is gone' }}</span>
                    <span v-else class="text-medium-emphasis">any fill</span>
                  </td>
                  <td class="text-right">
                    <v-btn v-if="row.groove" size="x-small" variant="text"
                           @click="setGrooveFor(row.name, null, 'groove')">clear</v-btn>
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
