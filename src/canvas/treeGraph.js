/**
 * A catalogue's tree, explored by opening it.
 *
 * Not a force graph. The previous renderer was one, and almost everything it
 * offered was something this view does not want: it ran a physics simulation
 * over positions that are computed rather than settled into, so the simulation
 * had to be switched off in four places and the one that was missed made the
 * graph drift away from under the pointer; it took its configuration as a bag
 * of strings and silently ignored the keys it did not know, so the link
 * styling never once applied; and it drew a million points, which a picture
 * nobody can read does not need.
 *
 * What this is instead is the collapsible tree: d3-hierarchy for the layout,
 * and enter/update/exit for the interaction. That is the difference between a
 * graph that happens to contain a hierarchy and one made for exploring it:
 *
 *   * opening a node never clears the picture. Everything already on screen
 *     stays on screen and moves to where it now belongs.
 *   * children grow out of their parent, from the exact point it occupies, so
 *     where they came from is visible rather than inferred.
 *   * closing a node collapses its children back into it rather than deleting
 *     them, so it reads as the same gesture undone.
 *
 * Canvas rather than SVG because a wide level of a real catalogue is a few
 * thousand nodes and that many DOM elements is a scroll of jank; d3 does the
 * layout and the arithmetic and this does the painting.
 */
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import { quadtree } from 'd3-quadtree'
import { hierarchy, tree as tidyTree } from 'd3-hierarchy'

/** How near the pointer must be to a node to count as on it, in screen pixels. */
const GRAB = 14
/** How long opening or closing takes. Long enough to follow with an eye. */
const UNFOLD = 420

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2)

export class TreeGraph {
  constructor(box, { onPick = null, onHover = null, onOpen = null } = {}) {
    this.box = box
    this.onPick = onPick
    this.onHover = onHover
    this.onOpen = onOpen

    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    box.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.root = null
    this.drawn = []              // every node with a place, including those leaving
    this.look = { link: 'rgba(128,140,180,0.26)', linkWidth: 0.8, ring: 'rgba(255,255,255,0.9)' }
    this.hovered = -1
    this.chosen = null
    this.at = zoomIdentity
    this.frame = 0
    this.moving = 0
    this.dpr = 1
    this.spread = 1

    /*
     * The transform is the only thing panning changes.
     *
     * Positions are never touched by looking at the graph, which is what makes
     * it impossible for reading it to move it -- the failure the last renderer
     * had, where every zoom nudged the simulation.
     */
    this.zoom = zoom().scaleExtent([0.02, 40])
      .on('zoom', (event) => { this.at = event.transform; this.paintSoon() })
    select(this.canvas).call(this.zoom)

    this.canvas.addEventListener('mousemove', this.onMove)
    this.canvas.addEventListener('mouseleave', this.onLeave)
    this.canvas.addEventListener('click', this.onTap)
    this.canvas.addEventListener('dblclick', this.onDoubleTap)

    this.watching = new ResizeObserver(() => this.resize())
    this.watching.observe(box)
    this.resize()
  }

  /* ---------------- the tree ---------------- */

  /**
   * Take a catalogue's tree, and open it down to `openTo`.
   *
   * One level, for a real catalogue: the level below it is thousands of nodes
   * and reads as a solid band. @see components/CatalogueGraph.vue
   *
   * `{ nodes, parents }` in, a d3 hierarchy out. Collapsed children live on
   * `_children`, which is the convention every collapsible-tree example uses
   * and the reason d3's layout simply does not see them.
   */
  setTree(source, { openTo = 1 } = {}) {
    if (!source || !source.nodes || !source.nodes.length) {
      this.root = null
      this.drawn = []
      this.paintSoon()
      return
    }

    const made = source.nodes.map((one, at) => ({ ...one, at, children: [] }))
    const tops = []
    source.parents.forEach((parent, at) => {
      if (parent < 0) tops.push(made[at])
      else if (made[parent]) made[parent].children.push(made[at])
    })

    // One root above the libraries when there are several, so the layout has
    // something to hang them from. It is never drawn.
    const top = tops.length === 1 ? tops[0] : { label: '', at: -1, clips: 0, children: tops }
    this.root = hierarchy(top)
    this.root.each((node) => {
      node.shut = false
      if (node.depth >= openTo && node.children) {
        node._children = node.children
        node.children = null
        node.shut = true
      }
    })

    this.relayout({ animate: false })
    this.fitView()
  }

  /** Open or close one node, and travel to the new shape. */
  toggle(node) {
    if (!node) return
    if (node.children) {
      node._children = node.children
      node.children = null
      node.shut = true
    } else if (node._children) {
      node.children = node._children
      node._children = null
      node.shut = false
    } else {
      return
    }
    if (this.onOpen) this.onOpen(node.data, !node.shut)
    this.relayout({ animate: true })
  }

