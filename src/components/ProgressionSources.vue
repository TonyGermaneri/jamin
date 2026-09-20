<script setup>
/**
 * Where progressions come from, and how to put more in.
 *
 * Lifted out of the progression library so that all three catalogues are
 * loaded from the same place. @see components/SettingsDialog.vue
 *
 * Chordonomicon is fetched by the person rather than by jamin: it is a
 * 264MB CSV under CC-BY-NC-4.0, which is neither ours to redistribute nor a
 * reasonable thing to ask a server for on somebody's behalf. It is read as a
 * stream into the browser's database, so the whole set fits and none of it
 * sits in memory.
 */
import { ref } from 'vue'
import {
  state, toast, importChordonomiconFile, forgetBulkProgressions,
  importProgressionJson, exportProgressionJson, CHORDONOMICON, CHORDONOMICON_CSV,
} from '../store.js'
import { openOutside } from '../core/host.js'
import InfoTip from './InfoTip.vue'

const importText = ref('')
const exportText = ref('')
const csvFile = ref(null)

/**
 * A plugin window cannot download a file: there is no browser around it to
 * put one anywhere. So the button hands the link to the machine's own
 * browser instead. Outside a plugin the anchor does the job and this does
 * nothing.
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
}

function runImport() {
  if (importProgressionJson(importText.value).ok) importText.value = ''
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
  <div>
    <v-alert density="compact" variant="tonal" class="mb-4 text-caption">
      <div class="mb-2">
        <strong>Chordonomicon</strong> — {{ CHORDONOMICON.rows.toLocaleString() }} progressions
        with genre and decade, CC-BY-NC-4.0. Download the CSV, then hand the file back here.
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
        <v-btn size="small" :loading="state.bulk.importing" prepend-icon="mdi-upload"
               @click="csvFile && csvFile.click()">
          Upload it here
        </v-btn>
        <input ref="csvFile" type="file" accept=".csv,text/csv" style="display: none"
               @change="openCsv" />
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
    <v-btn size="small" prepend-icon="mdi-import" :disabled="!importText.trim()"
           @click="runImport">Import</v-btn>

    <v-divider class="my-5" />
    <v-btn size="small" prepend-icon="mdi-export" :disabled="!state.progressions.length"
           @click="runExport">
      Export your {{ state.progressions.length }} saved
      progression{{ state.progressions.length === 1 ? '' : 's' }}
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
  </div>
</template>
