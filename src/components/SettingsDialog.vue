<script setup>
/**
 * Settings. Two things must be here and the rest is taste: which MIDI ports to
 * use, and how it looks.
 */
import { computed, ref, watch } from 'vue'
import InfoTip from './InfoTip.vue'
import DrumLibraries from './DrumLibraries.vue'
import PhraseSources from './PhraseSources.vue'
import ProgressionSources from './ProgressionSources.vue'
import DrumKit from './DrumKit.vue'
import { state, engine, applyTheme, resetSettings, applyPortBindings, forgetErrors, toast } from '../store.js'
import { THEMES, SHADER_DEFAULTS } from '../core/themes.js'
import { defaultSettings } from '../core/settings.js'
import { loadChordDictionary, searchChords } from '../core/chordDictionary.js'
import { pcName } from '../core/chordParser.js'

const showSecret = ref(false)

/** How long ago, in the units somebody actually thinks in. */
function whenWas(at) {
  const ago = Math.max(0, Date.now() - at)
  if (ago < 60000) return `${Math.round(ago / 1000)}s ago`
  if (ago < 3600000) return `${Math.round(ago / 60000)}m ago`
  return new Date(at).toLocaleTimeString()
}

/** The whole log as text, because the useful thing to do with an error is send
    it to somebody. */
async function copyErrors() {
  const text = state.errors.map((row) =>
    `${new Date(row.at).toISOString()} ${row.where}\n${row.message}`
    + (row.count > 1 ? ` (x${row.count})` : '')
    + (row.stack ? `\n${row.stack}` : '')).join('\n\n')
  try {
    await navigator.clipboard.writeText(text)
    toast(`${state.errors.length} error${state.errors.length === 1 ? '' : 's'} copied`)
  } catch {
    toast('The clipboard would not take it')
  }
}
const inputs = computed(() => [
  { title: 'None', value: '' },
  { title: 'Any input', value: '__any__' },
  ...state.midi.inputs.map((port) => ({ title: port.name, value: port.id })),
])

const outputs = computed(() => [
  { title: 'None', value: '' },
  ...state.midi.outputs.map((port) => ({ title: port.name, value: port.id })),
])

const channels = Array.from({ length: 16 }, (_, i) => ({ title: `Channel ${i + 1}`, value: i }))

const fonts = [
  '"IBM Plex Mono", "SF Mono", ui-monospace, monospace',
  'ui-monospace, "SF Mono", Menlo, monospace',
  '"Helvetica Neue", Inter, system-ui, sans-serif',
  '"Iowan Old Style", Georgia, "Times New Roman", serif',
  '"Futura", "Avenir Next", system-ui, sans-serif',
]

const search = ref('')
const results = ref([])

watch(search, async (query) => {
  if (!query || query.length < 2) {
    results.value = []
    return
  }
  await loadChordDictionary()
  results.value = searchChords(query, 40)
})

function formatSet(set) {
  return set.map((pc) => pcName(pc)).join(' ')
}

function resetShaders() {
  Object.assign(state.settings.shader, SHADER_DEFAULTS)
}

/** Which catalogue's loading is showing. @see the Libraries tab. */
const libraryTab = ref('progressions')

/** The map's own dials, which live under the graph settings. */
const map = computed(() => state.settings.graph.look)

function resetMap() {
  // From the defaults rather than from a second copy of them written here,
  // which is how two sets of defaults come to disagree.
  Object.assign(state.settings.graph.look, defaultSettings().graph.look)
}

async function retryMidi() {
  await engine.enable()
  state.midi.state = engine.state
  state.midi.error = engine.error
  applyPortBindings()
}
</script>

