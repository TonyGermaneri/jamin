<script setup>
/**
 * Which note each drum goes out on.
 *
 * The far end of the only translation jamin does. Every library is read into
 * forty named voices on the way in -- kick, snare, side stick, high conga --
 * because a note number means whatever the kit it was recorded on says it
 * means, and two libraries rarely agree. Nothing downstream ever sees those
 * names: this table turns each one back into a note, and it is the only place
 * a note leaves.
 *
 * Which makes this a fact about the instrument loaded on this track, and it is
 * a setting rather than a tab in the catalogue because nobody adjusts their
 * note map while choosing a groove and everybody adjusts it once, on the day
 * the snare turns out to be a cowbell.
 *
 * What it cannot do is know what is on the other end. A plugin's layout is not
 * readable over a MIDI cable, so the built-in kits send General MIDI -- the one
 * layout anything can be assumed to take -- and anyone who can see their own
 * mapping window corrects the table and keeps it. @see store.js saveMyKit
 */
import { computed, ref } from 'vue'
import {
  state, toast, tapDrum, kitFor, everyKit, saveMyKit, deleteMyKit,
} from '../store.js'
import { DRUM_VOICES, gmName, TD11_TO_VOICE, sameAsGeneralMidi } from '../core/drumKits.js'
import InfoTip from './InfoTip.vue'

const settings = computed(() => state.settings.drums)

const kit = computed({
  get: () => settings.value.kit,
  set: (id) => { settings.value.kit = id },
})
const chosenKit = computed(() => kitFor(kit.value))
const kitItems = computed(() => everyKit().map((one) => ({
  title: one.mine ? `${one.name} — yours` : one.name, value: one.id,
})))

/*
 * Whether choosing this kit changed anything at all.
 *
 * Four of the six built-in kits send exactly General MIDI, which is the
 * right answer for all four and looks like a broken dropdown: you pick your
 * sampler by name, every number stays where it was, and nothing tells you
 * that is correct rather than ignored.
 */
const plainGm = computed(() => !chosenKit.value.mine && sameAsGeneralMidi(chosenKit.value))

const naming = ref(false)
const newName = ref('')

function keepIt() {
  if (saveMyKit(newName.value)) { newName.value = ''; naming.value = false }
}

/**
 * The layout as something to work from at the other end.
 *
 * Programming a sampler to receive this means sitting in front of its
 * mapping window typing forty numbers, and reading them off a screen
 * behind the DAW is how the tambourine ends up on the cowbell. Tab
 * separated, so it pastes into anything.
 *
 * What is sent, not what the kit says: if a note has been changed here,
 * the changed one is the one the instrument has to be set to.
 */
function copyLayout() {
  const rows = DRUM_VOICES
    .filter((one) => !silent(one.id))
    .map((one) => [one.name, noteFor(one.id), gmName(noteFor(one.id))].join('\t'))
  const missing = DRUM_VOICES.filter((one) => silent(one.id))
  const text = [
    `${chosenKit.value.name} — what jamin sends`,
    'Voice\tNote\tGeneral MIDI name',
    ...rows,
    ...(missing.length
      ? ['', `Not on this kit: ${missing.map((one) => one.name).join(', ')}`]
      : []),
  ].join('\n')

  navigator.clipboard?.writeText(text).then(
    () => toast(`${rows.length} voices copied`),
    () => toast('Could not reach the clipboard'))
}

/** The drums struck since the last frame, so the table lights up in time. */
const playingVoices = computed(() => new Set(state.playing.voices))

/** What a voice will actually play: the kit, unless it has been overridden. */
function noteFor(voice) {
  const custom = settings.value.customMap || {}
  return custom[voice] ?? chosenKit.value.map[voice]
}

