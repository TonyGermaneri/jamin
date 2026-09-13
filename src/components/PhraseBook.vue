<script setup>
/**
 * The phrase book.
 *
 * One catalogue, not a catalogue and a library: a phrase you captured and a
 * phrase that shipped are the same kind of thing. Nothing is filtered by the
 * chord you are on, because every phrase fits every chord -- they are stored as
 * degrees and re-pointed at whatever they land on -- and nothing is truncated,
 * because a list you cannot reach the end of is not a list.
 */
import { computed, ref, watch } from 'vue'
import {
  state,
  keepCapture,
  deletePhrase,
  renamePhrase,
  usePhrase,
  bindPhrase,
  armCapture,
  currentToken,
  toast,
  ensureLicks as rebuildLicks,
  defaultVocabularyUrl,
  importMidiPhrases,
  visibleLicks,
  catalogue,
} from '../store.js'
import { summarize } from '../core/phrases.js'
import { describeLick } from '../core/licks.js'

const search = ref('')
const name = ref('')
const renaming = ref(null)
const renameTo = ref('')
const vocabUrl = ref('')
const vocabFile = ref(null)
const midiFile = ref(null)
const midiBars = ref(1)

const accompany = computed(() => state.settings.accompany)
const report = computed(() => state.lickReport)
const defaultVocab = computed(() => defaultVocabularyUrl())
const target = computed(() => currentToken())
const perChord = computed(() => accompany.value.perChordPhrases)
const playing = computed(() => state.songPhrase)

const list = computed(() => (state.licks.length || state.phrases.length ? visibleLicks(search.value) : []))
const total = computed(() => catalogue().length)

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

watch(
  () => [state.ui.phrases, state.ui.phrasesTab],
  ([open, tab]) => {
    if (open && (tab === 'catalogue' || tab === 'sources')) rebuildLicks()
  },
  { immediate: true }
)

watch(
  () => state.pendingCapture,
  (capture) => {
    name.value = capture ? `${capture.sourceChord}-lick` : ''
  }
)

function keepAndUse() {
  const phrase = keepCapture(name.value)
  if (!phrase) return
  usePhrase(phrase)
  state.ui.phrasesTab = 'catalogue'
}

function commitRename(entry) {
  if (renaming.value !== entry.id) return
  const next = renamePhrase(entry.name, renameTo.value)
  if (next) toast(`Renamed to ${next}`)
  renaming.value = null
}

async function rebuild(options) {
  await rebuildLicks(options)
  const r = state.lickReport
  if (r && !r.error) toast(`${r.total + (r.parts || 0)} in the catalogue`)
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
  state.ui.phrasesTab = 'catalogue'
}

/** A small piano roll, so a phrase is recognisable without playing it. */
function roll(phrase, width = 120, height = 34) {
  const notes = phrase.notes
  if (!notes || !notes.length) return []
  const length = phrase.lengthPulses || Math.max(...notes.map((n) => n.at + n.duration)) || 1
  const low = Math.min(...notes.map((n) => n.note))
  const high = Math.max(...notes.map((n) => n.note))
  const span = Math.max(6, high - low + 1)
  return notes.map((note) => ({
    x: (note.at / length) * width,
    w: Math.max(2, (note.duration / length) * width),
    y: height - ((note.note - low + 1) / span) * height,
    h: Math.max(2, height / span - 1),
    o: 0.35 + (note.velocity / 127) * 0.65,
  }))
}

const describe = (entry) => (entry.notes ? describeLick(entry) : summarize(entry))
</script>

