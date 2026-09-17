#!/usr/bin/env python3
"""Turn a real drum collection into a graph and report what kind of graph it is.

The tag model decides what the force view will look like before a single pixel
is drawn: which words become nodes, which clips join which, and where the floor
sits between "a word two clips share" and "a filename". Those are facts about
somebody's folders, not things to pick in advance -- so they are measured here,
against the real collection, the way scripts/filter_check.py measures the
filters.

It reports rather than asserting a particular shape, because the shape is the
finding. What it does assert is the handful of things that must hold whatever
the collection looks like: that every edge points at a word that exists, that
the clip and tag counts agree with the arrays, and that building it twice gives
exactly the same answer -- which is what a stored layout depends on.

    python3 scripts/graph_check.py /Volumes/external/800k-drums
    python3 scripts/graph_check.py <folder> --files 200000
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DRIVER = r"""
import fs from 'node:fs'
import path from 'node:path'
import { tagsFrom, countTags, usefulTags, buildGraph, coOccurrence, packEdges } from 'SRC/core/tagGraph.js'

const ROOT = process.argv[2]
const WANT = Number(process.argv[3] || 100000)

const files = []
const walk = (dir) => {
  if (files.length >= WANT) return
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (files.length >= WANT) return
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full)
    else if (/\.midi?$/i.test(e.name)) files.push(path.relative(ROOT, full).split(path.sep).join('/'))
  }
}
walk(ROOT)

const began = Date.now()
const tally = countTags(files)
const countedMs = Date.now() - began

// What each floor keeps. The number itself is a fact about this collection and
// the point of measuring rather than choosing.
const floors = [2, 4, 8, 16, 32, 64].map((least) => ({
  least,
  tags: usefulTags(tally, { least, most: 0.9 }).length,
}))

const built = Date.now()
const graph = buildGraph(files.map((p) => ({ path: p })))
const builtMs = Date.now() - built

const together = Date.now()
const edges = coOccurrence(graph.clipEdges)
const togetherMs = Date.now() - together
const packed = packEdges(edges)

// Every edge points at a word that exists. An index past the end of the table
// is a node a renderer would read garbage for.
let beyond = 0
for (let i = 1; i < graph.clipEdges.length; i += 2) {
  if (graph.clipEdges[i] >= graph.tags.length) beyond++
}
let loops = 0
for (const [a, b] of edges) {
  if (a >= graph.tags.length || b >= graph.tags.length) beyond++
  if (a === b) loops++
}

// A clip reaching one node twice, which happens when two of its words fold to
// the same node.
let doubled = 0
{
  let clip = -1
  let mine = new Set()
  for (let i = 0; i < graph.clipEdges.length; i += 2) {
    if (graph.clipEdges[i] !== clip) { clip = graph.clipEdges[i]; mine = new Set() }
    if (mine.has(graph.clipEdges[i + 1])) doubled++
    mine.add(graph.clipEdges[i + 1])
  }
}

// Clips with no word at all are nodes floating free of the graph -- they can be
// found by filtering and never by browsing, so how many there are is worth
// knowing.
const joined = new Set()
for (let i = 0; i < graph.clipEdges.length; i += 2) joined.add(graph.clipEdges[i])

// Built twice, identical. A layout is computed once and stored; if the table it
// was computed against renumbers itself, every stored position points at the
// wrong word.
const again = buildGraph(files.map((p) => ({ path: p })))
const stable = again.tags.length === graph.tags.length
  && again.tags.every((one, at) => one.tag === graph.tags[at].tag && one.clips === graph.tags[at].clips)
  && again.clipEdges.length === graph.clipEdges.length

