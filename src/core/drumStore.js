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

/**
 * Every field a filter can ask about, and the index that answers it.
 *
 * The name is what the interface calls the facet; the value is where the field
 * lives in a packed row. @see drumImport.packGroove for why the keys are one
 * letter: there are three quarters of a million of these rows and every
 * character is paid for once per row.
 */
const INDEXED = {
  set: 's',
  kind: 'k',
  bars: 'r',
  genre: 'g',
  signature: 't',
  folder: 'f',
  feel: 'x.feel',
  surface: 'x.surface',
  part: 'x.part',
  era: 'x.era',
}

/**
 * And the same fields again, paired with the library.
 *
 * A single-field index cannot answer a question about two things at once. It
 * knows how many rows are in this genre and how many are in this library, and
 * nothing whatever about the overlap -- so "the genres in *this* library" had
 * to be a walk of that library's rows.
 *
 * Measured in the plugin's own WebKit, that walk is 23ms per thousand rows. The
 * GM pack is three hundred and sixty thousand of them, so choosing it meant
 * eight and a half seconds during which the genre list was empty -- which reads
 * exactly like a library that has no genres, and was reported as one.
 *
 * A compound index on [library, value] counts the pair directly, in under a
 * millisecond. Building them over rows already imported costs about five
 * seconds each, once, on the first open -- forty for the set, against eight and
 * a half every time somebody picks a library.
 */
const PAIRED = {
  setKind: ['s', 'k'],
  setBars: ['s', 'r'],
  setGenre: ['s', 'g'],
  setSignature: ['s', 't'],
  setFolder: ['s', 'f'],
  setFeel: ['s', 'x.feel'],
  setSurface: ['s', 'x.surface'],
  setPart: ['s', 'x.part'],
  setEra: ['s', 'x.era'],
}

/** Which paired index answers a facet within one library. */
const PAIR_FOR = {
  kind: 'setKind', bars: 'setBars', genre: 'setGenre', signature: 'setSignature',
  folder: 'setFolder', feel: 'setFeel', surface: 'setSurface', part: 'setPart',
  era: 'setEra',
}

const DB_NAME = 'jamin.drums'
const DB_VERSION = 5
const SETS = 'sets'
const GROOVES = 'grooves'
/**
 * A catalogue's graph, and where its words settled.
 *
 * One row per catalogue, holding typed arrays rather than objects: the whole
 * point of a stored layout is that opening the view is a single `get` and an
 * upload to the GPU, not a second of arithmetic and a second of physics.
 *
 * The positions are what makes it worth storing at all. A force layout settles
 * somewhere new on every run, and the value of a map is knowing where things
 * are -- so it settles once and then it is that map for good.
 */
const GRAPHS = 'graphs'

let handle = null
/**
 * The version this open should ask for, or null for "whatever is there".
 *
 * Set only by @see buildIndexes, which is the one thing allowed to upgrade.
 */
let wantVersion = null

/** An open request, at a version or at none. */
function openAt(version) {
  return version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME)
}

/**
 * Somebody to tell while the browser is rebuilding the indexes.
 *
 * Adding an index to a store that already holds three quarters of a million
 * rows means reading all of them, and the browser does it inside the upgrade
 * transaction with nothing to say about how far along it is. It happens once,
 * on the first open after an update, and from the outside it is indistinguishable
 * from the program having hung -- which is the complaint that removing a large
 * library used to earn, for the same reason.
 *
 * There is no progress to report, so this reports the only thing there is: that
 * it is happening.
 */
let onUpgrade = () => {}

/** Called with true when an upgrade starts and false when it finishes. */
export function whileUpgrading(listener) {
  onUpgrade = typeof listener === 'function' ? listener : () => {}
}

/**
 * Whether this catalogue has the indexes this version knows how to use.
 *
 * Asked of the indexes rather than of the version number. A database opened
 * without a version and created on the spot lands at version 1 holding every
 * index this build knows about -- correct, and reported as out of date by
 * anything comparing 1 against 4, which would send somebody through a minute of
 * rebuilding that had nothing to rebuild.
 *
 * The version is how the browser is *told* to build them. What matters is
 * whether they are there.
 */
