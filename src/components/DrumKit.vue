<script setup>
/**
 * Which note each drum comes out on.
 *
 * A fact about the instrument loaded on this track, which is why it is a
 * setting rather than a tab in the catalogue: nobody adjusts their note map
 * while choosing a groove, and everybody adjusts it once on the day the snare
 * turns out to be a cowbell.
 */
import { computed } from 'vue'
import { state, toast, tapDrum } from '../store.js'
import { DRUM_KITS, DRUM_VOICES, kitById, gmName, TD11_TO_VOICE } from '../core/drumKits.js'
import InfoTip from './InfoTip.vue'

const settings = computed(() => state.settings.drums)

const kit = computed({
  get: () => settings.value.kit,
  set: (id) => { settings.value.kit = id },
})
const chosenKit = computed(() => kitById(kit.value))

/** The drums struck since the last frame, so the table lights up in time. */
const playingVoices = computed(() => new Set(state.playing.voices))

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

/**
 * How much of the bundled corpus lands on each voice.
 *
 * Counted once from what is loaded. It is here because when a drum sounds
 * wrong, the first question is how much of the music goes through it -- the
 * hi-hat foot is 11.7% of every note in the corpus, so a wrong sample there is
 * heard constantly, and the crash at 0.7% is a curiosity.
 */
const voiceShares = computed(() => {
  const counts = new Map()
  let total = 0
  for (const groove of state.drums) {
    for (const note of groove.notes) {
      const voice = TD11_TO_VOICE[note.note]
      if (!voice) continue
      counts.set(voice, (counts.get(voice) || 0) + 1)
      total++
    }
  }
  return { counts, total }
})

function voiceShare(id) {
  const { counts, total } = voiceShares.value
  const hits = counts.get(id) || 0
  if (!hits || !total) return ''
  const share = (100 * hits) / total
  return `${share < 0.1 ? '<0.1' : share.toFixed(1)}%`
}

const overridden = computed(() => Object.keys(settings.value.customMap || {}).length)

function resetMap() {
  settings.value.customMap = {}
  toast(`Back to ${chosenKit.value.name}`)
}
</script>

<template>
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
        <th />
        <th class="text-caption">Voice</th>
        <th class="text-caption">How often</th>
        <th class="text-caption">Note</th>
        <th class="text-caption">General MIDI calls it</th>
        <th class="text-caption">{{ chosenKit.name }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="voice in DRUM_VOICES" :key="voice.id"
          :class="{ 'is-struck': playingVoices.has(voice.id) }">
        <td style="width: 34px">
          <!-- Hit it. A table of numbers cannot answer "what is
               actually on 42"; hitting it can, and it works with the
               transport stopped, which is when somebody is checking. -->
          <v-btn icon size="x-small" variant="text"
                 :aria-label="`Hear the ${voice.name.toLowerCase()}`"
                 @click="tapDrum(noteFor(voice.id))">
            <v-icon size="16">mdi-play-circle-outline</v-icon>
          </v-btn>
        </td>
        <td class="text-body-2">
          <v-icon size="12" class="jamin-kit-dot">mdi-circle</v-icon>
          {{ voice.name }}
        </td>
        <!-- How much of the corpus lands on this voice, because a
             wrong sample on a common one is a wrong record and a
             wrong sample on a rare one is a curiosity. The hi-hat
             foot is one note in eight, which is why it is the first
             place to look when something sounds wrong. -->
        <td class="text-caption text-medium-emphasis" style="width: 96px">
          <span v-if="voiceShare(voice.id)">{{ voiceShare(voice.id) }}</span>
        </td>
        <td style="width: 120px">
          <v-text-field
            :model-value="noteFor(voice.id)" type="number" min="0" max="127"
            density="compact" hide-details variant="plain"
            @update:model-value="setNote(voice.id, $event)"
          />
        </td>
        <!-- The name, not just the number. A mapping that sends the
             rimshot to "Electric Snare" is obviously wrong the moment
             the words are on screen and nearly impossible to notice
             from the numbers -- which is exactly how it shipped. -->
        <td class="text-caption text-medium-emphasis">{{ gmName(noteFor(voice.id)) }}</td>
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
</template>
