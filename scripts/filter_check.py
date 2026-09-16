#!/usr/bin/env python3
"""Import a real drum library and check that every number the filters report is true.

This exists because the filters lied four times and every unit test passed each
time. The last of them offered "1 bar (494), 2 bars (1,428), 3 bars (78)" over a
catalogue of eight hundred thousand patterns -- numbers that add up to exactly
the two thousand rows the sampler had happened to look at, presented as counts
of what was there. A real library has 36 distinct bar lengths in its first
twenty thousand files.

No fixture can catch that. The fault was in the relationship between what the
facets counted and what the search could reach, and both were right about their
own half. So this imports actual MIDI through the actual import path into an
actual IndexedDB, tallies the truth in memory the dumbest possible way, and
asserts the database agrees with it value by value:

  * every facet value the filters offer exists, with exactly the right count
  * the counts sum to the number of rows that carry that field
  * searching for a value returns exactly as many as the facet promised
  * paging reaches the last page, stops after it, and repeats nothing

    python3 scripts/filter_check.py /Volumes/external/800k-drums
    python3 scripts/filter_check.py <folder> --files 100000

It is not part of `npm test`: it needs a library, and nobody's library is the
same. It is what you run after touching anything the filters stand on.
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DRIVER = r"""
import 'fake-indexeddb/auto'
/*
 * A catalogue as an older jamin left it.
 *
 * Built by hand before the store module is asked for anything: the grooves
 * store and the single-field indexes, and none of the paired ones. That is what
 * somebody who imported a library last week actually has, and it is the only
 * state in which the promise -- that opening never triggers a minute of
 * index-building -- can be tested at all. A database created fresh has nothing
 * to build and would pass without proving a thing.
 */
await new Promise((done) => {
  const open = indexedDB.open('jamin.drums', 1)
  open.onupgradeneeded = () => {
    const db = open.result
    db.createObjectStore('sets', { keyPath: 'id' })
    const store = db.createObjectStore('grooves', { keyPath: 'id' })
    for (const [name, field] of Object.entries({
      set: 's', kind: 'k', bars: 'r', genre: 'g', signature: 't', folder: 'f',
      feel: 'x.feel', surface: 'x.surface', part: 'x.part', era: 'x.era',
    })) store.createIndex(name, field)
  }
  open.onsuccess = () => { open.result.close(); done() }
  open.onerror = () => done()
})
import fs from 'node:fs'
import path from 'node:path'
import { readGrooveFile, packGroove } from 'SRC/core/drumImport.js'
import { putGrooves, searchGrooves, grooveFacets, countGrooves,
         buildIndexes, indexesAreCurrent } from 'SRC/core/drumStore.js'

const ROOT = process.argv[2]
const WANT = Number(process.argv[3] || 50000)

// Walk the real collection and read every file, exactly as the import does.
const files = []
const walk = (dir, depth = 0) => {
  if (files.length >= WANT) return
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (files.length >= WANT) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, depth + 1)
    else if (/\.midi?$/i.test(entry.name)) files.push(full)
  }
}
walk(ROOT)

const packs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)

let n = 0
let skipped = 0
let batch = []
// Truth kept alongside, in memory, counted the dumbest possible way. The test
// is whether the database agrees with this.
const truth = { kind: new Map(), bars: new Map(), genre: new Map(), signature: new Map(),
                feel: new Map(), surface: new Map(), part: new Map(), era: new Map() }
const setOf = new Map()
const everyRow = []

const bump = (map, key) => { if (key || key === 0) map.set(key, (map.get(key) || 0) + 1) }

for (const file of files) {
  const rel = path.relative(ROOT, file)
  const pack = rel.split(path.sep)[0] || 'library'
  let groove = null
  try { groove = readGrooveFile(new Uint8Array(fs.readFileSync(file)), rel, rel) } catch { groove = null }
  if (!groove) { skipped++; continue }
  n++
  const setId = `set-${packs.indexOf(pack) < 0 ? 0 : packs.indexOf(pack)}`
  setOf.set(setId, (setOf.get(setId) || 0) + 1)
  const row = packGroove(groove, setId, n)
  batch.push(row)
  everyRow.push({ s: row.s, k: row.k, r: row.r, g: row.g, t: row.t, x: row.x })

  const tags = row.x || {}
  bump(truth.kind, row.k); bump(truth.bars, row.r); bump(truth.genre, row.g)
  bump(truth.signature, row.t); bump(truth.feel, tags.feel); bump(truth.surface, tags.surface)
  bump(truth.part, tags.part); bump(truth.era, tags.era)

  if (batch.length >= 2000) { await putGrooves(batch); batch = [] }
}
if (batch.length) await putGrooves(batch)

