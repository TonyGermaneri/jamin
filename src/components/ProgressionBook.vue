<script setup>
/**
 * The progression library.
 *
 * The list is a page at a time and shows only a name and a length, because it
 * has to work with two thirds of a million progressions in it. Whatever is
 * selected is shown in full on the right, converted and transposed only then --
 * doing that to every row of every page would be work thrown away.
 */
import { computed, ref, watch } from 'vue'
import {
  state,
  saveProgression,
  deleteProgression,
  insertProgression,
  renderProgression,
  importProgressionJson,
  exportProgressionJson,
  progressionPage,
  progressionFacetList,
  importChordonomiconFile,
  forgetBulkProgressions,
  refreshBulkCount,
  CHORDONOMICON,
  CHORDONOMICON_CSV,
  toast,
} from '../store.js'
import { summarizeProgression } from '../core/progressions.js'
import { parseScore } from '../core/score.js'
import InfoTip from './InfoTip.vue'
import { pcName } from '../core/chordParser.js'
import { openOutside } from '../core/host.js'

const PER_PAGE = 12

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
const importText = ref('')
const exportText = ref('')
const csvFile = ref(null)

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

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)))

/*
 * Genre and decade are Chordonomicon's own columns -- every imported row
 * carries both -- so they are filters rather than something only visible in a
 * name. They appear once a collection has been imported and not before, since
 * the built-in progressions have neither.
 */
const genre = ref('')
const decade = ref('')
const facets = ref({ genres: [], decades: [] })
const filtersOpen = ref(undefined)
const activeFilters = computed(() => [genre.value, decade.value].filter(Boolean).length)

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

async function load() {
  loading.value = true
  try {
    const result = await progressionPage((page.value - 1) * PER_PAGE, PER_PAGE, search.value,
                                         { genre: genre.value, decade: decade.value })
    rows.value = result.rows
    total.value = result.total
    partial.value = result.partial
    if (!rows.value.some((row) => row.name === (selected.value && selected.value.name))) {
      selected.value = rows.value[0] || null
    }
  } finally {
    loading.value = false
  }
}

watch(() => [state.ui.progressions, page.value, search.value, genre.value, decade.value,
             state.progressions.length, state.bulk.count],
  ([open]) => { if (open) load() }, { immediate: true })
watch([search, genre, decade], () => { page.value = 1 })

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

function saveCurrent(text, label) {
  if (saveProgression(newName.value || label, text)) {
    newName.value = ''
    state.ui.progressionsTab = 'library'
  }
}

/**
 * Inside the plugin a link cannot save a file, and fails silently doing it, so
 * the URL goes to the system browser. In a tab the anchor does its own job and
 * this does nothing.
 */
async function downloadCsv(event) {
  if (!state.host.active) return
  event.preventDefault()
  if (!(await openOutside(CHORDONOMICON_CSV))) toast('Could not open your browser')
}

async function openCsv(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
  await importChordonomiconFile(file)
  page.value = 1
  load()
}

function runImport() {
  if (importProgressionJson(importText.value, { targetPc: targetPc.value, spelling: spelling.value }).ok) {
    importText.value = ''
    state.ui.progressionsTab = 'library'
  }
}

function runExport() {
  exportText.value = exportProgressionJson()
  navigator.clipboard?.writeText(exportText.value).then(
    () => toast('Copied to the clipboard'),
    () => toast('Select the text below and copy it')
  )
}
</script>

