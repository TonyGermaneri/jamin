<script setup>
/**
 * One book, whichever kind of part the track plays.
 *
 * There used to be two dialogs -- a phrase book and a drum book -- and which
 * one you could open was decided by the window you happened to be looking at.
 * That is the wrong owner. A DAW hides a plugin behind whichever track is
 * selected, so the window in front of you is an accident of what you last
 * clicked; the *catalogue* a part needs is a fact about the track, and a
 * session with a piano on one track and a kit on another needs both from
 * wherever you are standing.
 *
 * So there is one dialog. The tabs across the top are every jamin in the host,
 * and picking one shows that track's catalogue: a drum track offers grooves
 * even from a window that is playing a piano. The track says which it is
 * (@see store.modeOf), and the roster carries it between instances the same way
 * it carries what each one is playing.
 */
import { computed, watch } from 'vue'
import { state, setSends, modeOf, openDrumBook } from '../store.js'
import InstanceTabs from './InstanceTabs.vue'
import PhraseBook from './PhraseBook.vue'
import DrumBook from './DrumBook.vue'

const open = computed({
  get: () => Boolean(state.ui.book),
  set: (value) => { if (!value) state.ui.book = null },
})

/** Which track everything below is aimed at; this one until told otherwise. */
const aimedAt = computed({
  get: () => state.ui.targetInstance || state.roster.me,
  set: (id) => { state.ui.targetInstance = id },
})

/** True when the tab open is somebody else's track. */
const elsewhere = computed(() =>
  state.host.active && aimedAt.value && aimedAt.value !== state.roster.me)

/** What kind of part the aimed-at track plays. */
const trackMode = computed(() => modeOf(aimedAt.value))

/**
 * Whether what is showing is a map rather than a list.
 *
 * The two want opposite things from the screen. A list wants a column and a
 * detail pane beside it; a map wants the glass, with everything else floating
 * over the top of it. @see styles/app.css .jamin-book-mapped
 */
const mapped = computed(() => (state.ui.book === 'drums'
  ? state.settings.graph.drums
  : state.settings.graph.phrases))

/*
 * Clicking a track shows that track's catalogue.
 *
 * Which is the whole point of unifying the two. The book does not argue with
 * the track: if it is a drum track it gets grooves, and if the window doing the
 * showing is playing a piano that changes nothing about what track 1 is.
 */
watch(aimedAt, () => {
  if (state.ui.book) state.ui.book = trackMode.value
}, { immediate: false })

// And a track that changes what it plays while its tab is open changes with it.
watch(trackMode, (mode) => {
  if (state.ui.book) state.ui.book = mode
})

/**
 * The switch, which means two different things and only does one of them.
 *
 * On this instance it is what this track plays -- the same decision as the
 * toolbar's, and it stops the notes as it goes, because one output plays one
 * part. On somebody else's it can only ever be a view: a page cannot reach into
 * another page, and the roster has no message for "become a drum track". So it
 * is a control for your own track and a label for anybody else's, which is
 * better than a switch that looks live and silently is not.
 */
const mode = computed({
  get: () => state.ui.book || 'phrases',
  set: (value) => {
    const next = value === 'drums' ? 'drums' : 'phrases'
    if (!elsewhere.value) setSends(next)
    if (next === 'drums') openDrumBook()
    else state.ui.book = 'phrases'
  },
})

/** A track's name, for saying whose catalogue this is. */
const whose = computed(() => {
  const at = state.roster.instances.findIndex((one) => one.id === aimedAt.value)
  if (at < 0) return ''
  return state.roster.instances[at].name || `Track ${at + 1}`
})
</script>

<template>
  <!-- The drum catalogue wants the whole width: a row of grooves carries a pill
       per part and a song has several. The phrase catalogue does not.
       @see styles/app.css .jamin-drums -->
  <!--
    The whole screen, not a card on top of one.

    It was a dialog, and a dialog is a thing you glance at and dismiss. This is
    where the work happens: eight hundred thousand patterns, ten thousand
    phrases, and a map of either that wants every pixel there is. A modal
    frames all of that inside about a quarter of the window and leaves the
    chart showing uselessly around the edges.
    @see styles/app.css .jamin-book
  -->
  <v-dialog
    v-model="open"
    fullscreen
    :scrim="false"
    transition="dialog-bottom-transition"
    scrollable
    class="jamin-book"
    :class="{ 'jamin-drums': mode === 'drums', 'jamin-book-mapped': mapped }"
  >
    <v-card>
      <!--
        One strip, not two.
      
        Which track, which catalogue and the way out all live on the same line,
        because the editor is whatever shape the DAW leaves room for and the
        smallest one jamin allows is 480px tall. Two rows of chrome over the
        drum book took its pagination off the bottom of the screen -- measured,
        at 493px in a 480px window. @see native/tools/boot_probe.m
      -->
      <div class="d-flex align-center jamin-book-chrome" style="gap: 8px">
        <!-- Every jamin in this DAW. Pick one and everything below is aimed at
             that track — including which catalogue it is.
             @see components/InstanceTabs.vue -->
        <InstanceTabs v-if="state.host.active" v-model="aimedAt" class="flex-grow-1" />
        <v-spacer v-else />

        <!-- A page cannot reach into another page, so on somebody else's track
             this says what that track is rather than pretending to set it. -->
        <span v-if="elsewhere" class="text-caption text-medium-emphasis text-no-wrap">
          {{ whose }} plays {{ trackMode === 'drums' ? 'drums' : 'articulations' }}
        </span>

        <v-btn-toggle
          v-model="mode" density="compact" variant="outlined" divided mandatory
          :disabled="elsewhere" class="flex-shrink-0"
        >
          <v-btn value="phrases" size="small" aria-label="Articulations">
            <v-icon size="18">mdi-book-music-outline</v-icon>
          </v-btn>
          <v-btn value="drums" size="small" aria-label="Drums">
            <v-icon size="18">mdi-circle-multiple-outline</v-icon>
          </v-btn>
        </v-btn-toggle>

        <v-btn icon="mdi-close" size="small" variant="text" class="flex-shrink-0"
               aria-label="Close" @click="state.ui.book = null" />
      </div>

      <PhraseBook v-if="mode === 'phrases'" />
      <DrumBook v-else />
    </v-card>
  </v-dialog>
</template>
