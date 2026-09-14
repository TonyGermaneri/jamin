<script setup>
/**
 * Every instance of jamin in this DAW, as tabs.
 *
 * A DAW hides a plugin's window behind whichever track is selected, so
 * controlling eight instances means clicking through eight tracks -- and by the
 * time you have found the right one the bar has gone. This puts all of them in
 * one window: pick a tab and the phrase book below it is pointed at that track.
 *
 * **Mute and solo here are not the DAW's.** A DAW mutes audio, after the notes
 * have been played. These decide whether the notes happen at all, which is a
 * different musical act and one the mixer cannot perform -- and they land on a
 * bar line, so a part stops where a musician would stop it rather than wherever
 * the mouse was. @see jamin::Roster
 *
 * Every control is one letter or one icon. A tab strip that has to hold eight
 * tracks has no room for a word, and the die is put at the far end from mute and
 * solo on purpose: rolling a new articulation by accident when you meant to
 * silence a track is not a mistake anybody would forgive.
 */
import { computed } from 'vue'
import { state, setInstanceMuted, setInstanceSoloed, randomSongPhrase } from '../store.js'

const model = defineModel({ type: String, default: null })

const instances = computed(() => state.roster.instances)
const soloing = computed(() => instances.value.some((i) => i.soloed))

/** A track's name, or its place in the session. Never empty: a nameless tab is
    one nobody can choose between. */
const label = (instance, index) => instance.name || `Track ${index + 1}`

/** The word is long, the tab is not. */
const short = (instance, index) => {
  const name = label(instance, index)
  return name.length > 14 ? `${name.slice(0, 13)}…` : name
}

function roll(instance) {
  // Only this instance can roll its own: the catalogue lives in its page.
  if (instance.id === state.roster.me) randomSongPhrase()
}
</script>

<template>
  <v-tabs
    v-if="instances.length"
    v-model="model"
    density="compact"
    show-arrows
    class="jamin-instance-tabs"
  >
    <v-tab
      v-for="(instance, index) in instances"
      :key="instance.id"
      :value="instance.id"
      class="jamin-instance-tab px-2"
      :class="{ 'is-quiet': !instance.audible }"
    >
      <!-- Mute and solo at one end … -->
      <span class="jamin-instance-switches">
        <v-btn
          :color="instance.muted ? 'error' : undefined"
          :variant="instance.muted ? 'flat' : 'text'"
          size="x-small" density="compact" icon
          :aria-label="`Mute ${label(instance, index)}`"
          @click.stop="setInstanceMuted(instance.id, !instance.muted)"
        >M</v-btn>
        <v-btn
          :color="instance.soloed ? 'warning' : undefined"
          :variant="instance.soloed ? 'flat' : 'text'"
          size="x-small" density="compact" icon
          :aria-label="`Solo ${label(instance, index)}`"
          @click.stop="setInstanceSoloed(instance.id, !instance.soloed)"
        >S</v-btn>
      </span>

      <span class="jamin-instance-name" :title="instance.phrase || 'no articulation'">
        {{ short(instance, index) }}
        <span v-if="instance.id === state.roster.me" class="jamin-instance-here">•</span>
      </span>

      <!-- … and the die at the other, so neither is ever the one you meant. -->
      <v-btn
        v-if="instance.id === state.roster.me"
        size="x-small" density="compact" icon variant="text"
        class="jamin-instance-dice"
        :aria-label="`A random articulation for ${label(instance, index)}`"
        @click.stop="roll(instance)"
      >
        <v-icon size="15">mdi-dice-5-outline</v-icon>
      </v-btn>
      <span v-else class="jamin-instance-dice" />
    </v-tab>
  </v-tabs>

  <div v-if="soloing" class="text-caption text-warning px-3 pb-1">
    Soloing — every other part is silent until you let it go.
  </div>
</template>
