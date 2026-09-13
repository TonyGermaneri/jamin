<script setup>
/**
 * The progression library: named snippets of chart text.
 *
 * A progression is stored as the notation you type, so anything here drops
 * straight into a chart and any part of a chart can be saved back. The only
 * thing done to it on the way in is transposition.
 */
import { computed, ref, watch } from 'vue'
import {
  state,
  allProgressions,
  saveProgression,
  deleteProgression,
  renameProgression,
  insertProgression,
  renderProgression,
  importProgressionJson,
  exportProgressionJson,
  toast,
} from '../store.js'
import { summarizeProgression, firstRoot, usesFlats } from '../core/progressions.js'
import { pcName } from '../core/chordParser.js'

const filter = ref('')
const mode = ref('caret')
const targetPc = ref(null)
const spelling = ref('auto')
const renaming = ref(null)
const renameTo = ref('')
const newName = ref('')
const importText = ref('')
const exportText = ref('')

const ROOTS = Array.from({ length: 12 }, (_, pc) => pc)

const modes = [
  { title: 'At the cursor', value: 'caret' },
  { title: 'On a new line at the end', value: 'append' },
  { title: 'Replace the whole chart', value: 'replace' },
]

const keyOptions = computed(() => [
  { title: 'As written', value: null },
  ...ROOTS.map((pc) => ({ title: pcName(pc, true) === pcName(pc) ? pcName(pc) : `${pcName(pc)} / ${pcName(pc, true)}`, value: pc })),
])

const list = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  const all = allProgressions()
  if (!needle) return all
  return all.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.text.toLowerCase().includes(needle) ||
      (item.tags || []).some((tag) => tag.toLowerCase().includes(needle))
  )
})

const selectionText = computed(() => {
  const [a, b] = state.status.selection
  const [from, to] = a <= b ? [a, b] : [b, a]
  return state.text.slice(from, to).trim()
})

watch(
  () => state.ui.progressions,
  (open) => {
    if (!open) return
    newName.value = ''
    exportText.value = ''
  }
)

function preview(item) {
  return renderProgression(item, targetPc.value, spelling.value)
}

function insert(item) {
  insertProgression(item, { mode: mode.value, targetPc: targetPc.value, spelling: spelling.value })
}

function keyOf(item) {
  const root = firstRoot(item.text)
  return root === null ? '' : pcName(root, usesFlats(item.text))
}

function commitRename(item) {
  if (renaming.value !== item.name) return
  const next = renameProgression(item.name, renameTo.value)
  if (next) toast(`Renamed to ${next}`)
  renaming.value = null
}

function saveCurrent(text, label) {
  const saved = saveProgression(newName.value || label, text)
  if (saved) {
    newName.value = ''
    state.ui.progressionsTab = 'library'
  }
}

