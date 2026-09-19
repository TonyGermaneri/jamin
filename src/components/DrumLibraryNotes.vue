<script setup>
/**
 * What one library's own notes mean, when no standard says.
 *
 * The kit dropdown next door answers "which numbering is this written in",
 * and for a library that answers it, that is the whole of the question. A
 * sampled library does not answer it. Superior Drummer's Latin percussion
 * puts its congas on 90 and 94 to 97, its cajon on 10 to 14, its timbales on
 * 17 to 23; General MIDI stops at 81 and starts at 35, no kit in the list
 * reads any of those, and there is no table anywhere that does -- they are
 * that library's own layout and nobody published it.
 *
 * jamin will not invent one. Those notes are 8% of that library and they
 * played as silence, and a guess at what they mean is a wrong drum played
 * confidently, which is worse. So this asks, and puts next to each question
 * everything that can be known without guessing: how much of the library the
 * note is, where in it the note lives, and -- where the library named the
 * folder after an instrument rather than after a groove -- what that folder
 * calls it.
 *
 * Per library, not per shelf. A shelf that disagrees with the rest of its
 * library about which *kit* it was written for already says so, and is
 * honoured; a note that means two different things in two shelves of one
 * library is beyond what this can express, and saying so is better than a
 * table nobody can reason about.
 *
 * @see core/drumKits.js learnInbound, store.js inboundFor
 */
import { computed, ref } from 'vue'
import { state, setDrumSetInbound, clearDrumSetInbound, tapDrum, kitMapFor } from '../store.js'
import { DRUM_VOICES, kitById, gmName, cleanInMap } from '../core/drumKits.js'
import InfoTip from './InfoTip.vue'

const props = defineProps({
  /** The library being taught, as it is stored. */
  set: { type: Object, required: true },
})

/** Name first, because that is what the question is about. */
const CHOICES = [
  { title: 'Leave it silent', value: '' },
  ...DRUM_VOICES.map((one) => ({ title: one.name, value: one.id })),
]

const showAll = ref(false)

const mine = computed(() => cleanInMap(props.set.inMap))
const learned = computed(() => props.set.inLearned || { hints: {}, where: {} })

/** What the kit alone reads, before this library's own corrections. */
const fromKit = computed(() => kitById(props.set.kit || 'gm').in || {})

/**
 * Every note this library plays that the kit cannot read, loudest first.
 *
 * Loudest, because that is the order somebody should spend their attention
 * in: on the Superior Drummer download note 24 is struck forty-five thousand
 * times and note 122 seven hundred, and answering the first is worth more
 * than answering thirty of the second. Notes already answered stay in the
 * list so an answer can be changed, and they are marked.
 */
const rows = computed(() => {
  const uses = (props.set.facts && props.set.facts.pitchUse) || null
  const pitches = (props.set.facts && props.set.facts.pitches) || []
  const struck = uses ? Object.values(uses).reduce((sum, n) => sum + n, 0) : 0

  const out = []
  for (const pitch of pitches) {
    if (fromKit.value[pitch] && !mine.value[pitch]) continue
    const hits = uses ? (uses[pitch] || 0) : 0
    out.push({
      note: pitch,
      hits,
      share: struck ? (100 * hits) / struck : 0,
      gm: gmName(pitch),
      voice: mine.value[pitch] || '',
      hint: learned.value.hints[pitch] || null,
      where: learned.value.where[pitch] || [],
    })
  }
  return out.sort((a, b) => b.hits - a.hits)
})

const shown = computed(() => (showAll.value ? rows.value : rows.value.slice(0, 24)))
const answered = computed(() => Object.keys(mine.value).length)

/** How much of the library is still going nowhere, as a share of the playing. */
const stillLost = computed(() => {
  const uses = (props.set.facts && props.set.facts.pitchUse) || null
  if (!uses) return null
  const struck = Object.values(uses).reduce((sum, n) => sum + n, 0)
  if (!struck) return null
  let missed = 0
  for (const [pitch, hits] of Object.entries(uses)) {
    const voice = mine.value[pitch] || fromKit.value[pitch]
    if (!voice || !Number.isInteger(kitMapFor()[voice])) missed += hits
  }
  return Math.round((100 * missed) / struck)
})

function nameOf(id) {
  const found = DRUM_VOICES.find((one) => one.id === id)
  return found ? found.name : ''
}

function choose(note, voice) {
  setDrumSetInbound(props.set.id, note, voice || '')
}

/** Hear it, on whatever drum that voice is currently sent to. */
function hear(voice) {
  const note = kitMapFor()[voice]
  if (Number.isInteger(note)) tapDrum(note)
}

