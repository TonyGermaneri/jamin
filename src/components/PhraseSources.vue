<script setup>
/**
 * Where articulations come from, and how to put more in.
 *
 * Lifted out of the phrase book so that all three catalogues are loaded from
 * the same place. Pointing jamin at a collection is a thing somebody does
 * once and then not again for a month; it was in three different books,
 * behind three differently named tabs, and the one question it answers --
 * "how do I get my own material in" -- had three answers depending on which
 * window you happened to have open.
 *
 * @see components/SettingsDialog.vue, components/DrumLibraries.vue
 */
import { computed, ref } from 'vue'
import {
  state, toast, ensureLicks as rebuildLicks, importMidiPhrases, defaultVocabularyUrl,
} from '../store.js'

const vocabUrl = ref('')
const vocabFile = ref(null)
const midiFile = ref(null)
const midiBars = ref(1)

const report = computed(() => state.lickReport)
const defaultVocab = computed(() => defaultVocabularyUrl())

async function rebuild(options) {
  await rebuildLicks(options)
  const said = state.lickReport
  if (said && !said.error) toast(`${said.total + (said.parts || 0)} in the catalogue`)
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
}
</script>

<template>
  <div>
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
      <v-btn size="small" variant="text" @click="vocabFile && vocabFile.click()">
        Open a .voc file…
      </v-btn>
      <input ref="vocabFile" type="file" accept=".voc,text/plain" style="display: none"
             @change="openVocabulary" />
    </div>

    <div class="d-flex align-center mb-2" style="gap: 8px">
      <v-text-field v-model="vocabUrl" label="…or a vocabulary URL" :placeholder="defaultVocab"
                    density="compact" hide-details />
      <v-btn size="x-small" :disabled="!vocabUrl.trim()" @click="rebuild({ url: vocabUrl.trim() })">
        Load
      </v-btn>
    </div>

    <v-alert v-if="report && report.error" type="warning" variant="tonal" density="compact"
             class="mb-4 text-caption">
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
      <input ref="midiFile" type="file" accept=".mid,.midi,audio/midi" style="display: none"
             @change="openMidi" />
      <v-select
        v-model="midiBars"
        :items="[{ title: 'One bar each', value: 1 },
                 { title: 'Two bars each', value: 2 },
                 { title: 'Four bars each', value: 4 }]"
        label="Cut into"
        density="compact" hide-details
        style="max-width: 180px"
      />
    </div>
  </div>
</template>
