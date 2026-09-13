<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import ChordCanvas from './components/ChordCanvas.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import PhraseBook from './components/PhraseBook.vue'
import ProgressionBook from './components/ProgressionBook.vue'
import { state, initApp, armCapture, disarmCapture, panic, toggleInternalTransport, engine } from './store.js'

const idle = ref(false)
let idleTimer = null

onMounted(() => {
  initApp()
  window.addEventListener('mousemove', wake)
  window.addEventListener('keydown', wake)
  wake()
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', wake)
  window.removeEventListener('keydown', wake)
  clearTimeout(idleTimer)
})

function wake() {
  idle.value = false
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idle.value = true
  }, 2600)
}

const midiTone = computed(() => {
  if (state.midi.state === 'ready') return state.settings.midi.clockInputId ? 'success' : 'warning'
  if (state.midi.state === 'denied' || state.midi.state === 'unsupported') return 'error'
  return 'grey'
})

const midiHint = computed(() => {
  if (state.midi.state === 'unsupported') return 'Web MIDI is unavailable in this browser'
  if (state.midi.state === 'denied') return 'MIDI permission was refused — click to retry'
  if (!state.settings.midi.clockInputId) return 'No clock source bound — click to pick one'
  if (!state.settings.midi.chordOutputId) return 'No chord output bound — click to pick one'
  return `Clock in · ${portName(state.settings.midi.clockInputId)}`
})

function portName(id) {
  const port = [...state.midi.inputs, ...state.midi.outputs].find((candidate) => candidate.id === id)
  return port ? port.name : '—'
}

const noClockBound = computed(() => !state.settings.midi.clockInputId || state.midi.state !== 'ready')

const readoutColor = computed(() => state.settings.theme.fg)

function openMidi() {
  state.ui.settingsTab = 'midi'
  state.ui.settings = true
  if (state.midi.state === 'denied' || state.midi.state === 'idle') engine.enable()
}

function toggleArm() {
  if (state.ui.armed) disarmCapture()
  else armCapture()
}
</script>

<template>
  <v-app :style="{ background: state.settings.theme.bg }">
    <div class="jamin-root">
      <ChordCanvas />

      <div class="jamin-chrome" :class="{ 'is-idle': idle }">
        <v-btn
          v-if="noClockBound"
          :icon="state.status.internal ? 'mdi-stop' : 'mdi-play'"
          size="small"
          variant="text"
          :color="state.status.internal ? 'secondary' : undefined"
          title="Internal clock — only needed when no DAW is sending one"
          @click="toggleInternalTransport"
        />
        <v-btn
          icon="mdi-record-circle-outline"
          size="small"
          variant="text"
          :color="state.ui.armed ? 'error' : undefined"
          title="Mr. Accompany Me — capture a phrase over the next chord"
          @click="toggleArm"
        />
        <v-btn icon="mdi-book-music-outline" size="small" variant="text" title="Phrase book" @click="state.ui.phrases = true" />
        <v-btn icon="mdi-bookshelf" size="small" variant="text" title="Progression library" @click="state.ui.progressions = true" />
        <v-btn icon="mdi-cog-outline" size="small" variant="text" title="Settings" @click="state.ui.settings = true" />
        <v-btn icon="mdi-volume-off" size="small" variant="text" title="All notes off" @click="panic" />
        <v-tooltip :text="midiHint" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon size="small" variant="text" @click="openMidi">
              <v-icon :color="midiTone" size="14">mdi-circle</v-icon>
            </v-btn>
          </template>
        </v-tooltip>
      </div>

      <div
        v-if="state.settings.display.showReadout"
        class="jamin-readout"
        :class="{ 'is-idle': idle }"
        :style="{ color: readoutColor, opacity: idle ? 0.3 : 0.8 }"
      >
        <span><span class="label">bar </span>{{ state.status.bar }}<span class="label">.</span>{{ state.status.beat }}</span>
        <span><span class="label">bpm </span>{{ state.status.bpm }}</span>
        <span v-if="state.status.chord"><span class="label">now </span>{{ state.status.chord }}</span>
        <span v-if="state.status.chordName" style="opacity: 0.6">{{ state.status.chordName }}</span>
        <span v-if="state.status.phrase"><span class="label">phrase </span>{{ state.status.phrase }}</span>
        <span v-if="state.status.caretChord" style="opacity: 0.55"><span class="label">typing </span>{{ state.status.caretChord }}</span>
        <span v-if="state.ui.armed" style="color: #ff5470">● capturing</span>
        <span v-if="!state.status.running" class="label">stopped — waiting for the DAW</span>
      </div>

      <v-snackbar :model-value="!!state.ui.toast" location="bottom" :timeout="-1" color="surface">
        {{ state.ui.toast }}
      </v-snackbar>

      <SettingsDialog />
      <PhraseBook />
      <ProgressionBook />
    </div>
  </v-app>
</template>