/**
 * Whether this kit has anywhere at all to send this drum.
 *
 * Addictive Drums 2 has no congas and no note that would make one, and
 * its own layout uses the General MIDI percussion numbers for real kit
 * pieces -- 63 is a ride choke -- so sending a conga there is a ride choke
 * in the middle of the bar rather than a guess that might land. Those
 * voices are left unmapped and the note is dropped, which is what a kit
 * with no congas sounds like. @see core/drumKits.js
 */
function silent(voice) {
  return !Number.isInteger(noteFor(voice))
}

/** How much of a real collection a kit with no percussion leaves behind. */
const dropped = computed(() =>
  DRUM_VOICES.filter((one) => one.percussion && silent(one.id)).length)

/**
 * What the instrument calls the note this voice is going to.
 *
 * The point of having words beside the numbers is to catch a mapping that
 * is plausible and wrong: a rimshot sent to "Electric Snare" is obvious in
 * words and invisible in numbers. Which vocabulary is the right one to say
 * it in depends on the kit. On a General MIDI kit, General MIDI's. On a kit
 * with a layout of its own, its own -- naming AD2's note 71 "Short Whistle"
 * because that is what General MIDI puts there was the column inventing
 * mistakes rather than finding them.
 *
 * Empty where nothing can be said honestly, which is a kit with its own
 * layout on a note it has no name for -- including any note typed in here.
 */
function callsIt(voice) {
  const note = noteFor(voice)
  if (!Number.isInteger(note)) return ''
  const own = chosenKit.value.calls
  if (own) return own[note] || ''
  return plainGm.value ? gmName(note) : ''
}

