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
import fs from 'node:fs'
import path from 'node:path'
import { readGrooveFile, packGroove } from 'SRC/core/drumImport.js'
import { putGrooves, searchGrooves, grooveFacets, countGrooves } from 'SRC/core/drumStore.js'

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
  everyRow.push({ k: row.k, r: row.r, g: row.g, t: row.t, x: row.x })

  const tags = row.x || {}
  bump(truth.kind, row.k); bump(truth.bars, row.r); bump(truth.genre, row.g)
  bump(truth.signature, row.t); bump(truth.feel, tags.feel); bump(truth.surface, tags.surface)
  bump(truth.part, tags.part); bump(truth.era, tags.era)

  if (batch.length >= 2000) { await putGrooves(batch); batch = [] }
}
if (batch.length) await putGrooves(batch)

const stored = await countGrooves()
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
  sets: [...setOf.entries()].length, report, searched, paging, pairs,
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

    check("the shelves add up", found["shelfSum"] == found["read"],
          f"{found['shelfSum']} against {found['read']}")

    for failure in failures:
        print(f"FAIL {failure}")
    print("filters: all checks passed" if not failures else f"filters: {len(failures)} FAILED")
    return 1 if failures else 0


sys.exit(main())