const stored = await countGrooves()
/*
 * Opening does not upgrade.
 *
 * Building the indexes over a catalogue already imported is the better part of
 * a minute with nothing able to report on it, so it happens when somebody has
 * asked for a long job and been told so -- never because they opened the
 * plugin. This is that promise, checked: a database left at an older version
 * stays there until something asks.
 */
const beforeAsking = await indexesAreCurrent()
await countGrooves()
await searchGrooves({}, { limit: 1 })
const afterAsking = await indexesAreCurrent()
const built = await buildIndexes()
const afterBuilding = await indexesAreCurrent()
const upgrading = { beforeAsking, afterAsking, built, afterBuilding }

const facets = await grooveFacets(null)

const plural = { kind: 'kinds', bars: 'bars', genre: 'genres', signature: 'signatures',
                 feel: 'feels', surface: 'surfaces', part: 'parts', era: 'eras' }

const report = {}
for (const name of Object.keys(truth)) {
  const offered = facets[plural[name]] || []
  const said = new Map(offered.map(([v, c]) => [String(v), c]))
  const real = new Map([...truth[name].entries()].map(([v, c]) => [String(v), c]))

  const wrong = []
  for (const [value, count] of real) {
    if (said.get(value) !== count) wrong.push({ value, said: said.get(value) ?? null, real: count })
  }
  for (const [value, count] of said) {
    if (!real.has(value)) wrong.push({ value, said: count, real: 0 })
  }
  report[name] = {
    values: offered.length,
    sum: [...said.values()].reduce((a, b) => a + b, 0),
    realSum: [...real.values()].reduce((a, b) => a + b, 0),
    wrong: wrong.slice(0, 5),
    wrongCount: wrong.length,
  }
}

// And the search agrees with the facet it was offered from, value by value.
const searched = []
for (const name of ['bars', 'genre', 'surface', 'kind', 'era']) {
  for (const [value] of (facets[plural[name]] || []).slice(0, 6)) {
    const hit = await searchGrooves({ [name]: name === 'bars' ? Number(value) : value }, { limit: 5 })
    searched.push({ name, value: String(value), total: hit.total,
                    real: truth[name].get(name === 'bars' ? Number(value) : value) || 0,
                    got: hit.rows.length })
  }
}

// Two facets at once, which is the path that intersects key sets rather than
// reading rows. Counted against the truth the same way: the intersection's size
// has to be the number of rows that really carry both.
const pairs = []
for (const [a, b] of [['genre', 'surface'], ['bars', 'kind'], ['era', 'feel'], ['genre', 'bars']]) {
  const aValue = (facets[plural[a]] || [])[0]
  const bValue = (facets[plural[b]] || [])[0]
  if (!aValue || !bValue) continue
  const filters = {}
  filters[a] = a === 'bars' ? Number(aValue[0]) : aValue[0]
  filters[b] = b === 'bars' ? Number(bValue[0]) : bValue[0]
  const hit = await searchGrooves(filters, { limit: 12 })
  let real = 0
  for (const row of everyRow) {
    const tags = row.x || {}
    const held = { kind: row.k, bars: row.r, genre: row.g, signature: row.t,
                   feel: tags.feel, surface: tags.surface, part: tags.part, era: tags.era }
    if (held[a] === filters[a] && held[b] === filters[b]) real++
  }
  pairs.push({ a: `${a}=${aValue[0]}`, b: `${b}=${bValue[0]}`,
               total: hit.total, real, got: hit.rows.length })
}

