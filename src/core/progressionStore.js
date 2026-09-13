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
export async function searchProgressions(query, limit = 200, scanLimit = 60000) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return { rows: [], scanned: 0, complete: true }

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
      if (
        (row.name || '').toLowerCase().includes(needle) ||
        (row.genre || '').toLowerCase().includes(needle) ||
        (row.chords || '').toLowerCase().includes(needle)
      ) {
        rows.push(row)
      }
      cursor.continue()
    }
  })

  return { rows, scanned, complete: rows.length < limit && scanned < scanLimit }
}
