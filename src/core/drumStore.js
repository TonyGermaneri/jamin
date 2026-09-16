/**
 * Where an imported drum library lives.
 *
 * The same arrangement Chordonomicon uses and for the same reason: it is far
 * too much to keep in memory and it is not ours to ship, so it goes into the
 * browser's own database on the machine it was read from and never leaves.
 *
 * Two stores. A **set** is a folder somebody imported -- its name, how many
 * patterns it holds, what the sampling found out about it, and the kit its
 * notes were written for. A **groove** is one pattern, stored in the same
 * compact shape as the bundled corpus.
 *
 * The kit is per set because a library is written for a particular instrument
 * and two libraries are not written for the same one. One folder is General
 * MIDI, the next uses pitches below 35 that General MIDI has no name for, and
 * a single global setting cannot be right for both.
 */

const DB_NAME = 'jamin.drums'
const DB_VERSION = 1
const SETS = 'sets'
const GROOVES = 'grooves'

let handle = null

function open() {
  if (handle) return handle

  handle = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SETS)) {
        db.createObjectStore(SETS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(GROOVES)) {
        const store = db.createObjectStore(GROOVES, { keyPath: 'id' })
        // By set, so deleting a library does not walk every row; by kind and
        // length, which are the two filters that actually narrow a catalogue of
        // several hundred thousand.
        store.createIndex('set', 's')
        store.createIndex('kind', 'k')
        store.createIndex('bars', 'r')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })

  return handle
}

const ask = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const done = (tx) =>
  new Promise((resolve) => {
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
    tx.onabort = () => resolve(false)
  })

/* ------------------------------------------------------------------ sets */

export async function listSets() {
  const db = await open()
  if (!db) return []
  try {
    const rows = await ask(db.transaction(SETS, 'readonly').objectStore(SETS).getAll())
    return rows.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
  } catch {
    return []
  }
}

export async function putSet(set) {
  const db = await open()
  if (!db) return false
  const tx = db.transaction(SETS, 'readwrite')
  tx.objectStore(SETS).put(set)
  return done(tx)
}

/** How many rows go in one deleting transaction. @see deleteSet */
const SWEEP = 2000

/**
 * A set and everything in it, a batch at a time.
 *
 * It used to be one transaction holding a cursor over every row in the library.
 * For a library of three hundred and sixty thousand that is minutes of work
 * inside a single write lock, with nothing able to report on it and nothing
 * else able to touch the database until it finished. It looked like the
 * program had hung, because from the outside there is no difference.
 *
 * So it goes in sweeps: a page of keys, a transaction to delete them, and the
 * interface gets a turn in between. `onProgress(done, total)` is called after
 * each one, which is the whole point -- a number that moves is the difference
 * between waiting and despairing.
 *
 * The set's own row goes last. While it is there the library is still listed,
 * still says how many patterns it had, and a removal interrupted half way can
 * simply be asked for again.
 */
export async function deleteSet(id, onProgress = null) {
  const db = await open()
  if (!db) return false

  const range = IDBKeyRange.only(id)
  let total = 0
  try {
    total = await ask(db.transaction(GROOVES, 'readonly').objectStore(GROOVES).index('set').count(range))
  } catch {
    total = 0
  }

  let removed = 0
  if (onProgress) onProgress(0, total)

  for (;;) {
    let keys = []
    try {
      const store = db.transaction(GROOVES, 'readonly').objectStore(GROOVES)
      keys = await ask(store.index('set').getAllKeys(range, SWEEP))
    } catch {
      break
    }
    if (!keys.length) break

    const tx = db.transaction(GROOVES, 'readwrite')
    const store = tx.objectStore(GROOVES)
    for (const key of keys) store.delete(key)
    if (!(await done(tx))) break

    removed += keys.length
    if (onProgress) onProgress(removed, total)
    // A turn for the interface, so the number somebody is watching actually
    // moves rather than arriving all at once at the end.
    await new Promise((resume) => setTimeout(resume, 0))
  }

  const last = db.transaction(SETS, 'readwrite')
  last.objectStore(SETS).delete(id)
  return done(last)
}

/* --------------------------------------------------------------- grooves */

