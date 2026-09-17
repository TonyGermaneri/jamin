#!/usr/bin/env python3
"""Turn a real drum collection into its tree and report what kind of tree it is.

The catalogue is a hierarchy -- libraries, then folders, then folders, then
clips -- and the graph view draws it as one. What that tree looks like at three
quarters of a million files is a fact about somebody's folders rather than
something to decide in advance, so it is measured here.

An earlier version of this measured a *co-occurrence* graph: words joined by how
often they turned up together. It drew a hairball, and the numbers it reported
were all healthy, because the numbers were not the problem -- the model was. The
shape of what comes out is the finding, which is why most of this reports rather
than asserts.

What it does assert is what must hold whatever the collection looks like: that
every node has at most one parent, that no node is its own ancestor, that the
edge count follows from the node count, and that building it twice gives exactly
the same tree -- which a stored layout depends on.

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
import { buildTree, trail, childrenOf, treeSizes } from 'SRC/core/pathTree.js'

const ROOT = process.argv[2]
const WANT = Number(process.argv[3] || 100000)
const SORT = process.argv[4] || ''

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

// The clips, with the one facet a "group the graph by" choice would use. The
// genre stands in for all of them: they behave the same way, differing only in
// how many distinct values they have.
const clips = files.map((p) => ({ path: p, genre: p.split('/')[1] || '' }))

const began = Date.now()
const tree = buildTree(clips, { facetOf: SORT ? (one) => one.genre : null })
const builtMs = Date.now() - began

// Nothing is its own ancestor, which would be a cycle in something that must be
// a tree -- and a renderer walking it would never stop.
let cycles = 0
let deepest = 0
for (let at = 0; at < tree.nodes.length; at++) {
  const seen = new Set()
  let here = at
  let steps = 0
  while (here >= 0 && steps++ < 200) {
    if (seen.has(here)) { cycles++; break }
    seen.add(here)
    here = tree.parents[here]
  }
  deepest = Math.max(deepest, steps)
}

let roots = 0
for (const one of tree.parents) if (one < 0) roots++

// Every edge goes parent -> child, one level down, and points at nodes that
// exist. A renderer reading an index past the end draws garbage.
let beyond = 0
let backwards = 0
for (let at = 0; at < tree.edges.length; at += 2) {
  const [a, b] = [tree.edges[at], tree.edges[at + 1]]
  if (a >= tree.nodes.length || b >= tree.nodes.length) { beyond++; continue }
  if (tree.nodes[b].depth !== tree.nodes[a].depth + 1) backwards++
}

// A parent holds at least what its children hold.
let shrinking = 0
tree.parents.forEach((parent, child) => {
  if (parent >= 0 && tree.nodes[parent].clips < tree.nodes[child].clips) shrinking++
})

const again = buildTree(clips, { facetOf: SORT ? (one) => one.genre : null })
const stable = again.nodes.length === tree.nodes.length
  && again.nodes.every((one, at) => one.label === tree.nodes[at].label && one.clips === tree.nodes[at].clips)

const perDepth = new Map()
for (const one of tree.nodes) perDepth.set(one.depth, (perDepth.get(one.depth) || 0) + 1)

const biggest = tree.nodes
  .map((one, at) => ({ at, ...one }))
  .filter((one) => one.depth === 0)
  .sort((a, b) => b.clips - a.clips)
  .slice(0, 6)

process.stdout.write(JSON.stringify({
  files: files.length,
  nodes: tree.nodes.length,
  edges: tree.edges.length / 2,
  roots,
  depth: tree.depth,
  deepest,
  leaves: tree.nodes.filter((one) => one.leaf).length,
  cycles, beyond, backwards, shrinking, stable,
  truncated: tree.truncated,
  builtMs,
  bytes: { edges: tree.edges.byteLength },
  perDepth: [...perDepth.entries()].sort((a, b) => a[0] - b[0]),
  biggest: biggest.map((one) => [one.label.slice(0, 40), one.clips]),
  branchiest: tree.nodes
    .map((one, at) => ({ label: one.label, kids: childrenOf(tree, at).length }))
    .sort((a, b) => b.kids - a.kids).slice(0, 4).map((one) => [one.label.slice(0, 30), one.kids]),
  sample: (() => {
    const leaf = tree.nodes.findIndex((one) => one.leaf)
    return leaf < 0 ? [] : trail(tree, leaf).map((one) => one.label)
  })(),
  // Walked rather than spread: `Math.min(...s)` on eight hundred thousand
  // numbers is eight hundred thousand arguments, and it blows the stack.
  sizes: (() => {
    const s = treeSizes(tree.nodes)
    let low = Infinity
    let high = -Infinity
    for (const one of s) { if (one < low) low = one; if (one > high) high = one }
    return [low, high]
  })(),
}))
"""