  /**
   * Where everything goes, and how it gets there.
   *
   * A radial tidy tree: d3 gives each node an angle and a depth, and the
   * radius is the depth times whatever spacing the open part of the tree
   * needs. Recomputed whenever the shape changes, because in a tidy tree
   * opening a node genuinely does move its siblings -- that is what keeps it
   * tidy, and the transition is what makes it readable rather than jarring.
   */
  relayout({ animate }) {
    if (!this.root) return

    const was = new Map()
    for (const one of this.drawn) was.set(one.node, { x: one.x, y: one.y })

    const open = this.root.descendants()
    const deepest = open.reduce((most, one) => Math.max(most, one.depth), 0)
    const ring = Math.max(90, Math.min(260, 1400 / Math.max(1, deepest)))

    tidyTree()
      .size([Math.PI * 2, deepest * ring])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(this.root)

    /*
     * Closing the circle, which a tidy tree does not know it is drawing.
     *
     * d3 lays a tree out along a line and places the first and last leaf at
     * the two ends of it. Bent into a ring those two ends are the same place,
     * so the first node and the last are drawn exactly on top of one another
     * -- invisible in a catalogue of two hundred, and the whole picture in a
     * catalogue of two, where the phrase book drew one dot and appeared to
     * have lost half its contents. It also quietly cost two labels on every
     * graph, culled for colliding with a node underneath them.
     *
     * So the leaves are spread over the ring rather than along it: `L` of
     * them at the centres of `L` equal arcs, leaving the same gap between the
     * last and the first as between any other pair. The remap is affine, so
     * the parents -- which d3 has already placed at the midpoints of their
     * children -- stay at the midpoints of them.
     */
    const leaves = open.reduce((many, one) => many + (one.children ? 0 : 1), 0)
    if (leaves > 1) {
      const squeeze = (leaves - 1) / leaves
      const shift = Math.PI / leaves
      for (const one of open) one.x = one.x * squeeze + shift
    }

    const next = open.map((node) => {
      const radius = node.depth * ring
      const x = Math.cos(node.x - Math.PI / 2) * radius
      const y = Math.sin(node.x - Math.PI / 2) * radius
      return { node, x, y, fromX: x, fromY: y, fade: 1 }
    })

    const real = (one) => one.node.depth > 0 || one.node.data.at >= 0

    if (!animate) {
      this.drawn = next.filter(real)
      this.tree = null
      this.paintSoon()
      return
    }

    /*
     * Where each node starts from.
     *
     * One that was already on screen starts where it was. A new one starts at
     * the place its parent occupied a moment ago -- so it is seen coming out
     * of the thing that was opened, rather than appearing somewhere and being
     * connected by a line after the fact.
     */
    for (const one of next) {
      const before = was.get(one.node)
      if (before) { one.fromX = before.x; one.fromY = before.y; continue }
      let up = one.node.parent
      let seed = null
      while (up && !seed) { seed = was.get(up) || null; up = up.parent }
      one.fromX = seed ? seed.x : one.x
      one.fromY = seed ? seed.y : one.y
      one.fade = 0
    }

    /*
     * And the ones leaving do not simply go.
     *
     * A closed node's children collapse into it and fade as they travel, so
     * closing reads as the same gesture as opening, undone. Deleting them
     * outright is what makes a tree feel like it is being rebuilt rather than
     * folded.
     */
    const here = new Set(next.map((one) => one.node))
    const going = []
    for (const one of this.drawn) {
      if (here.has(one.node)) continue
      let up = one.node.parent
      let seat = null
      while (up && !seat) {
        const found = next.find((two) => two.node === up)
        seat = found || null
        up = up.parent
      }
      if (!seat) continue
      going.push({ node: one.node, x: seat.x, y: seat.y, fromX: one.x, fromY: one.y, fade: 1, leaving: true })
    }

    this.travel([...next.filter(real), ...going])
  }