/** Whose vocabulary the column beside the number is speaking. @see callsIt */
const callsHeader = computed(() => (chosenKit.value.calls || !plainGm.value
  ? `${chosenKit.value.name} calls it` : 'General MIDI calls it'))

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
  <div class="text-caption text-medium-emphasis mb-3">
    Which note each drum goes out on — the instrument loaded on this track, not the
    libraries coming in.
    <InfoTip>
      A note number means whatever the kit it was recorded on says it means, and two
      libraries rarely agree: 48 is a high tom on a Roland pad and a hi-mid tom in
      General MIDI, 58 is a floor tom rim on one and a vibraslap on the other. So
      nothing is ever sent as it was recorded. Every clip is read into
      {{ DRUM_VOICES.length }} named voices on the way in — kick, snare, side stick,
      high conga — and this table turns each name back into a note on the way out.
      <br /><br />
      It is the only place a note leaves, so if a drum is silent or wrong, it is
      fixed here.
    </InfoTip>
  </div>

  <div class="d-flex align-center ga-2 mb-2">
    <v-select
      v-model="kit" :items="kitItems"
      label="Kit" density="compact" hide-details
    />
    <v-btn v-if="chosenKit.mine" size="small" variant="text" class="text-none flex-shrink-0"
           @click="deleteMyKit(kit)">Forget it</v-btn>
  </div>

  <div class="text-caption text-medium-emphasis mb-4">
    <!--
      Said out loud, because otherwise it reads as a dropdown that does
      nothing. Four of the six built-in kits send exactly General MIDI --
      which is the right answer for all four, and indistinguishable from
      being ignored unless somebody says so. First, because it is the
      important half; the kit's own note is whatever is particular to it.
    -->
    <div v-if="plainGm">
      These are the General MIDI numbers, unchanged. jamin cannot read the layout of a
      plugin over a MIDI cable, so it sends the one layout anything can be assumed to
      take — if yours is laid out differently, correct the notes below and keep it.
    </div>
    <div v-if="chosenKit.notes" :class="{ 'mt-1': plainGm }">{{ chosenKit.notes }}</div>
    <!--
      What a kit with no percussion costs, in the one unit that matters.
      Counted over the whole 774,268-file collection: 14.6% of every note
      played is General MIDI percussion. A kit that cannot play any of it
      is a kit that drops a seventh of the music, and that is worth
      knowing before wondering where the tambourine went.
    -->
    <div v-if="dropped" class="mt-1">
      {{ dropped }} percussion voices have nowhere to go on this kit, so those notes are
      dropped rather than sent to something else. On a real collection that is about a
      seventh of every note played — point a spare slot at one below if your kit has one.
    </div>
  </div>

  <v-table density="compact">
    <thead>
      <tr>
        <th />
        <th class="text-caption">Voice</th>
        <!-- Of the corpus that ships, and it has to say so: on a machine
             with an imported library of three quarters of a million clips
             this column is about eleven hundred of them. -->
        <th class="text-caption">
          In the built-in corpus
          <InfoTip>
            How much of jamin's own bundled corpus lands on each voice, counted once.
            It is here because when a drum sounds wrong the first question is how much
            of the music goes through it — the hi-hat foot is one note in eight, so a
            wrong sample there is heard constantly and a wrong crash is a curiosity.
            <br /><br />
            It says nothing about a library you imported. Counting those means reading
            every row of the catalogue, which on a real collection is a wait for a
            number nobody asked for.
          </InfoTip>
        </th>
        <th class="text-caption">Note</th>
        <th class="text-caption">{{ callsHeader }}</th>
        <!-- What the kit says, against what is being sent. They differ only
             where somebody has typed a number in, and that is the whole
             reason the column is here. -->
        <th class="text-caption">Kit default</th>
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
            :placeholder="silent(voice.id) ? 'not on this kit' : ''"
            @update:model-value="setNote(voice.id, $event)"
          />
        </td>
        <!-- The name, not just the number. A mapping that sends the
             rimshot to "Electric Snare" is obviously wrong the moment
             the words are on screen and nearly impossible to notice
             from the numbers -- which is exactly how it shipped. -->
        <td class="text-caption text-medium-emphasis">{{ callsIt(voice.id) }}</td>
        <td class="text-caption text-medium-emphasis">
          <span v-if="Number.isInteger(chosenKit.map[voice.id])">
            {{ chosenKit.map[voice.id] }}
          </span>
          <span v-else class="text-disabled">—</span>
          <span v-if="noteFor(voice.id) !== chosenKit.map[voice.id]" class="text-warning">
            — changed
          </span>
        </td>
      </tr>
    </tbody>
  </v-table>

  <div class="d-flex align-center flex-wrap ga-2 mt-3">
    <span class="text-caption text-medium-emphasis">
      <span v-if="overridden">{{ overridden }} voice{{ overridden === 1 ? '' : 's' }} changed from {{ chosenKit.name }}</span>
      <span v-else>Unchanged from {{ chosenKit.name }}</span>
    </span>
    <v-spacer />
    <v-btn v-if="overridden" size="small" variant="text" class="text-none" @click="resetMap">
      Back to {{ chosenKit.name }}
    </v-btn>
    <!--
      And kept, which is the only honest answer to not being able to read
      the instrument. jamin cannot see the layout; the person looking at
      their sampler's mapping window can, and this is where that goes so it
      survives the kit dropdown moving. @see store.js saveMyKit
    -->
    <v-btn size="small" variant="text" class="text-none"
           @click="copyLayout">Copy the layout</v-btn>
    <v-btn size="small" variant="tonal" class="text-none"
           @click="naming = !naming">Save as my own kit</v-btn>
  </div>

  <div v-if="naming" class="d-flex align-center ga-2 mt-2">
    <v-text-field v-model="newName" label="Call it" density="compact" hide-details
                  placeholder="Addictive Drums 2, as mine is set up"
                  @keyup.enter="keepIt" />
    <v-btn size="small" class="text-none" :disabled="!newName.trim()" @click="keepIt">Keep</v-btn>
  </div>
  <div v-if="naming" class="text-caption text-medium-emphasis mt-1">
    The whole table as it stands, not only what you changed — a saved kit is an answer
    about an instrument, and “General MIDI except for three” stops being true the moment
    the kit under it changes.
  </div>
</template>
