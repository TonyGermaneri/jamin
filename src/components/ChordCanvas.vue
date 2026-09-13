<script setup>
/**
 * The chart itself: three stacked layers filling the window.
 *
 *   1. a WebGL canvas for the effects
 *   2. a transparent 2D canvas for the text, the caret and the selection
 *   3. a fully transparent <textarea> on top
 *
 * The textarea is never seen, but it is a real text control, so typing, IME,
 * clipboard and the browser's own undo stack all work exactly as they should.
 * We take over the things it cannot get right -- hit testing and vertical caret
 * movement -- because our lines are each a different size.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state, live, setText, engine, describeAt } from '../store.js'
import { layoutChart, createMeasurer, caretRect, indexAtPoint, verticalMove, rectForToken } from '../canvas/layout.js'
import { drawChart } from '../canvas/textRenderer.js'
import { GlRenderer, MAX_REGIONS } from '../canvas/glRenderer.js'
import { hexToRgb } from '../core/themes.js'

const root = ref(null)
const glCanvas = ref(null)
const textCanvas = ref(null)
const input = ref(null)

let ctx = null
let measure = null
let gl = null
let layout = null
let layoutKey = ''
let laidOutScore = null
let frameHandle = 0
let scroll = 0
let lastCaret = -1
let width = 0
let height = 0
let dpr = 1
let dragging = false
let anchor = 0
let observer = null

const caret = ref(0)
const selection = ref([0, 0])
const focused = ref(false)

onMounted(() => {
  ctx = textCanvas.value.getContext('2d')
  measure = createMeasurer(state.settings.display.font)
  gl = new GlRenderer(glCanvas.value)

  input.value.value = state.text
  observer = new ResizeObserver(resize)
  observer.observe(root.value)
  resize()

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      measure.reset(state.settings.display.font)
      layoutKey = ''
    })
  }

  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
  input.value.focus()
  frameHandle = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameHandle)
  if (observer) observer.disconnect()
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  if (gl) gl.dispose()
})

// Text can change from outside the editor -- inserting a progression rewrites
// the chart -- so mirror it back into the textarea. Keep the whole selection,
// not just the caret: collapsing it would throw away a selection the user made
// for something else. Assigning `.value` resets the selection, hence the
// read-then-restore.
watch(
  () => state.text,
  (next) => {
    const field = input.value
    if (!field || field.value === next) return
    const start = Math.min(field.selectionStart, next.length)
    const end = Math.min(field.selectionEnd, next.length)
    field.value = next
    field.setSelectionRange(start, end)
    layoutKey = ''
  }
)

// Hand focus back to the chart when a dialog closes, so typing just works.
watch(
  () => state.ui.settings || state.ui.phrases || state.ui.progressions,
  (open) => {
    if (!open && input.value) input.value.focus()
  }
)

watch(
  () => [state.settings.display.font, state.settings.display.fitLines],
  () => {
    measure.reset(state.settings.display.font)
    layoutKey = ''
  }
)

/* ---------------- sizing ---------------- */

function resize() {
  if (!root.value) return
  const rect = root.value.getBoundingClientRect()
  width = Math.max(1, rect.width)
  height = Math.max(1, rect.height)
  dpr = Math.min(window.devicePixelRatio || 1, 2)

  const backingWidth = Math.round(width * dpr)
  const backingHeight = Math.round(height * dpr)
  if (textCanvas.value.width !== backingWidth || textCanvas.value.height !== backingHeight) {
    textCanvas.value.width = backingWidth
    textCanvas.value.height = backingHeight
  }
  if (gl) gl.resize(width, height, dpr)
  layoutKey = ''
}

function ensureLayout() {
  const display = state.settings.display
  const key = [
    state.score.text.length,
    state.score.tokens.length,
    width,
    display.font,
    display.minFontSize,
    display.maxFontSize,
    display.lineHeight,
    display.padding,
    display.fitLines,
  ].join('|')
  // A reparse always produces a new score object, so identity is the cheapest
  // possible "did the chart change" test.
  if (key === layoutKey && layout && laidOutScore === state.score) return
  layoutKey = key
  laidOutScore = state.score
  layout = layoutChart(state.score, { width, measure, display })
  // The caret may not have moved, but what is under it just changed.
  lastCaret = -1
}

/* ---------------- input ---------------- */

function onInput(event) {
  setText(event.target.value)
  layoutKey = ''
}

function syncCaret() {
  const field = input.value
  if (!field) return
  caret.value = field.selectionStart
  selection.value = [field.selectionStart, field.selectionEnd]
  // Published so the progression library knows where "insert here" means.
  // Written only on change; this runs every frame.
  const status = state.status
  if (status.caret !== field.selectionStart) status.caret = field.selectionStart
  if (status.selection[0] !== field.selectionStart || status.selection[1] !== field.selectionEnd) {
    status.selection = [field.selectionStart, field.selectionEnd]
  }
}