<template>
  <v-dialog v-model="state.ui.progressions" max-width="1040" scrollable class="jamin-book">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon size="18" class="mr-2">mdi-bookshelf</v-icon>
        <span class="text-body-1">Progression library</span>
        <v-spacer />
        <span class="text-caption text-medium-emphasis mr-3">{{ total.toLocaleString() }} progressions</span>
        <v-btn icon="mdi-close" size="small" variant="text" @click="state.ui.progressions = false" />
      </v-card-title>

      <v-tabs v-model="state.ui.progressionsTab">
        <v-tab value="library">Library</v-tab>
        <v-tab value="save">Save</v-tab>
        <v-tab value="transfer">Import / export</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="state.ui.progressionsTab">
          <!-- Library: list on the left, the one you picked on the right ---- -->
          <v-window-item value="library">
            <v-row class="jamin-book-row">
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
                      </v-row>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>

                <v-list
                  v-if="rows.length"
                  density="compact"
                  class="py-0 jamin-book-scroll"
                  tabindex="0"
                  style="outline: none"
                  @keydown.down.prevent="step(1)"
                  @keydown.up.prevent="step(-1)"
                  @wheel="onWheel"
                >
                  <v-list-item
                    v-for="row in rows"
                    :key="row.id || row.name"
                    :active="selected && selected.name === row.name"
                    class="px-2"
                    @click="selected = row"
                  >
                    <v-list-item-title class="text-body-2 text-truncate">{{ row.name }}</v-list-item-title>
                    <template #append>
                      <span class="text-caption text-medium-emphasis">{{ barsOf(row) }} bars</span>
                    </template>
                  </v-list-item>
                </v-list>
                <div v-else-if="loading" class="text-caption text-medium-emphasis py-6 text-center">Loading…</div>
                <div v-else class="text-caption text-medium-emphasis py-6 text-center">Nothing matches “{{ search }}”.</div>

                <v-pagination
                  v-model="page"
                  :length="pageCount"
                  :total-visible="6"
                  density="comfortable"
                  class="mt-2"
                />
                <div class="text-caption text-medium-emphasis text-center">
                  Click the list, then arrow or scroll. Nothing is inserted until you say so.
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
          </v-window-item>

          <!-- Save --------------------------------------------------------- -->
          <v-window-item value="save">
            <v-text-field v-model="newName" label="Name" class="mb-4" placeholder="ii–V–I in Eb" />
            <div class="text-caption text-medium-emphasis mb-1">Whole chart</div>
            <pre class="jamin-mono text-caption mb-2" style="white-space: pre-wrap; max-height: 160px; overflow: auto; opacity: .85">{{ state.text }}</pre>
            <v-btn size="small" :disabled="!state.text.trim()" @click="saveCurrent(state.text, 'Chart')">
              Save the whole chart
            </v-btn>
          </v-window-item>

          <!-- Import / export ---------------------------------------------- -->
          <v-window-item value="transfer">
            <v-alert density="compact" variant="tonal" class="mb-4 text-caption">
              <div class="mb-2">
                <strong>Chordonomicon</strong> — {{ CHORDONOMICON.rows.toLocaleString() }} progressions with
                genre and decade, CC-BY-NC-4.0. Download the CSV, then hand the file back here.
                <InfoTip>
                  It is a {{ Math.round(264198044 / 1e6) }}MB CSV, which is too much to ask a
                  server for on your behalf and far too much to keep in a browser's ordinary
                  storage. It is read as a stream and kept in the browser's database, so the whole
                  set fits and none of it sits in memory.
                </InfoTip>
              </div>
              <div v-if="state.host.active" class="mb-2">
                A plugin window cannot download a file, so the button below opens the link in your
                browser.
                <InfoTip>
                  Download it there, then come back and choose it here. Reading a file you pick
                  <em>does</em> work, and the database is shared by every instance, so this is once
                  per machine rather than once per track.
                </InfoTip>
              </div>
              <div class="d-flex align-center flex-wrap" style="gap: 8px">
                <v-btn size="small" :href="state.host.active ? undefined : CHORDONOMICON_CSV"
                       :target="state.host.active ? undefined : '_blank'" rel="noreferrer"
                       prepend-icon="mdi-download" @click="downloadCsv">
                  {{ state.host.active ? 'Download it in your browser' : 'Download the CSV' }}
                </v-btn>
                <v-btn size="small" :loading="state.bulk.importing" prepend-icon="mdi-upload" @click="csvFile && csvFile.click()">
                  Upload it here
                </v-btn>
                <input ref="csvFile" type="file" accept=".csv,text/csv" style="display: none" @change="openCsv" />
                <span v-if="state.bulk.progress" class="text-caption">{{ state.bulk.progress }}</span>
                <template v-else-if="state.bulk.count">
                  <span class="text-caption">{{ state.bulk.count.toLocaleString() }} imported</span>
                  <v-btn size="x-small" variant="text" @click="forgetBulkProgressions">Clear</v-btn>
                </template>
              </div>
            </v-alert>

            <div class="text-caption text-medium-emphasis mb-2">
              Or paste a collection as JSON — our own export, a bare array,
              <code>{ progressions: [...] }</code>, entries using <code>title</code>/<code>chords</code>,
              or Hugging Face's <code>{ rows: [...] }</code> envelope.
            </div>
            <v-textarea
              v-model="importText"
              label="Paste JSON here"
              rows="6"
              variant="outlined"
              density="compact"
              hide-details="auto"
              class="jamin-mono mb-3"
            />
            <v-btn size="small" prepend-icon="mdi-import" :disabled="!importText.trim()" @click="runImport">Import</v-btn>

            <v-divider class="my-5" />
            <v-btn size="small" prepend-icon="mdi-export" :disabled="!state.progressions.length" @click="runExport">
              Export your {{ state.progressions.length }} saved progression{{ state.progressions.length === 1 ? '' : 's' }}
            </v-btn>
            <v-textarea
              v-if="exportText"
              :model-value="exportText"
              readonly
              rows="6"
              variant="outlined"
              density="compact"
              hide-details="auto"
              class="jamin-mono mt-3"
            />
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
