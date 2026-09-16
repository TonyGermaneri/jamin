/**
 * Which groove plays where.
 *
 * A binding is a section's name and the groove bound to it -- "the chorus plays
 * this" -- and it lives here rather than in the chart for the reason phrase
 * names do not carry catalogue numbers: `[d:g1841]` is unreadable and does not
 * survive the catalogue changing. The chart says what the parts are; this says
 * what they sound like.
 *
 * **A binding outlives its section.** Delete the `[Chorus]` marker and the
 * chorus's groove is not thrown away: charts get rewritten, and losing an
 * assignment because a label was retyped would be its own small disaster. The
 * binding is marked stale instead, and a stale binding can be deleted by hand.
 * One whose marker is still in the chart cannot be -- there is nothing to
 * delete, it would simply come back.
 */

/**
 * Where a browser tab keeps them.
 *
 * One key, because a browser tab is one jamin and there is no such thing as
 * another track in it. Inside a plugin this is a starting guess and nothing
 * more: several instances share one browser origin, so they shared this key --
 * binding a groove on the kit rebound it on the piano, and whichever instance
 * loaded last won. There, the bindings belong to the instance's own saved state
 * and travel with the project, per track. @see store.adoptSavedState
 */
export const DRUM_BINDINGS_KEY = 'jamin.drums.v1'

/** The section a chart with no sections has. Leading space so it cannot collide
    with anything somebody would type between brackets. */
export const WHOLE_SONG = ' song'

export function loadDrumBindings() {
  try {
    const raw = localStorage.getItem(DRUM_BINDINGS_KEY)
    return clean(raw ? JSON.parse(raw) : null)
  } catch {
    return {}
  }
}

export function saveDrumBindings(bindings) {
  try {
    localStorage.setItem(DRUM_BINDINGS_KEY, JSON.stringify(bindings || {}))
  } catch {
    /* nothing sensible to do */
  }
}

function clean(bindings) {
  const out = {}
  for (const [name, value] of Object.entries(bindings || {})) {
    if (!name || typeof value !== 'object' || value === null) continue
    out[name] = {
      groove: typeof value.groove === 'string' ? value.groove : null,
      fill: typeof value.fill === 'string' ? value.fill : null,
    }
  }
  return out
}

/**
 * Bring the bindings into line with the chart.
 *
 * Every section in the chart gets a row, whether or not anything is bound to it
 * yet -- an unassigned part you can see is a part you can assign, and one you
 * cannot see is a part you will not remember exists. Rows whose section is no
 * longer in the chart are kept and marked stale.
 *
 * Returns the rows to show, in the order the chart has them, stale ones last.
 */
export function reconcileBindings(bindings, sections) {
  const present = []
  const seen = new Set()

  const named = (sections || []).map((section) => section.name).filter(Boolean)
  const list = named.length ? named : [WHOLE_SONG]

  for (const name of list) {
    if (seen.has(name)) continue          // two choruses are one binding
    seen.add(name)
    const bound = bindings[name] || {}
    present.push({
      name,
      groove: bound.groove || null,
      fill: bound.fill || null,
      stale: false,
      wholeSong: name === WHOLE_SONG,
    })
  }

  const stale = []
  for (const [name, bound] of Object.entries(bindings || {})) {
    if (seen.has(name)) continue
    stale.push({
      name,
      groove: bound.groove || null,
      fill: bound.fill || null,
      stale: true,
      wholeSong: name === WHOLE_SONG,
    })
  }

  stale.sort((a, b) => a.name.localeCompare(b.name))
  return [...present, ...stale]
}

/** Bind, or unbind with null. Returns a new map; nothing is mutated. */
export function bindGroove(bindings, name, grooveId, what = 'groove') {
  if (!name) return bindings

  const next = { ...bindings }
  const row = { groove: null, fill: null, ...(next[name] || {}) }
  row[what === 'fill' ? 'fill' : 'groove'] = grooveId || null

  if (!row.groove && !row.fill) delete next[name]
  else next[name] = row

  return next
}

/**
 * Which slot a groove is in for a part: its groove, its fill, or neither.
 *
 * Any pattern can be either. What a library *calls* a pattern is a guess made
 * from its file name and its length -- "1 Bar Fills" in the path, eight bars or
 * fewer -- and a guess is not a rule. A two-bar pattern nobody labelled is a
 * perfectly good fill, and refusing it because of what a vendor typed in a
 * folder name is the interface arguing with somebody about their own library.
 */
export function slotOf(bindings, name, grooveId) {
  const row = (bindings || {})[name]
  if (!row || !grooveId) return ''
  if (row.groove === grooveId) return 'groove'
  if (row.fill === grooveId) return 'fill'
  return ''
}

/**
 * The next of the three states: nothing, the part's groove, the part's fill.
 *
 * What the pattern is labelled decides only which slot the *first* step reaches
 * -- something labelled a fill offers itself as a fill first, because a fill
 * played for eight bars is a bad first result -- and both slots are always
 * reachable from either starting point.
 */
export function nextSlot(current, kind) {
  const first = kind === 'fill' ? 'fill' : 'groove'
  const second = first === 'fill' ? 'groove' : 'fill'
  if (!current) return first
  return current === first ? second : ''
}

/**
 * Round the three states, returning the new bindings and where it landed.
 *
 * Moving between slots is a clear and a set rather than a change: a groove
 * leaving the groove slot has to actually leave it, or a pattern would end up
 * being both the section's groove and the fill that leads out of it.
 */
export function cycleBinding(bindings, name, grooveId, kind) {
  if (!name || !grooveId) return { bindings, slot: '' }

  const now = slotOf(bindings, name, grooveId)
  const slot = nextSlot(now, kind)

  let next = bindings
  if (now) next = bindGroove(next, name, null, now)
  if (slot) next = bindGroove(next, name, grooveId, slot)

  return { bindings: next, slot }
}

/**
 * Forget a binding.
 *
 * Refused while the section is still in the chart: there would be nothing to
 * delete. The row is generated from the chart, so it would be back before the
 * dialog had finished redrawing, which looks like a broken button rather than a
 * rule. @see reconcileBindings
 */
export function forgetBinding(bindings, name, sections) {
  const inChart = (sections || []).some((section) => section.name === name)
  if (inChart || !(name in (bindings || {}))) return bindings

  const next = { ...bindings }
  delete next[name]
  return next
}

/** How many parts are still waiting for a groove. */
export function unassigned(rows) {
  return rows.filter((row) => !row.stale && !row.groove).length
}