  /**
   * Walk every node from where it was to where it belongs.
   *
   * Nothing is added or removed while this runs -- the whole cast, arriving,
   * staying and leaving, is on screen for the entire journey. That is the
   * difference between a tree that opens and one that is rebuilt.
   */
  travel(all) {
    cancelAnimationFrame(this.moving)
    const began = performance.now()

    const step = () => {
      const through = Math.min(1, (performance.now() - began) / UNFOLD)
      const much = ease(through)
      for (const one of all) {
        one.drawX = one.fromX + (one.toX - one.fromX) * much
        one.drawY = one.fromY + (one.toY - one.fromY) * much
        one.alpha = one.leaving ? 1 - much : (one.fade === 0 ? much : 1)
      }
      this.tree = null
      this.paint()
      if (through < 1) { this.moving = requestAnimationFrame(step); return }

      // Landed. The ones that were leaving have gone, and everything else is
      // exactly where the layout put it.
      this.moving = 0
      this.drawn = all.filter((one) => !one.leaving)
      for (const one of this.drawn) {
        one.drawX = one.toX
        one.drawY = one.toY
        one.x = one.toX
        one.y = one.toY
        one.alpha = 1
      }
      this.tree = null
      this.paint()
    }

    for (const one of all) {
      one.toX = one.x
      one.toY = one.y
      one.drawX = one.fromX
      one.drawY = one.fromY
    }
    this.drawn = all
    this.moving = requestAnimationFrame(step)
  }

  /* ---------------- looking at it ---------------- */

  placeOf(one) {
    return [one.drawX ?? one.x, one.drawY ?? one.y]
  }

  /** A node's place on the screen, for putting a label over it. */
  screenOf(one) {
    const [x, y] = this.placeOf(one)
    return this.at.apply([x, y])
  }

  /**
   * How much of the canvas is actually clear.
   *
   * The canvas runs the whole window and the interface floats on top of it:
   * a bar of filters across the top, a detail panel down the right, a count
   * along the bottom. Fitting to the canvas therefore fits to a box a third
   * of which cannot be seen, and with only two nodes to place it put one of
   * them squarely behind the detail panel -- a graph that looked like it had
   * lost half its contents and had not.
   *
   * Each floating piece is measured here rather than declared as a number,
   * because the bar is one row or two depending on how many filters a
   * catalogue has and the panel is only there once something is picked -- but
   * it says for itself which edge it is on, as `data-keep-clear="right"`.
   * Working that out from the geometry instead was tried and was wrong: a
   * panel down the right-hand side sits against the bottom edge as snugly as
   * it does the right one, the tie went the wrong way, and the graph was
   * squeezed into the top corner with half of it behind the panel -- which is
   * the fault this was written to fix.
   */
  clearArea() {
    const box = { top: 0, right: 0, bottom: 0, left: 0 }
    const host = this.canvas && this.canvas.parentElement
    if (!host || !host.ownerDocument) return box

    const mine = this.canvas.getBoundingClientRect()
    if (!mine.width || !mine.height) return box

    for (const one of host.ownerDocument.querySelectorAll('[data-keep-clear]')) {
      const side = one.getAttribute('data-keep-clear')
      if (!Object.prototype.hasOwnProperty.call(box, side)) continue

      const there = one.getBoundingClientRect()
      if (!there.width || !there.height) continue
      if (there.right <= mine.left || there.left >= mine.right) continue
      if (there.bottom <= mine.top || there.top >= mine.bottom) continue

      const deep = side === 'top' ? there.bottom - mine.top
        : side === 'bottom' ? mine.bottom - there.top
          : side === 'left' ? there.right - mine.left
            : mine.right - there.left
      // Never more than half, so a panel that has grown to fill the window
      // leaves a graph rather than a sliver.
      const most = (side === 'top' || side === 'bottom' ? mine.height : mine.width) * 0.5
      box[side] = Math.max(box[side], Math.min(deep, most))
    }
    return box
  }

  fitView(padding = 80) {
    if (!this.drawn.length || !this.width) return
    let lowX = Infinity; let lowY = Infinity; let highX = -Infinity; let highY = -Infinity
    for (const one of this.drawn) {
      const [x, y] = this.placeOf(one)
      if (x < lowX) lowX = x
      if (x > highX) highX = x
      if (y < lowY) lowY = y
      if (y > highY) highY = y
    }
    const wide = Math.max(1, highX - lowX)
    const tall = Math.max(1, highY - lowY)

    const clear = this.clearArea()
    const room = Math.max(120, this.width - clear.left - clear.right - padding * 2)
    const high = Math.max(120, this.height - clear.top - clear.bottom - padding * 2)
    // The middle of what can be seen, which is not the middle of the canvas.
    const midX = clear.left + (this.width - clear.left - clear.right) / 2
    const midY = clear.top + (this.height - clear.top - clear.bottom) / 2

    const scale = Math.max(0.02, Math.min(40, Math.min(room / wide, high / tall)))
    select(this.canvas).call(this.zoom.transform, zoomIdentity
      .translate(midX, midY)
      .scale(scale)
      .translate(-(lowX + wide / 2), -(lowY + tall / 2)))
  }