export async function indexesAreCurrent() {
  const db = await open()
  if (!db) return true
  if (!db.objectStoreNames.contains(GROOVES)) return false

  try {
    const store = grooves(db)
    for (const name of [...Object.keys(INDEXED), ...Object.keys(PAIRED)]) {
      if (!store.indexNames.contains(name)) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Build the indexes, deliberately, now.
 *
 * The one thing that upgrades. It is called by the import before it reads a
 * file, because that is a moment somebody has already chosen to wait through --
 * and it must never be the moment they opened the plugin, which is what asking
 * for a version on every open would make it.
 *
 * Roughly five seconds per index per three quarters of a million rows, measured
 * in the plugin's own WebKit. There is no progress to be had from inside an
 * upgrade transaction; @see whileUpgrading is the only thing there is to say.
 */
export async function buildIndexes() {
  if (typeof indexedDB === 'undefined') return true
  if (await indexesAreCurrent()) return true

  const db = await open()
  // One past whatever is there, so the browser runs an upgrade whatever version
  // this catalogue happens to sit at -- a database created without a version is
  // at 1 and would never be upgraded by asking for 4... except that it would,
  // and asking for "the next one" is the rule that holds in both cases.
  const next = db ? Math.max(DB_VERSION, db.version + 1) : DB_VERSION
  if (db) db.close()

  handle = null
  wantVersion = next
  const built = await open()
  wantVersion = null
  return Boolean(built)
}

function open() {
  if (handle) return handle

  handle = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }

    /*
     * Opened at whatever version is already there, not at the newest one.
     *
     * Asking for a version is what triggers the upgrade, and an upgrade over
     * three quarters of a million rows is the better part of a minute with
     * nothing able to report on it. That is a fine thing to wait through when
     * you have just asked to import a library and a very bad thing to find
     * happening because you opened the plugin.
     *
     * So the version is only ever asked for deliberately. @see buildIndexes,
     * which the import calls before it reads a single file, and which is the
     * only thing that upgrades. A catalogue imported before an index existed
     * goes on working without it -- slower, and @see walkWithin says how it
     * copes -- until the next import brings it up to date.
     */
    const request = openAt(wantVersion)

    request.onupgradeneeded = () => {
      onUpgrade(true)
      const db = request.result
      if (!db.objectStoreNames.contains(SETS)) {
        db.createObjectStore(SETS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(GRAPHS)) {
        db.createObjectStore(GRAPHS, { keyPath: 'id' })
      }

      /*
       * One index per thing anybody filters by.
       *
       * Indexes are added rather than created once, because a library already
       * imported must gain them without being imported again. The browser fills
       * a new one in by reading every row it already holds -- a wait on a large
       * catalogue, once.
       *
       * These are not an optimisation. A count over an index range is answered
       * from the index itself without reading a single row, which is the only
       * way a filter can say how many patterns it will show *before* showing
       * them. Without one the choice is between reading three quarters of a
       * million rows on every keystroke and guessing from a sample -- and the
       * guess is what made the filters lie: "1 bar (494), 2 bars (1,428)" over
       * a catalogue of eight hundred thousand, because those were counts of the
       * two thousand rows the sampler happened to look at, scaled by a stride
       * that was 1 because the row count it divided by was the wrong one.
       *
       * Nested keys are allowed, so what the folders said is indexable where it
       * already lives rather than being copied into a column.
       */
      const store = db.objectStoreNames.contains(GROOVES)
        ? request.transaction.objectStore(GROOVES)
        : db.createObjectStore(GROOVES, { keyPath: 'id' })

      for (const [name, field] of Object.entries(INDEXED)) {
        if (!store.indexNames.contains(name)) store.createIndex(name, field)
      }
      // And the same fields paired with the library, so a facet can be counted
      // *within* one. @see PAIRED for what that is worth and what it costs.
      for (const [name, fields] of Object.entries(PAIRED)) {
        if (!store.indexNames.contains(name)) store.createIndex(name, fields)
      }
    }

    request.onsuccess = () => {
      onUpgrade(false)
      const db = request.result

      /*
       * A database that does not exist yet opens at version 1 with nothing in
       * it, which is not a database anybody can use. So the one case that must
       * upgrade without being asked is the empty one -- where there is nothing
       * to build an index over and the wait is nil.
       */
      if (!db.objectStoreNames.contains(GROOVES)) {
        db.close()
        wantVersion = DB_VERSION
        handle = null
        resolve(open())
        return
      }

      resolve(db)
    }
    request.onerror = () => { onUpgrade(false); resolve(null) }
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

  forgetCount()

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

  // Its dropdowns said what it held, and it holds nothing now.
  await forgetFacets(db, id)

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

  // There are more rows than there were. @see countGrooves
  forgetCount()

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

/**
 * How many rows there are, remembered.
 *
 * `count()` over an object store reads like a free answer -- the engine
 * surely knows how many rows it holds -- and measured on 774,986 of them in
 * the web view the plugin embeds it is 510ms. It walks.
 *
 * That number turned up everywhere: every unfiltered search recomputed it to
 * report a total, so the book's first page cost 509ms, the facet count cost
 * 505ms, checking whether the map was stale cost 510ms, and streaming the
 * catalogue into the grid paid it *per batch* -- which is why sixty thousand
 * rows took two minutes in batches of 250 and three seconds in batches of
 * ten thousand. The rows were nearly free; the counting was all of it.
 *
 * So it is counted once and kept until something changes it. Everything that
 * writes or deletes calls `forgetCount`, which is four places.
 */
const counted = new Map()

export function forgetCount(setId = null) {
  if (setId) counted.delete(setId)
  else counted.clear()
  counted.delete('*')
}

export async function countGrooves(setId = null) {
  const key = setId || '*'
  if (counted.has(key)) return counted.get(key)

  const db = await open()
  if (!db) return 0
  try {
    const store = db.transaction(GROOVES, 'readonly').objectStore(GROOVES)
    const how = await ask(setId ? store.index('set').count(IDBKeyRange.only(setId)) : store.count())
    counted.set(key, how || 0)
    return how || 0
  } catch {
    return 0
  }
}

/* ------------------------------------------------------------- searching */

/**
 * The filters, as a list of [index, value] pairs an index can actually answer.
 *
 * Pure, so which indexes a set of filters can use is decidable without a
 * database. Everything here is an equality on one indexed field; the text
 * search is not, and is applied as a predicate.
 */
export function indexable(filters = {}) {
  const out = []
  for (const name of Object.keys(INDEXED)) {
    const value = filters[name]
    if (Array.isArray(value)) {
      // Several values of one field, meaning any of them. A length filter of
      // "whatever fits this song" is a handful of bar counts rather than one.
      if (value.length) out.push({ name, value, several: true })
      continue
    }
    if (value || value === 0) {
      if (typeof value === 'number' ? Number.isFinite(value) && value !== 0 : String(value).length) {
        out.push({ name, value })
      }
    }
  }
  return out
}

/** Whether a row satisfies everything the index did not already guarantee. */
export function matchesGroove(row, filters = {}) {
  // A named handful of ids, which is what "only the ones I starred" is.
  if (Array.isArray(filters.ids) && !filters.ids.includes(row.id)) return false

  for (const { name, value, several } of indexable(filters)) {
    if (name === 'folder') {
      if (!String(row.f || '').startsWith(value)) return false
      continue
    }
    const field = INDEXED[name]
    const held = field.includes('.')
      ? (row[field.split('.')[0]] || {})[field.split('.')[1]]
      : row[field]
    if (several ? !value.includes(held) : held !== value) return false
  }

  const needle = String(filters.text || '').trim().toLowerCase()
  if (!needle) return true

  // The whole path, not just the name and the shelf. A vendor puts the kit, the
  // drummer and the tempo in there -- `Chrome Kit`, `CARTER_BEAUFORD`, `170BPM`
  // -- none of which is a filter and all of which somebody might type.
  const tags = row.x || {}
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

/**
 * The range an indexed filter covers.
 *
 * A folder is a prefix rather than a value -- choosing the shelf `Pack/Rock`
 * means everything filed under it -- and a prefix over strings is a bounded
 * range, which an index counts as cheaply as it counts one key.
 */
function rangeFor(name, value) {
  // Already a range: a paired index builds its own, because a pair's bounds are
  // arrays rather than values. @see narrowest
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (name === 'folder') return IDBKeyRange.bound(value, `${value}\uffff`)
  return IDBKeyRange.only(value)
}

/*
 * A transaction lives until the first moment nothing is pending on it.
 *
 * Which is the end of the task that has no request outstanding -- so an `await`
 * between two requests on the same transaction ends it, and the second one
 * throws `InvalidStateError: The transaction is finished`. It does not throw in
 * every implementation: the stand-in these are tested against in node is
 * lenient about it, and the plugin's WebKit is not, which is the only reason
 * this was caught.
 *
 * So anything that awaits between requests takes a fresh transaction for each
 * one. They are cheap. A cursor walk keeps its own alive by having a request
 * outstanding at every moment, which is what `continue()` inside `onsuccess`
 * means, so those hold one for the whole walk.
 */
function grooves(db) {
  return db.transaction(GROOVES, 'readonly').objectStore(GROOVES)
}

/** How many rows one indexed filter covers, counted by the index itself. */
async function countOn(db, name, value) {
  const store = grooves(db)
  if (!store.indexNames.contains(name)) return null
  try {
    return await ask(store.index(name).count(rangeFor(name, value)))
  } catch {
    return null
  }
}

/**
 * The narrowest index these filters can be walked on, and how many rows it
 * covers.
 *
 * Chosen by counting rather than by a fixed order. One library out of fifty is
 * usually the biggest cut, but one genre inside a single enormous library is a
 * bigger one, and which it is is a fact about somebody's collection. Counting
 * an index range reads no rows, so asking all of them costs less than walking
 * the wrong one.
 */
async function narrowest(db, filters) {
  let best = null
  for (const { name, value, several } of indexable(filters)) {
    // A field with several values is walked through the key sets rather than a
    // cursor, so it is not a candidate for the one-index shortcut.
    if (several) continue
    const holds = await countOn(db, name, value)
    if (holds === null) continue
    if (!best || holds < best.holds) best = { name, value, holds }
  }

  /*
   * A library and one facet is a pair, and a pair has its own index.
   *
   * Which makes it exact and instant rather than a walk of whichever of the two
   * is smaller -- and "this library, this genre" is the commonest thing anybody
   * asks of a catalogue with fifty libraries in it. @see PAIRED
   */
  const set = filters.set
  const others = indexable(filters).filter((one) => one.name !== 'set')
  if (set && others.length === 1) {
    const paired = PAIR_FOR[others[0].name]
    const store = grooves(db)
    if (paired && store.indexNames.contains(paired)) {
      const range = others[0].name === 'folder'
        ? IDBKeyRange.bound([set, others[0].value], [set, `${others[0].value}\uffff`])
        : IDBKeyRange.only([set, others[0].value])
      try {
        const holds = await ask(store.index(paired).count(range))
        return { name: paired, value: range, holds, pair: true }
      } catch {
        /* no such index here, so the single-field answer above stands */
      }
    }
  }

  return best
}

/**
 * Everything matching, exactly counted, one page at a time.
 *
 * Three questions, and they used to be answered by one pass that got all three
 * wrong: how many there are, which ones this page shows, and whether the answer
 * is complete.
 *
 *   * **how many** is a count over an index range when one index answers the
 *     whole filter, which is exact and reads no rows at all. With two filters
 *     it is a walk of the narrower one, which is bounded by that index rather
 *     than by the catalogue.
 *   * **which ones** is the same walk with `offset` rows skipped -- so the last
 *     page of eight hundred thousand is reachable, where before there were only
 *     ever the first four hundred.
 *   * **whether it is complete** is true unless the walk hit `scanLimit`, and
 *     the only way to reach that is to type free text with no facet set at all,
 *     because text is the one question no index can answer. It is a ceiling on
 *     one hard case, not a sample: every row up to it is examined, every match
 *     is counted, and every page of the result is reachable.
 *
 * Returns `{ rows, total, exact, scanned }`.
 */
export async function searchGrooves(filters = {}, { limit = 24, offset = 0,
                                                    after = null,
                                                    scanLimit = 400000 } = {}) {
  const db = await open()
  if (!db) return { rows: [], ended: null, total: 0, exact: true, scanned: 0 }

  const chosen = await narrowest(db, filters)
  const needle = String(filters.text || '').trim().toLowerCase()
  const others = chosen && chosen.pair
    ? []
    : indexable(filters).filter((one) => !chosen || one.name !== chosen.name)

  /*
   * The whole filter, answered by the index alone.
   *
   * One equality on one indexed field and no text: the index range *is* the
   * answer, so the count is exact for nothing and the page is a walk that skips
   * straight to it. This is the common case and it costs one count and one
   * advance whatever the catalogue holds.
   */
  if (chosen && !others.length && !needle) {
    const page = await pageOf(grooves(db).index(chosen.name),
                              rangeFor(chosen.name, chosen.value), offset, limit, after)
    return { ...page, total: chosen.holds, exact: true, scanned: page.rows.length }
  }

  // Nothing indexed at all: the scope is the whole store.
  if (!chosen && !needle && !others.length) {
    // Through the cache: this is the same count, and asking the store
    // directly is 510ms of walking every row to learn a number that has not
    // changed. @see countGrooves
    const total = await countGrooves(null)
    const page = await pageOf(grooves(db), undefined, offset, limit, after)
    return { ...page, total, exact: true, scanned: page.rows.length }
  }

  /*
   * Two or more facets: intersect their keys rather than reading their rows.
   *
   * `getAllKeys` over an index range hands back the primary keys in that range
   * without deserialising a single row -- one bulk call per facet, whatever the
   * range holds. Intersecting those key sets *is* the answer: its size is the
   * exact count, and a page is twelve `get`s by key. Nothing reads a row it is
   * not going to show.
   *
   * The alternative, and what this replaced, is walking the narrowest index and
   * testing each row -- which deserialises forty thousand rows to find three
   * hundred and sixty-five of them, and does it again on every keystroke.
   *
   * Above a ceiling it falls back to the walk, because the key lists are held
   * in memory and two facets covering half the catalogue each is a great many
   * strings. The walk is slower and bounded; this is faster and is not.
   */
  const KEYS_AT_MOST = 250000
  const several = indexable(filters).filter((one) => one.several)

  /*
   * Only what was starred, or only what fits the song.
   *
   * Both used to be applied to whatever page happened to be on screen, so the
   * count beside them was the count of something else. Stars are a named
   * handful of ids; fitting is a handful of bar counts, because whether a
   * groove fits is decided by its length alone. Both are answerable exactly.
   */
  if (Array.isArray(filters.ids)) {
    const wanted = await byKeys(db, filters.ids)
    const kept = wanted.filter((row) => matchesGroove(row, { ...filters, ids: null }))
    return { rows: kept.slice(offset, offset + limit), ended: null,
             total: kept.length, exact: true, scanned: kept.length }
  }

  if (several.length && !needle) {
    const lists = []
    for (const one of [...(chosen ? [chosen] : []), ...several]) {
      const list = await keysFor(db, one.name, one.value)
      if (!list) { lists.length = 0; break }
      lists.push(list)
    }
    if (lists.length) {
      const keys = lists.reduce((into, list) => intersect(into, list))
      const rows = await byKeys(db, keys.slice(offset, offset + limit))
      const kept = rows.filter((row) => matchesGroove(row, filters))
      return { rows: kept, ended: null, total: keys.length, exact: true, scanned: keys.length }
    }
  }

  if (chosen && others.length && !needle && chosen.holds <= KEYS_AT_MOST) {
    const lists = [await keysFor(db, chosen.name, chosen.value)]
    for (const one of others) {
      lists.push(await keysFor(db, one.name, one.value))
      if (!lists[lists.length - 1]) { lists.pop(); break }
    }

    if (lists.every(Boolean)) {
      const keys = lists.reduce((into, list) => intersect(into, list))
      const rows = await byKeys(db, keys.slice(offset, offset + limit))
      return { rows, ended: null, total: keys.length, exact: true, scanned: keys.length }
    }
  }

  /*
   * Otherwise the narrowest index is the scope and the rest is a predicate.
   *
   * Counted by walking it, which is exact and bounded by that index rather than
   * by the catalogue -- a second filter on top of a genre walks that genre, not
   * three quarters of a million rows.
   */
  const walking = grooves(db)
  const source = chosen
    ? walking.index(chosen.name).openCursor(rangeFor(chosen.name, chosen.value))
    : walking.openCursor()

  const rows = []
  let matched = 0
  let scanned = 0
  let capped = false

  await new Promise((resolve) => {
    source.onsuccess = () => {
      const cursor = source.result
      if (!cursor) { resolve(); return }
      if (scanned >= scanLimit) { capped = true; resolve(); return }

      scanned++
      if (matchesGroove(cursor.value, filters)) {
        if (matched >= offset && rows.length < limit) rows.push(cursor.value)
        matched++
      }
      cursor.continue()
    }
    source.onerror = () => resolve()
  })

  return { rows, ended: null, total: matched, exact: !capped, scanned }
}

/** Every primary key an indexed filter covers, without reading a row. */
async function keysFor(db, name, value) {
  const store = grooves(db)
  if (!store.indexNames.contains(name)) return null
  try {
    // Several values of one field is the union of what each covers.
    if (Array.isArray(value)) {
      const lists = []
      for (const one of value) {
        lists.push(await ask(grooves(db).index(name).getAllKeys(rangeFor(name, one))))
      }
      return [...new Set(lists.flat())].sort()
    }
    const keys = await ask(store.index(name).getAllKeys(rangeFor(name, value)))
    // getAllKeys orders by index key first, so the primary keys come back in
    // whatever order the values happened to be in. Sorted, they intersect in
    // one pass instead of needing a set per list.
    return keys.sort()
  } catch {
    return null
  }
}

/** Two sorted key lists, merged down to what is in both. */
function intersect(left, right) {
  const out = []
  let a = 0
  let b = 0
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { out.push(left[a]); a++; b++ }
    else if (left[a] < right[b]) a++
    else b++
  }
  return out
}

/** The rows for a handful of keys, all asked for before anything is awaited. */
async function byKeys(db, keys) {
  if (!keys.length) return []
  const store = grooves(db)
  const asked = keys.map((key) => ask(store.get(key)).catch(() => null))
  return (await Promise.all(asked)).filter(Boolean)
}

/**
 * One page out of a source the range already answers.
 *
 * Two ways to reach it, and which one is used is the difference between a
 * catalogue you can browse and one you can only address.
 *
 * **From where the last page ended**, when `after` says where that was. The
 * cursor opens at the next key and takes ten. It costs the same at page eighty
 * thousand as at page one.
 *
 * **By skipping**, otherwise. IndexedDB has no skip index, so `advance(n)`
 * steps over n entries: measured in the plugin's own WebKit, 22ms for twenty
 * thousand, which is about 880ms to reach the end of eight hundred thousand.
 * Fine for jumping somewhere once, far too slow to do on every press of next --
 * which is why `after` exists.
 *
 * Returns the rows and where they ended, so the next page can start there.
 */
function pageOf(source, range, offset, limit, after = null) {
  return new Promise((resolve) => {
    const rows = []
    const onIndex = typeof source.objectStore !== 'undefined'
    let request
    let resumed = !after
    let skipped = offset <= 0 || Boolean(after)

    const done = () => {
      const last = rows[rows.length - 1]
      resolve({
        rows,
        // Where this page ended, in whatever terms the cursor needs to resume:
        // an index cursor is positioned by its index key *and* the primary key,
        // because a hundred rows share one genre.
        ended: last ? { key: after && !onIndex ? last.id : undefined, id: last.id,
                        indexKey: after ? after.indexKey : undefined } : null,
      })
    }

    try {
      request = source.openCursor(range)
    } catch {
      resolve({ rows: [], ended: null })
      return
    }

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || rows.length >= limit) { done(); return }

      if (!resumed) {
        resumed = true
        try {
          // Straight to just past where the last page stopped.
          if (onIndex && typeof cursor.continuePrimaryKey === 'function') {
            cursor.continuePrimaryKey(after.indexKey, after.id)
            return
          }
          if (!onIndex) {
            cursor.continue(after.id)
            return
          }
        } catch {
          /* fall through to reading from here, which is correct but slower */
        }
      }

      if (!skipped) {
        skipped = true
        cursor.advance(offset)
        return
      }

      // `continue`/`continuePrimaryKey` land *on* the key asked for, so the row
      // the last page ended with is skipped rather than shown twice.
      if (after && cursor.primaryKey === after.id) { cursor.continue(); return }

      rows.push(cursor.value)
      if (after) after = { ...after, indexKey: cursor.key, id: cursor.primaryKey }
      cursor.continue()
    }
    request.onerror = () => done()
  })
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

/**
 * The pattern a node on the map stands for.
 *
 * A leaf of the catalogue's tree is one clip, but the tree only knows the
 * labels along the path to it -- the folder it lives in and what it is
 * called. Picking one used to look for that name among `state.drumHits`,
 * which is the ten rows the list happens to be showing, so a leaf almost
 * never resolved to anything and clicking a file did nothing at all.
 *
 * The folder is indexed, so this is a range over a handful of rows rather
 * than a walk: a folder holds tens of patterns, not thousands.
 */
export async function grooveInFolder(folder, name) {
  const db = await open()
  if (!db || !name) return null

  try {
    const store = db.transaction(GROOVES, 'readonly').objectStore(GROOVES)
    const range = IDBKeyRange.only(String(folder || ''))
    const found = await ask(store.index('folder').getAll(range, 400))
    if (!found || !found.length) return null
    return found.find((row) => row.n === name)
      // A folder whose names are not unique, or a label the tree shortened.
      || found.find((row) => String(row.n || '').startsWith(name))
      || null
  } catch {
    return null
  }
}

/**
 * Several at once, which is what compiling a chart needs.
 *
 * Every request issued before anything is awaited, so they all belong to one
 * transaction that is still open when they are made. Awaiting them one at a
 * time ends the transaction after the first, and the second throws -- in WebKit,
 * which is where this runs. @see grooves
 */
export async function getGrooves(ids) {
  const db = await open()
  if (!db || !ids.length) return []

  const store = grooves(db)
  const asked = ids.map((id) => {
    try {
      return ask(store.get(id)).catch(() => null)
    } catch {
      return Promise.resolve(null)
    }
  })

  // One missing groove is not a reason to lose the rest.
  return (await Promise.all(asked)).filter(Boolean)
}

/**
 * Every value a filter can offer, and exactly how many patterns carry it.
 *
 * Counted, not sampled. The previous version read every nth row, tallied what
 * it saw and multiplied by the stride, which is a reasonable thing to do when
 * counting is impossible and a lie when it is not. It reported "1 bar (494),
 * 2 bars (1,428), 3 bars (78)" over a catalogue of eight hundred thousand --
 * numbers that add up to exactly the two thousand rows it had looked at.
 *
 * Counting is not impossible. Every one of these fields is indexed, and an
 * index answers two questions without reading a row: what distinct values are
 * in it, and how many entries each one has.
 *
 *   * the distinct values come from a key cursor in `nextunique` mode, which
 *     visits each value once and skips the rest -- so a field with sixty values
 *     costs sixty steps whether the catalogue holds a thousand rows or a
 *     million
 *   * the count for each comes from `count()` over that value's range, which
 *     the index answers from its own structure
 *
 * Scoped to one library it is a single pass over that library's rows instead,
 * tallying every facet at once: a count within a subset is not a question a
 * single-field index can answer, and one pass over one library is honest where
 * a compound index for every pair would be a schema nobody could hold in their
 * head.
 *
 * `exact` is true either way. It exists because it was false, and anything that
 * reads these has to be able to tell the difference.
 */
const FACETS = ['kind', 'bars', 'genre', 'signature', 'feel', 'surface', 'part', 'era']

export async function grooveFacets(setId = null) {
  const db = await open()
  if (!db) return emptyFacets()

  /*
   * Through the cache, which is the same count.
   *
   * The remembered facets are stamped with how many rows they were counted
   * from, so this runs before the cache is even consulted -- meaning the
   * cheap path paid 510ms of walking the store to find out whether it could
   * take the cheap path. @see countGrooves
   */
  const holds = setId ? await countOn(db, 'set', setId) : await countGrooves(null)

  const remembered = await rememberedFacets(db, setId, holds)
  if (remembered) return remembered

  /*
   * Nothing written down for this one, so count it and write it down.
   *
   * Which is the slow path, and is meant to be: a library imported since this
   * existed was tallied as it arrived and never reaches here. This is for the
   * ones that were already in the database when it did not.
   */
  const counted = setId ? await walkWithin(db, setId) : await tallyEverything(db)
  const answer = { ...counted, holds: holds || 0, exact: true }
  await rememberFacets(db, setId, holds, answer)
  return answer
}

/**
 * The whole catalogue's dropdowns, out of the libraries' own.
 *
 * Added up from what each library already knows rather than counted again
 * over everything -- forty-nine small tallies is arithmetic, and three
 * quarters of a million rows is a minute. Any library that has not been
 * tallied yet is counted here and written down as a side effect, so this is
 * also how a catalogue from before all this gets prepared.
 */
async function tallyEverything(db) {
  const sets = await ask(db.transaction(SETS, 'readonly').objectStore(SETS).getAll())
    .catch(() => [])

  const total = emptyTally()
  for (const set of sets) {
    const holds = await countOn(db, 'set', set.id)
    if (!holds) continue
    let each = await rememberedFacets(db, set.id, holds)
    if (!each) {
      each = { ...(await walkWithin(db, set.id)), holds, exact: true }
      await rememberFacets(db, set.id, holds, each)
    }
    addTally(total, each)
  }
  return finishTally(total)
}

/** Fold one library's counted values into a running total. */
function addTally(into, some) {
  for (const name of FACETS) {
    for (const [value, many] of some[plural(name)] || []) {
      into[name].set(value, (into[name].get(value) || 0) + many)
    }
  }
  for (const [shelf, many] of some.folders || []) {
    into.folders.set(shelf, (into.folders.get(shelf) || 0) + many)
  }
}

/**
 * Count every library that has not been counted, with something to watch.
 *
 * The one-off for a catalogue imported before the tallies existed. One pass
 * per library, all nine fields at once, and the answer written down -- after
 * which opening a library is a row read. @see store.js prepareDrumFilters
 */
export async function materialiseFacets(onProgress = null) {
  const db = await open()
  if (!db) return 0

  const sets = await ask(db.transaction(SETS, 'readonly').objectStore(SETS).getAll())
    .catch(() => [])
  let done = 0

  for (const set of sets) {
    const holds = await countOn(db, 'set', set.id)
    if (!holds) { done++; continue }
    if (await rememberedFacets(db, set.id, holds)) { done++; continue }

    if (onProgress) onProgress({ name: set.name || set.id, done, of: sets.length, rows: 0 })
    const counted = await walkWithin(db, set.id,
      (rows) => onProgress && onProgress({ name: set.name || set.id, done, of: sets.length, rows }))
    await rememberFacets(db, set.id, holds, { ...counted, holds, exact: true })
    done++
  }

  // And the whole-catalogue answer, which is now just arithmetic.
  await forgetFacets(db, null)
  await grooveFacets(null)
  return done
}

/** What a library's tally is, for the import to store as it goes. */
export async function rememberFacetsFor(setId, holds, counted) {
  const db = await open()
  if (!db) return
  await forgetFacets(db, null)
  await rememberFacets(db, setId, holds, { ...counted, holds, exact: true })
}

/*
 * What the dropdowns say, remembered between askings.
 *
 * Filling them means finding every distinct value of nine fields. The trick
 * that should make that cheap is `nextunique`, which is meant to seek to the
 * next distinct key rather than step over every duplicate -- and measured in
 * the web view the plugin embeds, WebKit steps: the same two values took 5ms
 * to find in a thousand rows and 73ms in twenty thousand. So the cost is per
 * clip, not per value, and the biggest library here holds 404,339 clips. Nine
 * fields of that is fifteen to twenty seconds, every time somebody picks a
 * library.
 *
 * It is the same answer every time, so it is worked out once and kept. The
 * stamp is the library's row count: rows are only ever added by an import or
 * removed with the whole library, so a count that still matches is an answer
 * that still holds. @see forgetFacets for the two places that is not enough.
 *
 * It lives in the `graphs` store because that store is already a place to put
 * a blob under a name, and adding one of its own would mean a version bump --
 * which in this database means an upgrade transaction over three quarters of a
 * million rows, on a page somebody just opened. @see buildIndexes.
 */
const facetKey = (setId) => `facets:${setId || 'all'}`

async function rememberedFacets(db, setId, holds) {
  if (!db.objectStoreNames.contains(GRAPHS)) return null
  const row = await ask(db.transaction(GRAPHS, 'readonly').objectStore(GRAPHS)
    .get(facetKey(setId))).catch(() => null)
  if (!row || row.holds !== (holds || 0) || !row.facets) return null
  return row.facets
}

async function rememberFacets(db, setId, holds, facets) {
  if (!db.objectStoreNames.contains(GRAPHS)) return
  try {
    const tx = db.transaction(GRAPHS, 'readwrite')
    tx.objectStore(GRAPHS).put({ id: facetKey(setId), holds: holds || 0, facets, at: Date.now() })
    await done(tx)
  } catch {
    // A cache that will not be written is not a failure worth reporting; the
    // answer above is already correct and was already returned.
  }
}

/**
 * Forget what a library's dropdowns said, from outside.
 *
 * For the one case the row count cannot notice: rewriting a library's rows
 * into a different shape without changing how many there are. @see
 * store.js shelveTheCorpus, which gave the bundled corpus folders it never
 * had and left eleven hundred rows saying something new.
 */
export async function forgetCachedFacets(setId = null) {
  const db = await open()
  await forgetFacets(db, setId)
}

/** Forget what a library's dropdowns said, and what everything's said. */
async function forgetFacets(db, setId = null) {
  if (!db || !db.objectStoreNames.contains(GRAPHS)) return
  try {
    const tx = db.transaction(GRAPHS, 'readwrite')
    if (setId) tx.objectStore(GRAPHS).delete(facetKey(setId))
    // Whatever happened to one library changed the whole catalogue too.
    tx.objectStore(GRAPHS).delete(facetKey(null))
    await done(tx)
  } catch {
    /* as above */
  }
}

function emptyFacets() {
  const out = { folders: [], holds: 0, exact: true }
  for (const name of FACETS) out[plural(name)] = []
  return out
}

/** What the interface calls each facet's list. */
function plural(name) {
  if (name === 'kind') return 'kinds'
  if (name === 'bars') return 'bars'
  if (name === 'signature') return 'signatures'
  if (name === 'feel') return 'feels'
  if (name === 'surface') return 'surfaces'
  if (name === 'part') return 'parts'
  if (name === 'era') return 'eras'
  return `${name}s`
}

/**
 * The same answer, the slow way, for a catalogue with no paired indexes.
 *
 * One pass over the library's rows tallying every facet at once -- 23ms per
 * thousand rows in the plugin's WebKit, so a third of a minute for the largest
 * library anybody has. Correct, and the reason the indexes exist.
 */
/* ------------------------------------------------------------------ *
 * What the dropdowns say, counted once and written down
 *
 * Every value of nine fields, and how many rows carry each. There is no cheap
 * way to ask a database this: the trick that should make it cheap is a
 * `nextunique` cursor, which is meant to seek to the next distinct key, and
 * WebKit -- which is what the plugin is -- steps over every duplicate instead.
 * Measured in the plugin's own web view: the same two values took 5ms to find
 * in a thousand rows and 73ms in twenty thousand. The cost is per clip, not
 * per value, and the biggest library here holds 404,339 clips.
 *
 * So it is not asked at all. The tally is built while the rows are being
 * written, when every one of them is in hand anyway, and stored beside the
 * library. Opening a library is then a single row read.
 * @see store.js importOnePack, which tallies as it imports
 * ------------------------------------------------------------------ */

/** An empty tally, ready to be added to. */
export function emptyTally() {
  const seen = { folders: new Map() }
  for (const name of FACETS) seen[name] = new Map()
  return seen
}

/**
 * One row, counted.
 *
 * Takes a stored row (`{ k, r, g, t, x, f }`) so the import and a pass over
 * the database are counting exactly the same thing in exactly the same way --
 * two tallies that disagree would be worse than one that is slow.
 */
export function tallyRow(seen, row) {
  const tags = row.x || {}
  const held = {
    kind: row.k, bars: row.r, genre: row.g, signature: row.t,
    feel: tags.feel, surface: tags.surface, part: tags.part, era: tags.era,
  }
  for (const name of FACETS) {
    const one = held[name]
    if (one || one === 0) seen[name].set(one, (seen[name].get(one) || 0) + 1)
  }
  // A shelf is the top two levels of a path, which is the grain somebody
  // actually narrows by -- the whole path is one folder per clip.
  const shelf = String(row.f || '').split('/').slice(0, 2).join('/')
  seen.folders.set(shelf, (seen.folders.get(shelf) || 0) + 1)
}

/** The tally, in the shape the dropdowns want. */
export function finishTally(seen) {
  const out = { folders: order('folder', [...seen.folders.entries()]).slice(0, 120) }
  for (const name of FACETS) out[plural(name)] = order(name, [...seen[name].entries()])
  return out
}

/**
 * Count a library the slow way, once, because nobody counted it as it arrived.
 *
 * One pass over its rows tallying all nine fields together -- not nine passes,
 * one each. For a catalogue imported before any of this existed, this is the
 * price of the first look at it, and it is paid once and written down.
 */
async function walkWithin(db, setId, onProgress = null) {
  const seen = emptyTally()
  let read = 0

  await new Promise((resolve) => {
    const request = grooves(db).index('set').openCursor(IDBKeyRange.only(setId))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { resolve(); return }
      tallyRow(seen, cursor.value)
      if (onProgress && (++read % 5000) === 0) onProgress(read)
      cursor.continue()
    }
    request.onerror = () => resolve()
  })

  return finishTally(seen)
}

/**
 * Biggest first, except lengths and decades, which read as a scale.
 *
 * A blank is never a value. Most paths say nothing about the feel and a good
 * many say nothing about the genre, and an index happily counts the empty
 * string as a key -- so the genre list offered `(903)` with no name against it,
 * and choosing it matched everything, because "no genre" is the absence of a
 * filter rather than a filter. Not having a genre is not a genre.
 */
function order(name, pairs) {
  pairs = pairs.filter(([value]) => value !== '' && value !== null && value !== undefined)

  if (name === 'bars') return pairs.slice().sort((a, b) => a[0] - b[0])
  if (name === 'era') return pairs.slice().sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return pairs.slice().sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
}

/** Everything, gone. */
export async function clearImported() {
  forgetCount()
  const db = await open()
  if (!db) return false
  // The graphs and the remembered dropdowns both describe a catalogue that is
  // about to not exist. An emptied catalogue counts zero rows, which is a
  // stamp a cache written when it was empty would match.
  const stores = db.objectStoreNames.contains(GRAPHS)
    ? [SETS, GROOVES, GRAPHS] : [SETS, GROOVES]
  const tx = db.transaction(stores, 'readwrite')
  for (const name of stores) tx.objectStore(name).clear()
  return done(tx)
}

/**
 * How fast this browser's database really is, on rows written for the purpose.
 *
 * The filter path is checked against a real library in node -- @see
 * scripts/filter_check.py -- against a stand-in for IndexedDB. That stand-in is
 * correct and is not a performance model: its cursor deserialises every row it
 * steps over, so it reports two hundred seconds for a walk WebKit does in a
 * fraction of one. Choosing a storage engine on those numbers would be choosing
 * it on a measurement of the wrong thing.
 *
 * So this exists to take the numbers where they matter, in the web view the
 * plugin embeds. It writes into its own database and deletes it afterwards, so
 * it can never touch somebody's catalogue. @see native/tools/boot_probe.m
 */
export async function measureStore(rows = 50000) {
  if (typeof indexedDB === 'undefined') return 'no indexedDB'

  const NAME = 'jamin.drums.probe'
  await new Promise((done) => {
    const wipe = indexedDB.deleteDatabase(NAME)
    wipe.onsuccess = done; wipe.onerror = done; wipe.onblocked = done
  })

  const db = await new Promise((done) => {
    const open = indexedDB.open(NAME, 1)
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(GROOVES, { keyPath: 'id' })
      for (const [name, field] of Object.entries(INDEXED)) store.createIndex(name, field)
    }
    open.onsuccess = () => done(open.result)
    open.onerror = () => done(null)
  })
  if (!db) return 'would not open'

  const GENRES = ['Rock', 'Jazz', 'Funk', 'Blues', 'Metal', 'Soul', 'Reggae', 'Pop']
  const SURFACES = ['Hi-hat', 'Ride', 'Crash', 'Toms', 'Snare']
  const since = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

  const wrote = since()
  for (let at = 0; at < rows; at += 2000) {
    const tx = db.transaction(GROOVES, 'readwrite')
    const store = tx.objectStore(GROOVES)
    for (let n = at; n < Math.min(rows, at + 2000); n++) {
      store.put({
        id: `p:${n}`, s: `set-${n % 20}`, n: `groove ${n}`, p: `Pack ${n % 20}/Shelf ${n % 7}/g${n}`,
        f: `Pack ${n % 20}/Shelf ${n % 7}`, k: n % 5 ? 'beat' : 'fill', r: (n % 8) + 1,
        t: '4-4', g: GENRES[n % GENRES.length], b: 120,
        x: { surface: SURFACES[n % SURFACES.length], feel: n % 3 ? 'Straight' : 'Shuffle' },
        v: [], m: {},
      })
    }
    await new Promise((done) => { tx.oncomplete = done; tx.onerror = done; tx.onabort = done })
  }
  const writeMs = Math.round(since() - wrote)

  const timed = async (fn) => { const t = since(); const out = await fn(); return [Math.round(since() - t), out] }
  const store = () => db.transaction(GROOVES, 'readonly').objectStore(GROOVES)
  const one = (request) => new Promise((done) => {
    request.onsuccess = () => done(request.result); request.onerror = () => done(null)
  })

  const [countMs, counted] = await timed(() =>
    one(store().index('genre').count(IDBKeyRange.only('Rock'))))
  const [keysMs, keys] = await timed(async () =>
    (await one(store().index('genre').getAllKeys(IDBKeyRange.only('Rock')))) || [])
  const [crossMs] = await timed(async () => {
    const other = (await one(store().index('surface').getAllKeys(IDBKeyRange.only('Ride')))) || []
    return intersect(keys.slice().sort(), other.slice().sort()).length
  })
  /*
   * Deep paging, which is the thing an eight-hundred-thousand-row catalogue
   * asks for and the thing IndexedDB has no shortcut for. There is no skip
   * index: `advance(n)` steps. So the question is what it costs at depth, and
   * whether a page late in the catalogue is reachable or merely addressable.
   */
  const deep = Math.max(0, rows - 200)
  const [advanceMs] = await timed(() => new Promise((done) => {
    const request = store().openCursor()
    let first = true
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { done(0); return }
      if (first) { first = false; cursor.advance(deep); return }
      done(1)
    }
    request.onerror = () => done(0)
  }))

  const [walkMs] = await timed(() => new Promise((done) => {
    const request = store().index('genre').openCursor(IDBKeyRange.only('Rock'))
    let seen = 0
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { done(seen); return }
      seen++
      cursor.continue()
    }
    request.onerror = () => done(seen)
  }))

  /*
    The two numbers that decide how a library's own facets can be counted.

    Within one library a single-field index is no use: it knows how many rows
    are in this genre and how many are in this library, and nothing about the
    overlap. So it is either a walk of that library's rows, or a compound index
    on [library, value] which counts the pair directly.

    The walk is what a 360,000-row library costs today. The build is what the
    alternative costs once, on upgrade, per index.
  */
  const [tallyMs] = await timed(() => new Promise((done) => {
    const request = store().index('set').openCursor(IDBKeyRange.only('set-3'))
    const seen = new Map()
    let n = 0
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { done(n); return }
      n++
      const row = cursor.value
      seen.set(row.g, (seen.get(row.g) || 0) + 1)
      cursor.continue()
    }
    request.onerror = () => done(n)
  }))

  const perSet = await ask(store().index('set').count(IDBKeyRange.only('set-3'))).catch(() => 0)

  /*
   * And what it costs to take rows out again, which nothing had measured.
   *
   * Removing a library deletes every row it owns, and every delete has to
   * maintain nineteen indexes. Under fake-indexeddb that is catastrophic --
   * one batch of two thousand does not finish in forty seconds of solid CPU,
   * which is an hours-long removal for a real library and is how a check of
   * it came to burn nine hours. Whether that is the shim's index maintenance
   * or something this store does is a question only a real engine answers.
   */
  const toGo = (await one(store().index('set').getAllKeys(IDBKeyRange.only('set-5'), 2000))) || []
  const wiping = since()
  const wipeTx = db.transaction(GROOVES, 'readwrite')
  const wipeStore = wipeTx.objectStore(GROOVES)
  for (const key of toGo) wipeStore.delete(key)
  await new Promise((settled) => {
    wipeTx.oncomplete = settled; wipeTx.onerror = settled; wipeTx.onabort = settled
  })
  const wipeMs = Math.round(since() - wiping)

  db.close()

  /*
    And what the upgrade costs -- which is the number that decides it.

    A compound index turns "how many of this genre are in this library" from a
    walk of that library into a count, but the browser has to build it over
    every row already there, once, inside the upgrade transaction with nothing
    able to report on it. So it is measured the way it will actually happen:
    reopen at a higher version and add the index to a store that already holds
    the rows.
  */
  const upgraded = since()
  const later = await new Promise((done) => {
    const open = indexedDB.open(NAME, 2)
    open.onupgradeneeded = () => {
      const store2 = open.transaction.objectStore(GROOVES)
      store2.createIndex('setGenre', ['s', 'g'])
      store2.createIndex('setBars', ['s', 'r'])
    }
    open.onsuccess = () => done(open.result)
    open.onerror = () => done(null)
  })
  const upgradeMs = Math.round(since() - upgraded)

  /*
   * And what it costs to find out *which* values a library has, which is the
   * other half of filling a dropdown and the half that was never measured.
   *
   * `nextunique` is supposed to seek to the next distinct key rather than step
   * over every duplicate. Whether an engine really does that decides everything:
   * over a 404,000-row library, seeking is one step per genre and stepping is
   * one step per clip. fake-indexeddb steps -- measured at 130us a row, which
   * is the whole of the twelve minutes it reports for one library's dropdowns
   * and tells us nothing about this web view.
   *
   * So the two walks below are the experiment. Both have the same eight
   * distinct genres; the second has twenty times the rows. If seeking is real
   * they cost the same. If the ratio is twenty, this engine steps too and the
   * dropdowns need their answer stored rather than counted.
   */
  let uniqueSmallMs = 0
  let uniqueWholeMs = 0
  let uniqueSeen = 0
  if (later) {
    const distinct = (span) => new Promise((done) => {
      const found = []
      const request = later.transaction(GROOVES, 'readonly').objectStore(GROOVES)
        .index('setGenre').openKeyCursor(span, 'nextunique')
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) { done(found); return }
        found.push(cursor.key[1])
        cursor.continue()
      }
      request.onerror = () => done(found)
    })
    const small = since()
    uniqueSeen = (await distinct(IDBKeyRange.bound(['set-3'], ['set-3', []]))).length
    uniqueSmallMs = Math.round(since() - small)
    const whole = since()
    await distinct(null)
    uniqueWholeMs = Math.round(since() - whole)
  }

  // And that the thing it was built for is now instant.
  let pairMs = 0
  let pairCount = 0
  if (later) {
    const t = since()
    pairCount = await new Promise((done) => {
      const request = later.transaction(GROOVES, 'readonly').objectStore(GROOVES)
        .index('setGenre').count(IDBKeyRange.only(['set-3', 'Rock']))
      request.onsuccess = () => done(request.result)
      request.onerror = () => done(-1)
    })
    pairMs = Math.round(since() - t)
    later.close()
  }

  await new Promise((done) => {
    const wipe = indexedDB.deleteDatabase(NAME)
    wipe.onsuccess = done; wipe.onerror = done; wipe.onblocked = done
  })

  return `${rows} rows written in ${writeMs}ms · count ${counted} in ${countMs}ms`
       + ` · keys in ${keysMs}ms · two facets in ${crossMs}ms · row walk in ${walkMs}ms`
       + ` · advance to row ${deep} in ${advanceMs}ms`
       + ` · tally of one ${perSet}-row library in ${tallyMs}ms`
       + ` · two compound indexes built over ${rows} existing rows in ${upgradeMs}ms`
       + ` · that pair counted (${pairCount}) in ${pairMs}ms`
       + ` · ${uniqueSeen} distinct genres found in one ${perSet}-row library in ${uniqueSmallMs}ms`
       + ` and across all ${rows} rows in ${uniqueWholeMs}ms`
       + ` (same values either way — equal times mean nextunique seeks,`
       + ` ${Math.round(rows / Math.max(1, perSet))}x means it steps)`
       + ` · ${toGo.length} rows deleted, indexes and all, in ${wipeMs}ms`
}