/*
 * Turning the page from where the last one ended, all the way through.
 *
 * This is the path a person actually uses and the one that has to be both
 * cheap and correct: resuming at the previous page's key costs the same at page
 * eighty thousand as at page one, and it is exactly the kind of thing that
 * silently drops a row at every boundary or shows one twice.
 *
 * So every row of the unfiltered catalogue is walked by resuming, and what
 * comes out has to be all of them, each once, in order.
 */
/*
 * And the same questions asked of one library at a time.
 *
 * A different path entirely: a count within a subset is not something a
 * single-field index can answer -- it knows how many rows are in this genre and
 * how many are in this library, and nothing about the overlap -- so one library
 * is a pass over its own rows. Only the everything case was being checked, and
 * "select a library and the genre list empties" is exactly what an untested
 * second path looks like.
 */
const perSet = []
for (const [setId] of setOf) {
  const only = await grooveFacets(setId)
  const mine = everyRow.filter((row) => row.s === setId)
  const truthFor = (pick) => {
    const counts = new Map()
    for (const row of mine) {
      const value = pick(row)
      if (value || value === 0) counts.set(String(value), (counts.get(String(value)) || 0) + 1)
    }
    return counts
  }
  const said = (list) => new Map((list || []).map(([v, c]) => [String(v), c]))

  const fields = {
    genres: (row) => row.g,
    bars: (row) => row.r,
    kinds: (row) => row.k,
    surfaces: (row) => (row.x || {}).surface,
    eras: (row) => (row.x || {}).era,
  }

  const wrong = []
  for (const [name, pick] of Object.entries(fields)) {
    const real = truthFor(pick)
    const offered = said(only[name])
    for (const [value, count] of real) {
      if (offered.get(value) !== count) {
        wrong.push(`${name} ${value || '(blank)'}: offered ${offered.get(value) ?? 'nothing'} of ${count}`)
      }
    }
  }

  perSet.push({
    set: setId,
    rows: mine.length,
    holds: only.holds,
    genres: (only.genres || []).length,
    realGenres: [...truthFor((row) => row.g).keys()].filter(Boolean).length,
    wrong: wrong.slice(0, 4),
    wrongCount: wrong.length,
  })
}

const PER = 10
const seenIds = new Set()
let cursorAfter = null
let repeated = 0
let pages = 0
let offset = 0
for (;;) {
  const page = await searchGrooves({}, { limit: PER, offset, after: cursorAfter })
  if (!page.rows.length) break
  for (const row of page.rows) {
    if (seenIds.has(row.id)) repeated++
    seenIds.add(row.id)
  }
  // A resume that lands back where it started never finishes. That is not a
  // slow test, it is a hung one, and a check that hangs teaches nobody
  // anything -- so it is caught here and reported as what it is.
  const stuck = cursorAfter && page.ended && cursorAfter.id === page.ended.id
  cursorAfter = page.ended
  offset += PER
  pages++
  if (stuck) { repeated += PER; break }
  if (pages > Math.ceil(stored / PER) + 2) break
}
const turning = { pages, walked: seenIds.size, repeated, of: stored }

// A library and one facet together, which is the pair an index answers
// directly and the commonest thing anybody asks of a catalogue with fifty
// libraries in it.
const scoped = []
for (const [setId] of [...setOf].slice(0, 6)) {
  const mine = everyRow.filter((row) => row.s === setId)
  const genre = (await grooveFacets(setId)).genres?.[0]
  if (!genre) continue
  const hit = await searchGrooves({ set: setId, genre: genre[0] }, { limit: 5 })
  scoped.push({ set: setId, genre: String(genre[0]), total: hit.total,
                real: mine.filter((row) => row.g === genre[0]).length,
                offered: genre[1], got: hit.rows.length })
}

// Paging reaches the end rather than stopping at a few hundred.
const biggest = (facets.bars || []).slice().sort((a, b) => b[1] - a[1])[0]
let paging = null
if (biggest) {
  const [value, count] = biggest
  const perPage = 12
  const lastPage = Math.ceil(count / perPage)
  const last = await searchGrooves({ bars: Number(value) }, { limit: perPage, offset: (lastPage - 1) * perPage })
  const past = await searchGrooves({ bars: Number(value) }, { limit: perPage, offset: count })
  const ids = new Set()
  let dupes = 0
  for (let p = 0; p < Math.min(lastPage, 40); p++) {
    const page = await searchGrooves({ bars: Number(value) }, { limit: perPage, offset: p * perPage })
    for (const row of page.rows) { if (ids.has(row.id)) dupes++; ids.add(row.id) }
  }
  paging = { value: String(value), count, lastPage, lastPageRows: last.rows.length,
             pastTheEnd: past.rows.length, walked: ids.size, dupes }
}