<template>
  <v-dialog v-model="state.ui.settings" max-width="820" scrollable class="jamin-settings">
    <v-card>
      <v-card-title class="d-flex align-center">
        <span class="text-body-1">Settings</span>
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="text" @click="state.ui.settings = false" />
      </v-card-title>

      <v-tabs v-model="state.ui.settingsTab" show-arrows>
        <v-tab value="midi">MIDI</v-tab>
        <v-tab value="transport">Transport</v-tab>
        <v-tab value="chords">Chords</v-tab>
        <v-tab value="display">Display</v-tab>
        <v-tab value="themes">Themes</v-tab>
        <v-tab value="shaders">Shaders</v-tab>
        <v-tab value="map">Map</v-tab>
        <v-tab value="accompany">Accompany</v-tab>
        <!-- Both were tabs in the drum book, which was four tabs of which one
             was a catalogue. Pointing at a folder and fixing a note map are
             things somebody does once and never while choosing a groove. -->
        <v-tab value="libraries">Libraries</v-tab>
        <v-tab value="kit">Kit</v-tab>
        <v-tab value="random">Dice</v-tab>
        <v-tab value="errors">
          Errors<span v-if="state.errors.length"> ({{ state.errors.length }})</span>
        </v-tab>
        <v-tab value="help">Notation</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="state.ui.settingsTab">
          <!-- MIDI ------------------------------------------------------- -->
          <v-window-item value="midi">
            <v-switch
              v-model="state.settings.network.enabled"
              density="compact"
              hide-details
              color="success"
              class="mb-2"
              label="Share this chart with other machines on the network"
            />
            <v-text-field
              v-model="state.settings.network.secret"
              label="Shared word"
              placeholder="pick one, and use the same on every machine"
              density="compact"
              hide-details
              class="mb-2"
              :append-inner-icon="showSecret ? 'mdi-eye-off' : 'mdi-eye'"
              :type="showSecret ? 'text' : 'password'"
              autocomplete="off"
              @click:append-inner="showSecret = !showSecret"
            />
            <div class="text-caption text-medium-emphasis mb-4">
              <strong v-if="!state.settings.network.secret" class="text-warning">
                No <em>machine</em> shares this until you choose a word.
                <InfoTip>
                  Instances inside one host always hold the same chart — they
                  share it through memory, with no port and nothing to configure,
                  so several tracks in this project are already in step. The word
                  is what lets another machine join them.
                </InfoTip>
              </strong>
              <template v-else>
                Every machine that knows this word holds the same chart. Open
                <code v-if="state.net.address">{{ state.net.address }}</code>
                <code v-else>http://&lt;this machine&gt;.local:7777</code>
                on a phone or a laptop and that is jamin too.
              </template>
              <InfoTip>
                Every machine running jamin here finds the others on its own — there is nothing to
                configure and no address to type. The word travels in the clear on your own
                network, so pick one you would say out loud rather than one you use anywhere else.
                Changing it takes effect next time the plugin loads.
              </InfoTip>
            </div>

            <v-switch
              v-model="state.settings.drums.enabled"
              density="compact" hide-details color="success" class="mb-1"
              label="Play the drums"
            />
            <v-switch
              v-model="state.settings.drums.fillOnEveryBoundary"
              :disabled="!state.settings.drums.enabled"
              density="compact" hide-details color="success" class="mb-2"
              label="A fill into every section change"
            />
            <div class="text-caption text-medium-emphasis mb-4">
              Write <code>[d:nofill]</code> in a section to stop just that one.
            </div>

            <!-- Taking one drum out of the whole song, which the piano roll's
                 keys do. The same musical act as muting a track and quantised
                 for the same reason. -->
            <v-select
              v-model="state.settings.drums.muteQuantize"
              :items="[
                { title: 'On the next bar', value: 'bar' },
                { title: 'On the next beat', value: 'beat' },
                { title: 'Instantly', value: 'instant' },
              ]"
              label="Silencing a drum takes effect"
              density="compact"
              hide-details
              class="mb-2"
            />
            <div class="text-caption text-medium-emphasis mb-4">
              Click a drum's name in the drum book's piano roll to take it out of the song.
              <InfoTip>
                It applies to every part that plays, not to one pattern: taking the hi-hat out
                means out. It lands on a bar line by default, which is where a drummer drops it
                rather than wherever the mouse was — and each drum is a parameter the DAW can
                automate, so the hat can come out for a chorus and back afterwards.
              </InfoTip>
            </div>

            <v-select
              v-if="state.host.active"
              v-model="state.settings.instances.quantize"
              :items="[
                { title: 'On the next bar', value: 'bar' },
                { title: 'On the next beat', value: 'beat' },
                { title: 'Instantly', value: 'instant' },
              ]"
              label="Mute and solo take effect"
              density="compact"
              hide-details
              class="mb-2"
            />
            <div v-if="state.host.active" class="text-caption text-medium-emphasis mb-4">
              Muting a track in the phrase book stops its notes, not its audio.
              <InfoTip>
                A DAW mutes audio, after the notes have been played. This decides whether the notes
                happen at all, which is a different musical act and one the mixer cannot perform.
                It lands on a bar line by default, so a part stops where a musician would stop it
                rather than wherever the mouse was. Solo silences every other instance in this
                project without touching their own mute switches, so letting it go puts the session
                back exactly as it was.
              </InfoTip>
            </div>

            <v-alert
              v-if="state.net.state === 'refused'"
              type="error" variant="tonal" density="compact" class="mb-4"
            >
              That word was refused. Every machine sharing a chart has to use the same one.
            </v-alert>

            <v-alert
              v-if="state.net.state !== 'offline' && state.net.state !== 'refused'"
              :type="state.net.peers.length ? 'success' : 'info'"
              variant="tonal" density="compact" class="mb-4"
            >
              <div class="text-caption font-weight-medium mb-1">
                Sharing this chart
                <span v-if="state.net.state === 'joining'">— looking for the others…</span>
              </div>
              <div v-if="!state.net.peers.length" class="text-caption">
                Nobody else is here yet.
                <InfoTip>
                  Any machine running jamin on this network will find this one on its own; there
                  is nothing to configure and no address to type. Every machine has to be using
                  the same word.
                </InfoTip>
              </div>
              <table v-else class="text-caption jamin-hostinfo">
                <tr v-for="peer in state.net.peers" :key="peer.id">
                  <td>{{ peer.name || 'a machine' }}</td>
                  <td><a :href="`http://${peer.host}:${peer.port}/`" target="_blank"
                         rel="noreferrer">{{ peer.host }}:{{ peer.port }}</a></td>
                </tr>
              </table>
              <div class="text-caption mt-2 text-medium-emphasis">
                Anyone on this network who knows the word can edit the chart.
              </div>
            </v-alert>

            <template v-if="state.host.active">
              <v-alert type="success" variant="tonal" density="compact" class="mb-3">
                Running as a plugin — nothing here to bind.
                <InfoTip>
                  The host supplies the transport and takes the notes, so the port and channel
                  settings on this tab are the browser build's. What the host is saying is below.
                </InfoTip>
              </v-alert>

              <!-- What the host is actually saying. Every question that starts
                   "it doesn't seem to see the transport" is answered here. -->
              <v-alert
                :type="state.host.messages === 0 ? 'warning' : 'info'"
                variant="tonal" density="compact" class="mb-4"
              >
                <div class="text-caption font-weight-medium mb-1">What the host is saying</div>
                <table class="text-caption jamin-hostinfo">
                  <tr><td>reports received</td><td>{{ state.host.messages.toLocaleString() }}</td></tr>
                  <tr><td>playhead</td><td>{{ state.host.hasPlayhead ? 'yes' : 'no' }}</td></tr>
                  <tr><td>transport</td><td>{{ state.status.running ? 'rolling' : 'stopped' }}</td></tr>
                  <tr><td>position</td><td>{{ state.host.ppq }} ♩ — bar {{ state.status.bar }}.{{ state.status.beat }}</td></tr>
                  <tr><td>tempo</td><td>{{ state.status.bpm }} bpm</td></tr>
                  <tr>
                    <td>compiled</td>
                    <td v-if="state.host.compileError" class="text-error">{{ state.host.compileError }}</td>
                    <td v-else-if="state.host.events < 0">not yet</td>
                    <td v-else>{{ state.host.events.toLocaleString() }} notes</td>
                  </tr>
                  <tr><td>shared chart</td><td>{{ state.host.shared ? 'connected' : 'this process only' }}</td></tr>
                  <tr><td>instance</td><td class="text-truncate" style="max-width: 15rem">{{ state.host.instanceId || '—' }}</td></tr>
                </table>
                <div v-if="state.host.messages === 0" class="text-caption mt-2">
                  Nothing has arrived from the host yet. Reports are only sent while this window is
                  open and only when something changes, so press play and watch this count.
                </div>
              </v-alert>
            </template>

            <v-alert
              v-if="!state.host.active && state.midi.state !== 'ready'"
              :type="state.midi.state === 'requesting' ? 'info' : 'warning'"
              variant="tonal"
              density="compact"
              class="mb-4"
            >
              {{ state.midi.error || 'Waiting for MIDI permission…' }}
              <template #append>
                <v-btn size="x-small" @click="retryMidi">Retry</v-btn>
              </template>
            </v-alert>

            <div class="text-caption text-medium-emphasis mb-3">
              Bind a clock source and a chord output and you are done. Everything else —
              tempo, transport, song position — comes from the DAW.
            </div>

            <v-row dense>
              <v-col cols="12" md="6">
                <v-select v-model="state.settings.midi.clockInputId" :items="inputs" label="Clock in (from the DAW)" />
                <div v-if="!state.settings.midi.clockInputId && state.settings.transport.autoDetectClock" class="text-caption text-medium-emphasis mt-1">
                  Listening on every input — whichever one sends clock gets picked.
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="state.settings.midi.accompInputId" :items="inputs" label="Accompaniment in (your keyboard)" />
              </v-col>

              <v-col cols="12" md="8">
                <v-select v-model="state.settings.midi.chordOutputId" :items="outputs" label="Chord out" />
              </v-col>
              <v-col cols="12" md="4">
                <v-select v-model="state.settings.midi.chordChannel" :items="channels" label="Chord channel" />
              </v-col>

              <v-col cols="12" md="8">
                <v-select v-model="state.settings.midi.bassOutputId" :items="outputs" label="Bass out (blank = chord out)" />
              </v-col>
              <v-col cols="12" md="4">
                <v-select v-model="state.settings.midi.bassChannel" :items="channels" label="Bass channel" />
              </v-col>

              <v-col cols="12" md="8">
                <v-select v-model="state.settings.midi.accompOutputId" :items="outputs" label="Accompaniment out (blank = chord out)" />
              </v-col>
              <v-col cols="12" md="4">
                <v-select v-model="state.settings.midi.accompChannel" :items="channels" label="Accompaniment channel" />
              </v-col>

              <v-col cols="12" md="8">
                <v-select v-model="state.settings.midi.drumOutputId" :items="outputs" label="Drum out (blank = chord out)" />
              </v-col>
              <v-col cols="12" md="4">
                <v-select v-model="state.settings.midi.drumChannel" :items="channels" label="Drum channel" />
              </v-col>
              <v-col cols="12">
                <div class="text-caption text-medium-emphasis mb-3">
                  Channel 10 unless you have a reason — it is where every drum machine since 1991
                  listens.
                  <InfoTip>
                    Drums are the one part of jamin that is played exactly as it was recorded: a
                    drum note is an instrument rather than a pitch, so nothing about a groove is
                    transposed or voice-led. What does happen is a translation from the kit the
                    corpus was played on to the kit you have loaded, which is the Kit tab of the
                    drum book.
                  </InfoTip>
                </div>
              </v-col>

              <v-col cols="12">
                <div class="text-caption mb-1">Velocity — {{ state.settings.midi.velocity }}</div>
                <v-slider v-model="state.settings.midi.velocity" :min="1" :max="127" :step="1" />
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Transport -------------------------------------------------- -->
          <v-window-item value="transport">
            <div class="text-caption text-medium-emphasis mb-3">
              MIDI clock carries tempo, start/stop and song position — but not time
              signature, which no DAW can send over standard MIDI. Set the bar length here
              once and forget it.
            </div>
            <v-row dense>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Beats per bar — {{ state.settings.transport.beatsPerBar }}</div>
                <v-slider v-model="state.settings.transport.beatsPerBar" :min="1" :max="12" :step="1" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">
                  Timing offset — {{ state.settings.transport.latencyPulses }} pulses
                  ({{ (state.settings.transport.latencyPulses / 24).toFixed(2) }} beats)
                </div>
                <v-slider v-model="state.settings.transport.latencyPulses" :min="-24" :max="24" :step="1" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch v-model="state.settings.transport.loop" label="Loop the chart when the song runs past it" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch v-model="state.settings.transport.autoStartOnClock" label="Start on incoming clock, even without a Start message" />
                <v-switch v-model="state.settings.transport.autoDetectClock" label="Find the clock source automatically" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Internal clock tempo — {{ state.settings.transport.internalTempo }} bpm</div>
                <v-slider v-model="state.settings.transport.internalTempo" :min="40" :max="260" :step="1" />
                <div class="text-caption text-medium-emphasis">Only used when no clock source is bound.</div>
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Chords ----------------------------------------------------- -->
          <v-window-item value="chords">
            <v-row dense>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Chord octave — {{ state.settings.chords.octave }}</div>
                <v-slider v-model="state.settings.chords.octave" :min="1" :max="7" :step="1" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Maximum voices — {{ state.settings.chords.maxVoices }}</div>
                <v-slider v-model="state.settings.chords.maxVoices" :min="2" :max="8" :step="1" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Range — {{ state.settings.chords.rangeLow }} to {{ state.settings.chords.rangeHigh }}</div>
                <v-range-slider
                  :model-value="[state.settings.chords.rangeLow, state.settings.chords.rangeHigh]"
                  :min="24"
                  :max="108"
                  :step="1"
                  density="compact"
                  hide-details
                  @update:model-value="(v) => { state.settings.chords.rangeLow = v[0]; state.settings.chords.rangeHigh = v[1] }"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch v-model="state.settings.chords.smartVoicing" label="Voice-lead between chords" />
                <v-switch v-model="state.settings.chords.mergeRepeats" label="A chord repeated is one long chord, not two attacks" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch v-model="state.settings.chords.omitThirdOnDominant11" label="Drop the 3rd from a dominant 11" />
                <v-switch v-model="state.settings.chords.omitElevenOnThirteen" label="Drop the natural 11 from a 13" />
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Display ---------------------------------------------------- -->
          <v-window-item value="display">
            <v-row dense>
              <!-- A catalogue as the words in it rather than as a list of it.
                   Per catalogue, because they are not the same problem. -->
              <v-col cols="12">
                <div class="text-caption mb-1 d-flex align-center">
                  Browse as a graph
                  <InfoTip>
                    Draws the catalogue as the words its clips are described by — genres, feels,
                    instruments, whatever the names actually say — joined by how often they turn
                    up together. Picking a word searches for it, so the list and the detail beside
                    it carry on working as they do now.
                    <br /><br />
                    Arrow keys walk the relationships rather than the rows: ← and → along what a
                    word is related to, ↓ to follow one, ↑ to come back. That is the thing a graph
                    does that a list cannot, and the thing a mouse does badly.
                    <br /><br />
                    A list is simply the right answer sometimes, which is why this is per
                    catalogue and off by default.
                  </InfoTip>
                </div>
                <div class="d-flex flex-wrap" style="gap: 18px">
                  <v-switch v-model="state.settings.graph.phrases" density="compact" hide-details
                            color="primary" label="Articulations" />
                  <v-switch v-model="state.settings.graph.drums" density="compact" hide-details
                            color="primary" label="Drums" />
                  <v-switch v-model="state.settings.graph.progressions" density="compact" hide-details
                            color="primary" label="Progressions" />
                </div>
              </v-col>
              <v-col cols="12">
                <v-select v-model="state.settings.display.font" :items="fonts" label="Font" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Smallest size — {{ state.settings.display.minFontSize }}px</div>
                <v-slider v-model="state.settings.display.minFontSize" :min="8" :max="60" :step="1" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Largest size — {{ state.settings.display.maxFontSize }}px</div>
                <v-slider v-model="state.settings.display.maxFontSize" :min="40" :max="400" :step="2" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Line spacing — {{ state.settings.display.lineHeight.toFixed(2) }}</div>
                <v-slider v-model="state.settings.display.lineHeight" :min="0.9" :max="2" :step="0.01" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Edge padding — {{ state.settings.display.padding }}px</div>
                <v-slider v-model="state.settings.display.padding" :min="0" :max="120" :step="2" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">Idle chord dimming — {{ state.settings.display.dimInactive.toFixed(2) }}</div>
                <v-slider v-model="state.settings.display.dimInactive" :min="0.1" :max="1" :step="0.01" />
              </v-col>
              <v-col cols="12" md="6">
                <div class="d-flex align-center">
                  <v-switch v-model="state.settings.display.dynamicLineSize" density="compact"
                            hide-details label="Dynamic line size" />
                  <InfoTip>
                    Off, every line is drawn at one size — whatever the longest line needs to fit
                    the width — so the chart reads as an even column of text and a short bar does
                    not shout.
                    <br /><br />
                    On, each line is scaled on its own to fill the width: a bar of four chords is
                    small and a single chord fills the screen. Every line uses all the room there
                    is, which is worth having when a chart is a few sparse bars and legibility
                    matters more than evenness.
                  </InfoTip>
                </div>
                <v-switch v-model="state.settings.display.showReadout" label="Show the bar/tempo readout" />
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Themes ----------------------------------------------------- -->
          <v-window-item value="themes">
            <v-row dense>
              <v-col v-for="theme in THEMES" :key="theme.id" cols="6" md="3">
                <div
                  class="jamin-theme-swatch"
                  :class="{ 'is-active': state.settings.theme.id === theme.id }"
                  :style="{ color: theme.accent }"
                  @click="applyTheme(theme.id)"
                >
                  <div class="jamin-swatch-bar" :style="{ background: theme.bg }">
                    <div style="flex: 1" :style="{ background: theme.accent }" />
                    <div style="flex: 1" :style="{ background: theme.accentAlt }" />
                    <div style="flex: 2" :style="{ background: theme.bg }" />
                  </div>
                  <div
                    class="pa-2 text-caption"
                    :style="{ background: theme.bg, color: theme.fg, fontFamily: theme.font }"
                  >
                    {{ theme.name }}
                  </div>
                </div>
              </v-col>
            </v-row>

            <v-divider class="my-4" />
            <div class="text-caption text-medium-emphasis mb-2">Or mix your own</div>
            <v-row dense>
              <v-col v-for="key in ['bg', 'fg', 'dim', 'accent', 'accentAlt', 'error']" :key="key" cols="6" md="2">
                <v-text-field v-model="state.settings.theme[key]" :label="key" type="color" />
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Shaders ---------------------------------------------------- -->
          <v-window-item value="shaders">
            <v-switch v-model="state.settings.shader.enabled" label="Effects on" class="mb-2" />
            <v-row dense>
              <v-col
                v-for="knob in [
                  ['intensity', 'Overall intensity', 0, 2],
                  ['bloom', 'Halo on the playing chord', 0, 2],
                  ['preRoll', 'Charge under the next chord', 0, 2],
                  ['trail', 'Embers off the last chord', 0, 2],
                  ['warp', 'Heat shimmer', 0, 1],
                  ['chroma', 'Colour fringing', 0, 1],
                  ['scan', 'Scanlines', 0, 1],
                  ['grain', 'Film grain', 0, 1],
                  ['pulse', 'Background breathing', 0, 2],
                  ['speed', 'Animation speed', 0, 3],
                  ['hue', 'Accent hue shift', 0, 1],
                ]"
                :key="knob[0]"
                cols="12"
                md="6"
              >
                <div class="text-caption mb-1">{{ knob[1] }} — {{ state.settings.shader[knob[0]].toFixed(2) }}</div>
                <v-slider
                  v-model="state.settings.shader[knob[0]]"
                  :min="knob[2]"
                  :max="knob[3]"
                  :step="0.01"
                  :disabled="!state.settings.shader.enabled"
                />
              </v-col>
            </v-row>
            <v-btn size="small" class="mt-2" @click="resetShaders">Reset effects</v-btn>
          </v-window-item>

          <!-- Map ------------------------------------------------------- -->
          <v-window-item value="map">
            <div class="text-caption text-medium-emphasis mb-3">
              The catalogue as a map. What makes a tree of nine nodes readable is not what
              makes one of nine hundred thousand readable, so these are here rather than
              decided for you.
              <InfoTip>
                Every colour comes from the theme — the map is drawn on the arc between the
                theme's two accents, one shade per branch, so a far-flung node says which
                family it belongs to without a legend. Change the theme and the map changes
                with it.
              </InfoTip>
            </div>

            <v-row dense>
              <v-col cols="12" md="6">
                <v-select
                  v-model="map.unfold"
                  :items="[
                    { title: 'Ring — children open out steadily', value: 'ring' },
                    { title: 'Burst — they fly clear of the parent', value: 'burst' },
                    { title: 'Spiral — they fan out by order', value: 'spiral' },
                  ]"
                  label="Opening a node" density="compact" hide-details class="mb-3"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="map.nodeInfo"
                  :items="[
                    { title: 'Name and how much is in it', value: 'count' },
                    { title: 'Name only', value: 'name' },
                    { title: 'Nothing', value: 'none' },
                  ]"
                  label="Over each node" density="compact" hide-details class="mb-3"
                />
              </v-col>

              <v-col
                v-for="knob in [
                  ['nodeSize', 'Node size', 0.3, 2.5],
                  ['edgeWidth', 'Edge width', 0.1, 4],
                  ['bloom', 'Glow', 0, 1.5],
                  ['trail', 'Trails', 0, 0.9],
                  ['speed', 'How fast it settles', 0.2, 3],
                  ['repel', 'How hard nodes push apart', 0.1, 3],
                  ['reach', 'How far a branch reaches', 0.2, 3],
                  ['families', 'Colours in the palette', 2, 12],
                ]"
                :key="knob[0]" cols="12" md="6"
              >
                <div class="text-caption mb-1">
                  {{ knob[1] }} — {{ Number(map[knob[0]]).toFixed(knob[0] === 'families' ? 0 : 2) }}
                </div>
                <v-slider
                  v-model="map[knob[0]]" :min="knob[2]" :max="knob[3]"
                  :step="knob[0] === 'families' ? 1 : 0.01" hide-details
                />
              </v-col>

              <v-col cols="12">
                <v-switch v-model="state.settings.graph.labels" density="compact" hide-details
                          color="primary" label="Names over the nodes" />
                <v-switch v-model="map.follow" density="compact" hide-details color="primary"
                          label="Move the camera to whatever is opened" />
                <div class="text-caption text-medium-emphasis">
                  Off by default: you clicked it where you could see it, and taking the view
                  somewhere else loses your place.
                </div>
              </v-col>

              <v-col cols="12" md="6">
                <div class="text-caption mb-1">
                  Most names at once — {{ state.settings.graph.mostLabels }}
                </div>
                <v-slider v-model="state.settings.graph.mostLabels" :min="20" :max="400"
                          :step="10" hide-details />
              </v-col>
            </v-row>

            <v-btn size="small" class="mt-3" @click="resetMap">Back to the defaults</v-btn>
          </v-window-item>

          <!-- Accompany -------------------------------------------------- -->
          <v-window-item value="accompany">
            <div class="text-caption text-medium-emphasis mb-3">
              Mr. Accompany Me — play one chord's worth of music and it becomes a phrase that
              plays over the whole song.
              <InfoTip>
                Bind your keyboard as the accompaniment input, arm the red button, and play one
                chord's worth of music. The phrase lands in the phrase book; choose it and it
                plays over the whole song, re-pointed at each chord by voice leading. Turn on
                per-chord articulations below if you want different phrases on different chords.
              </InfoTip>
            </div>
            <v-row dense>
              <v-col cols="12" md="6">
                <v-switch v-model="state.settings.accompany.enabled" label="Play bound phrases" />
                <v-switch
                  v-model="state.settings.accompany.perChordPhrases"
                  label="Per-chord articulations"
                  hint="Off: one phrase plays the whole song. On: bind different phrases to individual chords, marked with a dot."
                  persistent-hint
                />
                <v-switch v-model="state.settings.accompany.monitor" label="Hear your keyboard through the accompaniment output" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch v-model="state.settings.accompany.keepRegister" label="Keep phrases in the register they were played" />
                <v-switch v-model="state.settings.accompany.snapNonChordTones" label="Snap passing notes onto the new chord" />
              </v-col>
              <v-col cols="12" md="4">
                <v-select
                  v-model="state.settings.accompany.mode"
                  :items="[{ title: 'Phrase replaces the chord', value: 'replace' }, { title: 'Phrase over the chord', value: 'layer' }]"
                  label="When a phrase is bound"
                />
              </v-col>
              <v-col cols="12" md="4">
                <v-select
                  v-model="state.settings.accompany.fit"
                  :items="[
                    { title: 'Keep the rhythm, follow the chart', value: 'follow' },
                    { title: 'Keep the rhythm, restart each chord', value: 'restart' },
                    { title: 'Stretch to fit the chord', value: 'stretch' },
                  ]"
                  label="When the phrase and the chord are different lengths"
                  hint="Stretching changes the tempo of the phrase: a bar of phrase in half a bar of chord plays twice as fast."
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" md="4">
                <!-- Mr. Accompany Me listens rather than records, so the two
                     controls that shaped a recording have nothing to shape. It
                     lives on the phrase book's Playback tab, next to the rest of
                     what a phrase does. -->
                <v-select
                  v-model="state.settings.accompany.liveMode"
                  :items="[{ title: 'Play over the chart', value: 'merge' },
                           { title: 'My chords replace the chart\'s', value: 'override' }]"
                  label="When I play along"
                  :disabled="!state.settings.accompany.listen"
                  hint="Turn listening on in the phrase book, under Playback."
                  persistent-hint
                />
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Libraries: somebody's own MIDI, read from where it lives ---- -->
          <v-window-item value="libraries">
            <!--
              All three catalogues, loaded from one place.

              Pointing jamin at a collection is a thing somebody does once
              and then not again for a month, and it used to be in three
              different windows behind three differently named tabs --
              "Sources" in the phrase book, "Import / export" in the
              progression library, "Libraries" here. One question with three
              answers depending on which window happened to be open.
            -->
            <v-tabs v-model="libraryTab" density="compact" class="mb-4">
              <v-tab value="progressions">Progressions</v-tab>
              <v-tab value="phrases">Articulations</v-tab>
              <v-tab value="drums">
                Drum patterns<span v-if="state.drumSets.length">
                  ({{ state.drumSets.length }})</span>
              </v-tab>
            </v-tabs>

            <v-window v-model="libraryTab">
              <v-window-item value="progressions"><ProgressionSources /></v-window-item>
              <v-window-item value="phrases"><PhraseSources /></v-window-item>
              <v-window-item value="drums"><DrumLibraries /></v-window-item>
            </v-window>
          </v-window-item>

          <!-- Kit: where the drums actually are --------------------------- -->
          <v-window-item value="kit">
            <DrumKit />
          </v-window-item>

          <!-- Dice: what the random buttons draw on --------------------- -->
          <v-window-item value="random">
            <div class="text-caption text-medium-emphasis mb-4">
              What the dice draw on. The right answer depends on the collection — somebody with
              one drum library wants the die to use it, somebody with fifty wants it to stay in
              a genre.
            </div>

            <v-switch
              v-model="state.settings.random.matchGenre"
              density="compact" hide-details color="primary"
              label="Keep the changes in the drums' genre"
            />
            <div class="text-caption text-medium-emphasis mb-3">
              Rolling each part separately gives a bossa nova progression under a metal beat.
              Nothing tagged in that genre is not a refusal — most progressions carry no tag at
              all, and a song with the right drums and untagged changes is still a song.
            </div>

            <v-switch
              v-model="state.settings.random.matchEra"
              density="compact" hide-details color="primary"
              label="Keep every section in one era"
            />
            <div class="text-caption text-medium-emphasis mb-3">
              Whichever decade the first groove belongs to, the rest follow where there are
              enough of them — which is a thing no amount of choosing at random will do.
            </div>

            <v-switch
              v-model="state.settings.random.phrasePerSection"
              density="compact" hide-details color="primary"
              label="A different articulation for every section"
            />
            <div class="text-caption text-medium-emphasis mb-4">
              Off gives the whole song one feel, which is what a great many records actually do.
            </div>

            <v-slider
              v-model="state.settings.random.mostSections"
              :min="1" :max="8" :step="1" thumb-label
              label="Sections at most" density="compact" hide-details class="mb-4"
            />

            <v-slider
              v-model="state.settings.random.leastPerGenre"
              :min="1" :max="40" :step="1" thumb-label
              label="Grooves a genre needs before the die will pick it"
              density="compact" hide-details class="mb-2"
            />
            <div class="text-caption text-medium-emphasis mb-4">
              One groove in a genre makes a song where every section is the same bar.
            </div>
          </v-window-item>

          <!-- Errors: what went wrong, because there is no console ------- -->
          <v-window-item value="errors">
            <div class="text-caption text-medium-emphasis mb-3 d-flex align-center">
              <span>
                Everything the page has thrown, rejected or logged — newest first.
              </span>
              <InfoTip>
                Inside a plugin there is no console to open, so a page that throws looks exactly
                like a page that decided not to do anything. That is how eight ReferenceErrors
                shipped, each of them a button that did nothing and said nothing.
                <br /><br />
                This catches what was thrown and never handled, promises nobody caught, anything
                logged as an error, and what jamin noticed about itself. The same fault repeated
                is one line with a count rather than two hundred lines.
              </InfoTip>
              <v-spacer />
              <v-btn v-if="state.errors.length" size="x-small" variant="text"
                     @click="copyErrors">Copy</v-btn>
              <v-btn v-if="state.errors.length" size="x-small" variant="text"
                     @click="forgetErrors()">Clear</v-btn>
            </div>

            <div v-if="!state.errors.length" class="text-caption text-medium-emphasis pa-4">
              Nothing has gone wrong since this window opened.
            </div>

            <v-expansion-panels v-else variant="accordion" class="jamin-error-log">
              <v-expansion-panel v-for="(row, at) in state.errors" :key="at">
                <v-expansion-panel-title class="text-caption py-1">
                  <span class="text-error text-truncate">{{ row.message }}</span>
                  <v-spacer />
                  <v-chip v-if="row.count > 1" size="x-small" variant="tonal" class="mr-2">
                    ×{{ row.count }}
                  </v-chip>
                  <span class="text-medium-emphasis">{{ whenWas(row.at) }}</span>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div class="text-caption text-medium-emphasis mb-1">{{ row.where }}</div>
                  <pre v-if="row.stack" class="jamin-mono text-caption"
                       style="white-space: pre-wrap; opacity: .8">{{ row.stack }}</pre>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-window-item>


          <!-- Notation --------------------------------------------------- -->
          <v-window-item value="help">
            <div class="jamin-mono text-caption">
              <p class="mb-2">
                <strong>With bar lines</strong> it reads like any fake book or lead sheet:
                <code>| Dm7 G7 | Cmaj7 | % |</code>. A bar is what sits between the lines, and
                chords inside it divide it — two chords means the change lands halfway.
                <code>/</code> holds the chord before it for a beat, so <code>| C / Am / |</code>
                is two beats each. <code>%</code> repeats the bar before, <code>x</code> the two before.
              </p>
              <p class="mb-2">
                <strong>Without bar lines</strong> you get a quicker shorthand where a space is a
                bar: <code>C F G</code> is three bars, <code>C C F</code> is two bars of C then F,
                and a comma splits a bar — <code>F,F- C</code>. Whichever you use, the whole chart
                reads that way; typing a bar line anywhere switches it.
              </p>
              <p class="mb-2">
                <strong>Repeats.</strong> <code>|: Am7 | Bbmaj7 :|16</code> plays that section
                sixteen times. Without bar lines the same thing is
                <code>:Am7 Am7 Bbmaj7 Bbmaj7:16</code>. A bare <code>:|</code> means twice.
              </p>
              <p class="mb-2"><strong>Labels.</strong> <code>[Verse 1]</code> is for the reader and takes no time.</p>
              <p class="mb-2"><strong>Quality.</strong> <code>A- Am Ami Amin Aminor</code> are the same. So are <code>A AM Ama Amaj Amajor</code>. Also <code>dim ° o</code>, <code>ø halfdim</code>, <code>aug +</code>, <code>alt</code>. Suspensions say what they mean: <code>sus</code> is sus4, <code>sus2</code> is sus2, <code>sus4</code> is sus4.</p>
              <p class="mb-2"><strong>Accidentals.</strong> Sharps may be <code>#</code>, <code>♯</code> or <code>s</code>; flats <code>b</code> or <code>♭</code>. So <code>Fs7</code> is F♯7 and <code>As5</code> is A♯ with no third. The one catch is <code>sus</code>: <code>Fsus4</code> is F suspended, and F♯sus4 is <code>F#sus4</code> or <code>Fssus4</code>.</p>
              <p class="mb-2"><strong>Harte notation</strong> is understood as well: <code>C:maj7</code>, <code>C:min7</code>, <code>C:hdim7</code>, <code>C:sus4(b7)</code>, and degree basses like <code>C:maj/5</code>. In Harte form, parentheses add a degree — <code>C:maj(9)</code> is a triad plus a ninth, not a major ninth.</p>
              <p class="mb-2"><strong>Nothing at all.</strong> <code>N</code>, <code>NC</code> or <code>N.C.</code> is a bar with no chord in it. It still takes up its time.</p>
              <p class="mb-2"><strong>Numbers.</strong> <code>C5</code> is the triad without the 3rd, <code>C3</code> without the 5th. Anything above 5 stacks diatonically: <code>C7 C9 C11 C13</code>. Colour: <code>C7b9 C7#11 C6/9 Cadd9 Cmaj7</code>.</p>
              <p class="mb-2"><strong>Inversions.</strong> A roman numeral suffix: <code>Di</code> 1st, <code>Dii</code> 2nd, <code>C7iii</code> 3rd. (<code>Cmi</code> stays C minor; write <code>C-i</code> for the inversion.)</p>
              <p class="mb-2"><strong>Slash bass.</strong> <code>C/E</code>. Accidentals belong to the root, so <code>Bb5</code> is a B-flat power chord — write <code>B(b5)</code> for a flat fifth.</p>
              <p class="mb-2"><strong>Phrases.</strong> A dot marks a phrase change: <code>.C7{walkup}</code> binds a phrase from that chord until the next dotted chord.</p>
            </div>

            <v-divider class="my-4" />
            <v-text-field v-model="search" label="Search the chord dictionary" prepend-inner-icon="mdi-magnify" />
            <div class="text-caption text-medium-emphasis mt-1 mb-2">
              ~2000 named pitch-class sets from ChordDictionary/SetTheory.
            </div>
            <v-list density="compact" max-height="220" class="overflow-y-auto">
              <v-list-item v-for="(item, index) in results" :key="index" :title="item.name" :subtitle="formatSet(item.set)" />
            </v-list>
          </v-window-item>
        </v-window>
      </v-card-text>

      <v-card-actions>
        <v-btn size="small" variant="text" @click="resetSettings">Reset everything</v-btn>
        <v-spacer />
        <v-btn size="small" @click="state.ui.settings = false">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* The host readout is a two-column table of facts; the labels stay quiet and
   the values line up, so a glance is enough to see which one is wrong. */
.jamin-hostinfo td:first-child {
  opacity: 0.7;
  padding-right: 1.25rem;
  white-space: nowrap;
}
</style>