/** Take every suggestion at once, for somebody who has read the column. */
async function takeHints() {
  for (const row of rows.value) {
    if (row.hint && !row.voice) {
      await setDrumSetInbound(props.set.id, row.note, row.hint.voice)
    }
  }
}

const hintsOffered = computed(() =>
  rows.value.filter((one) => one.hint && !one.voice).length)
</script>

<template>
  <div>
    <div class="text-body-2 mb-1">
      Notes in {{ set.name }} that {{ kitById(set.kit || 'gm').name }} cannot read
      <InfoTip>
        A sampled library lays its own articulations out on note numbers no standard
        defines — congas up at 94, a cajon down at 10 — and there is no published table
        for them, so jamin reads them as nothing rather than guessing at a drum. What
        is beside each note is everything that can be known without guessing: how much
        of this library it is, and the folders it lives in. Where a folder is named
        after an instrument rather than after a groove, that name is offered as a
        suggestion. It is a suggestion.
      </InfoTip>
    </div>

    <div class="text-caption text-medium-emphasis mb-3">
      <span v-if="answered">{{ answered }} answered</span>
      <span v-else>None answered yet</span>
      <span v-if="stillLost !== null"> · {{ stillLost }}% of this library still
        has nowhere to go</span>
    </div>

    <v-alert v-if="!rows.length" type="success" variant="tonal" density="compact">
      Every note this library plays has a voice.
    </v-alert>

    <template v-else>
      <v-table v-if="rows.length" density="compact" class="jamin-inbound">
        <thead>
          <tr>
            <th class="text-caption">Note</th>
            <th class="text-caption">How much of the library</th>
            <th class="text-caption">Where it is played</th>
            <th class="text-caption" style="min-width: 210px">Read it as</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in shown" :key="row.note">
            <td class="text-body-2" style="width: 120px">
              <strong>{{ row.note }}</strong>
              <!-- Only when the standard has a name for it, which for these
                   notes is nearly never -- they are outside its range. When
                   it does, that is worth more than anything below. -->
              <span v-if="row.gm && !row.gm.startsWith('note ')"
                    class="text-caption text-medium-emphasis d-block">{{ row.gm }}</span>
            </td>
            <td class="text-caption text-medium-emphasis" style="width: 150px">
              <span v-if="row.hits">
                {{ row.share < 0.1 ? '<0.1' : row.share.toFixed(1) }}%
                <span class="text-disabled">· {{ row.hits.toLocaleString() }} hits</span>
              </span>
            </td>
            <!-- The evidence, not an inference from it. The folders a note
                 is most played in are what somebody who knows the library
                 needs to recognise it, and they are a fact. -->
            <td class="text-caption text-medium-emphasis">
              <div v-for="place in row.where" :key="place.shelf" class="jamin-inbound-where">
                {{ place.shelf }}
                <span class="text-disabled">({{ place.share }}% of it)</span>
              </div>
              <span v-if="!row.where.length" class="text-disabled">—</span>
            </td>
            <td>
              <v-select
                :model-value="row.voice"
                :items="CHOICES"
                density="compact" hide-details variant="plain"
                @update:model-value="choose(row.note, $event)"
              />
            </td>
            <td style="width: 150px">
              <!-- The suggestion sits beside the answer rather than in it:
                   an interface that fills the box in has decided, and this
                   has not. One press accepts it. -->
              <v-btn
                v-if="row.hint && row.voice !== row.hint.voice"
                size="x-small" variant="tonal" class="text-none"
                :title="`${row.hint.share}% of the folders that name an instrument `
                  + `and are mostly this note call it that`
                  + (row.hint.against ? `; ${row.hint.against} other named something else` : '')"
                @click="choose(row.note, row.hint.voice)"
              >{{ nameOf(row.hint.voice) }}?</v-btn>
              <v-btn
                v-else-if="row.voice"
                icon size="x-small" variant="text"
                :aria-label="`Hear the ${nameOf(row.voice).toLowerCase()}`"
                @click="hear(row.voice)"
              ><v-icon size="16">mdi-play-circle-outline</v-icon></v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>

      <div class="d-flex align-center mt-3 ga-2">
        <v-btn v-if="rows.length > 24" size="small" variant="text" class="text-none"
               @click="showAll = !showAll">
          {{ showAll ? 'Show the loudest 24' : `Show all ${rows.length}` }}
        </v-btn>
        <v-spacer />
        <v-btn v-if="hintsOffered" size="small" variant="tonal" class="text-none"
               @click="takeHints">
          Accept {{ hintsOffered }} suggestion{{ hintsOffered === 1 ? '' : 's' }}
        </v-btn>
        <v-btn v-if="answered" size="small" variant="text" class="text-none"
               @click="clearDrumSetInbound(set.id)">
          Forget them all
        </v-btn>
      </div>
    </template>
  </div>
</template>