/**
 * A batch. Import writes in batches so a library of several hundred thousand
 * can be interrupted, and so the page is not held for a minute at a time.
 *
 * Returns nothing when it worked and the browser's own name for the trouble
 * when it did not -- `QuotaExceededError`, most likely, twenty minutes into a
 * job. Guessing at the reason in a message is worse than repeating the one
 * word the browser used, which is a word somebody can look up.
 */
export async function putGrooves(rows) {
  const db = await open()
  if (!db) return 'NoDatabase'
  if (!rows.length) return ''

  const tx = db.transaction(GROOVES, 'readwrite')
  const store = tx.objectStore(GROOVES)
  try {
    for (const row of rows) store.put(row)
  } catch (error) {
    return (error && error.name) || 'UnknownError'
  }

  return new Promise((resolve) => {
    tx.oncomplete = () => resolve('')
    tx.onerror = () => resolve((tx.error && tx.error.name) || 'UnknownError')
    tx.onabort = () => resolve((tx.error && tx.error.name) || 'AbortError')
  })
}

export async function countGrooves(setId = null) {
  const db = await open()
  if (!db) return 0
  try {
    const store = db.transaction(GROOVES, 'readonly').objectStore(GROOVES)
    return await ask(setId ? store.index('set').count(IDBKeyRange.only(setId)) : store.count())
  } catch {
    return 0
  }
}

/**
 * Everything matching, up to a limit.
 *
 * A cursor rather than getAll: the catalogue can be several hundred thousand
 * patterns and the filters usually cut it to a handful, so the rows are tested
 * as they arrive and the walk stops as soon as enough have been found.
 *
 * `scanLimit` is the promise this makes to the interface: it will look at that
 * many rows and no more, so a search that matches nothing costs a known amount
 * of time rather than the whole database.
 */
export async function searchGrooves(filters = {}, limit = 400, scanLimit = 40000) {
  const db = await open()
  if (!db) return { rows: [], scanned: 0, partial: false }

  const {
    set = '', kind = '', bars = 0, signature = '', text = '', folder = '',
    genre = '', feel = '', surface = '', part = '', era = '',
  } = filters
  const needle = String(text || '').trim().toLowerCase()

  const store = db.transaction(GROOVES, 'readonly').objectStore(GROOVES)
  // The narrowest index the filters allow. A set is the biggest cut by far --
  // one library out of several -- so it wins when it is given.
  // No set given means every library at once, which is what somebody looking
  // for a groove rather than for a library wants. It costs a walk of the whole
  // catalogue instead of one index range, which is what `scanLimit` is for.
  const source = set ? store.index('set').openCursor(IDBKeyRange.only(set))
    : kind ? store.index('kind').openCursor(IDBKeyRange.only(kind))
    : store.openCursor()

  const rows = []
  let scanned = 0

  await new Promise((resolve) => {
    source.onsuccess = () => {
      const cursor = source.result
      if (!cursor || rows.length >= limit || scanned >= scanLimit) {
        resolve()
        return
      }

      scanned++
      const row = cursor.value
      if (matches(row, { kind, bars, signature, needle, folder, genre, feel, surface, part, era })) {
        rows.push(row)
      }
      cursor.continue()
    }
    source.onerror = () => resolve()
  })

  return { rows, scanned, partial: scanned >= scanLimit }
}

function matches(row, { kind, bars, signature, needle, folder, genre, feel, surface, part, era }) {
  if (kind && row.k !== kind) return false
  if (bars && row.r !== bars) return false
  if (signature && row.t !== signature) return false
  if (folder && !String(row.f || '').startsWith(folder)) return false
  if (genre && row.g !== genre) return false

  const tags = row.x || {}
  if (feel && tags.feel !== feel) return false
  if (surface && tags.surface !== surface) return false
  if (part && tags.part !== part) return false
  if (era && tags.era !== era) return false

  if (!needle) return true
  // The whole path, not just the name and the shelf. A vendor puts the kit, the
  // drummer and the tempo in there -- `Chrome Kit`, `CARTER_BEAUFORD`, `170BPM`
  // -- none of which is a filter and all of which somebody might type.
  if (String(row.p || '').toLowerCase().includes(needle)) return true
  if (String(row.n || '').toLowerCase().includes(needle)) return true
  if (String(row.f || '').toLowerCase().includes(needle)) return true
  if (String(row.g || '').toLowerCase().includes(needle)) return true
  for (const value of Object.values(tags)) {
    if (String(value).toLowerCase().includes(needle)) return true
  }
  for (const value of Object.values(row.m || {})) {
    if (String(value).toLowerCase().includes(needle)) return true
  }
  return false
}