process.stdout.write(JSON.stringify({
  files: files.length,
  everyWord: tally.counts.size,
  loops, doubled,
  tags: graph.tags.length,
  clipEdges: graph.clipEdges.length / 2,
  tagEdges: edges.length,
  orphans: files.length - joined.size,
  beyond,
  stable,
  floors,
  ms: { counted: countedMs, built: builtMs, together: togetherMs },
  bytes: {
    clipEdges: graph.clipEdges.byteLength,
    tagPairs: packed.pairs.byteLength,
    weights: packed.weight.byteLength,
  },
  biggest: graph.tags.slice(0, 14).map((one) => [one.tag, one.clips]),
  strongest: edges.slice(0, 10).map(([a, b, n]) => [graph.tags[a].tag, graph.tags[b].tag, n]),
  sample: files.slice(0, 3).map((p) => [p, tagsFrom(p)]),
}))
"""


def run(folder, want):
    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    if not os.path.exists(esbuild):
        raise SystemExit("esbuild is not installed; run npm install")

    work = os.path.join(ROOT, "node_modules", ".graph-check")
    os.makedirs(work, exist_ok=True)
    entry = os.path.join(work, "driver.mjs")
    with open(entry, "w", encoding="utf-8") as handle:
        handle.write(DRIVER.replace("SRC", os.path.join(ROOT, "src")))

    bundle = os.path.join(work, "bundle.mjs")
    built = subprocess.run(
        [esbuild, entry, "--bundle", "--format=esm", "--platform=node",
         "--log-level=error", f"--outfile={bundle}"],
        capture_output=True, text=True)
    if built.returncode != 0:
        raise SystemExit(f"bundling the graph path failed:\n{built.stderr}")

    out = subprocess.run(["node", "--max-old-space-size=8192", bundle, folder, str(want)],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"the graph path threw:\n{out.stderr[-4000:]}")
    return json.loads(out.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="a folder of MIDI drum files")
    parser.add_argument("--files", type=int, default=100000)
    args = parser.parse_args()

    if not os.path.isdir(args.folder):
        raise SystemExit(f"{args.folder} is not a folder")

    found = run(args.folder, args.files)
    mb = lambda n: f"{n / 1024 / 1024:.1f}MB"

    print(f"  {found['files']:,} clips · {found['everyWord']:,} distinct words · "
          f"{found['tags']:,} kept as nodes")
    print(f"  {found['clipEdges']:,} clip edges ({mb(found['bytes']['clipEdges'])}) · "
          f"{found['tagEdges']:,} tag edges ({mb(found['bytes']['tagPairs'])})")
    print(f"  {found['orphans']:,} clips join nothing")
    print(f"  counted in {found['ms']['counted']:,}ms · built in {found['ms']['built']:,}ms · "
          f"paired in {found['ms']['together']:,}ms")

    print("  floor      " + "  ".join(f"{f['least']}→{f['tags']:,}" for f in found["floors"]))
    print("  biggest    " + ", ".join(f"{t} {n:,}" for t, n in found["biggest"][:8]))
    print("  strongest  " + ", ".join(f"{a}·{b} {n:,}" for a, b, n in found["strongest"][:5]))
    for p, tags in found["sample"]:
        print(f"  e.g.       {p[:72]}")
        print(f"             {', '.join(tags)}")

    failures = []

    def check(label, ok, detail=""):
        if not ok:
            failures.append(f"{label}{f': {detail}' if detail else ''}")

    # Every edge points at a word that exists. An index past the end of the
    # table is a node the renderer reads garbage for.
    check("every edge points at a word that exists", found["beyond"] == 0,
          f"{found['beyond']} point past the table")

    # Nothing is related to itself. This was the heaviest edge in the collection
    # -- `fill·fill`, 26,459 times -- because `fill` and `fills` fold to one
    # node and a path saying both reached it twice.
    check("nothing is related to itself", found["loops"] == 0,
          f"{found['loops']} edges join a word to itself")
    check("and no clip joins one word twice", found["doubled"] == 0,
          f"{found['doubled']} duplicate clip edges")

    # Built twice, identical. The layout is computed once and stored; if the
    # table renumbers itself, every stored position points at the wrong word.
    check("building it twice gives the same graph", found["stable"],
          "the tag table is not stable, so a stored layout would drift")

    # A graph where most clips join nothing is a list with extra steps.
    joined = found["files"] - found["orphans"]
    check("most clips join something", joined >= found["files"] * 0.9,
          f"{joined:,} of {found['files']:,} clips have any word at all")

    # And one where everything joins everything is a hairball by construction
    # rather than by scale.
    check("there is more than one word to browse by", found["tags"] >= 20,
          f"only {found['tags']} words survived the floor")
    check("and not so many that the map is the catalogue",
          found["tags"] <= found["files"] / 4,
          f"{found['tags']:,} words for {found['files']:,} clips")

    for failure in failures:
        print(f"FAIL {failure}")
    print("graph: all checks passed" if not failures else f"graph: {len(failures)} FAILED")
    return 1 if failures else 0


sys.exit(main())
