#!/usr/bin/env python3
"""Import a real drum library and play its patterns out of it.

`import_check.py` asks whether a library reads. This asks the next question,
which is the one a listener cares about: once it is in, does pressing play
produce notes -- and do the notes land on the right drums?

It exists because the Superior Drummer pack reported "106 of 128 sounds have
nowhere to go on this kit" whichever map was chosen, while the patterns
themselves played perfectly. Two different faults can produce that sentence and
only one of them is audible, so the check reports both separately:

  * what the *badge* says, computed the way the library screen computes it
  * what actually comes out of the play path, note by note

The play path is the real one: the library's own numbering read in (per shelf,
because a pack disagrees with itself), the track's drum instrument written out.
@see store.js midiForGroove, inboundMapFor, kitMapFor

    python3 scripts/play_check.py "/Volumes/external/800k-drums/Superior Drummer 2 Drum Midi [425,000 files]"
    python3 scripts/play_check.py <folder> --per-shelf 40

Not part of `npm test`: it needs somebody's library. Run it after touching
anything on the mapping path.
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
import { readGrooveFile, describeSet, spread } from 'SRC/core/drumImport.js'
import {
  classifyFolders, kitById, mapDrumNote, mapDrumNotes, learnInbound, cleanInMap,
  DRUM_KITS, DEFAULT_KIT,
} from 'SRC/core/drumKits.js'

const ROOT = process.argv[2]
const PER_SHELF = Number(process.argv[3] || 40)
const NAME = path.basename(ROOT)

/* The shelves, as the import sees them: every folder that holds MIDI files,
   named relative to the library's own root. */
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
walk(ROOT)

const byShelf = new Map()
for (const file of files) {
  const shelf = path.dirname(path.relative(ROOT, file))
  if (!byShelf.has(shelf)) byShelf.set(shelf, [])
  byShelf.get(shelf).push(file)
}

/* Read a sample from every shelf -- the import's own histograms are built from
   every file, but a verdict that needs more than forty patterns per shelf is
   not a verdict. */
const perFolder = new Map()
const uses = new Map()
const grooves = []
let read = 0
let skipped = 0

for (const [, list] of byShelf) {
  for (const file of spread(list, PER_SHELF)) {
    const rel = path.relative(ROOT, file)
    let groove = null
    try {
      groove = readGrooveFile(new Uint8Array(fs.readFileSync(file)), rel, `${NAME}/${rel}`)
    } catch { groove = null }
    if (!groove || !groove.notes.length) { skipped++; continue }
    read++
    grooves.push(groove)

    let hist = perFolder.get(groove.folder)
    if (!hist) { hist = {}; perFolder.set(groove.folder, hist) }
    for (const note of groove.notes) {
      hist[note.note] = (hist[note.note] || 0) + 1
      uses.set(note.note, (uses.get(note.note) || 0) + 1)
    }
  }
}

const { folderKits, setKit, reason } = classifyFolders(perFolder)

/*
 * And the corrections a person would be offered for the notes no kit reads.
 *
 * The library screen puts these in front of somebody with the evidence
 * beside them, one press each. Here they are all accepted at once, which is
 * the best case rather than the likely one -- what it measures is how much
 * of the gap the library's own folder names can close without anybody
 * inventing anything. @see components/DrumLibraryNotes.vue
 */
const learned = learnInbound(perFolder, kitById(setKit || DEFAULT_KIT).in)
const taught = cleanInMap(Object.fromEntries(
  Object.entries(learned.hints).map(([note, one]) => [note, one.voice])))
const facts = describeSet(grooves.slice(0, 120),
  { pitches: [...uses.keys()].sort((a, b) => a - b), uses })
const set = { id: 'probe', name: NAME, kit: setKit, folderKits, facts }

/* ---- what the badge says ------------------------------------------------
   Two readings of the same row: the one the screen was computing, and the one
   that answers the question the words on it ask. */
const badge = (inboundOf, outboundOf) => {
  const list = facts.pitches || []
  const lost = list.filter((pitch) => mapDrumNote(pitch, outboundOf(), inboundOf()) === null)
  const struck = [...uses.values()].reduce((sum, n) => sum + n, 0)
  const missed = lost.reduce((sum, pitch) => sum + (uses.get(pitch) || 0), 0)
  return { lost: lost.length, total: list.length, silent: lost,
           percent: struck ? Math.round(100 * missed / struck) : 0 }
}

/* ---- what playing actually does ----------------------------------------
   The real path, once per playback kit: inbound from the shelf the pattern
   sits on, outbound from the drum instrument on the track. */
const inboundFor = (groove, withTaught) => {
  const base = kitById(folderKits[groove.folder] || set.kit || DEFAULT_KIT).in
  return withTaught ? { ...base, ...taught } : base
}

const runThrough = (kit, withTaught) => {
  let notesIn = 0
  let notesOut = 0
  let silentClips = 0
  const lostPitch = new Map()
  for (const groove of grooves) {
    const inbound = inboundFor(groove, withTaught)
    const out = mapDrumNotes(groove.notes, kitById(kit).map, inbound)
    notesIn += groove.notes.length
    notesOut += out.length
    if (!out.length) silentClips++
    if (out.length < groove.notes.length) {
      for (const note of groove.notes) {
        if (mapDrumNote(note.note, kitById(kit).map, inbound) === null) {
          lostPitch.set(note.note, (lostPitch.get(note.note) || 0) + 1)
        }
      }
    }
  }
  return { notesIn, notesOut, silentClips, clips: grooves.length,
           lost: [...lostPitch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10) }
}

const played = DRUM_KITS.map((kit) =>
  ({ kit: kit.id, name: kit.name, ...runThrough(kit.id, false) }))
const afterTeaching = runThrough(DEFAULT_KIT, true)

process.stdout.write(JSON.stringify({
  name: NAME, files: files.length, read, skipped,
  shelves: byShelf.size, setKit, reason,
  disagreeing: Object.entries(folderKits).slice(0, 8),
  pitches: facts.pitches || [],
  // As the screen had it: the library's own map used as the outbound one, and
  // the inbound left to its default.
  badgeWas: badge(() => undefined, () => kitById(set.kit || DEFAULT_KIT).map),
  // As it should be: the library's numbering in, the chosen instrument out.
  badgeNow: badge(() => kitById(set.kit || DEFAULT_KIT).in,
                  () => kitById(DEFAULT_KIT).map),
  played,
  // And with every suggestion the library's own folder names can make.
  taught: Object.entries(taught).sort((a, b) => Number(a[0]) - Number(b[0])),
  asked: Object.keys(learned.where).length,
  afterTeaching,
}))
"""