function setCaret(start, end = start) {
  const field = input.value
  field.setSelectionRange(Math.min(start, end), Math.max(start, end), start > end ? 'backward' : 'forward')
  syncCaret()
}

function pointIndex(event) {
  const rect = root.value.getBoundingClientRect()
  ensureLayout()
  return indexAtPoint(layout, event.clientX - rect.left, event.clientY - rect.top + scroll, measure)
}

function onMouseDown(event) {
  if (event.button !== 0) return
  event.preventDefault()
  input.value.focus()
  const index = pointIndex(event)

  if (event.detail >= 3) {
    const line = layout.lines.find((candidate) => index >= candidate.start && index <= candidate.end) || layout.lines[0]
    setCaret(line.start, line.end)
    return
  }
  if (event.detail === 2) {
    const [from, to] = wordAt(index)
    setCaret(from, to)
    return
  }

  anchor = index
  dragging = true
  setCaret(index)
}

function onDragMove(event) {
  if (!dragging) return
  setCaret(anchor, pointIndex(event))
}

function onDragEnd() {
  dragging = false
}

function wordAt(index) {
  const text = state.text
  let from = index
  let to = index
  while (from > 0 && !/\s/.test(text[from - 1])) from--
  while (to < text.length && !/\s/.test(text[to])) to++
  return [from, to]
}

/**
 * Up, down, home and end have to be ours: the textarea would move the caret
 * using its own uniform layout, which does not match what is on screen.
 */
function onKeyDown(event) {
  const field = input.value
  ensureLayout()

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const from = event.shiftKey ? field.selectionEnd : field.selectionStart
    const target = verticalMove(layout, from, event.key === 'ArrowUp' ? -1 : 1, measure)
    if (event.shiftKey) setCaret(field.selectionStart, target)
    else setCaret(target)
    return
  }

  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const line = layout.lines.find((candidate) => caret.value >= candidate.start && caret.value <= candidate.end)
    if (!line) return
    const target = event.key === 'Home' ? line.start : line.end
    if (event.shiftKey) setCaret(field.selectionStart, target)
    else setCaret(target)
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    insertText('  ')
    return
  }

  if (event.key === 'Escape') {
    field.blur()
  }
}

/** Insert through execCommand where possible so native undo keeps working. */
function insertText(text) {
  const field = input.value
  let inserted = false
  try {
    inserted = document.execCommand('insertText', false, text)
  } catch {
    inserted = false
  }
  if (!inserted) {
    const start = field.selectionStart
    field.setRangeText(text, start, field.selectionEnd, 'end')
  }
  setText(field.value)
  layoutKey = ''
}

function onWheel(event) {
  if (!layout) return
  scroll = clamp(scroll + event.deltaY, 0, Math.max(0, layout.height - height))
}

/* ---------------- frame ---------------- */

function frame(now) {
  frameHandle = requestAnimationFrame(frame)
  if (!ctx || !layout) ensureLayout()
  syncCaret()
  ensureLayout()
  followCaret()

  const seconds = now / 1000
  const status = buildStatus(now)
  if (state.settings.shader.enabled && gl && gl.ok) {
    gl.render({
      time: seconds,
      dpr,
      beat: status.beatPhase,
      bar: status.barPhase,
      attack: status.attack,
      running: status.running,
      colors: glColors(),
      params: state.settings.shader,
      regions: buildRegions(status),
    })
  } else if (gl && gl.ok) {
    clearGl()
  }

  drawChart(ctx, {
    layout,
    colors: textColors(status.running),
    display: state.settings.display,
    status: status.of,
    selection: selection.value,
    // Dots mean nothing unless per-chord articulations are on, so don't draw
    // marks the chart is not acting on.
    showMarks: state.settings.accompany.perChordPhrases,
    caret: caret.value,
    caretVisible: focused.value && (now % 1060 < 620 || dragging),
    measure,
    width,
    height,
    dpr,
    scroll,
  })
}

let cleared = false
function clearGl() {
  if (cleared) return
  cleared = true
  const context = gl.gl
  const [r, g, b] = hexToRgb(state.settings.theme.bg)
  context.clearColor(r, g, b, 1)
  context.clear(context.COLOR_BUFFER_BIT)
}

watch(() => [state.settings.shader.enabled, state.settings.theme.bg], () => { cleared = false })