<template>
  <v-dialog v-model="state.ui.phrases" max-width="880" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon size="18" class="mr-2">mdi-book-music-outline</v-icon>
        <span class="text-body-1">Phrase book</span>
        <v-spacer />
        <span v-if="playing" class="text-caption text-medium-emphasis mr-3">playing “{{ playing }}”</span>
        <v-btn icon="mdi-close" size="small" variant="text" @click="state.ui.phrases = false" />
      </v-card-title>

      <v-tabs v-model="state.ui.phrasesTab">
        <v-tab value="catalogue">Catalogue ({{ total }})</v-tab>
        <v-tab value="captured">Just played</v-tab>
        <v-tab value="playback">Playback</v-tab>
        <v-tab value="sources">Sources</v-tab>
        <v-tab value="about">How it works</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="state.ui.phrasesTab">
          <!-- Catalogue --------------------------------------------------- -->
          <v-window-item value="catalogue">
            <v-row dense class="mb-2">
              <v-col cols="12" md="8">
                <v-text-field v-model="search" label="Search" prepend-inner-icon="mdi-magnify" clearable />
              </v-col>
              <v-col cols="12" md="4">
                <v-select
                  v-model="state.ui.lickTexture"
                  :items="[
                    { title: 'Any texture', value: 'any' },
                    { title: 'Two hands', value: 'hands' },
                    { title: 'Single line', value: 'line' },
                  ]"
                  label="Texture"
                />
              </v-col>
            </v-row>

            <div v-if="state.licksLoading && !list.length" class="text-center py-8 text-caption text-medium-emphasis">
              Loading the catalogue…
            </div>
            <div v-else-if="!list.length" class="text-center py-8 text-caption text-medium-emphasis">
              Nothing matches “{{ search }}”.
            </div>

            <v-virtual-scroll v-else :items="list" :item-height="62" height="380">
              <template #default="{ item }">
                <div class="d-flex align-center py-1" style="gap: 12px">
                  <svg :width="120" :height="34" style="flex: none; background: rgba(255,255,255,0.04); border-radius: 4px">
                    <rect
                      v-for="(note, index) in roll(item)"
                      :key="index"
                      :x="note.x"
                      :y="note.y"
                      :width="note.w"
                      :height="note.h"
                      :opacity="note.o"
                      fill="currentColor"
                      rx="1"
                    />
                  </svg>

                  <div style="flex: 1; min-width: 0">
                    <div v-if="renaming !== item.id" class="text-body-2 text-truncate">{{ item.name }}</div>
                    <v-text-field
                      v-else
                      v-model="renameTo"
                      density="compact"
                      autofocus
                      @keydown.enter="commitRename(item)"
                      @blur="commitRename(item)"
                    />
                    <div class="text-caption text-medium-emphasis text-truncate">{{ describe(item) }}</div>
                  </div>

                  <v-btn
                    size="x-small"
                    :variant="playing === item.id ? 'flat' : 'tonal'"
                    :color="playing === item.id ? 'primary' : undefined"
                    @click="usePhrase(item)"
                  >
                    {{ playing === item.id ? 'Playing' : 'Use' }}
                  </v-btn>
                  <v-btn
                    v-if="!item.builtin"
                    icon="mdi-rename-outline"
                    size="x-small"
                    variant="text"
                    @click="renaming = item.id; renameTo = item.name"
                  />
                  <v-btn
                    v-if="!item.builtin"
                    icon="mdi-delete-outline"
                    size="x-small"
                    variant="text"
                    @click="deletePhrase(item.name)"
                  />
                </div>
              </template>
            </v-virtual-scroll>

            <div class="d-flex align-center flex-wrap mt-3" style="gap: 10px">
              <v-btn size="small" variant="text" :disabled="!playing" @click="bindPhrase(null)">Play no phrase</v-btn>
              <span class="text-caption text-medium-emphasis">
                {{ list.length }} shown of {{ total }}.
                <span v-if="perChord">Using one binds it to {{ target ? target.body : 'the chord at the cursor' }}.</span>
                <span v-else>Using one plays it over the whole song.</span>
              </span>
            </div>
          </v-window-item>

          <!-- Just played ------------------------------------------------- -->
          <v-window-item value="captured">
            <div v-if="!state.pendingCapture" class="text-center py-8">
              <v-icon size="42" class="mb-3" color="grey">mdi-piano</v-icon>
              <div class="text-body-2 mb-1">Nothing captured yet.</div>
              <div class="text-caption text-medium-emphasis mb-4">
                Arm capture, then play over one chord while the DAW is running.
              </div>
              <v-btn size="small" :color="state.ui.armed ? 'error' : 'primary'" @click="armCapture">
                {{ state.ui.armed ? 'Armed — play something' : 'Arm capture' }}
              </v-btn>
            </div>

            <div v-else>
              <div class="text-caption text-medium-emphasis mb-2">{{ summarize(state.pendingCapture) }}</div>
              <svg :width="260" :height="54" class="mb-3" style="background: rgba(255,255,255,0.04); border-radius: 6px">
                <rect
                  v-for="(note, index) in roll(state.pendingCapture, 260, 54)"
                  :key="index"
                  :x="note.x"
                  :y="note.y"
                  :width="note.w"
                  :height="note.h"
                  :opacity="note.o"
                  fill="currentColor"
                  rx="1"
                />
              </svg>
              <v-text-field v-model="name" label="Name" class="mb-3" />
              <div class="d-flex flex-wrap" style="gap: 8px">
                <v-btn size="small" color="primary" @click="keepAndUse">Use</v-btn>
                <v-btn size="small" variant="text" @click="state.pendingCapture = null">Discard</v-btn>
              </div>
              <div class="text-caption text-medium-emphasis mt-3">
                It joins the catalogue either way once used, and behaves like anything else in it.
              </div>
            </div>
          </v-window-item>

          <!-- Playback ---------------------------------------------------- -->
          <v-window-item value="playback">
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
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-caption mb-1">
                  {{ accompany.bassOctaves }} octave{{ accompany.bassOctaves === 1 ? '' : 's' }} down
                </div>
                <v-slider v-model="accompany.bassOctaves" :min="0" :max="3" :step="1" :disabled="!accompany.bass" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch
                  v-model="accompany.doubleBass"
                  :disabled="!accompany.bass"
                  label="Double bass — the same root an octave lower again"
                />
              </v-col>

              <v-col cols="12">
                <v-divider class="my-3" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch v-model="accompany.enabled" label="Play phrases at all" />
                <v-switch v-model="accompany.keepRegister" label="Follow the register of the chord before" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="accompany.fit"
                  :items="[
                    { title: 'Keep the rhythm, follow the chart', value: 'follow' },
                    { title: 'Keep the rhythm, restart each chord', value: 'restart' },
                    { title: 'Stretch to fit the chord', value: 'stretch' },
                  ]"
                  label="When the phrase and the chord are different lengths"
                />
                <div class="text-caption text-medium-emphasis mt-1">
                  Stretching changes the phrase's tempo; speed above is the deliberate way to do that.
                </div>
              </v-col>
            </v-row>
          </v-window-item>

          <!-- Sources ----------------------------------------------------- -->
          <v-window-item value="sources">
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
              <v-btn size="small" variant="text" @click="vocabFile && vocabFile.click()">Open a .voc file…</v-btn>
              <input ref="vocabFile" type="file" accept=".voc,text/plain" style="display: none" @change="openVocabulary" />
            </div>
            <div class="d-flex align-center mb-2" style="gap: 8px">
              <v-text-field v-model="vocabUrl" label="…or a vocabulary URL" :placeholder="defaultVocab" density="compact" hide-details />
              <v-btn size="x-small" :disabled="!vocabUrl.trim()" @click="rebuild({ url: vocabUrl.trim() })">Load</v-btn>
            </div>
            <v-alert v-if="report && report.error" type="warning" variant="tonal" density="compact" class="mb-4 text-caption">
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
              <input ref="midiFile" type="file" accept=".mid,.midi,audio/midi" style="display: none" @change="openMidi" />
              <v-select
                v-model="midiBars"
                :items="[{ title: 'One bar each', value: 1 }, { title: 'Two bars each', value: 2 }, { title: 'Four bars each', value: 4 }]"
                label="Cut into"
                style="max-width: 180px"
              />
            </div>
          </v-window-item>

          <!-- How it works ------------------------------------------------ -->
          <v-window-item value="about">
            <div class="text-body-2" style="line-height: 1.7">
              <p class="mb-3">
                A phrase is one chord's worth of playing, stored rooted on C — as degrees
                measured from the chord it was played over, rather than the notes that were
                played. Capture something over F minor 7 and it is filed as root, ♭3, 5, ♭7.
              </p>
              <p class="mb-3">
                Putting it over a chord happens in that order, and the order matters. The root
                goes first, so the degrees stay intact. Only if the new chord is a different
                <em>shape</em> does minimal-movement voice leading get involved, and by then both
                chords share a root, so the root stays the root. Last, the octave is chosen to
                sit nearest to where the phrase was over the previous chord.
              </p>
              <p class="mb-3">
                That is why nothing here is filtered by the chord you are on: every phrase fits
                every chord. The rhythm is never touched either — it runs at the rate it was
                played and keeps time with the chart, and a chord decides only the harmony for
                the stretch of time it occupies.
              </p>
              <p class="mb-3">
                One phrase plays for the whole song by default. Turn on
                <em>per-chord articulations</em> in settings and it instead applies from the
                chord it is bound to until the next chord wearing a dot — the dot you see above
                a chord is literally the <code>.</code> in the text.
              </p>
            </div>
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
