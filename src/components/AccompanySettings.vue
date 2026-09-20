<script setup>
/**
 * What a phrase does when it plays — all of it, in one place.
 *
 * This was two places. The phrase book had a Playback tab and the control
 * panel had an Accompany tab, and they shared five controls between them:
 * "play phrases at all", the register, the snapping, the fit, and the live
 * mode — each drawn twice, worded differently each time, and one of them
 * carrying a hint pointing at the other copy. Which of the two you happened
 * to open decided which half of the answer you got.
 *
 * So the phrase book keeps the catalogue, which is what a book is, and
 * everything about how a phrase is *played* is here.
 *
 * @see components/SettingsDialog.vue, components/PhraseBook.vue
 */
import { computed } from 'vue'
import {
  state, setHolding, triggerAccent, catalogue,
} from '../store.js'
import InfoTip from './InfoTip.vue'

const accompany = computed(() => state.settings.accompany)

/** The phrase the accent is armed with, named so it can be recognised. */
const accent = computed(() =>
  catalogue().find((entry) => entry.id === state.accentPhrase) || null)

/** How long a heard chord runs before its phrase comes round again. */
const LIVE_BARS = [
  { title: 'one bar', value: 1 },
  { title: 'two bars', value: 2 },
  { title: 'four bars', value: 4 },
]

const SPEEDS = [
  { title: '1/16×', value: 0.0625 },
  { title: '1/8×', value: 0.125 },
  { title: '1/4×', value: 0.25 },
  { title: '1/3×', value: 0.3333 },
  { title: '1/2×', value: 0.5 },
  { title: '2/3×', value: 0.6667 },
  { title: '1× as played', value: 1 },
  { title: '1.5×', value: 1.5 },
  { title: '2×', value: 2 },
  { title: '3×', value: 3 },
  { title: '4×', value: 4 },
]

const FIT = [
  { title: 'Keep the rhythm, follow the chart', value: 'follow' },
  { title: 'Keep the rhythm, restart each chord', value: 'restart' },
  { title: 'Stretch to fit the chord', value: 'stretch' },
]
</script>

