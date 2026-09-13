/**
 * Reading Chordonomicon's CSV without reading it into memory.
 *
 * The file is 252MB and 679,807 rows. Held as JavaScript strings that is around
 * half a gigabyte, so it is streamed: decoded in chunks, split into lines, and
 * written to IndexedDB a few thousand rows at a time. Nothing but the current
 * chunk is ever in memory.
 *
 * Rows are stored in the dialect they arrive in and converted when one is
 * actually looked at. Converting all of them on the way in would mean running
 * the chord converter across roughly seventy million words to produce something
 * nobody has asked to see yet.
 *
 * @see https://huggingface.co/datasets/ailsntua/Chordonomicon (CC-BY-NC-4.0)
 */

import { clearProgressions, putProgressions } from './progressionStore.js'

export const CHORDONOMICON_CSV =
  'https://huggingface.co/datasets/ailsntua/Chordonomicon/resolve/main/chordonomicon_v2.csv'

/**
 * Split one CSV line.
 *
 * The fast path is a plain split, which is what this file needs: its chord
 * fields are space-separated and nothing is quoted. The careful path only runs
 * on a line that actually contains a quote, so a different export of the same
 * data still reads correctly.
 */
export function splitCsvLine(line) {
  if (!line.includes('"')) return line.split(',')

  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(field)
      field = ''
    } else field += ch
  }
  out.push(field)
  return out
}

/** Bars, counted cheaply: every word that is not a `<section>` tag is one. */
export function countBars(chords) {
  let bars = 0
  for (const word of String(chords || '').split(' ')) {
    if (word && word.charCodeAt(0) !== 60) bars++
  }
  return bars
}

const cleanGenre = (value) => String(value || '').replace(/'/g, '').trim()

/**
 * @param {File|Blob} file the downloaded CSV
 * @param {{onProgress?: Function, batchSize?: number, limit?: number}} opts
 * @returns {Promise<{rows: number, skipped: number, bytes: number, ms: number}>}
 */
export async function importChordonomiconCsv(file, opts = {}) {
  const { onProgress = null, batchSize = 4000, limit = Infinity } = opts
  const started = Date.now()

  await clearProgressions()

  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader()
  let carry = ''
  let columns = null
  let rows = 0
  let skipped = 0
  let bytes = 0
  let batch = []

  const flush = async () => {
    if (!batch.length) return
    await putProgressions(batch)
    batch = []
    if (onProgress) onProgress({ rows, bytes, total: file.size })
  }

  const take = async (line) => {
    if (!line) return
    if (!columns) {
      columns = splitCsvLine(line).map((name) => name.trim())
      return
    }
    if (rows >= limit) return

    const cells = splitCsvLine(line)
    const at = (name) => cells[columns.indexOf(name)] || ''
    const chords = at('chords')
    if (!chords.trim()) {
      skipped++
      return
    }

    const genre = cleanGenre(at('main_genre')) || cleanGenre(at('genres').split(' ')[0])
    const decade = String(at('decade') || '').replace(/\.0$/, '')
    const id = at('id') || String(rows + 1)

    batch.push({
      n: rows,
      name: [genre, decade && `${decade}s`, `#${id}`].filter(Boolean).join(' '),
      chords,
      bars: countBars(chords),
      genre,
      decade,
      source: 'Chordonomicon',
    })
    rows++
    if (batch.length >= batchSize) await flush()
  }

  while (rows < limit) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.length
    carry += value
    const lines = carry.split('\n')
    carry = lines.pop()
    for (const line of lines) await take(line.endsWith('\r') ? line.slice(0, -1) : line)
  }
  if (carry && rows < limit) await take(carry.endsWith('\r') ? carry.slice(0, -1) : carry)
  await flush()

  try {
    await reader.cancel()
  } catch {
    /* already finished */
  }

  return { rows, skipped, bytes, ms: Date.now() - started }
}
