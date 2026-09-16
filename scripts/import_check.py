#!/usr/bin/env python3
"""Run the real import over a real drum library and check what comes out.

This exists because the import broke four times in a row and every unit test
passed each time. The pieces were tested; the path was not. Between them the
faults were:

  * a whole tree asked for in one bridge call, which failed as silence
  * bytes handed over in an encoding the page could not decode, so every file
    was read successfully and thrown away
  * the genre read from a path with the library's own name already stripped
    off it, which is the only word in most of them that says anything
  * a kit verdict of "General MIDI" given to packs where General MIDI can read
    none of the notes

None of those is visible in a unit test with a hand-written fixture. All four
are obvious the moment the real path meets a real library.

So this drives readGrooveFile -> tagsFor/genreOf -> packGroove -> unpackGroove
and classifyKit over an actual folder of MIDI, and asserts the *shape* of the
result rather than any particular file: that most files parse, that genres come
out, that kits vary, that a row survives the round trip.

    python3 scripts/import_check.py /Volumes/external/800k-drums
    python3 scripts/import_check.py <folder> --per-pack 40

It is not part of `npm test`: it needs a library, and nobody's library is the
same. It is what you run after touching anything on the import path.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The import path, exercised the way the application exercises it. Bundled by
# esbuild rather than imported directly, because these modules import JSON and
# a package, neither of which plain Node ESM will take without ceremony.
DRIVER = r"""
import 'fake-indexeddb/auto'
import fs from 'node:fs'
import path from 'node:path'
import { readGrooveFile, packGroove, unpackGroove, spread } from 'SRC/core/drumImport.js'
import { classifyKit } from 'SRC/core/drumKits.js'
import { putGrooves, searchGrooves, grooveFacets } from 'SRC/core/drumStore.js'

const ROOT = process.argv[2]
const PER_PACK = Number(process.argv[3] || 60)

const packs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)

const listed = packs.length ? packs : ['']
const genres = new Map()
const kits = new Map()
const tags = { feel: new Map(), surface: new Map(), part: new Map(), era: new Map() }
const named = []
const stored = []
let read = 0
let withGenre = 0
let skipped = 0
let roundTripped = 0
let withNotes = 0

for (const pack of listed) {
  const root = pack ? path.join(ROOT, pack) : ROOT
  const files = []
  const walk = (dir) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.midi?$/i.test(entry.name)) files.push(full)
    }
  }
  walk(root)
  if (!files.length) continue

  const histogram = {}
  for (const file of spread(files, PER_PACK)) {
    const relative = path.relative(root, file)
    let groove = null
    try {
      groove = readGrooveFile(new Uint8Array(fs.readFileSync(file)), relative,
                              pack ? `${pack}/${relative}` : relative)
    } catch { groove = null }

    if (!groove) { skipped++; continue }
    read++

    for (const note of groove.notes) histogram[note.note] = (histogram[note.note] || 0) + 1

    const packed = packGroove(groove, 'probe', read)
    stored.push(packed)
    const back = unpackGroove(packed)
    if (back.name === groove.name && back.bars === groove.bars) roundTripped++
    if (back.notes.length === groove.notes.length) withNotes++
    if (back.genre) {
      withGenre++
      genres.set(back.genre, (genres.get(back.genre) || 0) + 1)
    }
    for (const kind of Object.keys(tags)) {
      const value = back.tags[kind]
      if (value) tags[kind].set(value, (tags[kind].get(value) || 0) + 1)
    }
  }

  const called = classifyKit(histogram)
  kits.set(called.kit || '(undecided)', (kits.get(called.kit || '(undecided)') || 0) + 1)
  // A named kit has to be able to read what it was named for. This is the
  // number the assertion needs: a verdict with no coverage is a label on a
  // library that will play nothing.
  if (called.kit) named.push({ pack, kit: called.kit, coverage: called.coverage })
}

/*
 * And then the half that broke this time: the catalogue, filtered.
 *
 * The rows go into a database in the order they were imported, which is the
 * order of the tree, which is the thing that made the filters lie. A genre
 * living in the last pack read is invisible to a search that walks the rows in
 * order and gives up part way -- and the facets, which sample evenly, offer it
 * anyway with a count beside it.
 *
 * So the check is exactly that: whatever the facets say exists, the search must
 * be able to find, on a budget smaller than the catalogue. `budget` is deliberately
 * a fraction of the rows, because that is the only condition under which the
 * fault appears and a real library is always past it.
 */
await putGrooves(stored)

const facets = await grooveFacets('probe', Math.max(8, Math.floor(stored.length / 8)))
const budget = Math.max(16, Math.floor(stored.length / 4))

