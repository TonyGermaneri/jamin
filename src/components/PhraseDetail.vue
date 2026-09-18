<script setup>
/**
 * One phrase, described.
 *
 * Lifted out of the phrase book because there are now two places to put it and
 * only one of it: down the right of the list, and floating over the map. A
 * second copy of eighty lines of markup is a second copy that drifts, and the
 * first thing to drift is always the one somebody looks at less.
 *
 * Everything it does to a phrase it does through the store, so it needs no
 * handlers passed in -- only which phrase, and the two facts about the song
 * that change what "use" means.
 */
import { state, usePhrase, bindPhrase, deletePhrase, renamePhrase, setAccentPhrase } from '../store.js'
import { describeLick } from '../core/licks.js'
import { summarize } from '../core/phrases.js'
import { ref } from 'vue'

const props = defineProps({
  /** The phrase, or null when nothing is chosen. */
  phrase: { type: Object, default: null },
  /** Whether using one binds it to a chord rather than the whole song. */
  perChord: { type: Boolean, default: false },
  /** The chord at the cursor, when there is one. */
  target: { type: Object, default: null },
})

const renaming = ref(null)
const renameTo = ref('')

const describe = (entry) => (entry.notes ? describeLick(entry) : summarize(entry))
const isAccent = (entry) => Boolean(entry) && state.accentPhrase === (entry.id || entry.name)
const playing = () => state.songPhrase

function commitRename(entry) {
  if (renaming.value !== entry.id) return
  const wanted = renameTo.value.trim()
  renaming.value = null
  if (wanted && wanted !== entry.name) renamePhrase(entry.name, wanted)
}

/**
 * The notes as a little piano roll.
 *
 * Inset by a few pixels so the top and bottom notes sit inside the box rather
 * than on its edge, and given a floor of six semitones of span so a phrase that
 * moves by a tone is not drawn as one that moves by an octave.
 */
function roll(phrase, width = 300, height = 120) {
  const notes = phrase.notes
  if (!notes || !notes.length) return []
  const length = phrase.lengthPulses || Math.max(...notes.map((n) => n.at + n.duration)) || 1
  const low = Math.min(...notes.map((n) => n.note))
  const high = Math.max(...notes.map((n) => n.note))
  const span = Math.max(6, high - low + 1)
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
</script>

<template>
  <div v-if="!phrase" class="text-caption text-medium-emphasis py-8 text-center">
    Pick one to see what it plays.
  </div>

  <div v-else>
    <div class="text-body-1 mb-1">{{ phrase.name }}</div>
    <div class="text-caption text-medium-emphasis mb-3">{{ describe(phrase) }}</div>

    <!-- Drawn to a viewBox rather than to pixels, so it is the width of
         whatever pane it is in: 300px in the plugin's own editor and the full
         column on a desktop, without two sizes to keep in step. -->
    <svg
      viewBox="0 0 300 120" preserveAspectRatio="none" class="jamin-phrase-roll mb-3"
      role="img" :aria-label="`${phrase.name}, ${(phrase.notes || []).length} notes`"
    >
      <rect
        v-for="(note, index) in roll(phrase)" :key="index"
        :x="note.x" :y="note.y" :width="note.w" :height="note.h"
        :opacity="note.o" fill="currentColor" rx="1"
      />
    </svg>

    <!-- What it is, as facts rather than as a sentence. A column of labelled
         values is read at a glance; the same information in prose is not. -->
    <dl class="jamin-facts mb-3">
      <div><dt>Kind</dt><dd>{{ phrase.kind || 'phrase' }}</dd></div>
      <div><dt>Over</dt><dd>{{ phrase.sourceChord || '—' }}</dd></div>
      <div><dt>Notes</dt><dd>{{ (phrase.notes || []).length }}</dd></div>
      <div v-if="phrase.voices"><dt>Voices</dt><dd>{{ phrase.voices }}</dd></div>
      <div v-if="phrase.origin"><dt>From</dt><dd>{{ phrase.origin }}</dd></div>
    </dl>

    <!-- Why it works anywhere, which the facts above cannot say. Where it came
         from is one of them and is not repeated here. -->
    <div class="text-caption text-medium-emphasis mb-3">
      Stored as degrees from its root and re-pointed at whatever chord it lands
      on, so it fits every chord in the chart.
    </div>

    <div class="d-flex align-center flex-wrap" style="gap: 8px">
      <v-btn
        size="small"
        :color="playing() === phrase.id ? 'primary' : undefined"
        :variant="playing() === phrase.id ? 'flat' : 'tonal'"
        @click="usePhrase(phrase)"
      >
        {{ playing() === phrase.id ? 'Playing' : 'Use' }}
      </v-btn>
      <v-btn v-if="playing()" size="small" variant="text" @click="bindPhrase(null)">
        Play no phrase
      </v-btn>
      <v-btn
        size="small" variant="text" prepend-icon="mdi-flash-outline"
        :color="isAccent(phrase) ? 'secondary' : undefined"
        @click="setAccentPhrase(isAccent(phrase) ? null : phrase.id || phrase.name)"
      >
        {{ isAccent(phrase) ? 'Is the accent' : 'Make it the accent' }}
      </v-btn>
      <v-btn
        v-if="!phrase.builtin" icon="mdi-rename-outline" size="x-small" variant="text"
        @click="renaming = phrase.id; renameTo = phrase.name"
      />
      <v-btn
        v-if="!phrase.builtin" icon="mdi-delete-outline" size="x-small" variant="text"
        @click="deletePhrase(phrase.name)"
      />
    </div>

    <v-text-field
      v-if="renaming === phrase.id"
      v-model="renameTo"
      density="compact" autofocus class="mt-3" label="Name"
      @keydown.enter="commitRename(phrase)"
      @blur="commitRename(phrase)"
    />

    <div class="text-caption text-medium-emphasis mt-3">
      <span v-if="perChord">
        Using one binds it to {{ target ? target.body : 'the chord at the cursor' }}.
      </span>
      <span v-else>Using one plays it over the whole song.</span>
    </div>
  </div>
</template>