function runImport() {
  const result = importProgressionJson(importText.value)
  if (result.ok) {
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
  <v-dialog v-model="state.ui.progressions" max-width="780" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon size="18" class="mr-2">mdi-bookshelf</v-icon>
        <span class="text-body-1">Progression library</span>
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="text" @click="state.ui.progressions = false" />
      </v-card-title>

      <v-tabs v-model="state.ui.progressionsTab">
        <v-tab value="library">Library ({{ allProgressions().length }})</v-tab>
        <v-tab value="save">Save</v-tab>
        <v-tab value="transfer">Import / export</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="state.ui.progressionsTab">
          <!-- Library ---------------------------------------------------- -->
          <v-window-item value="library">
            <v-row dense class="mb-1">
              <v-col cols="12" md="4">
                <v-text-field v-model="filter" label="Search" prepend-inner-icon="mdi-magnify" clearable />
              </v-col>
              <v-col cols="12" md="3">
                <v-select v-model="targetPc" :items="keyOptions" label="Transpose to" />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="spelling"
                  :disabled="targetPc === null"
                  :items="[{ title: 'Auto', value: 'auto' }, { title: '♯', value: 'sharps' }, { title: '♭', value: 'flats' }]"
                  label="Spell"
                />
              </v-col>
              <v-col cols="12" md="3">
                <v-select v-model="mode" :items="modes" label="Insert" />
              </v-col>
            </v-row>

            <div v-if="!list.length" class="text-center py-8 text-caption text-medium-emphasis">
              Nothing matches “{{ filter }}”.
            </div>

            <v-list v-else density="compact" class="py-0">
              <v-list-item v-for="item in list" :key="item.name" class="px-0">
                <v-list-item-title v-if="renaming !== item.name" class="d-flex align-center" style="gap: 8px">
                  {{ item.name }}
                  <span v-if="item.builtin" class="text-caption text-medium-emphasis">built in</span>
                  <span v-for="tag in item.tags || []" :key="tag" class="text-caption text-medium-emphasis">· {{ tag }}</span>
                </v-list-item-title>
                <v-text-field
                  v-else
                  v-model="renameTo"
                  density="compact"
                  autofocus
                  @keydown.enter="commitRename(item)"
                  @blur="commitRename(item)"
                />

                <v-list-item-subtitle class="text-caption">
                  {{ summarizeProgression(item, state.settings.transport.beatsPerBar) }}
                </v-list-item-subtitle>
                <pre
                  class="jamin-mono text-caption mt-1 mb-1"
                  style="white-space: pre-wrap; opacity: 0.85; line-height: 1.5"
                >{{ preview(item) }}</pre>

                <template #append>
                  <v-btn size="x-small" variant="tonal" class="mr-1" @click="insert(item)">Insert</v-btn>
                  <v-btn
                    v-if="!item.builtin"
                    icon="mdi-rename-outline"
                    size="x-small"
                    variant="text"
                    @click="renaming = item.name; renameTo = item.name"
                  />
                  <v-btn
                    v-if="!item.builtin"
                    icon="mdi-delete-outline"
                    size="x-small"
                    variant="text"
                    @click="deleteProgression(item.name)"
                  />
                </template>
              </v-list-item>
            </v-list>

            <div v-if="targetPc !== null" class="text-caption text-medium-emphasis mt-2">
              Shown transposed so the first chord is {{ pcName(targetPc) }}. The library keeps the original.
            </div>
          </v-window-item>

          <!-- Save ------------------------------------------------------- -->
          <v-window-item value="save">
            <v-text-field v-model="newName" label="Name" class="mb-4" placeholder="ii–V–I in Eb" />

            <div class="text-caption text-medium-emphasis mb-1">Selection</div>
            <pre class="jamin-mono text-caption mb-2" style="white-space: pre-wrap; min-height: 20px; opacity: .85">{{ selectionText || '— nothing selected in the chart —' }}</pre>
            <v-btn size="small" :disabled="!selectionText" class="mb-5" @click="saveCurrent(selectionText, 'Selection')">
              Save the selection
            </v-btn>

            <div class="text-caption text-medium-emphasis mb-1">Whole chart</div>
            <pre class="jamin-mono text-caption mb-2" style="white-space: pre-wrap; max-height: 120px; overflow: auto; opacity: .85">{{ state.text }}</pre>
            <v-btn size="small" :disabled="!state.text.trim()" @click="saveCurrent(state.text, 'Chart')">
              Save the whole chart
            </v-btn>
          </v-window-item>

          <!-- Import / export -------------------------------------------- -->
          <v-window-item value="transfer">
            <div class="text-caption text-medium-emphasis mb-2">
              Paste a collection as JSON. Our own export works, and so do most shapes found in the
              wild: a bare array, <code>{ progressions: [...] }</code>, entries using
              <code>title</code>/<code>chords</code> instead of <code>name</code>/<code>text</code>.
            </div>
            <v-textarea
              v-model="importText"
              label="Paste JSON here"
              rows="7"
              variant="outlined"
              density="compact"
              hide-details="auto"
              class="jamin-mono mb-2"
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
              rows="7"
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