/*
 * Where in the library a value first appears.
 *
 * This is what makes the check sharp rather than lucky. A value scattered
 * through the collection turns up in the front of it too, so a search that only
 * ever reads the front still finds it and the check passes with the fault in --
 * which is how three earlier tests passed over three earlier faults. The values
 * worth asserting on are the ones that first appear *past* the budget, because
 * those are the ones a prefix cannot reach and a sample can.
 */
const firstAt = (has) => {
  for (let at = 0; at < stored.length; at++) if (has(stored[at])) return at
  return -1
}

const probe = async (label, values, has, filter) => {
  const out = []
  for (const name of values) {
    const at = firstAt((row) => has(row, name))
    const hit = await searchGrooves({ set: 'probe', ...filter(name) }, 50, budget)
    out.push({
      [label]: name,
      firstAt: at,
      late: at >= budget,
      found: hit.rows.length,
      total: hit.total,
      truly: stored.filter((row) => has(row, name)).length,
    })
  }
  return out
}

const searches = await probe('genre', (facets.genres || []).map(([name]) => name).slice(0, 12),
                             (row, name) => row.g === name, (name) => ({ genre: name }))
for (const hit of searches) {
  hit.claimed = (facets.genres.find(([name]) => name === hit.genre) || [])[1] || 0
}

// The same question asked of a filter no index can answer, which is the case
// that has to fall back on sampling the library rather than reading its front.
const surfaced = await probe('surface', (facets.surfaces || []).map(([name]) => name),
                             (row, name) => (row.x || {}).surface === name,
                             (name) => ({ surface: name }))