<template>
  <div>
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

    <!-- Listening. It used to wait for a chord to be written down and record
         what was played over it; now it hears what is played and answers it. -->
    <div class="mb-3">
      <div class="d-flex align-center">
        <v-switch v-model="accompany.listen" density="compact" hide-details
                  color="primary" label="Listen to what I play" />
        <InfoTip>
          Notes come in, the chord they make is named, and that chord is played back
          through a phrase — all while the keys are still down. Nothing is recorded and
          nothing is kept: what you hear is what is being held, and letting go ends it.
          <br /><br />
          The phrase it uses is the chart's own — whatever the chord under the playhead is
          playing — so it sounds like the song rather than like a second program. An armed
          accent beats that, as an accent beats everything.
          <br /><br />
          A chord is named whether or not the transport is rolling, but it can only be
          <em>played</em> while it is: a phrase is a rhythm, and a stopped transport has no
          time to lay one on.
        </InfoTip>
      </div>

      <div v-if="accompany.listen" class="ml-8">
        <v-radio-group v-model="accompany.liveMode" density="compact" hide-details
                       class="mb-2">
          <v-radio value="merge" label="Play over the chart" />
          <v-radio value="override" label="My chords replace the chart's" />
        </v-radio-group>
        <div class="text-caption text-medium-emphasis mb-2">
          <span v-if="accompany.liveMode === 'override'">
            While you are holding something the chart's harmony gives way. The drums and
            the pedal still follow the song — they follow the song, not your hands.
          </span>
          <span v-else>
            The chart plays its own chords and you play over the top, which is what a
            second player in the room is.
          </span>
        </div>
        <v-select v-model="accompany.liveBars" :items="LIVE_BARS" density="compact"
                  hide-details label="A held chord lasts" style="max-width: 260px" />
        <div class="text-caption text-medium-emphasis mt-1">
          A written chord knows how long it lasts because the bar says so. A held one lasts
          until your hands move, so it is given a length and comes round again.
        </div>

        <!-- Hold. The foot is the ordinary way to reach it, so the binding
             sits with the thing it holds rather than in a list of
             controllers somewhere else. -->
        <div class="d-flex align-center flex-wrap ga-2 mt-4">
          <v-btn
            size="small"
            :variant="state.ui.holding ? 'flat' : 'tonal'"
            :color="state.ui.holding ? 'primary' : undefined"
            class="text-none"
            @click="setHolding(!state.ui.holding)"
          >{{ state.ui.holding ? 'Holding — let go' : 'Hold the chord' }}</v-btn>
          <v-btn
            size="small"
            :variant="state.ui.learningHold ? 'flat' : 'text'"
            :color="state.ui.learningHold ? 'secondary' : undefined"
            class="text-none"
            @click="state.ui.learningHold = !state.ui.learningHold"
          >{{ state.ui.learningHold ? 'Move a control…' : 'Bind to MIDI' }}</v-btn>
          <span v-if="state.settings.midi.holdCc !== null" class="text-caption">
            CC {{ state.settings.midi.holdCc }}<span
              v-if="state.settings.midi.holdCc === 64"> — the sustain pedal</span>
            <v-btn size="x-small" variant="text" class="text-none"
                   @click="state.settings.midi.holdCc = null">clear</v-btn>
          </span>
        </div>
        <div class="text-caption text-medium-emphasis mt-1">
          Your hands can come off the chord and it goes on playing, so the other one is
          free. A new chord takes over and is held in its turn; letting go of Hold is what
          ends it. Lifting the pedal while the keys are still down does nothing — you have
          not stopped playing the chord.
        </div>
      </div>
    </div>

    <v-divider class="mb-3" />

    <v-row dense>
      <v-col cols="12" md="6">
        <v-select v-model="accompany.speed" :items="SPEEDS" label="Speed" />
        <div class="text-caption text-medium-emphasis mt-1 mb-4">
          How fast a phrase runs over the chords. At 1× it plays at the rate it was
          performed, whatever a chord's length.
        </div>
      </v-col>
      <v-col cols="12" md="6">
        <div class="text-caption mb-1">Octave — {{ accompany.octave }}</div>
        <v-slider v-model="accompany.octave" :min="1" :max="7" :step="1" />
        <div class="text-caption text-medium-emphasis mt-1 mb-4">
          Where a phrase sits when it is not following the register of the chord before it.
        </div>
      </v-col>

      <v-col cols="12">
        <v-divider class="mb-3" />
        <v-switch v-model="accompany.bass" label="Bass note — a held root under everything" />
        <div class="text-caption text-medium-emphasis mb-2">
          Held for the whole chord, under a phrase or a plain chord alike, and a slash
          chord puts its own note in the bass.
        </div>
      </v-col>
      <v-col cols="12" md="6">
        <div class="text-caption mb-1">
          {{ accompany.bassOctaves }} octave{{ accompany.bassOctaves === 1 ? '' : 's' }} down
        </div>
        <v-slider v-model="accompany.bassOctaves" :min="0" :max="3" :step="1"
                  :disabled="!accompany.bass" />
      </v-col>
      <v-col cols="12" md="6">
        <v-switch
          v-model="accompany.doubleBass"
          :disabled="!accompany.bass"
          label="Double bass — the same root an octave lower again"
        />
      </v-col>

      <v-col cols="12">
        <v-divider class="mb-3" />
        <div class="d-flex align-center">
          <v-switch v-model="accompany.pedal" label="Hold pedal for chord" hide-details />
          <InfoTip>
            Sustain (CC 64) goes down as each chord starts and lifts on the change, so a
            chord rings for its full length without smearing into the next one. It follows
            whatever is sounding — the chord channel, and the accompaniment channel when a
            phrase is playing.
            <br /><br />
            <code>[n.p]</code> and <code>[n.p.]</code> mean the same as <code>[np]</code>.
            A mark beats this switch from where it appears; this switch is what applies
            before the first one.
          </InfoTip>
        </div>
        <div class="text-caption text-medium-emphasis mb-2 mt-1">
          Or write <code>[p]</code> in the chart to hold it from there,
          <code>[np]</code> to lift it.
        </div>
      </v-col>

      <v-col cols="12">
        <v-divider class="my-3" />
        <div class="text-body-2 mb-1">Accent</div>
        <div class="text-caption text-medium-emphasis mb-2">
          <span v-if="accent"><strong>{{ accent.name }}</strong> — right-click any phrase
            in the phrase book to change it.</span>
          <span v-else>None yet. Right-click a phrase in the phrase book to choose one.</span>
          <InfoTip>
            It replaces the phrase on the next chord rather than playing over the top of
            it, and waits for the chord change to do it — so pressing this half a bar
            early means the same thing as pressing it a beat early. Press it again to
            cancel.
          </InfoTip>
        </div>
        <div class="d-flex align-center flex-wrap mb-2" style="gap: 8px">
          <v-btn size="small"
                 :prepend-icon="state.ui.accentArmed ? 'mdi-flash' : 'mdi-flash-outline'"
                 :color="state.ui.accentArmed ? 'warning' : undefined"
                 :disabled="!accent" @click="triggerAccent">
            {{ state.ui.accentArmed ? 'Armed — cancel' : 'Play it on the next chord' }}
          </v-btn>
          <v-btn
            size="small"
            :variant="state.ui.learningAccent ? 'flat' : 'text'"
            :color="state.ui.learningAccent ? 'secondary' : undefined"
            @click="state.ui.learningAccent = !state.ui.learningAccent"
          >
            {{ state.ui.learningAccent ? 'Move a control…' : 'Bind to MIDI' }}
          </v-btn>
          <span v-if="state.settings.midi.accentCc !== null" class="text-caption">
            CC {{ state.settings.midi.accentCc }}
            <v-btn size="x-small" variant="text"
                   @click="state.settings.midi.accentCc = null">clear</v-btn>
          </span>
        </div>
      </v-col>

      <v-col cols="12"><v-divider class="mb-3" /></v-col>

      <v-col cols="12" md="6">
        <v-switch v-model="accompany.enabled" label="Play phrases at all" />
        <v-switch
          v-model="accompany.perChordPhrases"
          label="Per-chord articulations"
          hint="Off: one phrase plays the whole song. On: bind different phrases to individual chords, marked with a dot."
          persistent-hint
        />
        <v-switch v-model="accompany.monitor"
                  label="Hear your keyboard through the accompaniment output" />
      </v-col>
      <v-col cols="12" md="6">
        <v-switch v-model="accompany.keepRegister"
                  label="Follow the register of the chord before" />
        <v-switch v-model="accompany.snapNonChordTones" label="Snap to chord notes" />
        <div class="text-caption text-medium-emphasis">
          Anything not in the chord moves to the nearest note that is. Off, a passing
          tone stays where the harmony put it, which is more faithful to the phrase and
          less certain to fit.
        </div>
      </v-col>

      <v-col cols="12" md="6">
        <v-select
          v-model="accompany.mode"
          :items="[{ title: 'Phrase replaces the chord', value: 'replace' },
                   { title: 'Phrase over the chord', value: 'layer' }]"
          label="When a phrase is bound"
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-select v-model="accompany.fit" :items="FIT"
                  label="When the phrase and the chord are different lengths" />
        <div class="text-caption text-medium-emphasis mt-1">
          Stretching changes the phrase's tempo; speed above is the deliberate way to do that.
        </div>
      </v-col>
    </v-row>
  </div>
</template>