def run(folder, want, sort):
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
        raise SystemExit(f"bundling the tree path failed:\n{built.stderr}")

    out = subprocess.run(["node", "--max-old-space-size=8192", bundle, folder, str(want), sort],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"the tree path threw:\n{out.stderr[-4000:]}")
    return json.loads(out.stdout)


def report(found, title):
    print(f"  {title}")
    print(f"    {found['files']:,} clips → {found['nodes']:,} nodes, {found['edges']:,} edges "
          f"({found['bytes']['edges'] / 1024 / 1024:.1f}MB) in {found['builtMs']:,}ms")
    print(f"    {found['roots']:,} roots · {found['depth']} levels · {found['leaves']:,} leaves")
    print("    per level  " + "  ".join(f"{d}→{n:,}" for d, n in found["perDepth"][:8]))
    print("    biggest    " + ", ".join(f"{name} {n:,}" for name, n in found["biggest"]))
    print("    branchiest " + ", ".join(f"{name} {n:,}" for name, n in found["branchiest"]))
    if found["sample"]:
        print("    e.g.       " + " / ".join(found["sample"])[:96])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="a folder of MIDI drum files")
    parser.add_argument("--files", type=int, default=100000)
    args = parser.parse_args()

    if not os.path.isdir(args.folder):
        raise SystemExit(f"{args.folder} is not a folder")

    failures = []

    def check(label, ok, detail=""):
        if not ok:
            failures.append(f"{label}{f': {detail}' if detail else ''}")

    for sort, title in [("", "by folder"), ("genre", "grouped by a facet")]:
        found = run(args.folder, args.files, sort)
        report(found, title)

        # A tree, and demonstrably one. A cycle is a renderer that never stops.
        check(f"{title}: nothing is its own ancestor", found["cycles"] == 0,
              f"{found['cycles']} nodes reach themselves")

        # One parent each, so the edges follow from the nodes. This is the whole
        # difference from the co-occurrence graph this replaced.
        check(f"{title}: one edge per node that has a parent",
              found["edges"] == found["nodes"] - found["roots"],
              f"{found['edges']:,} edges for {found['nodes']:,} nodes and {found['roots']:,} roots")

        # Every edge goes exactly one level down.
        check(f"{title}: every edge points at a node that exists", found["beyond"] == 0,
              f"{found['beyond']} point past the table")
        check(f"{title}: and goes one level down", found["backwards"] == 0,
              f"{found['backwards']} do not")

        # A folder holds at least what its children hold, which is what makes
        # the sizes mean anything.
        check(f"{title}: a parent is never smaller than a child", found["shrinking"] == 0,
              f"{found['shrinking']} are")

        # Built twice, identical: a stored layout points at nodes by index, so a
        # tree that renumbers itself leaves every saved position on the wrong one.
        check(f"{title}: building it twice gives the same tree", found["stable"])

        # Grouping by a facet re-roots it and adds a level.
        if sort:
            check("grouping by a facet puts more at the top", found["roots"] > 1,
                  f"{found['roots']} roots")

    for failure in failures:
        print(f"FAIL {failure}")
    print("tree: all checks passed" if not failures else f"tree: {len(failures)} FAILED")
    return 1 if failures else 0


sys.exit(main())
