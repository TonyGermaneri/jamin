/**
 * The circle of fifths, drawn.
 *
 * It was twelve absolutely positioned buttons on a round div, and it looked
 * like twelve absolutely positioned buttons on a round div: the labels sat
 * wherever their boxes ended up, five of the places carried two names
 * stacked on each other, and the middle of it said the word "fifths" in
 * case the shape was not clear. A circle is a drawing. Drawn, the sectors
 * meet exactly, the type sits on the radius, and the whole thing costs one
 * canvas instead of a dozen elements with transforms on them.
 *
 * Two rings, which is the arrangement the wheel has always had and the
 * markup could not express: the seven naturals on the outside and the five
 * accidentals inside them. Reading round the outside gives C G D A E B ...
 * F, the keys with no accidentals in them, and the inside carries the five
 * that do -- so where the sharps and flats live is visible rather than
 * spelled out.
 *
 * Geometry and painting only. What the places are is @see core/chordPicker.js
 * and the pointing is the component's.
 */

/** The bands, as fractions of the radius. Outer edge, the line between, hub. */
const RING = { outer: 1, split: 0.66, hub: 0.34 }

/** A quarter turn back, so the first place is at the top rather than east. */
const START = -Math.PI / 2

/**
 * Where everything is, for a wheel of this size.
 *
 * One place per sector, each a twelfth of the circle. `mid` is the angle
 * the label sits on and `from`/`to` the edges the dividers are drawn at --
 * both wanted, and computing the second from the first at three call sites
 * is how a divider ends up half a degree off the sector it divides.
 */
export function wheelGeometry(size, places) {
  const radius = size / 2
  const step = (Math.PI * 2) / places.length

  return {
    size,
    radius,
    centre: radius,
    outer: radius * RING.outer,
    split: radius * RING.split,
    hub: radius * RING.hub,
    sectors: places.map((place, at) => {
      const from = START + at * step - step / 2
      const mid = START + at * step
      // Naturals ride the outer band, accidentals the inner one.
      const band = place.natural
        ? (RING.outer + RING.split) / 2
        : (RING.split + RING.hub) / 2
      return {
        ...place,
        at,
        from,
        to: from + step,
        mid,
        x: radius + Math.cos(mid) * radius * band,
        y: radius + Math.sin(mid) * radius * band,
      }
    }),
  }
}

/** Which sector a point is in, or -1. The hub is not a sector. */
export function sectorAt(geometry, x, y) {
  const dx = x - geometry.centre
  const dy = y - geometry.centre
  const away = Math.hypot(dx, dy)
  if (away > geometry.outer || away < geometry.hub) return -1

  const step = (Math.PI * 2) / geometry.sectors.length
  // Measured from the first sector's leading edge, so the arithmetic is one
  // division rather than a search.
  const turn = Math.atan2(dy, dx) - (START - step / 2)
  const round = ((turn % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return Math.min(geometry.sectors.length - 1, Math.floor(round / step))
}

/** `#rgb`/`#rrggbb` mixed with another, opaque. Canvas composites badly. */
function mix(over, under, amount) {
  const read = (hex) => {
    const clean = String(hex || '').trim().replace('#', '')
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
    const n = Number.parseInt(full, 16)
    if (!Number.isFinite(n) || full.length !== 6) return [128, 128, 128]
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const a = read(over)
  const b = read(under)
  const t = Math.max(0, Math.min(1, amount))
  return `rgb(${[0, 1, 2].map((i) => Math.round(b[i] + (a[i] - b[i]) * t)).join(',')})`
}

/** One annulus sector as a path, ready to fill. */
function wedge(ctx, geometry, sector, from, to) {
  ctx.beginPath()
  ctx.arc(geometry.centre, geometry.centre, to, sector.from, sector.to)
  ctx.arc(geometry.centre, geometry.centre, from, sector.to, sector.from, true)
  ctx.closePath()
}

/**
 * Paint it.
 *
 * `theme` is jamin's own palette rather than anything of this file's: a
 * control in a colour scheme nothing else on screen uses reads as a
 * different program. @see core/themes.js
 */
export function drawWheel(ctx, geometry, { theme, hovered = -1, chosen = '', dpr = 1 }) {
  const ground = theme.surface || theme.bg
  const ink = theme.fg
  const line = mix(theme.dim, ground, 0.55)
  const faint = mix(theme.dim, ground, 0.22)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, geometry.size, geometry.size)

  /*
   * The two bands, filled before anything is drawn on them.
   *
   * The inner one a shade lighter than the outer, which is what makes it
   * read as inset rather than as a circle with a line across it. Both are
   * opaque: a translucent fill over a canvas composites against the last
   * frame rather than against the surface behind it, so a hover would
   * darken a little more each time the pointer crossed it.
   */
  for (const sector of geometry.sectors) {
    const lit = sector.at === hovered
    const here = sector.name === chosen

    wedge(ctx, geometry, sector, geometry.split, geometry.outer)
    ctx.fillStyle = sector.natural && lit ? mix(theme.accent, ground, 0.3)
      : sector.natural && here ? mix(theme.accent, ground, 0.18)
        : mix(ink, ground, 0.05)
    ctx.fill()

    wedge(ctx, geometry, sector, geometry.hub, geometry.split)
    ctx.fillStyle = !sector.natural && lit ? mix(theme.accent, ground, 0.3)
      : !sector.natural && here ? mix(theme.accent, ground, 0.18)
        : mix(ink, ground, 0.11)
    ctx.fill()
  }

  /*
   * The dividers, drawn in one pass over the top.
   *
   * Per sector they would be drawn twice -- once as each neighbour's edge
   * -- and a hairline painted twice is a hairline at double the weight,
   * which is visible against the ones that are not.
   */
  ctx.beginPath()
  for (const sector of geometry.sectors) {
    ctx.moveTo(geometry.centre + Math.cos(sector.from) * geometry.hub,
      geometry.centre + Math.sin(sector.from) * geometry.hub)
    ctx.lineTo(geometry.centre + Math.cos(sector.from) * geometry.outer,
      geometry.centre + Math.sin(sector.from) * geometry.outer)
  }
  ctx.strokeStyle = line
  ctx.lineWidth = 1
  ctx.stroke()

  // And the three circles that make it a double inset ring.
  for (const [at, weight] of [[geometry.outer, 1.5], [geometry.split, 1], [geometry.hub, 1]]) {
    ctx.beginPath()
    ctx.arc(geometry.centre, geometry.centre, at, 0, Math.PI * 2)
    ctx.strokeStyle = at === geometry.outer ? line : faint
    ctx.lineWidth = weight
    ctx.stroke()
  }

  /*
   * The names, upright.
   *
   * Not rotated to the radius. A wheel with the type turned round it is a
   * wheel you read by tilting your head, and this is a thing somebody is
   * pointing at in a hurry.
   */
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const sector of geometry.sectors) {
    const lit = sector.at === hovered || sector.name === chosen
    ctx.fillStyle = lit ? ink : mix(ink, ground, 0.78)
    ctx.font = `${sector.natural ? 600 : 500} ${sector.natural ? 15 : 13}px `
      + 'ui-sans-serif, system-ui, -apple-system, sans-serif'
    // The accidentals in the typographer's signs, which is what a chart
    // shows; what gets written is still `F#` and `Bb`.
    ctx.fillText(sector.name.replace('#', '♯').replace('b', '♭'),
      sector.x, sector.y)
  }
}