/** One groove by id, for playing what a binding points at. */
export async function getGroove(id) {
  const db = await open()
  if (!db) return null
  try {
    return await ask(db.transaction(GROOVES, 'readonly').objectStore(GROOVES).get(id))
  } catch {
    return null
  }
}

/** Several at once, which is what compiling a chart needs. */
export async function getGrooves(ids) {
  const db = await open()
  if (!db || !ids.length) return []
  const store = db.transaction(GROOVES, 'readonly').objectStore(GROOVES)
  const out = []
  for (const id of ids) {
    try {
      const row = await ask(store.get(id))
      if (row) out.push(row)
    } catch {
      /* one missing groove is not a reason to lose the rest */
    }
  }
  return out
}

/**
 * What is worth offering as a filter, from a sample.
 *
 * Sampled rather than counted: counting the folders in three-quarters of a
 * million rows means reading three-quarters of a million rows, and the answer
 * -- a list of shelf names -- does not get more useful for being exact.
 */
export async function grooveFacets(setId = null, sample = 8000) {
  const db = await open()
  if (!db) return { folders: [], kinds: [], bars: [], signatures: [] }

  const tx = db.transaction(GROOVES, 'readonly')
  const store = tx.objectStore(GROOVES)
  const range = setId ? IDBKeyRange.only(setId) : undefined
  const holds = setId ? await ask(store.index('set').count(range)).catch(() => 0)
                      : await ask(store.count()).catch(() => 0)

  // Every nth row rather than the first n. Rows arrive in the order they were
  // imported, which is the order of the tree, so the first eight thousand of a
  // library of four hundred thousand are its first few shelves -- and its
  // filters would offer those shelves and no others. @see spread, which is the
  // same mistake caught once before.
  const stride = holds > sample ? Math.floor(holds / sample) : 1
  const source = setId ? store.index('set').openCursor(range) : store.openCursor()

  const folders = new Map()
  const kinds = new Map()
  const bars = new Map()
  const signatures = new Map()
  const genres = new Map()
  const feels = new Map()
  const surfaces = new Map()
  const parts = new Map()
  const eras = new Map()
  let seen = 0

  await new Promise((resolve) => {
    source.onsuccess = () => {
      const cursor = source.result
      if (!cursor || seen >= sample) {
        resolve()
        return
      }
      seen++
      const row = cursor.value
      const bump = (map, key) => { if (key || key === 0) map.set(key, (map.get(key) || 0) + 1) }
      // The top two levels of the path. Deeper than that is one shelf per
      // pattern, which is a list nobody can use.
      bump(folders, String(row.f || '').split('/').slice(0, 2).join('/'))
      bump(kinds, row.k)
      bump(bars, row.r)
      bump(signatures, row.t)
      bump(genres, row.g)
      const tags = row.x || {}
      bump(feels, tags.feel)
      bump(surfaces, tags.surface)
      bump(parts, tags.part)
      bump(eras, tags.era)
      if (stride > 1) cursor.advance(stride)
      else cursor.continue()
    }
    source.onerror = () => resolve()
  })

  const listed = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  return {
    folders: listed(folders).slice(0, 60),
    kinds: listed(kinds),
    bars: [...bars.entries()].sort((a, b) => a[0] - b[0]),
    signatures: listed(signatures),
    genres: listed(genres).slice(0, 60),
    feels: listed(feels),
    surfaces: listed(surfaces),
    parts: listed(parts),
    eras: [...eras.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    sampled: seen,
  }
}

/** Everything, gone. */
export async function clearImported() {
  const db = await open()
  if (!db) return false
  const tx = db.transaction([SETS, GROOVES], 'readwrite')
  tx.objectStore(SETS).clear()
  tx.objectStore(GROOVES).clear()
  return done(tx)
}
