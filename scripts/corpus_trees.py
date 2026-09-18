#!/usr/bin/env python3
"""Build the maps of the big collections, so the graph can be photographed at scale.

The catalogue map is a thing whose only real test is whether somebody can read
it, and whether it is readable at nine hundred nodes says nothing about whether
it is readable at nine hundred thousand. So the screenshot harness wants real
collections in front of it -- and the two that exist are far too large to
commit and are not ours to redistribute:

  drums         a folder of MIDI on disk; @see the import-only collection
  progressions  Chordonomicon, CC-BY-NC, from HuggingFace

Neither is bundled, neither is committed, and both live under
tests/browser/corpora/ which is gitignored. Delete them when you are done.

This turns each into the tree the application would build from it -- by calling
the application's own buildTree and the application's own adapters, so what is
photographed is what would be drawn -- and writes it where the harness can
fetch it. Importing either through the interface first would be twenty minutes
of progress bar to arrive at the same tree.

    curl -sSL -o tests/browser/corpora/chordonomicon.csv \\
      https://huggingface.co/datasets/ailsntua/Chordonomicon/resolve/main/chordonomicon_v2.csv
    python3 scripts/corpus_trees.py --drums /Volumes/external/800k-drums
    python3 scripts/corpus_trees.py --progressions tests/browser/corpora/chordonomicon.csv
    <venv>/bin/python scripts/shots.py graph-drums-whole graph-progressions-whole
    rm -rf tests/browser/corpora

@see scripts/graph_check.py, which times buildTree itself at this size.
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPORA = os.path.join(ROOT, "tests", "browser", "corpora")

DRUMS = r"""
import fs from 'node:fs'
import path from 'node:path'
import { buildTree } from 'SRC/core/pathTree.js'
import { ADAPTERS } from 'SRC/core/graphView.js'

/*
 * `buildBulkGraph` walks the database for `[path, setId]` and hands those to
 * buildTree. A path is the same path whether it comes out of IndexedDB or off
 * the disk it points at, so this walks the disk: no import, no parse, same
 * tree. @see store.js buildBulkGraph
 */
const ROOT = process.argv[2]
const OUT = process.argv[3]

const packs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((one) => one.isDirectory() && !one.name.startsWith('.'))
  .map((one) => one.name)

const rows = []
const walk = (dir, setId, base) => {
  let here = []
  try { here = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const one of here) {
    const full = path.join(dir, one.name)
    if (one.isDirectory()) walk(full, setId, base)
    else if (/\.midi?$/i.test(one.name)) {
      rows.push({ setId, path: path.relative(base, full).split(path.sep).join('/') })
    }
  }
}
for (const pack of packs) walk(path.join(ROOT, pack), pack, path.join(ROOT, pack))
report(rows, (one) => ADAPTERS.drums.treePath(one), 'drums', OUT)
"""

PROGRESSIONS = r"""
import fs from 'node:fs'
import readline from 'node:readline'
import { buildTree } from 'SRC/core/pathTree.js'
import { ADAPTERS } from 'SRC/core/graphView.js'
import { splitCsvLine, progressionRow } from 'SRC/core/csvImport.js'

const CSV = process.argv[2]
const OUT = process.argv[3]

let columns = null
const rows = []
const lines = readline.createInterface({ input: fs.createReadStream(CSV), crlfDelay: Infinity })
for await (const line of lines) {
  if (!line.trim()) continue
  if (!columns) { columns = splitCsvLine(line).map((one) => one.trim()); continue }
  const cells = splitCsvLine(line)
  // The application's own row, so the map is labelled the way the app labels
  // it. A second copy of this here once drew the genres as `po-me` and `al-re`.
  const row = progressionRow((name) => cells[columns.indexOf(name)] || '', rows.length)
  if (row) rows.push(row)
}
report(rows, (one) => ADAPTERS.progressions.treePath(one), 'progressions', OUT)
"""

SHARED = r"""
function report(rows, pathOf, which, out) {
  console.log(`${rows.length.toLocaleString()} rows`)
  const began = Date.now()
  const tree = buildTree(rows, { pathOf })
  console.log(`tree: ${tree.nodes.length.toLocaleString()} nodes, ${tree.depth} deep, `
    + `${Date.now() - began}ms`)

  const kids = new Map()
  tree.parents.forEach((parent) => {
    if (parent >= 0) kids.set(parent, (kids.get(parent) || 0) + 1)
  })
  let most = tree.parents.filter((one) => one < 0).length
  for (const many of kids.values()) if (many > most) most = many
  const shelves = tree.nodes.filter((one) => one.shelf).length
  console.log(`widest fan ${most}, ${shelves.toLocaleString()} shelves`)

  // `fs` from the driver above: this is bundled as one ES module, where a
  // `require` is not a thing.
  fs.writeFileSync(out, JSON.stringify({
    id: which, nodes: tree.nodes, edges: Array.from(tree.edges),
    parents: Array.from(tree.parents), depth: tree.depth,
    truncated: tree.truncated, clips: rows.length, builtAt: Date.now(),
  }))
  console.log(`wrote ${(fs.statSync(out).size / 1e6).toFixed(0)}MB to ${out}`)
}
"""


def build(driver, source, which):
    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    if not os.path.exists(esbuild):
        raise SystemExit("esbuild is not installed; run npm install")
    if not os.path.exists(source):
        raise SystemExit(f"{source} is not there")

    os.makedirs(CORPORA, exist_ok=True)
    work = os.path.join(ROOT, "node_modules", ".corpus-trees")
    os.makedirs(work, exist_ok=True)
    entry = os.path.join(work, f"{which}.mjs")
    with open(entry, "w", encoding="utf-8") as handle:
        handle.write((driver + SHARED).replace("SRC", os.path.join(ROOT, "src")))

    bundle = os.path.join(work, f"{which}.bundle.mjs")
    built = subprocess.run(
        [esbuild, entry, "--bundle", "--format=esm", "--platform=node",
         "--log-level=error", f"--outfile={bundle}"],
        capture_output=True, text=True,
    )
    if built.returncode != 0:
        raise SystemExit(f"bundling failed:\n{built.stderr}")

    out = os.path.join(CORPORA, f"{which}-tree.json")
    return subprocess.run(["node", "--max-old-space-size=12288", bundle, source, out]).returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--drums", help="a folder of MIDI drum files")
    parser.add_argument("--progressions", help="the Chordonomicon CSV")
    args = parser.parse_args()

    if not args.drums and not args.progressions:
        parser.print_help()
        return 1
    worst = 0
    if args.drums:
        worst = max(worst, build(DRUMS, args.drums, "drums"))
    if args.progressions:
        worst = max(worst, build(PROGRESSIONS, args.progressions, "progressions"))
    return worst


sys.exit(main())
