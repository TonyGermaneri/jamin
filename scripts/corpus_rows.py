#!/usr/bin/env python3
"""The real catalogue rows, for timing the filters against.

`corpus_trees.py` walks the disk for paths, which is all a *tree* needs. A
filter needs more than a path: it needs the genre the folders imply and the
tags the names carry, and those only exist once the files have been read. So
this runs the real import path -- readGrooveFile, then packGroove by
reference, exactly as importing the folder would -- and writes the rows out as
NDJSON for the performance harness to put into a real database.

Slow on purpose: it reads three quarters of a million MIDI files, which is
what the application does when somebody points it at that folder. Twenty
minutes, once, and the answer is kept.

    python3 scripts/corpus_rows.py /Volumes/external/800k-drums
    python3 scripts/graph_perf.py

The output is a test asset: gitignored, never bundled, and the collection it
comes from is import-only. @see tests/browser/corpora
"""
import argparse
import os
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPORA = os.path.join(ROOT, "tests", "browser", "corpora")

DRIVER = r"""
import fs from 'node:fs'
import path from 'node:path'
import { readGrooveFile, packGroove } from 'SRC/core/drumImport.js'

const ROOT = process.argv[2]
const OUT = process.argv[3]

const packs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((one) => one.isDirectory() && !one.name.startsWith('.'))
  .map((one) => one.name)

const out = fs.createWriteStream(OUT)
let index = 0
let kept = 0
let skipped = 0

const walk = (dir, pack, base) => {
  let here = []
  try { here = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const one of here) {
    const full = path.join(dir, one.name)
    if (one.isDirectory()) { walk(full, pack, base); continue }
    if (!/\.midi?$/i.test(one.name)) continue

    const rel = path.relative(base, full).split(path.sep).join('/')
    let groove = null
    try {
      // The library's own name goes to the labeller and not into the stored
      // path, exactly as the import does it -- `Africa` is the only word in
      // `Africa/01 Djembe.mid` that says what it is. @see store.js
      groove = readGrooveFile(new Uint8Array(fs.readFileSync(full)), rel, `${pack}/${rel}`)
    } catch { groove = null }
    if (!groove) { skipped++; continue }

    kept++
    out.write(JSON.stringify(packGroove(groove, pack, index++, { byReference: true })) + '\n')
  }
}

for (const pack of packs) walk(path.join(ROOT, pack), pack, path.join(ROOT, pack))
out.end()
await new Promise((done) => out.on('close', done))
process.stdout.write(JSON.stringify({ kept, skipped }))
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="a folder of MIDI drum files")
    args = parser.parse_args()
    if not os.path.isdir(args.folder):
        raise SystemExit(f"{args.folder} is not a folder")

    os.makedirs(CORPORA, exist_ok=True)
    out = os.path.join(CORPORA, "drums-rows.ndjson")

    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, "node_modules")) as work:
        entry = os.path.join(work, "rows.mjs")
        with open(entry, "w", encoding="utf-8") as handle:
            handle.write(DRIVER.replace("SRC", os.path.join(ROOT, "src")))
        bundle = os.path.join(work, "rows.bundle.mjs")
        built = subprocess.run([esbuild, entry, "--bundle", "--format=esm",
                                "--platform=node", "--log-level=error",
                                f"--outfile={bundle}"], capture_output=True, text=True)
        if built.returncode != 0:
            raise SystemExit(f"bundling failed:\n{built.stderr}")
        run = subprocess.run(["node", "--max-old-space-size=8192", bundle,
                              args.folder, out], capture_output=True, text=True)
        if run.returncode != 0:
            raise SystemExit(f"the import path threw:\n{run.stderr[-3000:]}")

    import json
    said = json.loads(run.stdout)
    size = os.path.getsize(out)
    print(f"  {said['kept']:,} rows, {said['skipped']:,} skipped")
    print(f"  wrote {size / 1024 / 1024:.0f}MB to {out}")


if __name__ == "__main__":
    main()