  /** Put one node in the middle, at a readable size. */
  zoomToPoint(node, scale = 1.4) {
    const seat = this.drawn.find((one) => one.node === node)
    if (!seat) return
    const [x, y] = this.placeOf(seat)
    select(this.canvas).call(this.zoom.transform, zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(Math.max(0.02, Math.min(40, scale)))
      .translate(-x, -y))
  }

  index() {
    if (this.tree) return this.tree
    this.tree = quadtree()
      .x((one) => this.placeOf(one)[0])
      .y((one) => this.placeOf(one)[1])
      .addAll(this.drawn.filter((one) => !one.leaving))
    return this.tree
  }

  nodeAt(screenX, screenY) {
    if (!this.drawn.length) return null
    const [x, y] = this.at.invert([screenX, screenY])
    return this.index().find(x, y, GRAB / this.at.k) || null
  }

  spotOf(event) {
    const box = this.canvas.getBoundingClientRect()
    return this.nodeAt(event.clientX - box.left, event.clientY - box.top)
  }

  onMove = (event) => {
    const found = this.spotOf(event)
    const which = found ? found.node : null
    if (which === this.hovered) return
    this.hovered = which
    this.canvas.style.cursor = which ? 'pointer' : 'default'
    if (this.onHover) this.onHover(which ? which.data : null)
    this.paintSoon()
  }

  onLeave = () => {
    if (!this.hovered) return
    this.hovered = null
    if (this.onHover) this.onHover(null)
    this.paintSoon()
  }

  onTap = (event) => {
    const found = this.spotOf(event)
    if (!found) return
    this.chosen = found.node
    if (this.onPick) this.onPick(found.node.data)
    this.paintSoon()
  }

  onDoubleTap = (event) => {
    const found = this.spotOf(event)
    if (found) this.toggle(found.node)
  }

  /* ---------------- painting it ---------------- */

  resize() {
    const box = this.box.getBoundingClientRect()
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.width = Math.max(1, Math.round(box.width))
    this.height = Math.max(1, Math.round(box.height))
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
    this.paintSoon()
  }

  paintSoon() {
    if (this.frame || this.moving) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint() })
  }

  paint() {
    const ctx = this.ctx
    if (!ctx) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    if (!this.drawn.length) return

    const { x, y, k } = this.at
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(k, k)

    /*
     * Every edge in one path and one stroke.
     *
     * With the seats in a map rather than searched for: a tree has an edge per
     * node, and finding each parent by scanning the list is quadratic -- two
     * thousand nodes is four million comparisons a frame, sixty times a
     * second, for an answer that does not change during a frame.
     */
    const seats = new Map()
    for (const one of this.drawn) seats.set(one.node, one)

    ctx.beginPath()
    for (const one of this.drawn) {
      const up = one.node.parent
      if (!up) continue
      const seat = seats.get(up)
      if (!seat) continue
      const [ax, ay] = this.placeOf(one)
      const [bx, by] = this.placeOf(seat)
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
    }
    ctx.strokeStyle = this.look.link
    ctx.lineWidth = this.look.linkWidth / k
    ctx.stroke()

    for (const one of this.drawn) {
      const [px, py] = this.placeOf(one)
      const radius = Math.max(0.8, (one.node.data.size || 5) / 2) / k
      ctx.globalAlpha = one.alpha ?? 1
      ctx.beginPath()
      ctx.arc(px, py, radius, 0, Math.PI * 2)
      ctx.fillStyle = one.node.data.colour || 'rgba(140,155,205,0.92)'
      ctx.fill()
      // A node with more inside it says so, rather than looking like a leaf.
      if (one.node._children) {
        ctx.lineWidth = 1.4 / k
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1

    for (const [node, colour] of [[this.hovered, 'rgba(255,255,255,0.7)'],
                                  [this.chosen, this.look.ring]]) {
      if (!node) continue
      const seat = seats.get(node)
      if (!seat) continue
      const [px, py] = this.placeOf(seat)
      const radius = Math.max(0.8, (node.data.size || 5) / 2) / k
      ctx.beginPath()
      ctx.arc(px, py, radius + 3.5 / k, 0, Math.PI * 2)
      ctx.strokeStyle = colour
      ctx.lineWidth = 1.8 / k
      ctx.stroke()
    }

    ctx.restore()
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.moving)
    this.watching.disconnect()
    this.canvas.removeEventListener('mousemove', this.onMove)
    this.canvas.removeEventListener('mouseleave', this.onLeave)
    this.canvas.removeEventListener('click', this.onTap)
    this.canvas.removeEventListener('dblclick', this.onDoubleTap)
    select(this.canvas).on('.zoom', null)
    this.canvas.remove()
    this.ctx = null
  }
}