const counted = (map) => Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]))
process.stdout.write(JSON.stringify({
  stored: stored.length, searches, surfaced,
  packs: listed.filter(Boolean).length,
  read, skipped, roundTripped, withNotes, withGenre, named,
  genres: counted(genres),
  kits: counted(kits),
  tags: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, counted(v)])),
}))
"""


def run(folder, per_pack):
    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    if not os.path.exists(esbuild):
        raise SystemExit("esbuild is not installed; run npm install")

    # Inside the project, because the driver imports from node_modules -- the
    # real store, and a stand-in for the browser's database -- and node resolves
    # those by walking up from the file. A system temp directory is nowhere near
    # them.
    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, "node_modules")) as work:
        entry = os.path.join(work, "driver.mjs")
        with open(entry, "w", encoding="utf-8") as handle:
            handle.write(DRIVER.replace("SRC", os.path.join(ROOT, "src")))

        bundle = os.path.join(work, "driver.bundle.mjs")
        built = subprocess.run(
            [esbuild, entry, "--bundle", "--format=esm", "--platform=node",
             "--log-level=error", f"--outfile={bundle}"],
            capture_output=True, text=True,
        )
        if built.returncode != 0:
            raise SystemExit(f"bundling the import path failed:\n{built.stderr}")

        out = subprocess.run(["node", bundle, folder, str(per_pack)],
                             capture_output=True, text=True)
        if out.returncode != 0:
            raise SystemExit(f"the import path threw:\n{out.stderr}")
        return json.loads(out.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="a folder of MIDI drum files")
    parser.add_argument("--per-pack", type=int, default=60,
                        help="files sampled from each pack (spread, not the first n)")
    args = parser.parse_args()

    if not os.path.isdir(args.folder):
        raise SystemExit(f"{args.folder} is not a folder")

    found = run(args.folder, args.per_pack)
    read = found["read"]
    packs = found["packs"]

    print(f"  {read} files read, {found['skipped']} skipped, from {packs} packs")
    print(f"  stored    {found['stored']} rows, then filtered on a quarter-sized budget")
    print(f"  kits      {summary(found['kits'], 8)}")
    print(f"  genres    {len(found['genres'])} distinct -- {summary(found['genres'], 8)}")
    for kind, counts in found["tags"].items():
        if counts:
            print(f"  {kind:9} {summary(counts, 6)}")
    for hit in found["searches"][:6]:
        print(f"  filter    {hit['genre']}: offered {hit['claimed']}, found {hit['found']}, "
              f"really {hit['truly']}, first at {hit['firstAt']}"
              f"{' (past the budget)' if hit['late'] else ''}")
    for hit in found["surfaced"][:4]:
        print(f"  unindexed {hit['surface']}: showed {hit['found']}, "
              f"reckoned {hit['total']}, really {hit['truly']}")

    failures = []

    def check(label, ok, detail=""):
        if not ok:
            failures.append(f"{label}{f': {detail}' if detail else ''}")

    # Most of a real library parses. A scraped collection has broken files in
    # it, so this is not "all" -- but a path that reads nothing is the failure
    # that keeps happening, and it looks exactly like an empty folder.
    check("most files parse", read > 0 and read >= (read + found["skipped"]) * 0.5,
          f"{read} read against {found['skipped']} skipped")

    # A row survives being stored and read back. This is where base64 and the
    # packed field names get checked against reality rather than a fixture.
    check("every row survives the round trip", roundTrip(found), "")
    check("and keeps its notes", found["withNotes"] == read,
          f"{found['withNotes']} of {read}")

    # How many *rows* carry a genre, not how many distinct genres exist.
    #
    # The distinct count is useless as an assertion: when the library's own name
    # was being stripped before the labeller saw it, the inner folders still
    # said `GM - Blues` and `11 Punk Rock`, so 67 genres came out and a
    # distinct-count check passed while every single-level pack -- `Africa`,
    # `Bossa`, `Reggae`, whose name is the only word they have -- came back
    # blank. The share is what moves.
    share = found["withGenre"] / read if read else 0
    check("most rows get a genre from their folders", share >= 0.6,
          f"{found['withGenre']} of {read} rows ({share:.0%})")

    # A named kit must be able to read most of what it was named for.
    #
    # Counting how many *different* verdicts came back does not catch this
    # either: with the coverage gate removed the answer was still "gm and
    # undecided and vdrums", three verdicts, looking healthy -- while whole
    # percussion packs were labelled General MIDI with nothing General MIDI
    # could play. The invariant is about each verdict, not about the spread.
    unplayable = [n for n in found["named"] if n["coverage"] < 0.6]
    check("no library is given a kit that cannot read it", not unplayable,
          "; ".join(f"{n['pack']} called {n['kit']} at {n['coverage']:.0%}"
                    for n in unplayable[:4]))

    # The paths say more than the genre, and half of them say what the right
    # hand is on.
    check("folders yield tags", any(found["tags"][k] for k in found["tags"]), "none found")

    # ---- and the half that lives in the database ---------------------------
    #
    # A filter that offers a value must be able to find it. This is the fault
    # that shipped: the facets sampled the library evenly and so offered
    # `Progressive (429)`, while the search read the rows in the order they were
    # written and gave up after a fixed number -- the first pack or two of three
    # quarters of a million -- so the list showed one pattern.
    #
    # Both halves are checked, because either alone passes with the bug in.
    empty = [s for s in found["searches"] if s["truly"] > 0 and s["found"] == 0]
    check("every genre the filters offer can be found", not empty,
          "; ".join(f"{s['genre']} offers {s['claimed']} and finds none of {s['truly']}"
                    for s in empty[:4]))

    # And specifically the ones that live past where the search stops reading.
    # A value scattered evenly turns up in the front of the library too, so
    # asserting on all of them passes with a prefix search in place; asserting
    # on the late ones is what fails. If a sample has none, the check says so
    # rather than passing quietly.
    late = [s for s in found["searches"] if s["late"] and s["truly"] > 0]
    check("including one that lives past the budget", late,
          "no genre in this sample starts late enough to prove it -- raise --per-pack")
    check("and those are found", all(s["found"] > 0 for s in late),
          "; ".join(f"{s['genre']} first appears at {s['firstAt']} and is not found"
                    for s in late if not s["found"]))

    # And the count beside it is the right size. Sampled counts used to be
    # reported raw -- a true count of what was looked at, presented as a count
    # of what is there.
    off = [s for s in found["searches"]
           if s["truly"] >= 8 and not (s["truly"] / 4 <= s["claimed"] <= s["truly"] * 4)]
    check("and the count beside it is the right size", not off,
          "; ".join(f"{s['genre']} offers {s['claimed']} of {s['truly']}" for s in off[:4]))

    # The same, for a filter no index can answer, which must fall back on
    # sampling the library rather than reading the front of it.
    #
    # An unindexed filter has nothing but the stride to save it, so it is the
    # one that proves the sampling rather than the index.
    #
    # Judged on the *total* rather than on the rows, because a budget smaller
    # than the library is meant to hand back a sample -- a quarter of the rows
    # gives a quarter of the matches and that is the design, not a fault. What
    # must survive is the number beside them: reading the front of the library
    # estimates from a biased corner and gets it wrong in whichever direction
    # that corner leans, which is what "Progressive (429)" showing one pattern
    # is made of.
    wrong = [s for s in found["surfaced"]
             if s["truly"] >= 8 and not (s["truly"] / 3 <= s["total"] <= s["truly"] * 3)]
    check("an unindexed filter still counts what is there", not wrong,
          "; ".join(f"{s['surface']} reports {s['total']} of {s['truly']}" for s in wrong[:4]))

    for failure in failures:
        print(f"FAIL {failure}")
    print("import: all checks passed" if not failures else f"import: {len(failures)} FAILED")
    return 1 if failures else 0


def roundTrip(found):
    return found["roundTripped"] == found["read"]


def summary(counts, limit):
    return ", ".join(f"{name} {n}" for name, n in list(counts.items())[:limit]) or "none"


sys.exit(main())
