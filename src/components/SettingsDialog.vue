<script setup>
/**
 * Settings. Two things must be here and the rest is taste: which MIDI ports to
 * use, and how it looks.
 */
import { computed, ref, watch } from 'vue'
import InfoTip from './InfoTip.vue'
import { state, engine, applyTheme, resetSettings, applyPortBindings } from '../store.js'
import { THEMES, SHADER_DEFAULTS } from '../core/themes.js'
import { loadChordDictionary, searchChords } from '../core/chordDictionary.js'
import { pcName } from '../core/chordParser.js'

const showSecret = ref(false)
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

const quantizeOptions = [
  { title: 'Off', value: 0 },
  { title: '1/16', value: 6 },
  { title: '1/8', value: 12 },
  { title: '1/4', value: 24 },
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
        <v-tab value="accompany">Accompany</v-tab>
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
                <v-switch v-model="state.settings.display.fitLines" label="Scale each line to fill the width" />
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
                <v-select v-model="state.settings.accompany.quantize" :items="quantizeOptions" label="Quantize capture" />
              </v-col>
              <v-col cols="12" md="4">
                <v-select
                  v-model="state.settings.accompany.captureMode"
                  :items="[{ title: 'Capture one chord, then stop', value: 'once' }, { title: 'Keep capturing', value: 'continuous' }]"
                  label="Capture mode"
                />
              </v-col>
            </v-row>
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
