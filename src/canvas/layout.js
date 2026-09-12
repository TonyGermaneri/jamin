/**
 * Text layout for the canvas editor.
 *
 * Every line is scaled independently so it fills the width of the window -- a
 * bar of four chords is small, a single chord is huge.  That is why this is a
 * canvas and not a textarea: no DOM text control can do per-line fitting and
 * still let us hang arbitrary paint on one specific typed word.
 *
 * Nothing in here touches the DOM.  Widths come from an injected `measure(text)`
 * function that reports the width of `text` at REFERENCE_SIZE; because canvas
 * text advances scale linearly with font size, one measurement per string is
 * enough for every scale we might draw it at.
 */

export const REFERENCE_SIZE = 100
export const BASELINE_RATIO = 0.78

/**
 * @param {object} score result of parseScore
 * @param {{width: number, measure: (text: string) => number, display: object}} ctx
 */
export function layoutChart(score, ctx) {
  const { width, measure, display } = ctx
  const padding = display.padding
  const usable = Math.max(40, width - padding * 2)
  const lines = []
  let top = padding

  for (const line of score.lines) {
    const referenceWidth = measure(line.text)
    let fontSize

    if (!line.text.length) {
      fontSize = display.minFontSize
    } else if (display.fitLines) {
      fontSize = clamp((usable / referenceWidth) * REFERENCE_SIZE, display.minFontSize, display.maxFontSize)
    } else {
      fontSize = display.maxFontSize
    }

    const scale = fontSize / REFERENCE_SIZE
    const height = fontSize * display.lineHeight
    const laid = {
      index: line.index,
      start: line.start,
      end: line.end,
      text: line.text,
      fontSize,
      scale,
      top,
      height,
      baseline: top + fontSize * BASELINE_RATIO,
      width: referenceWidth * scale,
      tokens: [],
      runs: [],
    }

    // Runs cover the whole line -- tokens and the whitespace between them --
    // each with its x already resolved, so drawing never has to measure again.
    let cursor = 0
    for (const tokenIndex of line.tokens) {
      const token = score.tokens[tokenIndex]
      const localStart = token.start - line.start
      const localEnd = token.end - line.start
      if (localStart > cursor) {
        laid.runs.push({ from: cursor, to: localStart, x: padding + measure(line.text.slice(0, cursor)) * scale, rect: null })
      }

      const x = padding + measure(line.text.slice(0, localStart)) * scale
      const bodyPrefix = line.text.slice(0, token.bodyStart - line.start)
      const rect = {
        tokenIndex,
        token,
        x,
        w: measure(token.text) * scale,
        y: top,
        h: height,
        bodyX: padding + measure(bodyPrefix) * scale,
        bodyW: measure(token.body || token.text) * scale,
      }
      laid.tokens.push(rect)
      laid.runs.push({ from: localStart, to: localEnd, x, rect })
      cursor = localEnd
    }
    if (cursor < line.text.length) {
      laid.runs.push({ from: cursor, to: line.text.length, x: padding + measure(line.text.slice(0, cursor)) * scale, rect: null })
    }

    lines.push(laid)
    top += height
  }

  return { lines, padding, height: top + padding, width }
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/** Which laid-out line contains a character index. */
export function lineForIndex(layout, index) {
  for (const line of layout.lines) {
    if (index <= line.end) return line
  }
  return layout.lines[layout.lines.length - 1] || null
}

/** Caret rectangle for a character index. */
export function caretRect(layout, index, measure) {
  const line = lineForIndex(layout, index)
  if (!line) return { x: layout.padding, y: layout.padding, h: 20 }
  const column = Math.max(0, Math.min(line.text.length, index - line.start))
  const x = layout.padding + measure(line.text.slice(0, column)) * line.scale
  return { x, y: line.top + line.height * 0.08, h: line.fontSize * 1.02, line }
}

/** Character index nearest a point, for click-to-place-caret. */
export function indexAtPoint(layout, x, y, measure) {
  if (!layout.lines.length) return 0
  let line = layout.lines[0]
  for (const candidate of layout.lines) {
    if (y >= candidate.top) line = candidate
    else break
  }

  const target = (x - layout.padding) / line.scale
  let lo = 0
  let hi = line.text.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (measure(line.text.slice(0, mid + 1)) - target < 0) lo = mid + 1
    else hi = mid
  }
  // Snap to whichever side of the glyph the click landed on.
  const before = measure(line.text.slice(0, lo))
  const after = measure(line.text.slice(0, Math.min(line.text.length, lo + 1)))
  const column = target - before > after - target && lo < line.text.length ? lo + 1 : lo
  return line.start + column
}

/** Move a caret up or down a line, keeping roughly the same horizontal spot. */
export function verticalMove(layout, index, direction, measure) {
  const line = lineForIndex(layout, index)
  if (!line) return index
  const next = layout.lines[line.index + direction]
  if (!next) return direction < 0 ? 0 : layout.lines[layout.lines.length - 1].end
  const column = Math.max(0, index - line.start)
  const x = layout.padding + measure(line.text.slice(0, column)) * line.scale
  return indexAtPoint(layout, x, next.top + next.height * 0.5, measure)
}

/** The drawn rectangle for a given score token index, if it is on screen. */
export function rectForToken(layout, tokenIndex) {
  for (const line of layout.lines) {
    for (const rect of line.tokens) if (rect.tokenIndex === tokenIndex) return rect
  }
  return null
}

/**
 * A string-width cache on its own canvas.
 *
 * It gets a private 2D context deliberately: the drawing context changes its
 * font on every line, so measuring through it would silently return widths at
 * whatever size happened to be drawn last.
 */
export function createMeasurer(font, limit = 4000) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const cache = new Map()
  let spec = `${REFERENCE_SIZE}px ${font}`
  ctx.font = spec

  const measure = (text) => {
    if (!text) return 0
    const hit = cache.get(text)
    if (hit !== undefined) return hit
    ctx.font = spec
    const width = ctx.measureText(text).width
    if (cache.size > limit) cache.clear()
    cache.set(text, width)
    return width
  }

  measure.reset = (nextFont) => {
    cache.clear()
    spec = `${REFERENCE_SIZE}px ${nextFont || font}`
    ctx.font = spec
  }

  return measure
}
