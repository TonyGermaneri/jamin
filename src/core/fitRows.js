/**
 * As many rows as there is room for.
 *
 * Every list in jamin paged twelve at a time, or ten, because the smallest
 * editor a DAW will give the plugin is 480px tall and twelve rows is what fits
 * in one. Full screen on a desktop that is a third of the window in use and
 * two thirds of it empty, with the pagination stranded in the middle -- the
 * catalogue looks smaller than it is and every page turn costs a click that the
 * room was there to avoid.
 *
 * So the page is however many rows fit. Measured rather than guessed at a
 * breakpoint, because the editor is whatever shape the host leaves and there is
 * no breakpoint that describes "a plugin window somebody is dragging".
 *
 * @see components/PhraseBook.vue, DrumBook.vue, ProgressionBook.vue
 */
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'

export function useRowsThatFit(rowHeight, { least = 6, most = 60 } = {}) {
  /** Put this on the element the rows go in. */
  const box = ref(null)
  const rows = ref(least)
  let watching = null

  /** The element, whether the ref landed on one or on a Vuetify component. */
  function elementOf() {
    const held = box.value
    if (!held) return null
    return held.$el || held
  }

  function measure() {
    const el = elementOf()
    if (!el || !el.clientHeight) return
    const height = el.clientHeight
    if (!height) return
    // One row's worth of slack, so the last row is never half-visible -- a row
    // cut in half reads as a rendering fault rather than as more list.
    const fits = Math.floor(height / rowHeight)
    rows.value = Math.max(least, Math.min(most, fits))
  }

  onMounted(async () => {
    await nextTick()
    measure()
    if (typeof ResizeObserver === 'undefined') return
    watching = new ResizeObserver(measure)
    const el = elementOf()
    if (el) watching.observe(el)
  })

  onBeforeUnmount(() => {
    if (watching) watching.disconnect()
    watching = null
  })

  return { box, rows, measure }
}
