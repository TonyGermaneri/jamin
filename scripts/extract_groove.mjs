/**
 * Build src/data/grooveDrums.json from the Groove MIDI Dataset.
 *
 *   node scripts/extract_groove.mjs /path/to/groove [out.json]
 *
 * The dataset is CC BY 4.0 (Google LLC) and is 3MB of MIDI, so unlike
 * Chordonomicon it can be shipped. What is shipped is a derived work -- the
 * performances sliced into loopable excerpts -- which CC BY permits with
 * attribution. @see src/data/grooveDrums.LICENSE
 *
 * It reads the MIDI with the application's own reader rather than a second
 * implementation, for the same reason the POP909 extractor does: two readers
 * drift, and the one that matters is the one the plugin runs.
 *
 * https://magenta.tensorflow.org/datasets/groove
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMidiFile } from '../src/core/midiFile.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PPQN = 24                       // what jamin counts in, everywhere

const source = process.argv[2]
const out = process.argv[3] || join(ROOT, 'src', 'data', 'grooveDrums.json')
if (!source) {
  console.error('usage: node scripts/extract_groove.mjs /path/to/groove [out.json]')
  process.exit(2)
}

/* ---------------------------------------------------------------- the index */
const csv = readFileSync(join(source, 'info.csv'), 'utf8').trim().split('\n')
const head = csv[0].split(',')
const rows = csv.slice(1).map((line) => {
  const cells = line.split(',')
  return Object.fromEntries(head.map((key, i) => [key, cells[i]]))
})

/* ------------------------------------------------------------- the slicing */
/**
 * A beat is a performance, not a loop -- the median is 24 bars and the longest
 * is 639 -- so a groove has to be cut out of it. A fill is already the right
 * size: the median is one bar and nine in ten are two or fewer.
 *
 * The first bar is skipped for a beat. Drummers were counted in and tend to
 * announce themselves, so bar one is an entry rather than the groove, and a
 * loop that starts with a crash is a loop that crashes every two bars.
 */
/**
 * Nothing is cut.
 *
 * An earlier version of this sliced the performances into one, two and four bar
 * loops. That was a decision about somebody else's material taken without
 * asking, and it was also done badly -- cutting on the bar line put the
 * anticipated downbeat at the end of the previous loop and left most of the
 * corpus flamming once a bar.
 *
 * So each performance ships whole, as it was played. A take that runs
 * twenty-four bars is twenty-four bars of drumming, which is a *song*: bind it
 * to a section and it plays through. A fill is a fill. Nothing is invented,
 * nothing is removed, and the only thing this file decides is what to call
 * things.
 */

/** Longer than this and it is a performance rather than a pattern. */
const SONG_BARS = 8

const grooves = []
let skipped = 0

for (const row of rows) {
  let file
  try {
    file = parseMidiFile(new Uint8Array(readFileSync(join(source, row.midi_filename))))
  } catch {
    skipped++
    continue
  }

  const [numerator, denominator] = row.time_signature.split('-').map(Number)
  const barPulses = Math.round((numerator * 4 / denominator) * PPQN)
  if (!barPulses) { skipped++; continue }

  const notes = file.tracks
    .flatMap((track) => track.notes)
    .map((note) => ({
      // Rounded to the pulse. Measured across the corpus, that throws away a
      // mean of 6.2ms against a mean human deviation of 23.5ms -- so about
      // three quarters of the groove survives, and none of it is re-quantised
      // onto a sixteenth, which would throw away all of it.
      at: Math.round(note.tick * PPQN / file.ppq),
      note: note.note,
      duration: Math.max(1, Math.round(note.duration * PPQN / file.ppq)),
      velocity: Math.min(127, Math.max(1, note.velocity)),
    }))
    .sort((a, b) => a.at - b.at || a.note - b.note)

  if (!notes.length) { skipped++; continue }

  const last = notes[notes.length - 1].at
  const bars = Math.max(1, Math.ceil((last + 1) / barPulses))
  const [genre, substyle = ''] = row.style.split('/')

  // The corpus says beat or fill. Length says whether a beat is a pattern you
  // would loop or a performance you would play through -- both are useful and
  // they are not used the same way.
  const kind = row.beat_type === 'fill' ? 'fill' : bars > SONG_BARS ? 'song' : 'beat'

  grooves.push({
    n: `${genre} ${row.bpm} ${kind}`,
    g: genre,
    u: substyle,
    b: Number(row.bpm),
    t: row.time_signature,
    k: kind,
    r: bars,
    d: bars * barPulses,
    // Whose take this is, which the slicing had no room for and which is the
    // honest label for an artefact somebody actually played.
    w: row.drummer,
    v: notes.map((note) => [note.at, note.note, note.duration, note.velocity]),
  })
}

/* --------------------------------------------------- names people can tell apart */
const counts = new Map()
for (const groove of grooves) {
  const base = `${groove.g} ${groove.b} ${groove.k}`
  const n = (counts.get(base) || 0) + 1
  counts.set(base, n)
  groove.n = `${base} ${n}`
}

writeFileSync(out, JSON.stringify({
  source: 'Groove MIDI Dataset',
  url: 'https://magenta.tensorflow.org/datasets/groove',
  licence: 'CC BY 4.0',
  attribution: 'Groove MIDI Dataset by Google LLC, used under CC BY 4.0. '
             + 'Sliced into loopable excerpts for jamin.',
  ppqn: PPQN,
  kit: 'roland-td11',
  grooves,
}))

const bars = new Map()
for (const groove of grooves) bars.set(`${groove.k} ${groove.r}`, (bars.get(`${groove.k} ${groove.r}`) || 0) + 1)
console.log(`${grooves.length} grooves from ${rows.length} performances (${skipped} unreadable)`)
console.log([...bars.entries()].sort().map(([k, n]) => `  ${k} bar: ${n}`).join('\n'))
