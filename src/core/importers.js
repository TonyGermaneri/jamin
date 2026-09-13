/**
 * Converters for chord collections published in other people's notation.
 *
 * These translate into the notation you type, so an imported progression is an
 * ordinary progression afterwards -- editable, transposable, indistinguishable
 * from one you wrote.
 *
 * On licensing: nothing here ships anyone's data. The converters are ours; the
 * collections stay wherever their authors put them, and you bring your own
 * copy. Chordonomicon in particular is CC-BY-NC-4.0, which the GPL cannot
 * absorb, so bundling it is not an option even if it were polite.
 */

/** `<verse_1>` and friends. */
const SECTION = /^<([a-z]+)_(\d+)>$/i

/**
 * Chordonomicon writes a whole song as one string: section tags interleaved
 * with space-separated chords.
 *
 *   "<intro_1> C <verse_1> F C E7 Amin C ... <chorus_1> F C F C G C"
 *
 * Its dialect differs from ours in exactly three ways, all confirmed against
 * the dataset rather than guessed:
 *
 *   - sharps are written `s`: `Fs7` is F#7, `A/Cs` is A/C#
 *   - except when that `s` starts `sus`: `Fsus4` is F sus4, never F# us4.
 *     Nothing in the corpus contains `ss`, so F#sus4 simply never arises
 *   - `no3d` is "no 3rd"
 *
 * @see https://huggingface.co/datasets/ailsntua/Chordonomicon (CC-BY-NC-4.0)
 */
export function chordonomiconToChart(chords) {
  const words = String(chords || '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  let current = []

  for (const word of words) {
    const section = SECTION.exec(word)
    if (section) {
      if (current.length) lines.push(current.join(' '))
      current = [`[${section[1].toLowerCase()} ${section[2]}]`]
      continue
    }
    current.push(normalizeChordonomiconChord(word))
  }
  if (current.length) lines.push(current.join(' '))

  return lines.join('\n')
}

export function normalizeChordonomiconChord(word) {
  return String(word)
    // Root sharp, unless the `s` is the start of `sus`.
    .replace(/^([A-G])s(?!us)/, '$1#')
    // Same for a slash bass.
    .replace(/\/([A-G])s(?!us)/, '/$1#')
    .replace(/no3d/gi, 'no3')
}

/** Does this look like Chordonomicon's dialect rather than plain chord names? */
export function looksLikeChordonomicon(text) {
  const value = String(text || '')
  return SECTION.test(value.trim().split(/\s+/)[0] || '') || /<[a-z]+_\d+>/i.test(value)
}

/**
 * Unwrap Hugging Face's datasets-server envelope, so a response can be pasted
 * straight in:
 *
 *   {"rows": [{"row_idx": 0, "row": {...}}, ...]}
 */
export function unwrapDatasetsServer(data) {
  if (!data || !Array.isArray(data.rows)) return null
  return data.rows.map((entry) => (entry && entry.row ? entry.row : entry)).filter(Boolean)
}

/** A readable name for a row that has no title of its own. */
export function describeChordonomiconRow(row, index) {
  const genre = row.main_genre || (Array.isArray(row.genres) ? row.genres[0] : row.genres) || ''
  const decade = row.decade ? `${row.decade}s` : ''
  const bits = [genre, decade].filter(Boolean).join(' ')
  return bits ? `${bits} #${row.id ?? index}` : `Chordonomicon #${row.id ?? index}`
}
