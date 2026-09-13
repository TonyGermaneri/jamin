<script setup>
/**
 * The phrase book: what you just played, and everything you kept.
 */
import { computed, ref, watch } from 'vue'
import {
  state,
  keepCapture,
  deletePhrase,
  renamePhrase,
  bindPhrase,
  unbindPhrase,
  armCapture,
  currentToken,
  toast,
  ensureLicks,
  visibleLicks,
  adoptLick,
  targetChord,
  ensureLicks as rebuildLicks,
  defaultVocabularyUrl,
} from '../store.js'
import { summarize } from '../core/phrases.js'
import { describeLick } from '../core/licks.js'

const name = ref('')
const renaming = ref(null)
const renameTo = ref('')
const lickSearch = ref('')
const vocabUrl = ref('')
const vocabFile = ref(null)
const LICK_LIMIT = 40

const report = computed(() => state.lickReport)
const defaultVocab = computed(() => defaultVocabularyUrl())

async function rebuild(options) {
  await rebuildLicks(options)
  const r = state.lickReport
  if (r && !r.error) toast(`${r.total} licks from ${r.source}`)
}

async function openVocabulary(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  await rebuild({ text: await file.text() })
  event.target.value = ''
}

watch(
  () => state.pendingCapture,
  (capture) => {
    name.value = capture ? `${capture.sourceChord}-lick` : ''
  }
)

const target = computed(() => currentToken())
const chord = computed(() => targetChord())

// Depend on the loaded catalogue explicitly so the list refreshes when it lands.
const matchingLicks = computed(() => {
  if (!state.licks.length) return []
  return visibleLicks(lickSearch.value)
})

watch(
  () => [state.ui.phrases, state.ui.phrasesTab],
  ([open, tab]) => {
    if (open && tab === 'licks') ensureLicks()
  },
  { immediate: true }
)

function keepAndBind() {
  const phrase = keepCapture(name.value)
  if (!phrase) return
  bindPhrase(phrase.name)
  state.ui.phrasesTab = 'library'
}

function keepOnly() {
  const phrase = keepCapture(name.value)
  if (phrase) {
    state.ui.phrasesTab = 'library'
    toast(`Kept ${phrase.name}`)
  }
}

function discard() {
  state.pendingCapture = null
}

function commitRename(phrase) {
  // Enter unmounts the field, which fires blur -- only act on the first one.
  if (renaming.value !== phrase.name) return
  const next = renamePhrase(phrase.name, renameTo.value)
  if (next) toast(`Renamed to ${next}`)
  renaming.value = null
}

