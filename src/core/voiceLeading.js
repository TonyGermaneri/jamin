/**
 * Voice leading: move as little as possible.
 *
 * Two jobs here.  One is picking a voicing for the next chord that sits close to
 * the one that just finished -- common tones stay put, everything else takes the
 * shortest available step.  The other is re-pointing a captured phrase at a new
 * chord: work out how each pitch class of the phrase's original chord maps onto
 * the new chord, then carry every note (chord tone or passing tone) along that
 * same map, so the shape of the lick survives the harmony changing underneath it.
 *
 * Background: the "law of the shortest way" from classical part-writing, and the
 * bijective-minimal-voice-leading framing in Tymoczko's geometry of chords --
 * with n voices the cheapest mapping between two chords of the same size is
 * always one of the n cyclic rotations, which is why the search below is a loop
 * over rotations rather than a full permutation search.
 */

export const mod12 = (n) => ((n % 12) + 12) % 12

/** Shortest signed distance from one pitch class to another, in [-6, 6]. */
export function signedDelta(fromPc, toPc) {
  let d = mod12(toPc - fromPc)
  if (d > 6) d -= 12
  return d
}

function uniqSorted(pcs) {
  return [...new Set((pcs || []).map(mod12))].sort((a, b) => a - b)
}

/**
 * Cheapest mapping from one chord's pitch classes to another's.
 * @returns {Map<number, number>} source pitch class -> signed semitone move
 */
export function minimalMap(sourcePcs, targetPcs) {
  const source = uniqSorted(sourcePcs)
  const target = uniqSorted(targetPcs)
  const map = new Map()
  if (!source.length || !target.length) return map

  if (source.length === target.length) {
    let best = null
    for (let rotation = 0; rotation < target.length; rotation++) {
      let cost = 0
      const pairs = []
      for (let i = 0; i < source.length; i++) {
        const delta = signedDelta(source[i], target[(i + rotation) % target.length])
        cost += Math.abs(delta)
        pairs.push([source[i], delta])
      }
      if (!best || cost < best.cost) best = { cost, pairs }
    }
    for (const [pc, delta] of best.pairs) map.set(pc, delta)
    return map
  }

  // Different sizes: hand out the closest pairings first, one target per source
  // until the targets run out, then let the stragglers double up.
  const pairs = []
  for (const s of source) for (const t of target) pairs.push({ s, t, delta: signedDelta(s, t) })
  pairs.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.s - b.s)

  const takenTargets = new Set()
  for (const pair of pairs) {
    if (map.has(pair.s) || takenTargets.has(pair.t)) continue
    map.set(pair.s, pair.delta)
    takenTargets.add(pair.t)
  }
  for (const pair of pairs) if (!map.has(pair.s)) map.set(pair.s, pair.delta)
  return map
}

/** Total movement needed to get from one set of sounding notes to another. */
export function voicingDistance(fromNotes, toNotes) {
  if (!fromNotes || !fromNotes.length || !toNotes.length) return 0
  let total = 0
  for (const note of toNotes) {
    let nearest = Infinity
    for (const previous of fromNotes) nearest = Math.min(nearest, Math.abs(note - previous))
    total += nearest
  }
  return total / toNotes.length
}

const average = (list) => list.reduce((a, b) => a + b, 0) / list.length

/**
 * Re-point a phrase at a different chord.
 *
 * Chord tones follow the minimal map.  Notes that were not in the source chord
 * (passing tones, approach notes, colour) move by whatever their nearest chord
 * tone moved, which keeps them the same distance from the harmony they were
 * decorating.  The whole result is then octave-shifted back to the register the
 * phrase was played in, so a lick never jumps a register just because the map
 * happened to point downward.
 *
 * @param {number[]} notes MIDI note numbers as played
 * @param {number[]} sourcePcs pitch classes of the chord it was played over
 * @param {number[]} targetPcs pitch classes of the chord to move it to
 */
