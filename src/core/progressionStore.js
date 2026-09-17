/**
 * Somewhere to keep a very large collection of progressions.
 *
 * Chordonomicon is 679,807 progressions in a 252MB CSV. None of that fits in
 * localStorage, and holding it as JavaScript strings would cost around half a
 * gigabyte, so it goes into IndexedDB and is read a page at a time. Nothing but
 * the page you are looking at is ever in memory.
 *
 * Rows are keyed by insertion order, which makes paging a range read rather than
 * a cursor walk -- the difference between instant and unusable at this size.
 */

const DB_NAME = 'jamin'
const DB_VERSION = 1
const STORE = 'progressions'

let opening = null

function open() {
  if (opening) return opening
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'n' })
        store.createIndex('genre', 'genre', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('could not open the database'))
  })
  return opening
}

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('aborted'))
  })

const ask = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export async function clearProgressions() {
  const db = await open()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).clear()
  await done(tx)
}

/** Write a batch. Keys are assigned by the caller so paging stays a range read. */
export async function putProgressions(rows) {
  if (!rows.length) return
  const db = await open()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const row of rows) store.put(row)
  await done(tx)
}

export async function countProgressions() {
  try {
    const db = await open()
    return await ask(db.transaction(STORE, 'readonly').objectStore(STORE).count())
  } catch {
    return 0
  }
}

/** One page, by position. */
export async function pageProgressions(offset, limit) {
  if (limit <= 0) return []
  const db = await open()
  const store = db.transaction(STORE, 'readonly').objectStore(STORE)
  const range = IDBKeyRange.bound(offset, offset + limit - 1)
  return (await ask(store.getAll(range))) || []
}

/**
 * Find rows whose name, text or genre contains `query`.
 *
 * A full scan of two thirds of a million rows is not something to do on every
 * keystroke, so this stops at `limit` matches and says whether it reached the
 * end. Better a fast answer that admits it is partial.
 */
export async function searchProgressions(query, limit = 200, scanLimit = 60000, filters = {}) {
  const needle = String(query || '').trim().toLowerCase()
  const genre = String(filters.genre || '').trim().toLowerCase()
  const decade = String(filters.decade || '').trim()
  // How many bars the chart is, when only progressions that fit it are wanted.
  // Zero means the filter is off.
  const fits = Math.round(Number(filters.fits) || 0)
  if (!needle && !genre && !decade && !fits) return { rows: [], scanned: 0, complete: true }

  const db = await open()
  const store = db.transaction(STORE, 'readonly').objectStore(STORE)
  const rows = []
  let scanned = 0

  await new Promise((resolve, reject) => {
    const request = store.openCursor()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || rows.length >= limit || scanned >= scanLimit) {
        resolve()
        return
      }
      scanned++
      const row = cursor.value
      // Rows are stored in the dialect they arrived in, so the chords are
      // searched as written -- `chords`, not the converted `text`, which is only
      // produced for a row somebody actually looks at.
      const text = !needle
        || (row.name || '').toLowerCase().includes(needle)
        || (row.genre || '').toLowerCase().includes(needle)
        || (row.chords || '').toLowerCase().includes(needle)
      // Genre and decade are exact rather than substring: they are chosen from
      // a list of what is actually in the data, not typed.
      const byGenre = !genre || String(row.genre || '').toLowerCase() === genre
      const byDecade = !decade || String(row.decade || '') === decade
      // The same length as the song, or going into it a whole number of times:
      // a four-bar turnaround under sixteen bars is the same shape four times
      // over, and a five-bar one is a different song. Rows carry their own bar
      // count from the import, so this costs nothing to test.
      const byLength = !fits || (row.bars > 0 && fits % Math.round(row.bars) === 0)

      if (text && byGenre && byDecade && byLength) {
        rows.push(row)
      }
      cursor.continue()
    }
  })

  return { rows, scanned, complete: rows.length < limit && scanned < scanLimit }
}


/**
 * Which genres and decades the imported collection actually contains.
 *
 * Chordonomicon carries both per row, so they are real facets rather than
 * invented ones -- but there are hundreds of thousands of rows and no index on
 * either field, so this reads a sample rather than all of them. Genre and
 * decade each have a couple of dozen values at most, so a sample of this size
 * finds every one of them many times over; it is a sample for the sake of the
 * scan, not because the answer is uncertain.
 */
export async function progressionFacets(sample = 20000) {
  const db = await open()
  const store = db.transaction(STORE, 'readonly').objectStore(STORE)
  const genres = new Map()
  const decades = new Map()
  let scanned = 0

  await new Promise((resolve, reject) => {
    const request = store.openCursor()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || scanned >= sample) return resolve()
      scanned++
      const row = cursor.value
      const genre = String(row.genre || '').trim()
      const decade = String(row.decade || '').trim()
      if (genre) genres.set(genre, (genres.get(genre) || 0) + 1)
      if (decade) decades.set(decade, (decades.get(decade) || 0) + 1)
      cursor.continue()
    }
  })

  const rank = (counts) => [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }))

  return { genres: rank(genres), decades: rank(decades), scanned }
}

/**
 * Every row's words, handed over a batch at a time.
 *
 * The graph wants what each progression is described by -- its name, its genre,
 * its decade -- and nothing else about it. A cursor reads whole rows because
 * that is what a cursor does, so the cost is the read; which is why the answer
 * is built once and stored rather than recomputed.
 *
 * The same shape as drumStore's everyPath, deliberately: two catalogues, one
 * way of walking them. @see core/drumStore.js everyPath
 */
export async function everyProgressionText(onBatch, batchSize = 20000) {
  const db = await open()
  if (!db) return 0

  let batch = []
  let seen = 0

  await new Promise((resolve) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { resolve(); return }
      const row = cursor.value
      // Text, and the group it belongs to -- the genre here, which is the
      // nearest thing Chordonomicon has to a library. @see core/pathTree.js
      batch.push([[row.name, row.genre, row.decade].filter(Boolean).join(' / '),
                  row.genre || ''])
      seen++
      if (batch.length >= batchSize) {
        const mine = batch
        batch = []
        onBatch(mine, seen)
      }
      cursor.continue()
    }
    request.onerror = () => resolve()
  })

  if (batch.length) onBatch(batch, seen)
  return seen
}