process.stdout.write(JSON.stringify({
  read: n, skipped, stored, holds: facets.holds, exact: facets.exact,
  sets: [...setOf.entries()].length, report, searched, paging, pairs, turning, perSet, scoped, upgrading,
  shelves: (facets.folders || []).length,
  shelfSum: (facets.folders || []).reduce((a, [, c]) => a + c, 0),
}))
"""



def run(folder, files):
    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    if not os.path.exists(esbuild):
        raise SystemExit("esbuild is not installed; run npm install")

    # Inside the project, because the driver imports the real store and a
    # stand-in for the browser's database, and node resolves those by walking up
    # from the file.
    work = os.path.join(ROOT, "node_modules", ".filter-check")
    os.makedirs(work, exist_ok=True)
    entry = os.path.join(work, "driver.mjs")
    with open(entry, "w", encoding="utf-8") as handle:
        handle.write(DRIVER.replace("SRC", os.path.join(ROOT, "src")))

    bundle = os.path.join(work, "bundle.mjs")
    built = subprocess.run(
        [esbuild, entry, "--bundle", "--format=esm", "--platform=node",
         "--log-level=error", f"--outfile={bundle}"],
        capture_output=True, text=True,
    )
    if built.returncode != 0:
        raise SystemExit(f"bundling the filter path failed:\n{built.stderr}")

    out = subprocess.run(["node", "--max-old-space-size=8192", bundle, folder, str(files)],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"the filter path threw:\n{out.stderr[-4000:]}")
    return json.loads(out.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="a folder of MIDI drum files")
    parser.add_argument("--files", type=int, default=20000,
                        help="how many files to import (default 20,000)")
    args = parser.parse_args()

    if not os.path.isdir(args.folder):
        raise SystemExit(f"{args.folder} is not a folder")

    found = run(args.folder, args.files)
    print(f"  {found['read']} files imported into {found['sets']} libraries, "
          f"{found['stored']} rows in the database")

    failures = []

    def check(label, ok, detail=""):
        if not ok:
            failures.append(f"{label}{f': {detail}' if detail else ''}")

    check("the database holds what was put in it",
          found["stored"] == found["read"],
          f"{found['stored']} rows for {found['read']} files")
    check("and the facets are counted rather than estimated", found["exact"])

    for name, said in found["report"].items():
        print(f"  {name:10} {said['values']:4} values, summing {said['sum']:>9,} "
              f"of {found['read']:,} rows")
        # Every value, with exactly the right count. Not "roughly", not "the
        # right number of distinct values" -- both of those passed over earlier
        # faults. Value by value against a tally kept in memory.
        check(f"every {name} count is exact", said["wrongCount"] == 0,
              "; ".join(f"{one['value'] or '(blank)'} says {one['said']} of {one['real']}"
                        for one in said["wrong"]))
        # And they add up. A facet whose counts sum to less than the rows that
        # carry it has lost some, and to more has counted some twice.
        check(f"the {name} counts add up", said["sum"] == said["realSum"],
              f"{said['sum']} against {said['realSum']}")

    # Two facets at once, which goes through the key intersection rather than
    # through a row walk. The count has to survive the change of algorithm.
    crossed = [one for one in found.get("pairs", []) if one["total"] != one["real"]]
    check("two filters together count exactly", not crossed,
          "; ".join(f"{one['a']} + {one['b']} says {one['total']} of {one['real']}"
                    for one in crossed[:4]))
    for one in found.get("pairs", []):
        print(f"  both       {one['a']} + {one['b']}: {one['total']:,}")

    # The filter promised a number; the search has to deliver it.
    wrong = [one for one in found["searched"] if one["total"] != one["real"]]
    check("searching for a value finds as many as the filter promised", not wrong,
          "; ".join(f"{one['name']}={one['value']} offered {one['real']} and found {one['total']}"
                    for one in wrong[:4]))

    paging = found.get("paging")
    if paging:
        print(f"  paging     {paging['count']:,} rows over {paging['lastPage']:,} pages")
        # The last page exists and is the right size, there is nothing past it,
        # and walking the pages repeats nothing. The list used to hold the first
        # four hundred matches and page through those, so a filter matching
        # forty thousand had thirty-three pages and no thirty-fourth.
        expected = paging["count"] % 12 or 12
        check("the last page is reachable and the right size",
              paging["lastPageRows"] == expected,
              f"{paging['lastPageRows']} rows, expected {expected}")
        check("and there is nothing past it", paging["pastTheEnd"] == 0,
              f"{paging['pastTheEnd']} rows past the end")
        check("and no row appears on two pages", paging["dupes"] == 0,
              f"{paging['dupes']} repeated")

    # One library at a time, which is a different path from all of them at once
    # and was the one nobody checked: "select a library and the genre list
    # empties" is exactly what an untested second path looks like.
    for one in found.get("perSet", []):
        note = "" if one["wrongCount"] == 0 else "  <-- WRONG"
        print(f"  library    {one['set']}: {one['rows']:,} rows, "
              f"{one['genres']} genres offered of {one['realGenres']} real{note}")
        for detail in one["wrong"]:
            print(f"             {detail}")

    empty = [one for one in found.get("perSet", [])
             if one["realGenres"] > 0 and one["genres"] == 0]
    check("a library's own genre list is not empty", not empty,
          "; ".join(f"{one['set']} has {one['realGenres']} genres and offers none"
                    for one in empty[:4]))

    offbeam = [one for one in found.get("perSet", []) if one["wrongCount"] > 0]
    check("and every count in it is exact", not offbeam,
          "; ".join(f"{one['set']}: {one['wrong'][0]}" for one in offbeam[:3]))

    check("and it knows how many rows it holds",
          all(one["holds"] == one["rows"] for one in found.get("perSet", [])),
          "; ".join(f"{one['set']} says {one['holds']} of {one['rows']}"
                    for one in found.get("perSet", []) if one["holds"] != one["rows"]))

    # Opening never upgrades. Building the indexes over a catalogue already
    # imported is the better part of a minute with nothing able to report on
    # it, so it belongs to an import somebody asked for and never to a plugin
    # somebody opened.
    up = found.get("upgrading") or {}
    if up:
        print(f"  indexing   indexed on open: {up['beforeAsking']}, "
              f"after querying: {up['afterAsking']}, after asking: {up['afterBuilding']}")
        check("using the catalogue does not upgrade it",
              up["afterAsking"] == up["beforeAsking"],
              "opening or querying triggered the index build")
        check("and asking for it does", up["afterBuilding"], "buildIndexes did nothing")

    # A library and one facet, which goes through the paired index.
    for one in found.get("scoped", []):
        print(f"  scoped     {one['set']} + {one['genre']}: "
              f"offered {one['offered']:,}, found {one['total']:,}, really {one['real']:,}")
    off = [one for one in found.get("scoped", [])
           if one["total"] != one["real"] or one["offered"] != one["real"]]
    check("a library and a facet together count exactly", not off,
          "; ".join(f"{one['set']}+{one['genre']} offered {one['offered']}"
                    f" found {one['total']} of {one['real']}" for one in off[:3]))

    # Turning the page, from the first to the last, resuming each time.
    turning = found.get("turning") or {}
    if turning:
        print(f"  turning    {turning['pages']:,} pages, {turning['walked']:,} rows seen")
        # Every row, once. A resume that lands on the wrong side of the boundary
        # either skips the first row of each page or repeats the last.
        check("turning the page reaches every row",
              turning["walked"] == turning["of"],
              f"{turning['walked']} of {turning['of']}")
        check("and shows none of them twice", turning["repeated"] == 0,
              f"{turning['repeated']} repeated")

    check("the shelves add up", found["shelfSum"] == found["read"],
          f"{found['shelfSum']} against {found['read']}")

    for failure in failures:
        print(f"FAIL {failure}")
    print("filters: all checks passed" if not failures else f"filters: {len(failures)} FAILED")
    return 1 if failures else 0


sys.exit(main())