/** A small piano roll so a phrase is recognisable at a glance. */
function roll(phrase, width = 260, height = 54) {
  const notes = phrase.notes
  if (!notes.length) return []
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
</script>

<template>
  <v-dialog v-model="state.ui.phrases" max-width="720" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon size="18" class="mr-2">mdi-book-music-outline</v-icon>
        <span class="text-body-1">Phrase book</span>
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="text" @click="state.ui.phrases = false" />
      </v-card-title>

      <v-tabs v-model="state.ui.phrasesTab">
        <v-tab value="captured">Just played</v-tab>
        <v-tab value="library">Library ({{ state.phrases.length }})</v-tab>
        <v-tab value="licks">Licks</v-tab>
        <v-tab value="about">How it works</v-tab>
      </v-tabs>

      <v-card-text>
        <v-window v-model="state.ui.phrasesTab">
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
              <svg :width="260" :height="54" class="mb-3" style="background: rgba(255, 255, 255, 0.04); border-radius: 6px">
                <rect
                  v-for="(note, index) in roll(state.pendingCapture)"
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
                <v-btn size="small" color="primary" :disabled="!target" @click="keepAndBind">
                  Keep and bind to {{ target ? target.body : '—' }}
                </v-btn>
                <v-btn size="small" @click="keepOnly">Keep only</v-btn>
                <v-btn size="small" variant="text" @click="discard">Discard</v-btn>
              </div>
              <div class="text-caption text-medium-emphasis mt-3">
                Binding writes <code>.{{ target ? target.body : 'chord' }}{{ '{' + (name || 'name') + '}' }}</code>
                into the chart. It applies from there until the next dotted chord.
              </div>
            </div>
          </v-window-item>

          <v-window-item value="library">
            <div v-if="!state.phrases.length" class="text-center py-8 text-caption text-medium-emphasis">
              No saved phrases yet.
            </div>
            <v-list v-else density="compact">
              <v-list-item v-for="phrase in state.phrases" :key="phrase.name" class="px-0">
                <template #prepend>
                  <svg :width="120" :height="34" class="mr-3" style="background: rgba(255, 255, 255, 0.04); border-radius: 4px">
                    <rect
                      v-for="(note, index) in roll(phrase, 120, 34)"
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
                </template>

                <v-list-item-title v-if="renaming !== phrase.name">{{ phrase.name }}</v-list-item-title>
                <v-text-field
                  v-else
                  v-model="renameTo"
                  density="compact"
                  autofocus
                  @keydown.enter="commitRename(phrase)"
                  @blur="commitRename(phrase)"
                />
                <v-list-item-subtitle class="text-caption">{{ summarize(phrase) }}</v-list-item-subtitle>

                <template #append>
                  <v-btn
                    size="x-small"
                    variant="text"
                    :disabled="!target"
                    :title="target ? `Bind to ${target.body}` : 'No chord to bind to'"
                    @click="bindPhrase(phrase.name)"
                  >
                    Bind
                  </v-btn>
                  <v-btn
                    icon="mdi-rename-outline"
                    size="x-small"
                    variant="text"
                    @click="renaming = phrase.name; renameTo = phrase.name"
                  />
                  <v-btn icon="mdi-delete-outline" size="x-small" variant="text" @click="deletePhrase(phrase.name)" />
                </template>
              </v-list-item>
            </v-list>

            <v-divider class="my-3" />
            <div class="d-flex" style="gap: 8px">
              <v-btn size="small" :disabled="!target" @click="bindPhrase(null)">
                Clear phrase at {{ target ? target.body : '—' }}
              </v-btn>
              <v-btn size="small" variant="text" :disabled="!target" @click="unbindPhrase()">
                Remove the dot entirely
              </v-btn>
            </div>
          </v-window-item>

          <v-window-item value="licks">
            <div class="text-caption text-medium-emphasis mb-1">
              Licks, cells and idioms from
              <a href="https://github.com/Impro-Visor/Impro-Visor" target="_blank" rel="noreferrer">Impro-Visor</a>
              (GPL-2.0-or-later). Each was written over one chord; keeping one copies it into
              your library, where it behaves like anything you played yourself.
            </div>
            <div class="text-caption text-medium-emphasis mb-3">
              The catalogue is built here in the page from the vocabulary file itself, so you can
              point it at your own.
              <span v-if="report && !report.error">
                Last build: <strong>{{ report.total }}</strong> from {{ report.source }},
                {{ report.skipped.multiChord }} skipped for spanning more than one chord<span
                  v-if="report.skipped.noHarmony"
                >, {{ report.skipped.noHarmony }} written over no chord at all</span>,
                {{ report.ms }}ms.
              </span>
            </div>

            <div class="d-flex flex-wrap align-center mb-3" style="gap: 8px">
              <v-btn size="x-small" :loading="state.licksLoading" @click="rebuild({ force: true })">
                Rebuild from Impro-Visor
              </v-btn>
              <v-btn size="x-small" variant="text" @click="vocabFile && vocabFile.click()">Open a .voc file…</v-btn>
              <input ref="vocabFile" type="file" accept=".voc,text/plain" style="display: none" @change="openVocabulary" />
            </div>
            <div class="d-flex align-center mb-4" style="gap: 8px">
              <v-text-field
                v-model="vocabUrl"
                label="…or a vocabulary URL"
                :placeholder="defaultVocab"
                density="compact"
                hide-details
              />
              <v-btn size="x-small" :disabled="!vocabUrl.trim()" @click="rebuild({ url: vocabUrl.trim() })">Load</v-btn>
            </div>
            <v-alert v-if="report && report.error" type="warning" variant="tonal" density="compact" class="mb-4 text-caption">
              {{ report.error }}
            </v-alert>

            <v-row dense class="mb-1">
              <v-col cols="12" md="7">
                <v-text-field v-model="lickSearch" label="Search" prepend-inner-icon="mdi-magnify" clearable />
              </v-col>
              <v-col cols="12" md="5" class="d-flex align-center">
                <v-switch
                  v-model="state.ui.licksForCurrentChord"
                  :disabled="!chord"
                  :label="chord ? `Only ones that fit ${chord.text}` : 'No chord to match'"
                />
              </v-col>
            </v-row>

            <div v-if="state.licksLoading" class="text-center py-8 text-caption text-medium-emphasis">
              Loading the catalogue…
            </div>
            <div v-else-if="!matchingLicks.length" class="text-center py-8 text-caption text-medium-emphasis">
              Nothing matches. Try turning off the chord filter.
            </div>

            <v-list v-else density="compact" class="py-0">
              <v-list-item v-for="lick in matchingLicks.slice(0, LICK_LIMIT)" :key="lick.id" class="px-0">
                <template #prepend>
                  <svg :width="120" :height="34" class="mr-3" style="background: rgba(255, 255, 255, 0.04); border-radius: 4px">
                    <rect
                      v-for="(note, index) in roll(lick, 120, 34)"
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
                </template>
                <v-list-item-title>{{ lick.name }}</v-list-item-title>
                <v-list-item-subtitle class="text-caption">{{ describeLick(lick) }}</v-list-item-subtitle>
                <template #append>
                  <v-btn size="x-small" variant="tonal" class="mr-1" :disabled="!target" @click="adoptLick(lick, true)">
                    Keep and bind
                  </v-btn>
                  <v-btn size="x-small" variant="text" @click="adoptLick(lick, false)">Keep</v-btn>
                </template>
              </v-list-item>
            </v-list>

            <div v-if="matchingLicks.length > LICK_LIMIT" class="text-caption text-medium-emphasis mt-2">
              Showing {{ LICK_LIMIT }} of {{ matchingLicks.length }}. Narrow it with the search box.
            </div>
          </v-window-item>

          <v-window-item value="about">
            <div class="text-body-2" style="line-height: 1.7">
              <p class="mb-3">
                A phrase is one chord's worth of playing, captured as you played it, along
                with the chord it was played over.
              </p>
              <p class="mb-3">
                When the chart moves to a different chord, the phrase is re-pointed rather
                than transposed. Each pitch class of the original chord is matched to the
                cheapest corresponding pitch class of the new one — common tones stay put,
                everything else takes the shortest step available. Notes that were not
                chord tones travel with whichever chord tone they were leaning on, so
                approach notes stay approach notes. The result is octave-corrected back to
                the register you played in.
              </p>
              <p class="mb-3">
                A phrase applies from the chord it is bound to until the next chord wearing
                a dot. The dot you see above a chord is literally the <code>.</code> in the
                text — bindings live in the chart, so they survive copy, paste and reload.
              </p>
              <p class="mb-3">
                The Licks tab is a catalogue of 1,900 phrases from Impro-Visor, each written
                over a single chord. They are matched to the chord you are on by shape rather
                than by root — a lick written over C7 belongs over any dominant seventh,
                because it gets re-pointed on the way in.
              </p>
            </div>
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