def run(folder, per_shelf):
    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    if not os.path.exists(esbuild):
        raise SystemExit("esbuild is not installed; run npm install")

    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, "node_modules")) as work:
        entry = os.path.join(work, "driver.mjs")
        with open(entry, "w", encoding="utf-8") as handle:
            handle.write(DRIVER.replace("SRC", os.path.join(ROOT, "src")))
        bundle = os.path.join(work, "driver.bundle.mjs")
        built = subprocess.run(
            [esbuild, entry, "--bundle", "--format=esm", "--platform=node",
             "--log-level=error", f"--outfile={bundle}"],
            capture_output=True, text=True)
        if built.returncode != 0:
            raise SystemExit(f"bundling the play path failed:\n{built.stderr}")
        out = subprocess.run(["node", "--max-old-space-size=8192", bundle,
                              folder, str(per_shelf)],
                             capture_output=True, text=True)
        if out.returncode != 0:
            raise SystemExit(f"the play path threw:\n{out.stderr[-4000:]}")
        return json.loads(out.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="one drum library")
    parser.add_argument("--per-shelf", type=int, default=40)
    args = parser.parse_args()
    if not os.path.isdir(args.folder):
        raise SystemExit(f"{args.folder} is not a folder")

    found = run(args.folder, args.per_shelf)
    print(f"  {found['name']}")
    print(f"  {found['read']:,} patterns read from {found['shelves']:,} shelves "
          f"({found['skipped']:,} skipped, {found['files']:,} files in all)")
    print(f"  called    {found['setKit'] or '(undecided)'}"
          f"{f'  -- {found[chr(39)+chr(39)]}' if False else ''}")
    if found["reason"]:
        print(f"  because   {found['reason']}")
    if found["disagreeing"]:
        print("  shelves with a map of their own: "
              + ", ".join(f"{s} -> {k}" for s, k in found["disagreeing"]))

    was, now = found["badgeWas"], found["badgeNow"]
    print(f"  badge     was '{was['lost']} of {was['total']} sounds have nowhere to go'")
    print(f"            now '{now['percent']}% of this library's notes have nowhere to go'"
          f"  ({now['lost']} of {now['total']} distinct notes)")
    if now["silent"]:
        print(f"            still silent: {', '.join(str(n) for n in now['silent'][:24])}")

    print(f"  asked     {found['asked']} notes have no voice; the library's own folder "
          f"names answer {len(found['taught'])} of them")
    if found["taught"]:
        print("            " + ", ".join(f"{n}->{v}" for n, v in found["taught"][:14]))
    print("  playing every pattern through each kit:")
    for one in found["played"]:
        share = one["notesOut"] / one["notesIn"] if one["notesIn"] else 0
        print(f"    {one['name']:24} {one['notesOut']:,} of {one['notesIn']:,} notes "
              f"({share:.1%}), {one['silentClips']:,} of {one['clips']:,} clips silent")
        if one["lost"]:
            print("      lost: " + ", ".join(f"{n}x{c:,}" for n, c in one["lost"][:6]))

    after = found["afterTeaching"]
    before = next(o for o in found["played"] if o["kit"] == "gm")
    wasShare = before["notesOut"] / before["notesIn"] if before["notesIn"] else 0
    nowShare = after["notesOut"] / after["notesIn"] if after["notesIn"] else 0
    print(f"  taught    {after['notesOut']:,} of {after['notesIn']:,} notes "
          f"({nowShare:.1%}, was {wasShare:.1%}), "
          f"{after['silentClips']:,} clips silent (was {before['silentClips']:,})")

    failures = []

    def check(label, ok, detail=""):
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}{f' -- {detail}' if detail else ''}")
        if not ok:
            failures.append(label)

    check("the library reads", found["read"] > 0, f"{found['read']} patterns")

    # The one that matters. A pattern that comes out with no notes at all is
    # silence where a groove should be, and no error says so.
    #
    # The bars are where the biggest real library stands today rather than at
    # perfection, because it is not at perfection: a Superior Drummer download
    # plays 91.8% of its notes and leaves 2.4% of its patterns silent, and all
    # of that is sampled libraries laying their own articulations out in their
    # own numbering -- EZX Latin Percussion puts its congas on 90 and 94-97,
    # its cajon on 10-14, its timbales on 17-23. Those are not faults to be
    # fixed by rounding a threshold down; they are notes with no voice, and
    # they need a decision about the vocabulary rather than a looser test.
    # What the bars are for is to catch the *next* thing that breaks mapping,
    # which is how all three of the faults above were found.
    for one in found["played"]:
        share = one["notesOut"] / one["notesIn"] if one["notesIn"] else 0
        silent = one["silentClips"] / one["clips"] if one["clips"] else 0
        check(f"{one['name']} plays it",
              silent <= 0.03 and share >= 0.90,
              f"{share:.1%} of notes, {silent:.1%} of clips silent")

    # And the badge has to agree with the sound. A warning that fires while
    # everything plays is worse than no warning: it sends somebody off to fix a
    # map that was right.
    worst = max((1 - o["notesOut"] / o["notesIn"]) for o in found["played"] if o["notesIn"])
    claimed = now["percent"] / 100
    check("the badge agrees with what is heard", abs(claimed - worst) < 0.03,
          f"badge says {claimed:.0%} lost, playing loses at most {worst:.0%}")

    # Suggesting is allowed to find nothing -- most libraries name their
    # folders after grooves. Suggesting something *worse* is not: a correction
    # can only ever add a voice to a note that had none, so the number of
    # notes that play can never fall.
    check("accepting the suggestions never loses a note", nowShare >= wasShare,
          f"{wasShare:.1%} before, {nowShare:.1%} after")

    print(f"\n  {'all checks passed' if not failures else str(len(failures)) + ' FAILED'}")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
