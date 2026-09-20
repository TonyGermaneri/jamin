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

  /*
   * And what each unnamed note *does*, for the packs whose folders say
   * nothing -- which is most of the ones that need saying. Three things
   * worth knowing about a note: what it lands on top of, where in the bar
   * it falls, and how thick it plays.
   */
  const behaviour = new Map()
  const seen = (note) => {
    let one = behaviour.get(note)
    if (!one) {
      one = { hits: 0, alone: 0, withTick: new Map(), slots: new Array(16).fill(0),
              bars: 0, absent: new Map(), inKit: 0 }
      behaviour.set(note, one)
    }
    return one
  }

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

      /* What this file has that is already named, and where everything
         falls in the bar. 24 pulses to the quarter, so a sixteenth is 6. */
      const named = new Set()
      const atTick = new Map()
      for (const n of groove.notes) {
        if (GENERAL_MIDI_IN[n.note]) named.add(GENERAL_MIDI_IN[n.note])
        const k = Math.round(n.at)
        if (!atTick.has(k)) atTick.set(k, [])
        atTick.get(k).push(n.note)
      }
      const perBar = Math.max(1, (groove.beatsPerBar || 4) * 24)
      const bars = Math.max(1, (groove.lengthPulses || perBar) / perBar)

      for (const n of groove.notes) {
        if (GENERAL_MIDI_IN[n.note]) continue
        const one = seen(n.note)
        one.hits++
        one.bars += 1 / bars
        const slot = Math.round((n.at % perBar) / (perBar / 16)) % 16
        one.slots[slot]++
        const together = (atTick.get(Math.round(n.at)) || [])
          .filter((x) => x !== n.note && GENERAL_MIDI_IN[x])
        if (!together.length) one.alone++
        for (const other of together) {
          const voice = GENERAL_MIDI_IN[other]
          one.withTick.set(voice, (one.withTick.get(voice) || 0) + 1)
        }
        // Which of the three anchors this file does *without*. A note that
        // plays where the snare would, in a file with no snare, is doing
        // the snare's job.
        for (const anchor of ['kick', 'snare', 'hatClosed']) {
          if (named.has(anchor)) continue
          one.absent.set(anchor, (one.absent.get(anchor) || 0) + 1)
        }
        // Whether this is a drum kit at all. A file with a kick or a snare
        // in it is; one with neither is a percussion part, and the two
        // want different guesses out of the same evidence.
        if (named.has('kick') || named.has('snare')) one.inKit++
      }

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

  /*
   * And the guesses, for the notes nothing named.
   *
   * These are inferences from behaviour, not readings of evidence, and
   * they are kept apart from the named ones for that reason. Three rules,
   * each with the number that triggered it recorded beside it:
   *
   *   layer     more than half its onsets land on the exact tick of one
   *             known voice, and twice as often as the next. A note that
   *             rides along with the snare is a snare articulation.
   *   standing in  it plays where an anchor would, in files that have no
   *             such anchor. A note on two and four in a file with no
   *             snare is doing the snare's job.
   *   density   six or more to the bar, spread across the sixteenths, in
   *             files with no closed hat. That is a hat part.
   *
   * A note that fits none of them gets nothing. `alone` is the check that
   * keeps `layer` honest: a note that mostly plays by itself is not
   * riding along with anything.
   */
  const guesses = {}
  const guessWhy = {}
  const BACKBEAT = [4, 12]
  const DOWNBEAT = [0, 8]

  for (const [note, one] of behaviour) {
    if (map[note] || one.hits < 24) continue

    const ranked = [...one.withTick].sort((a, b) => b[1] - a[1])
    const [top, many] = ranked[0] || ['', 0]
    const second = ranked[1] ? ranked[1][1] : 0
    const share = many / one.hits
    const aloneShare = one.alone / one.hits

    if (top && share >= 0.55 && many >= second * 2 && aloneShare < 0.35) {
      guesses[note] = top
      guessWhy[note] = `rides with the ${top} on ${Math.round(share * 100)}% of its hits`
      continue
    }

    const onSlots = (slots) => slots.reduce((sum, at) => sum + one.slots[at], 0) / one.hits
    const missing = (anchor) => (one.absent.get(anchor) || 0) / one.hits

    const back = onSlots(BACKBEAT)
    if (back >= 0.6 && missing('snare') > 0.5) {
      guesses[note] = 'snare'
      guessWhy[note] = `${Math.round(back * 100)}% on two and four, in files with no snare`
      continue
    }

    const down = onSlots(DOWNBEAT)
    if (down >= 0.6 && missing('kick') > 0.5) {
      guesses[note] = 'kick'
      guessWhy[note] = `${Math.round(down * 100)}% on one and three, in files with no kick`
      continue
    }

    /*
     * Dense and even: something small played fast. Which small thing
     * depends on whether there is a kit around it.
     *
     * The first version called all of them hi-hats and produced seven
     * hi-hats for a pack called `Midi.Styles.Percussion`, which has no kit
     * in it at all -- the rule had found "small thing played fast" and had
     * only one word for it. In a file with a kick or a snare the hat is
     * what is missing; in a file with neither, nothing is missing and the
     * dense part is a shaker.
     */
    const perBar = one.hits / Math.max(1, one.bars)
    const spread16 = one.slots.filter((at) => at > one.hits / 40).length
    if (perBar < 6 || spread16 < 8) continue

    const kitLike = one.inKit / one.hits
    if (kitLike > 0.5 && missing('hatClosed') > 0.5) {
      guesses[note] = 'hatClosed'
      guessWhy[note] = `${perBar.toFixed(1)} to the bar across ${spread16} sixteenths, `
        + 'in kit files with no closed hat'
    } else if (kitLike < 0.2) {
      guesses[note] = 'cabasa'
      guessWhy[note] = `${perBar.toFixed(1)} to the bar across ${spread16} sixteenths, `
        + 'in files with no kit in them at all — a shaker of some sort'
    }
  }

  const outside = [...uses.entries()].filter(([note]) => !GENERAL_MIDI_IN[note])
  const lost = outside.reduce((sum, [, n]) => sum + n, 0)
  const named = outside.filter(([note]) => map[note]).reduce((sum, [, n]) => sum + n, 0)

  const guessed = outside.filter(([note]) => guesses[note])
    .reduce((sum, [, n]) => sum + n, 0)

  report.push({
    pack,
    guesses,
    guessWhy,
    guessedShare: lost ? guessed / lost : 0,
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
    print(f"  {'pack':<46} {'outside':>8} {'of notes':>9} {'named':>7} "
          f"{'guessed':>8}  how")
    for one in found:
        how = ''
        if one["map"]:
            how = f"{len(one['map'])} notes"
            if one["sections"]:
                how += f", {one['sections']} sections"
        print(f"  {one['pack'][:44]:<46} {one['outside']:>8} "
              f"{one['lostShare']:>8.1%} {one['namedShare']:>7.0%} "
              f"{one['guessedShare']:>8.0%}  {how}")

    total = sum(one["notes"] for one in found)
    lost = sum(one["notes"] * one["lostShare"] for one in found)
    named = sum(one["notes"] * one["lostShare"] * one["namedShare"] for one in found)
    guessed = sum(one["notes"] * one["lostShare"] * one["guessedShare"] for one in found)
    print(f"\n  {lost / total:.1%} of every note is outside General MIDI; "
          f"the packs' own folders name {named / max(1, lost):.0%} of that, "
          f"and behaviour guesses at a further {guessed / max(1, lost):.0%}")

    if args.out:
        write(found, args.out)
        print(f"\n  wrote {args.out}")


def write(found, where):
    useful = [one for one in found if one["map"] or one["guesses"]]
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
        if one["guesses"]:
            lines.append("    /* Inferred from how these notes behave, not read off "
                         "anything that")
            lines.append("       names them. Offered, never applied: a guess about a drum "
                         "is worth")
            lines.append("       having in front of somebody and is not worth putting "
                         "under their")
            lines.append(f"       song unasked. Covers {one['guessedShare']:.0%} of what "
                         "is unnamed. */")
            lines.append("    guesses: {")
            for note in sorted(one["guesses"], key=int):
                lines.append(f"      {note}: {json.dumps(one['guesses'][note])}, "
                             f"// {one['guessWhy'][note]}")
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
function packFor(name) {
  if (!name) return null
  if (PACK_NOTES[name]) return PACK_NOTES[name]

  const want = String(name).toLowerCase()
  for (const [pack, one] of Object.entries(PACK_NOTES)) {
    const lower = pack.toLowerCase()
    if (lower === want || want.includes(lower) || lower.includes(want)) return one
  }
  return null
}

/** What the pack's own folders say. Applied at import. */
export function notesForPack(name) {
  const one = packFor(name)
  return (one && one.notes) || null
}

/**
 * What its notes look like they are doing. Offered, never applied.
 *
 * A guess about a drum is worth having in front of somebody -- it is a
 * starting point for an ear, and the alternative is silence -- and is not
 * worth putting under their song unasked. These are inferences from
 * rhythm, which is a weaker thing than a folder with an instrument's name
 * on it, and the interface says which is which.
 */
export function guessesForPack(name) {
  const one = packFor(name)
  return (one && one.guesses) || null
}
'''


if __name__ == "__main__":
    main()