if (typeof window !== 'undefined') window.__jaminStorageProbe = measureStore


/* ----------------------------------------------------------- the graph */

/** The stored graph for one catalogue, or null. */
export async function readGraph(which) {
  const db = await open()
  if (!db || !db.objectStoreNames.contains(GRAPHS)) return null
  try {
    return await ask(db.transaction(GRAPHS, 'readonly').objectStore(GRAPHS).get(which)) || null
  } catch {
    return null
  }
}

/** Keep one. Typed arrays go in as typed arrays; IndexedDB stores them whole. */
export async function writeGraph(which, graph) {
  const db = await open()
  if (!db || !db.objectStoreNames.contains(GRAPHS)) return false
  const tx = db.transaction(GRAPHS, 'readwrite')
  tx.objectStore(GRAPHS).put({ ...graph, id: which })
  return done(tx)
}

/** Forget one, for when the catalogue it described has changed. */
export async function forgetGraph(which) {
  const db = await open()
  if (!db || !db.objectStoreNames.contains(GRAPHS)) return false
  const tx = db.transaction(GRAPHS, 'readwrite')
  tx.objectStore(GRAPHS).delete(which)
  return done(tx)
}

/**
 * Every path in the catalogue, handed over a batch at a time.
 *
 * The graph needs the words in three quarters of a million paths and nothing
 * else about them. A cursor reads whole rows because that is what a cursor
 * does, so the cost is the read rather than the counting -- about sixteen
 * seconds on a real collection, which is why the answer is stored rather than
 * recomputed.
 *
 * Batched so the caller can report progress and the interface can breathe.
 */
export async function everyPath(onBatch, batchSize = 20000) {
  const db = await open()
  if (!db) return 0

  let batch = []
  let seen = 0

  await new Promise((resolve) => {
    const request = grooves(db).openCursor()
    request.onsuccess = async () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      const row = cursor.value
      // The path and the library it is in. The library is the top level of the
      // tree and the path hangs under it. @see core/pathTree.js
      batch.push([row.p || row.n || '', row.s || ''])
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
