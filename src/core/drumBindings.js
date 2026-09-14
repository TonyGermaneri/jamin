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
