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
} from '../store.js'
import { searchDrums, summarizeGroove } from '../core/drums.js'
import { DRUM_KITS, DRUM_VOICES, kitById } from '../core/drumKits.js'
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
  selected.value = pool[Math.floor(Math.random() * pool.length)]
}

/* ---------------- parts ---------------- */
const rows = computed(() => drumRows())
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
  <v-dialog v-model="state.ui.drums" max-width="900" scrollable class="jamin-book">
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

                <v-list v-if="list.length" density="compact"
                        class="py-0 jamin-book-scroll"
                        :class="{ 'jamin-filters-open': filtersOpen !== undefined }">
                  <v-list-item
                    v-for="groove in list" :key="groove.id"
                    :active="selected && selected.id === groove.id"
                    class="px-2" @click="selected = groove"
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
                  <th class="text-caption">Voice</th>
                  <th class="text-caption">Note</th>
                  <th class="text-caption">{{ chosenKit.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="voice in DRUM_VOICES" :key="voice.id">
                  <td class="text-body-2">{{ voice.name }}</td>
                  <td style="width: 120px">
                    <v-text-field
                      :model-value="noteFor(voice.id)" type="number" min="0" max="127"
                      density="compact" hide-details variant="plain"
                      @update:model-value="setNote(voice.id, $event)"
                    />
                  </td>
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
