#!/usr/bin/env python3
"""Work out what each drum pack's own notes mean, pack by pack.

General MIDI names notes 35 to 81. Every sampled library hangs its own
articulations off numbers outside that, and no two vendors agree: on the
collection measured here 11-18% of a pack's notes are outside the standard,
and jamin reads them as nothing. There is no published table for any of it.

What there is, is the packs themselves. A library that keeps its hi-hat
variations in a folder called `HATS_OPEN_VARIATIONS`, or opens a section with
`00@_CONGAS` and files eleven folders of conga patterns after it, has written
its own key down. This reads that key.

Two kinds of evidence, and nothing else:

  words     a folder whose path contains an instrument's name, where the
            note in question is most of what that folder plays. `learnInbound`
            in core/drumKits.js is the same rule the import already uses.

  sections  a pack whose top-level folders are numbered, where a name
            beginning with an underscore opens a section and everything
            numbered after it belongs to that section until the next one.
            EZX Latin Percussion is laid out exactly this way -- `00@_CONGAS`,
            then eleven conga folders, then `12@_CAJON`.

Where neither says anything, nothing is written. A wrong drum played
confidently is worse than a quiet one.

    python3 scripts/pack_maps.py /Volumes/external/800k-drums
    python3 scripts/pack_maps.py <folder> --per-shelf 6 --out src/core/drumPacks.js

Sampled, not exhaustive: six files a shelf over a quarter of a million
folders is enough to see which note dominates a folder, and reading all of
them is twenty minutes to reach the same answer.
"""
import argparse
import json
import os
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DRIVER = r"""
import fs from 'node:fs'
import path from 'node:path'
import { readGrooveFile, spread } from 'SRC/core/drumImport.js'
import { GENERAL_MIDI_IN, VOICE_WORDS, learnInbound } from 'SRC/core/drumKits.js'

const ROOT = process.argv[2]
const PER = Number(process.argv[3] || 6)

const packs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((one) => one.isDirectory() && !one.name.startsWith('.'))
  .map((one) => one.name)

/* The section convention: top-level folders numbered, an underscored name
   opening a section, everything after it belonging to that section. */
const sectionsOf = (where) => {
  let tops = []
  try {
    tops = fs.readdirSync(where, { withFileTypes: true })
      .filter((one) => one.isDirectory()).map((one) => one.name)
  } catch { return null }

  const numbered = tops.filter((one) => /^\d+@/.test(one))
  if (numbered.length < tops.length * 0.8) return null
  if (!tops.some((one) => /^\d+@_/.test(one))) return null

  const order = numbered.slice().sort((a, b) => Number(a.split('@')[0]) - Number(b.split('@')[0]))
  const out = new Map()
  let section = ''
  for (const one of order) {
    const label = one.split('@').slice(1).join('@')
    if (label.startsWith('_')) section = label.slice(1)
    if (section) out.set(one, section)
  }
  return out.size ? out : null
}

const report = []

for (const pack of packs) {
  const where = path.join(ROOT, pack)
  const sections = sectionsOf(where)

  const perFolder = new Map()
  const perSection = new Map()
  const uses = new Map()
  let notes = 0

  const walk = (dir, top) => {
    let here = []
    try { here = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    const files = []
    for (const one of here) {
      const full = path.join(dir, one.name)
      if (one.isDirectory()) walk(full, top || one.name)
      else if (/\.midi?$/i.test(one.name)) files.push(full)
    }
    if (!files.length) return

    const shelf = path.relative(where, dir).split(path.sep).join('/')
    const hist = perFolder.get(shelf) || {}
    for (const file of spread(files, PER)) {
      let groove = null
      try {
        groove = readGrooveFile(new Uint8Array(fs.readFileSync(file)), path.basename(file), file)
      } catch { groove = null }
      if (!groove) continue
      for (const note of groove.notes) {
        hist[note.note] = (hist[note.note] || 0) + 1
        uses.set(note.note, (uses.get(note.note) || 0) + 1)
        notes++
        if (sections && top && sections.has(top)) {
          const name = sections.get(top)
          const into = perSection.get(name) || new Map()
          into.set(note.note, (into.get(note.note) || 0) + 1)
          perSection.set(name, into)
        }
      }
    }
    perFolder.set(shelf, hist)
  }
  walk(where, '')
  if (!notes) continue

  /* What the folder names say, by the same rule the import uses. */
  const { hints, where: places } = learnInbound(perFolder, GENERAL_MIDI_IN)
  const map = {}
  const why = {}
  for (const [note, said] of Object.entries(hints)) {
    map[note] = said.voice
    why[note] = `folder names (${said.share}% agreed)`
  }

  /* And what the sections say, where a pack is laid out that way. A note
     that is most of what one section plays and turns up nowhere else is
     that section's instrument. */
  if (perSection.size) {
    for (const [name, counts] of perSection) {
      const word = VOICE_WORDS.find(([w]) => name.toLowerCase().replace(/[^a-z]+/g, ' ').includes(w))
      if (!word) continue
      const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
      for (const [note, many] of counts) {
        if (GENERAL_MIDI_IN[note]) continue
        if (many / total < 0.02) continue
        // Only if this section is where the note mostly lives.
        const everywhere = uses.get(note) || 0
        if (many / everywhere < 0.8) continue
        if (map[note]) continue
        map[note] = word[1]
        why[note] = `the "${name}" section`
      }
    }
  }

  const outside = [...uses.entries()].filter(([note]) => !GENERAL_MIDI_IN[note])
  const lost = outside.reduce((sum, [, n]) => sum + n, 0)
  const named = outside.filter(([note]) => map[note]).reduce((sum, [, n]) => sum + n, 0)

  report.push({
    pack,
    notes,
    sections: sections ? [...new Set(sections.values())].length : 0,
    outside: outside.length,
    lostShare: notes ? lost / notes : 0,
    namedShare: lost ? named / lost : 0,
    map,
    why,
    stillUnnamed: outside.filter(([note]) => !map[note])
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([note, n]) => [note, n]),
  })
}

process.stdout.write(JSON.stringify(report))
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="a folder of drum packs")
    parser.add_argument("--per-shelf", type=int, default=6)
    parser.add_argument("--out", default="", help="write the maps as a JS module")
    args = parser.parse_args()

    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, "node_modules")) as work:
        entry = os.path.join(work, "packs.mjs")
        with open(entry, "w", encoding="utf-8") as handle:
            handle.write(DRIVER.replace("SRC", os.path.join(ROOT, "src")))
        bundle = os.path.join(work, "packs.bundle.mjs")
        built = subprocess.run([esbuild, entry, "--bundle", "--format=esm",
                                "--platform=node", "--log-level=error",
                                f"--outfile={bundle}"], capture_output=True, text=True)
        if built.returncode != 0:
            raise SystemExit(f"bundling failed:\n{built.stderr}")
        run = subprocess.run(["node", "--max-old-space-size=8192", bundle,
                              args.folder, str(args.per_shelf)],
                             capture_output=True, text=True)
        if run.returncode != 0:
            raise SystemExit(f"the analysis threw:\n{run.stderr[-3000:]}")

    found = json.loads(run.stdout)
    found.sort(key=lambda one: -one["lostShare"])

    print(f"\n  {len(found)} packs\n")
    print(f"  {'pack':<46} {'outside':>8} {'of notes':>9} {'named':>7}  how")
    for one in found:
        how = ''
        if one["map"]:
            how = f"{len(one['map'])} notes"
            if one["sections"]:
                how += f", {one['sections']} sections"
        print(f"  {one['pack'][:44]:<46} {one['outside']:>8} "
              f"{one['lostShare']:>8.1%} {one['namedShare']:>7.0%}  {how}")

    total = sum(one["notes"] for one in found)
    lost = sum(one["notes"] * one["lostShare"] for one in found)
    named = sum(one["notes"] * one["lostShare"] * one["namedShare"] for one in found)
    print(f"\n  {lost / total:.1%} of every note is outside General MIDI; "
          f"the packs' own folders name {named / max(1, lost):.0%} of that")

    if args.out:
        write(found, args.out)
        print(f"\n  wrote {args.out}")


def write(found, where):
    useful = [one for one in found if one["map"]]
    body = []
    for one in sorted(useful, key=lambda x: x["pack"]):
        lines = [f"  {json.dumps(one['pack'])}: {{"]
        lines.append(f"    /* {one['outside']} of its notes are outside General MIDI, "
                     f"{one['lostShare']:.1%} of everything it plays.")
        lines.append(f"       Its own folders name {one['namedShare']:.0%} of them. */")
        lines.append("    notes: {")
        for note in sorted(one["map"], key=int):
            lines.append(f"      {note}: {json.dumps(one['map'][note])}, "
                         f"// {one['why'][note]}")
        lines.append("    },")
        lines.append("  },")
        body.append("\n".join(lines))

    with open(where, "w", encoding="utf-8") as handle:
        handle.write(HEADER + "\n".join(body) + FOOTER)


HEADER = '''/**
 * What each drum pack's own notes mean, read off the packs themselves.
 *
 * General MIDI names notes 35 to 81. Every sampled library hangs its own
 * articulations off numbers outside that and no two vendors agree, so a
 * pack's own notes are silent in jamin unless something says what they are.
 * Nobody publishes a table. The packs, however, write their key down in
 * their folder names, and this is that key read back.
 *
 * Generated by `scripts/pack_maps.py`, which is the honest part: every line
 * below carries the evidence it came from, and where there was no evidence
 * there is no line. A pack that names nothing is absent rather than guessed
 * at. Re-run it against a collection and it will say what it found.
 *
 * Matched on the pack's folder name, which is how these collections travel.
 * A library imported under a different name gets nothing from here, and the
 * per-library note table is still where somebody says so by hand.
 *
 * @see core/drumKits.js learnInbound, components/DrumLibraryNotes.vue
 */
export const PACK_NOTES = {
'''

FOOTER = '''}


/**
 * The map for a pack, by the name it was imported under.
 *
 * Exact, then case-insensitive, then a pack whose name is contained in the
 * imported one -- these collections travel with their file counts stuck on
 * the end, so `Superior Drummer 2 Drum Midi [425,000 files]` has to find
 * `Superior Drummer 2 Drum Midi`.
 */
export function notesForPack(name) {
  if (!name) return null
  if (PACK_NOTES[name]) return PACK_NOTES[name].notes

  const want = String(name).toLowerCase()
  for (const [pack, one] of Object.entries(PACK_NOTES)) {
    const lower = pack.toLowerCase()
    if (lower === want || want.includes(lower) || lower.includes(want)) return one.notes
  }
  return null
}
'''


if __name__ == "__main__":
    main()