export function remapPhraseNotes(notes, sourcePcs, targetPcs, opts = {}) {
  const { keepRegister = true, snapNonChordTones = false, range = [0, 127] } = opts
  if (!notes.length) return []

  const source = uniqSorted(sourcePcs)
  const target = uniqSorted(targetPcs)
  if (!source.length || !target.length) return notes.slice()

  const map = minimalMap(source, target)

  let out = notes.map((note) => {
    const pc = mod12(note)
    if (map.has(pc)) return note + map.get(pc)

    let anchor = source[0]
    let nearest = Infinity
    for (const candidate of source) {
      const distance = Math.abs(signedDelta(pc, candidate))
      if (distance < nearest) {
        nearest = distance
        anchor = candidate
      }
    }
    const moved = note + (map.get(anchor) ?? 0)
    if (!snapNonChordTones) return moved

    let best = moved
    let bestDistance = Infinity
    for (const pitchClass of target) {
      const delta = signedDelta(mod12(moved), pitchClass)
      if (Math.abs(delta) < bestDistance) {
        bestDistance = Math.abs(delta)
        best = moved + delta
      }
    }
    return best
  })

  if (keepRegister) {
    const shift = Math.round((average(notes) - average(out)) / 12) * 12
    if (shift) out = out.map((note) => note + shift)
  }

  return out.map((note) => clampOctave(note, range[0], range[1]))
}

/**
 * Choose the octave a phrase sits in: whichever placement moves least from
 * `anchor`, which is normally the phrase as it sounded over the previous chord.
 * That is what keeps a repeating figure from jumping registers mid-progression.
 */
export function anchorOctave(notes, anchor, range = [0, 127]) {
  if (!notes.length) return []

  // The phrase moves as a block. A two-handed part spans three octaves or more,
  // and folding individual notes into range would drop the left hand on top of
  // the right; better to shift the whole thing and accept the closest fit.
  const target = anchor && anchor.length ? average(anchor) : average(notes)
  let best = null
  let bestScore = Infinity

  for (let offset = -36; offset <= 36; offset += 12) {
    const low = Math.min(...notes) + offset
    const high = Math.max(...notes) + offset
    const overflow = Math.max(0, range[0] - low) + Math.max(0, high - range[1])
    const drift = Math.abs(average(notes) + offset - target)
    // Staying inside the range matters far more than sitting near the anchor.
    const score = overflow * 10 + drift
    if (score < bestScore) {
      bestScore = score
      best = offset
    }
  }

  const shifted = notes.map((note) => note + best)
  // Only an individual note still outside the instrument gets folded.
  return shifted.map((note) => (note < 0 || note > 127 ? clampOctave(note, 0, 127) : note))
}

const sameSet = (a, b) => a.length === b.length && a.every((value, i) => value === b[i])

/**
 * Put a phrase over a chord.
 *
 * Root first, shape second. The phrase is transposed so its root lands on the
 * new chord's root, which is what keeps its degrees intact -- a lick that
 * outlined root, b3, 5, b7 still outlines root, b3, 5, b7. Only if the new chord
 * is a different *shape* does the minimal-movement map get involved, and by then
 * both chords share a root, so the root stays the root.
 *
 * Doing it the other way round -- minimal movement first -- silently rotates the
 * degrees: over Fm7 to Dm7 the cheapest mapping keeps F where it is, turning the
 * lick's root into the new chord's third.
 *
 * @param {number[]} notes
 * @param {{rootPc: number, pcs: number[]}} source chord it was played over
 * @param {{rootPc: number, pcs: number[]}} target chord to put it over
 * @param {{anchor?: number[], range?: number[], snapNonChordTones?: boolean}} opts
 */
export function realizePhrase(notes, source, target, opts = {}) {
  const { anchor = null, range = [0, 127], snapNonChordTones = false } = opts
  if (!notes.length) return []
  if (!target || target.rootPc === null || target.rootPc === undefined || !target.pcs.length) {
    return notes.slice()
  }

  const shift = signedDelta(source.rootPc, target.rootPc)
  const moved = notes.map((note) => note + shift)
  const movedPcs = [...new Set(source.pcs.map((pc) => mod12(pc + shift)))].sort((a, b) => a - b)
  const wanted = [...new Set(target.pcs.map(mod12))].sort((a, b) => a - b)

  // Same shape: transposition alone is exact, and every degree survives.
  const mapped = sameSet(movedPcs, wanted)
    ? moved
    : remapPhraseNotes(moved, movedPcs, wanted, { keepRegister: false, snapNonChordTones, range })

  return anchorOctave(mapped, anchor && anchor.length ? anchor : notes, range)
}

/** Pull a note into range by octaves rather than squashing it to the boundary. */
export function clampOctave(note, low, high) {
  let n = note
  while (n < low) n += 12
  while (n > high) n -= 12
  return Math.max(low, Math.min(high, n))
}
