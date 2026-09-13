/**
 * Draws the laid-out chart onto a 2D canvas.
 *
 * The canvas is transparent and sits over the WebGL layer, so everything here is
 * glyphs, the caret, the selection, and the small marks that hang above a chord.
 * Text is drawn in runs between tokens rather than drawn once and painted over,
 * so a highlighted word stays crisp instead of going fuzzy under a second pass.
 */

import { caretRect } from './layout.js'

export function drawChart(ctx, options) {
  const { layout, colors, display, status, selection, caret, caretVisible, measure, showMarks = true } = options
  const { width, height, dpr, scroll = 0 } = options

  ctx.setTransform(dpr, 0, 0, dpr, 0, -scroll * dpr)
  ctx.clearRect(0, scroll, width, height)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  for (const line of layout.lines) {
    if (line.top > scroll + height || line.top + line.height < scroll) continue
    ctx.font = `${line.fontSize}px ${display.font}`
    drawSelection(ctx, line, selection, colors, layout, measure)
    drawLine(ctx, line, colors, status)
    if (showMarks) drawMarks(ctx, line, colors, status, display)
  }

  if (caretVisible && caret !== null && caret !== undefined) {
    const rect = caretRect(layout, caret, measure)
    ctx.fillStyle = colors.caret
    ctx.fillRect(rect.x, rect.y, Math.max(1.5, rect.h * 0.03), rect.h)
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

function drawLine(ctx, line, colors, status) {
  for (const run of line.runs) {
    const text = line.text.slice(run.from, run.to)
    if (!text) continue
    if (!run.rect) {
      ctx.fillStyle = colors.separator
      ctx.globalAlpha = 0.8
      ctx.fillText(text, run.x, line.baseline)
      ctx.globalAlpha = 1
      continue
    }
    paintToken(ctx, line, run.rect, colors, status(run.rect.token))
  }
}

function paintToken(ctx, line, rect, colors, state) {
  const token = rect.token

  let fill = colors.fg
  let alpha = colors.dimInactive
  let glow = 0

  if (state.kind === 'error') {
    fill = colors.error
    alpha = 0.9
  } else if (state.kind === 'active') {
    fill = colors.accent
    alpha = 1
    glow = state.glow
  } else if (state.kind === 'next') {
    fill = colors.accentAlt
    alpha = 0.55 + 0.45 * state.glow
  } else if (state.kind === 'past') {
    fill = colors.accentAlt
    alpha = 0.25 + 0.35 * state.glow
  } else if (token.type === 'barline' || token.type === 'label' || token.type === 'repeat') {
    fill = token.type === 'repeat' ? colors.accentAlt : colors.separator
    alpha = token.type === 'label' ? 0.65 : 0.8
  }

  ctx.fillStyle = fill
  ctx.globalAlpha = alpha
  if (glow > 0) {
    ctx.shadowColor = colors.accent
    ctx.shadowBlur = line.fontSize * 0.3 * glow
  }
  ctx.fillText(token.text, rect.x, line.baseline)
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1

  if (state.kind === 'active' && state.progress >= 0) {
    const barHeight = Math.max(2, line.fontSize * 0.04)
    const y = line.top + line.height - barHeight * 2.2
    ctx.fillStyle = colors.accent
    ctx.globalAlpha = 0.22
    ctx.fillRect(rect.x, y, rect.w, barHeight)
    ctx.globalAlpha = 0.95
    ctx.fillRect(rect.x, y, rect.w * state.progress, barHeight)
    ctx.globalAlpha = 1
  }
}

/** The dot and phrase label that hang above a chord carrying a phrase change. */
function drawMarks(ctx, line, colors, status, display) {
  for (const rect of line.tokens) {
    const token = rect.token
    if (!token.phraseChange && !token.phraseRef) continue
    const state = status(token)
    // Both marks live in the headroom the layout reserved above the text.
    const radius = Math.max(2, line.fontSize * 0.04)
    const cx = rect.bodyX + rect.bodyW / 2
    const cy = line.top + line.markSpace - radius * 1.8

    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fillStyle = state.kind === 'active' ? colors.accent : colors.accentAlt
    ctx.globalAlpha = state.kind === 'idle' ? 0.65 : 1
    ctx.fill()

    if (token.phraseRef) {
      const size = Math.max(9, Math.min(22, line.fontSize * 0.13))
      const font = ctx.font
      ctx.font = `${size}px ${display.font}`
      ctx.textAlign = 'center'
      ctx.globalAlpha = 0.7
      ctx.fillText(token.phraseRef, cx, cy - radius * 2.2)
      ctx.textAlign = 'left'
      ctx.font = font
    }
    ctx.globalAlpha = 1
  }
}

function drawSelection(ctx, line, selection, colors, layout, measure) {
  if (!selection || selection[0] === selection[1]) return
  const [from, to] = selection[0] < selection[1] ? selection : [selection[1], selection[0]]
  if (to < line.start || from > line.end) return

  const startCol = Math.max(0, from - line.start)
  const endCol = Math.min(line.text.length, to - line.start)
  const x1 = layout.padding + measure(line.text.slice(0, startCol)) * line.scale
  const x2 = layout.padding + measure(line.text.slice(0, endCol)) * line.scale
  ctx.fillStyle = colors.selection
  ctx.fillRect(x1, line.textTop, Math.max(2, x2 - x1), line.fontSize * 1.05)
}
