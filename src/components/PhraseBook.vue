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
  setAccentPhrase,
  triggerAccent,
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
const accentId = computed(() => state.accentPhrase)
const isAccent = (entry) => !!entry && state.accentPhrase === (entry.id || entry.name)
const accent = computed(() => matches.value.find((entry) => entry.id === state.accentPhrase) ||
  catalogue().find((entry) => entry.id === state.accentPhrase) || null)
const category = ref('any')
const kind = ref('any')
const source = ref('any')
const length = ref('any')

/**
 * Facets, built from the catalogue rather than written down.
 *
 * Every one of these is a field the collections actually carry: Impro-Visor
 * labels each entry and files it as a lick, a cell, an idiom or a quote;
 * POP909 says which song a part came from; a captured phrase knows it was
 * captured. There is no genre here and no year, because the phrase sources do
 * not have either -- POP909 ships beats, chords and keys and nothing else.
 * Genre and decade do exist in Chordonomicon, and are filters in the
 * progression library where they are real.
 */
function facet(pick, label) {
  const counts = new Map()
  for (const entry of catalogue()) {
    const value = pick(entry)
    if (value) counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [
    { title: label, value: 'any' },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([name, count]) => ({ title: `${name} (${count})`, value: name })),
  ]
}

/** What kind of thing it is, in the vocabulary's own words. */
const kinds = computed(() => facet((entry) => entry.kind, 'Any kind'))

/** Where it came from. The origin is per-entry -- "POP909 #219" -- so the
    collection is the part before the number. */
const sourceOf = (entry) => String(entry.origin || 'captured here').split(' #')[0]
const sources = computed(() => facet(sourceOf, 'Any source'))

const categories = computed(() => facet((entry) => entry.category, 'Any category'))

/** Length, in beats, as bands rather than a number nobody knows to type. */
const LENGTHS = [
  { title: 'Any length', value: 'any', fits: () => true },
  { title: 'Up to 2 beats', value: 'tiny', fits: (b) => b <= 2 },
  { title: '2 to 4 beats', value: 'short', fits: (b) => b > 2 && b <= 4 },
  { title: '4 to 8 beats', value: 'medium', fits: (b) => b > 4 && b <= 8 },
  { title: 'Over 8 beats', value: 'long', fits: (b) => b > 8 },
]

const PER_PAGE = 12
const page = ref(1)
const selected = ref(null)

const matches = computed(() => {
  if (!state.licks.length && !state.phrases.length) return []
  const band = LENGTHS.find((one) => one.value === length.value) || LENGTHS[0]

  return visibleLicks(search.value).filter((entry) => {
    if (category.value !== 'any' && entry.category !== category.value) return false
    if (kind.value !== 'any' && entry.kind !== kind.value) return false
    if (source.value !== 'any' && sourceOf(entry) !== source.value) return false
    return band.fits(entry.lengthPulses / 24)
  })
})

/** Whether anything is narrowing the list, so the UI can offer to stop. */
const filtered = computed(() =>
  Boolean(search.value) || category.value !== 'any' || kind.value !== 'any' ||
  source.value !== 'any' || length.value !== 'any' || state.ui.lickTexture !== 'any')

function clearFilters() {
  search.value = ''
  category.value = 'any'
  kind.value = 'any'
  source.value = 'any'
  length.value = 'any'
  state.ui.lickTexture = 'any'
}
const total = computed(() => catalogue().length)
const pageCount = computed(() => Math.max(1, Math.ceil(matches.value.length / PER_PAGE)))
const list = computed(() => matches.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE))

watch([search, category, kind, source, length, () => state.ui.lickTexture], () => { page.value = 1 })
watch(list, (rows) => {
  if (!rows.some((row) => selected.value && row.id === selected.value.id)) selected.value = rows[0] || null
}, { immediate: true })

const beatsOf = (entry) => Math.round((entry.lengthPulses / 24) * 10) / 10

/*
 * Arrow keys and the wheel walk the whole catalogue, not just the page: the
 * index is into the full list of matches, and the page follows it. Selecting is
 * auditioning -- the phrase goes straight into the song -- so a spin of the
 * wheel is a way of hearing through ten thousand of them.
 */
let useTimer = null

function step(delta) {
  const all = matches.value
  if (!all.length) return
  const at = Math.max(0, all.findIndex((entry) => selected.value && entry.id === selected.value.id))
  const next = Math.min(all.length - 1, Math.max(0, at + delta))
  if (next === at && selected.value) return

  selected.value = all[next]
  page.value = Math.floor(next / PER_PAGE) + 1

  // Using a phrase reparses the chart and writes to storage, so stepping fast
  // waits for the spinning to stop rather than doing that fifty times a second.
  clearTimeout(useTimer)
  useTimer = setTimeout(() => usePhrase(selected.value), 90)
}