function followCaret() {
  if (caret.value === lastCaret) {
    scroll = clamp(scroll, 0, Math.max(0, layout.height - height))
    return
  }
  lastCaret = caret.value
  state.status.caretChord = describeAt(caret.value)
  const rect = caretRect(layout, caret.value, measure)
  if (rect.y < scroll) scroll = Math.max(0, rect.y - 20)
  else if (rect.y + rect.h > scroll + height) scroll = rect.y + rect.h - height + 20
  scroll = clamp(scroll, 0, Math.max(0, layout.height - height))
}

/**
 * Which chord is playing, which is next, which just finished -- and how far
 * through the current one we are.  Everything visual keys off this.
 */
function buildStatus(now) {
  const events = state.score.events
  const running = engine.running && events.length > 0
  const activeIndex = live.eventIndex
  const active = events[activeIndex] || null
  const length = active ? Math.max(1, active.endPulse - active.startPulse) : 1
  const progress = active ? clamp((live.position - active.startPulse) / length, 0, 1) : 0

  const since = (now - live.attackAt) / 1000
  const attack = clamp(since / 0.55, 0, 1)
  const glow = Math.exp(-since * 2.4)
  const fade = Math.exp(-since * 1.4)

  const nextIndex = events.length ? (activeIndex + 1) % events.length : -1
  const prevIndex = events.length ? (activeIndex - 1 + events.length) % events.length : -1

  const of = (token) => {
    if (token.type === 'error') return { kind: 'error', glow: 0, progress: -1 }
    if (!running || token.eventIndex < 0) return { kind: 'idle', glow: 0, progress: -1 }
    if (token.eventIndex === activeIndex) return { kind: 'active', glow: 0.3 + 0.7 * glow, progress }
    if (token.eventIndex === nextIndex && nextIndex !== activeIndex) return { kind: 'next', glow: progress, progress: -1 }
    if (token.eventIndex === prevIndex && prevIndex !== activeIndex) return { kind: 'past', glow: fade, progress: -1 }
    return { kind: 'idle', glow: 0, progress: -1 }
  }

  const pulsesPerBar = state.score.pulsesPerBar || 96
  return {
    running,
    of,
    attack,
    glow,
    fade,
    progress,
    activeIndex,
    nextIndex,
    prevIndex,
    beatPhase: (live.position % 24) / 24,
    barPhase: (live.position % pulsesPerBar) / pulsesPerBar,
  }
}

function buildRegions(status) {
  if (!status.running) return []
  const events = state.score.events
  const regions = []
  const push = (eventIndex, kind, progress, energy) => {
    const event = events[eventIndex]
    if (!event) return
    for (const tokenIndex of event.tokens) {
      if (regions.length >= MAX_REGIONS) return
      const rect = rectForToken(layout, tokenIndex)
      if (!rect) continue
      const y = rect.y - scroll
      if (y + rect.h < -40 || y > height + 40) continue
      regions.push({
        x: rect.x - 6,
        y: y + rect.h * 0.06,
        w: rect.w + 12,
        h: rect.h * 0.92,
        state: kind,
        progress,
        energy,
        seed: tokenIndex * 0.37,
      })
    }
  }

  push(status.activeIndex, 0, status.progress, 1)
  if (status.nextIndex !== status.activeIndex) push(status.nextIndex, -1, status.progress, 1)
  if (status.prevIndex !== status.activeIndex) push(status.prevIndex, 1, status.fade, status.fade)
  return regions
}

function glColors() {
  const theme = state.settings.theme
  return {
    bg: hexToRgb(theme.bg),
    accent: hexToRgb(theme.accent),
    accentAlt: hexToRgb(theme.accentAlt),
  }
}

function textColors(running) {
  const theme = state.settings.theme
  return {
    bg: theme.bg,
    fg: theme.fg,
    accent: theme.accent,
    accentAlt: theme.accentAlt,
    error: theme.error,
    separator: theme.dim,
    selection: withAlpha(theme.accent, 0.22),
    caret: theme.accent,
    dimInactive: running ? state.settings.display.dimInactive : 1,
  }
}

function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

defineExpose({ focus: () => input.value && input.value.focus() })
</script>

<template>
  <div
    ref="root"
    class="jamin-layer"
    :style="{ background: state.settings.theme.bg }"
    @wheel.passive="onWheel"
  >
    <canvas ref="glCanvas" class="jamin-layer" aria-hidden="true" />
    <canvas ref="textCanvas" class="jamin-layer" aria-hidden="true" />
    <textarea
      ref="input"
      class="jamin-input"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      aria-label="Chord chart"
      @input="onInput"
      @keydown="onKeyDown"
      @mousedown="onMouseDown"
      @focus="focused = true"
      @blur="focused = false"
    />
  </div>
</template>
