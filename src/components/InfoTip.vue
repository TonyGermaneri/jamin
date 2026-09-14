<script setup>
/**
 * The long version, out of the way.
 *
 * A plugin editor is whatever height the DAW left over -- 480px at the smallest
 * jamin allows -- and a paragraph explaining a switch costs more of that than
 * the switch does. The explanations are worth keeping: several of them are the
 * only place a non-obvious decision is written down. They are just not worth
 * showing to somebody who already knows.
 *
 * So anything longer than a line or two lives behind this, and what stays on the
 * panel is the sentence that tells you what the control does.
 *
 * Hover, focus *and* click open it. Hover alone is the Vuetify default and it is
 * not enough here: a plugin window gets used from a trackpad, a touchscreen and
 * a keyboard, and a help icon that does nothing when tapped reads as broken.
 */
defineProps({
  /** Where it opens. `bottom` unless it would go off the foot of the panel. */
  location: { type: String, default: 'bottom' },
})
</script>

<template>
  <v-tooltip
    :location="location"
    :open-on-click="true"
    max-width="380"
    content-class="jamin-tip"
  >
    <template #activator="{ props }">
      <v-icon
        v-bind="props"
        icon="mdi-help-circle-outline"
        size="15"
        class="jamin-tip-icon"
        tabindex="0"
        role="button"
        aria-label="More about this"
      />
    </template>
    <div class="text-caption jamin-tip-body"><slot /></div>
  </v-tooltip>
</template>
