<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import ChordCanvas from './components/ChordCanvas.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import PhraseBook from './components/PhraseBook.vue'
import ProgressionBook from './components/ProgressionBook.vue'
import DrumBook from './components/DrumBook.vue'
import {
  state,
  initApp,
  panic,
  toggleInternalTransport,
  transposeSong,
  triggerAccent,
  accentPhrase,
  engine,
  toast,
  openDrumBook,
  rollSong,
} from './store.js'
import { SAMPLE_CHART } from './core/settings.js'

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
  if (state.host.active) return 'success'
  if (state.midi.state === 'ready') return state.settings.midi.clockInputId ? 'success' : 'warning'
  if (state.midi.state === 'denied' || state.midi.state === 'unsupported') return 'error'
  return 'grey'
})

const midiHint = computed(() => {
  if (state.host.active) return 'Following the host — its transport, its tempo, its playhead'
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

const noClockBound = computed(
  () => !state.host.active && (!state.settings.midi.clockInputId || state.midi.state !== 'ready'),
)

const accent = computed(() => (state.accentPhrase ? accentPhrase() : null))
const accentTitle = computed(() => {
  if (!accent.value) return 'Accent — right-click a phrase in the catalogue to choose one'
  const cc = state.settings.midi.accentCc
  const binding = cc === null ? '' : ` (CC ${cc})`
  if (state.ui.accentArmed) return `Armed: ${accent.value.name} plays on the next chord — click to cancel`
  return `Accent: ${accent.value.name} — plays instead of the next chord's phrase${binding}`
})

/*
 * Who else has this chart.
 *
 * The count is machines, not people -- a machine with three browsers open is
 * one machine -- because that is what discovery knows and claiming otherwise
 * would be inventing a number.
 */
const netIcon = computed(() => {
  if (state.net.state === 'joining') return 'mdi-lan-pending'
  return state.net.peers.length ? 'mdi-lan-connect' : 'mdi-lan-disconnect'
})

const netColour = computed(() => {
  if (state.net.state === 'joining') return 'warning'
  return state.net.peers.length ? 'success' : undefined
})

const netTitle = computed(() => {
  if (state.net.state === 'joining') return 'Looking for the other machines…'
  if (!state.net.peers.length) return 'Sharing this chart — nobody else is here yet'
  const names = state.net.peers.map((peer) => peer.name || peer.host).join(', ')
  return `Sharing this chart with ${state.net.peers.length} other machine${state.net.peers.length === 1 ? '' : 's'}: ${names}`
})

const readoutColor = computed(() => state.settings.theme.fg)

function openMidi() {
  state.ui.settingsTab = 'midi'
  state.ui.settings = true
  if (!state.host.active && (state.midi.state === 'denied' || state.midi.state === 'idle')) engine.enable()
}

/**
 * A whole song, at once.
 *
 * It replaces the chart, which is not a small thing to do by accident, so a
 * chart with anything in it is asked about first. An empty one is not: there is
 * nothing to lose and being asked would be pointless ceremony.
 */
function rollWholeSong() {
  const written = state.text.trim()
  if (written && written !== SAMPLE_CHART.trim()) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Roll a new song? This replaces what is in the notepad.')) return
  }
  rollSong()
}

/** Mr. Accompany Me on or off: hearing what is played and answering it. */
function toggleListen() {
  const accompany = state.settings.accompany
  accompany.listen = !accompany.listen
  toast(accompany.listen
    ? `Listening — ${accompany.liveMode === 'override' ? 'your chords win' : 'over the chart'}`
    : 'Not listening')
}
</script>

<template>
  <v-app :style="{ background: state.settings.theme.bg }">
    <div class="jamin-root">
      <ChordCanvas />

      <div class="jamin-chrome" :class="{ 'is-idle': idle }">
        <!-- A whole song, at once. First in the row because it is where you
             start from nothing, and everything else here adjusts what it made. -->
        <v-btn
          icon="mdi-dice-5-outline"
          size="small"
          variant="text"
          color="secondary"
          title="Roll a whole song — changes, sections, articulations and drums"
          @click="rollWholeSong"
        />
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
          icon="mdi-music-accidental-flat"
          size="small"
          variant="text"
          title="Transpose the whole chart down a semitone"
          @click="transposeSong(-1)"
        />
        <v-btn
          icon="mdi-music-accidental-sharp"
          size="small"
          variant="text"
          title="Transpose the whole chart up a semitone"
          @click="transposeSong(1)"
        />
        <v-btn
          :icon="state.ui.accentArmed ? 'mdi-flash' : 'mdi-flash-outline'"
          size="small"
          variant="text"
          :color="state.ui.accentArmed ? 'warning' : accent ? 'secondary' : undefined"
          :title="accentTitle"
          @click="triggerAccent"
        />
        <v-btn
          icon="mdi-ear-hearing"
          size="small"
          variant="text"
          :color="state.settings.accompany.listen ? 'primary' : undefined"
          title="Mr. Accompany Me — hear what you play and answer it"
          @click="toggleListen"
        />
        <!-- Only when there is a network to be on. A chart shared with nobody
             should not carry an indicator saying so. -->
        <v-btn
          v-if="state.net.state !== 'offline'"
          :icon="netIcon"
          size="small"
          variant="text"
          :color="netColour"
          :title="netTitle"
          @click="state.ui.settingsTab = 'midi'; state.ui.settings = true"
        />
        <!-- Follow the song. In the toolbar rather than the settings because it
             is turned on and off while playing, not configured once. -->
        <v-btn
          :icon="state.settings.display.autoScroll ? 'mdi-crosshairs-gps' : 'mdi-crosshairs'"
          :color="state.settings.display.autoScroll ? 'primary' : undefined"
          size="small" variant="text"
          :title="state.settings.display.autoScroll ? 'Following the song' : 'Follow the song'"
          @click="state.settings.display.autoScroll = !state.settings.display.autoScroll"
        />
        <v-btn icon="mdi-book-music-outline" size="small" variant="text" title="Phrase book" @click="state.ui.phrases = true" />
        <v-btn icon="mdi-bookshelf" size="small" variant="text" title="Progression library" @click="state.ui.progressions = true" />
        <v-btn icon="mdi-circle-multiple-outline" size="small" variant="text" title="Drum book"
               @click="openDrumBook" />
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
        <span v-if="state.status.key">
          <span class="label">key </span>{{ state.status.key.name }}<span
            v-if="state.status.key.confidence < 0.25"
            class="label"
          >?</span>
        </span>
        <span v-if="state.status.chord"><span class="label">now </span>{{ state.status.chord }}</span>
        <span v-if="state.status.chordName" style="opacity: 0.6">{{ state.status.chordName }}</span>
        <span v-if="state.status.phrase"><span class="label">phrase </span>{{ state.status.phrase }}</span>
        <span v-else-if="state.songPhrase"><span class="label">phrase </span>{{ state.songPhrase }}</span>
        <span v-if="state.status.caretChord" style="opacity: 0.55"><span class="label">typing </span>{{ state.status.caretChord }}</span>
        <span v-if="state.heard.name" style="color: #4ec9b0">
          <span class="label">hearing </span>{{ state.heard.name }}
        </span>
        <span v-else-if="state.settings.accompany.listen" class="label">listening</span>
        <span v-if="!state.status.running" class="label">stopped — waiting for the DAW</span>
      </div>

      <v-snackbar :model-value="!!state.ui.toast" location="bottom" :timeout="-1" color="surface">
        {{ state.ui.toast }}
      </v-snackbar>

      <SettingsDialog />
      <PhraseBook />
      <ProgressionBook />
    <DrumBook />
    </div>
  </v-app>
</template>