let wheelAcc = 0
function onWheel(event) {
  event.preventDefault()
  wheelAcc += event.deltaY
  // One row per notch, whether that arrives as one big delta or many small ones.
  while (Math.abs(wheelAcc) >= 30) {
    step(wheelAcc > 0 ? 1 : -1)
    wheelAcc -= Math.sign(wheelAcc) * 30
  }
}

function pick(entry) {
  selected.value = entry
  clearTimeout(useTimer)
  usePhrase(entry)
}

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
  // Inset, so the top and bottom notes sit inside the box rather than on its edge.
  const pad = 3
  const usable = height - pad * 2
  return notes.map((note) => ({
    x: (note.at / length) * width,
    w: Math.max(2, (note.duration / length) * width),
    y: pad + usable - ((note.note - low + 1) / span) * usable,
    h: Math.max(2, usable / span - 1),
    o: 0.35 + (note.velocity / 127) * 0.65,
  }))
}

const describe = (entry) => (entry.notes ? describeLick(entry) : summarize(entry))
</script>

<template>
  <v-dialog v-model="state.ui.phrases" max-width="880" scrollable class="jamin-book">
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
          <!-- Catalogue: list on the left, the one you picked on the right -->
          <v-window-item value="catalogue">
            <v-row class="jamin-book-row">
              <v-col cols="12" md="6" class="jamin-book-col">
                <v-row dense class="mb-1 flex-grow-0">
                  <v-col cols="12">
                    <v-text-field v-model="search" label="Search" prepend-inner-icon="mdi-magnify" clearable
                                  density="compact" hide-details />
                  </v-col>
                  <v-col cols="7">
                    <v-select v-model="category" :items="categories" label="Category"
                              density="compact" hide-details />
                  </v-col>
                  <v-col cols="5">
                    <v-select
                      v-model="state.ui.lickTexture"
                      :items="[
                        { title: 'Any texture', value: 'any' },
                        { title: 'Two hands', value: 'hands' },
                        { title: 'Single line', value: 'line' },
                      ]"
                      label="Texture"
                      density="compact"
                      hide-details
                    />
                  </v-col>
                  <v-col cols="4">
                    <v-select v-model="source" :items="sources" label="Source" density="compact" hide-details />
                  </v-col>
                  <v-col cols="4">
                    <v-select v-model="kind" :items="kinds" label="Kind" density="compact" hide-details />
                  </v-col>
                  <v-col cols="4">
                    <v-select v-model="length" :items="LENGTHS" label="Length" density="compact" hide-details />
                  </v-col>
                </v-row>

                <div v-if="state.licksLoading && !list.length" class="text-caption text-medium-emphasis py-8 text-center">
                  Loading the catalogue…
                </div>
                <div v-else-if="!list.length" class="text-caption text-medium-emphasis py-8 text-center">
                  Nothing matches.
                  <div v-if="filtered" class="mt-2">
                    <v-btn size="x-small" variant="text" @click="clearFilters">Clear the filters</v-btn>
                  </div>
                </div>

                <v-list
                  v-else
                  density="compact"
                  class="py-0 jamin-book-scroll"
                  tabindex="0"
                  style="outline: none"
                  @keydown.down.prevent="step(1)"
                  @keydown.up.prevent="step(-1)"
                  @keydown.page-down.prevent="step(PER_PAGE)"
                  @keydown.page-up.prevent="step(-PER_PAGE)"
                  @keydown.home.prevent="step(-matches.length)"
                  @keydown.end.prevent="step(matches.length)"
                  @wheel="onWheel"
                >
                  <v-list-item
                    v-for="entry in list"
                    :key="entry.id"
                    :active="selected && selected.id === entry.id"
                    class="px-2"
                    @click="pick(entry)"
                    @contextmenu.prevent="setAccentPhrase(entry.id || entry.name)"
                  >
                    <v-list-item-title class="text-body-2 text-truncate">{{ entry.name }}</v-list-item-title>
                    <template #append>
                      <v-icon v-if="isAccent(entry)" size="14" color="secondary" class="mr-2">mdi-flash-outline</v-icon>
                      <v-icon v-if="playing === entry.id" size="14" color="primary" class="mr-2">mdi-play</v-icon>
                      <span class="text-caption text-medium-emphasis">{{ beatsOf(entry) }} beats</span>
                    </template>
                  </v-list-item>
                </v-list>

                <v-pagination v-model="page" :length="pageCount" :total-visible="6" density="comfortable" class="mt-2" />
                <div class="text-caption text-medium-emphasis text-center">
                  {{ matches.length.toLocaleString() }} of {{ total.toLocaleString() }}
                  <template v-if="filtered">· <a href="#" @click.prevent="clearFilters">clear filters</a></template> ·
                  click the list, then arrow or scroll to hear your way through it ·
                  right-click one to make it the accent
                </div>
              </v-col>

              <!-- The aside -->
              <v-col cols="12" md="6" class="jamin-book-col">
                <div v-if="!selected" class="text-caption text-medium-emphasis py-8 text-center">
                  Pick one from the list.
                </div>
                <div v-else class="jamin-book-scroll">
                  <div class="text-body-1 mb-1">{{ selected.name }}</div>
                  <div class="text-caption text-medium-emphasis mb-3">{{ describe(selected) }}</div>

                  <svg
                    :width="300"
                    :height="120"
                    class="mb-3"
                    style="background: rgba(255,255,255,0.04); border-radius: 6px; max-width: 100%"
                  >
                    <rect
                      v-for="(note, index) in roll(selected, 300, 120)"
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

                  <div class="text-caption text-medium-emphasis mb-3">
                    Played over {{ selected.sourceChord }}, stored as degrees from its root, and
                    re-pointed at whatever chord it lands on — so it fits every chord in the chart.
                    <span v-if="selected.origin">From {{ selected.origin }}.</span>
                  </div>

                  <div class="d-flex align-center flex-wrap" style="gap: 8px">
                    <v-btn
                      size="small"
                      :color="playing === selected.id ? 'primary' : undefined"
                      :variant="playing === selected.id ? 'flat' : 'tonal'"
                      @click="usePhrase(selected)"
                    >
                      {{ playing === selected.id ? 'Playing' : 'Use' }}
                    </v-btn>
                    <v-btn v-if="playing" size="small" variant="text" @click="bindPhrase(null)">Play no phrase</v-btn>
                    <v-btn
                      size="small"
                      variant="text"
                      prepend-icon="mdi-flash-outline"
                      :color="isAccent(selected) ? 'secondary' : undefined"
                      @click="setAccentPhrase(isAccent(selected) ? null : selected.id || selected.name)"
                    >
                      {{ isAccent(selected) ? 'Is the accent' : 'Make it the accent' }}
                    </v-btn>
                    <v-btn
                      v-if="!selected.builtin"
                      icon="mdi-rename-outline"
                      size="x-small"
                      variant="text"
                      @click="renaming = selected.id; renameTo = selected.name"
                    />
                    <v-btn
                      v-if="!selected.builtin"
                      icon="mdi-delete-outline"
                      size="x-small"
                      variant="text"
                      @click="deletePhrase(selected.name)"
                    />
                  </div>

                  <v-text-field
                    v-if="renaming === selected.id"
                    v-model="renameTo"
                    density="compact"
                    autofocus
                    class="mt-3"
                    label="Name"
                    @keydown.enter="commitRename(selected)"
                    @blur="commitRename(selected)"
                  />

                  <div class="text-caption text-medium-emphasis mt-3">
                    <span v-if="perChord">Using one binds it to {{ target ? target.body : 'the chord at the cursor' }}.</span>
                    <span v-else>Using one plays it over the whole song.</span>
                  </div>
                </div>
              </v-col>
            </v-row>
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
                <div class="text-caption text-medium-emphasis mb-2">
                  Held for the whole chord, under a phrase or a plain chord alike, and a slash
                  chord puts its own note in the bass.
                </div>
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
                <div class="text-body-2 mb-1">Accent</div>
                <div class="text-caption text-medium-emphasis mb-2">
                  <span v-if="accent">
                    <strong>{{ accent.name }}</strong> — right-click any phrase in the catalogue to
                    change it.
                  </span>
                  <span v-else>None yet. Right-click a phrase in the catalogue to choose one.</span>
                  It replaces the phrase on the next chord rather than playing over the top of it,
                  and waits for the chord change to do it — so pressing this half a bar early means
                  the same thing as pressing it a beat early. Press it again to cancel.
                </div>
                <div class="d-flex align-center flex-wrap mb-2" style="gap: 8px">
                  <v-btn size="small" :prepend-icon="state.ui.accentArmed ? 'mdi-flash' : 'mdi-flash-outline'"
                         :color="state.ui.accentArmed ? 'warning' : undefined" :disabled="!accent" @click="triggerAccent">
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
                    <v-btn size="x-small" variant="text" @click="state.settings.midi.accentCc = null">clear</v-btn>
                  </span>
                </div>
              </v-col>
              <v-col cols="12">
                <v-divider class="mb-3" />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch v-model="accompany.enabled" label="Play phrases at all" />
                <v-switch v-model="accompany.keepRegister" label="Follow the register of the chord before" />
                <v-switch v-model="accompany.snapNonChordTones" label="Snap to chord notes" />
                <div class="text-caption text-medium-emphasis">
                  Anything not in the chord moves to the nearest note that is. Off, a passing
                  tone stays where the harmony put it, which is more faithful to the phrase and
                  less certain to fit.
                </div>
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
