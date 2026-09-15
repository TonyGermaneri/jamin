/**
 * Reading somebody's own drum library.
 *
 * A folder of MIDI files, whatever is in it. The shipped corpus is one
 * collection and a small one; a drummer who has bought libraries has hundreds
 * of thousands of patterns already, and they are *authored loops* -- already a
 * whole number of bars, already named, already sorted into folders by whoever
 * made them. Nothing here cuts anything up. A file is a pattern, and what is
 * played is what is in it.
 *
 * Nothing imported is ever redistributed: it is read from where it already is
 * on somebody's own machine, kept in their own browser, and never leaves.
 * @see README.md "On bundling other people's collections"
 */

import { parseMidiFile } from './midiFile.js'

const PPQN = 24
const DRUM_CHANNEL = 9

/** Longer than this and it is a song rather than a pattern. */
export const SONG_BARS = 8

/**
 * What kind of thing a file is, from where it sits and what it is called.
 *
 * Libraries say so in the path far more reliably than in the file: "1 Bar
 * Fills", "Fill - About That", "Endings", "Intro". So the path is read whole,
 * not just the name -- a file called `03.mid` inside `Straight Fills/1 Bar
 * Fills` is a fill, and nothing about `03` says that.
 *
 * Length settles what the words do not. A pattern is a loop and a song is a
 * performance; both are worth having and they are not used the same way.
 */
export function guessKind(path, bars) {
  const words = String(path || '').toLowerCase()

  if (/\b(fill|fills|break|breaks)\b/.test(words)) return 'fill'
  if (/\b(end|ending|endings|outro|outros)\b/.test(words)) return 'fill'
  if (/\b(intro|intros|count[- ]?in)\b/.test(words)) return 'fill'
  if (/\b(song|songs|full|arrangement|arrangements)\b/.test(words)) return 'song'

  return bars > SONG_BARS ? 'song' : 'beat'
}

/** The bit of the path that is not the file: what a library calls this shelf. */
export function folderOf(path) {
  const parts = String(path || '').split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

/** A readable name: the file, without its extension or its numbering noise. */
export function nameOf(path) {
  const file = String(path || '').split('/').pop() || 'pattern'
  return file.replace(/\.mid[i]?$/i, '').trim() || 'pattern'
}

/**
 * One file, read.
 *
 * Returns null for anything that is not a drum pattern -- a file that will not
 * parse, one with no notes, one whose notes are not on the drum channel. A
 * folder scraped off the internet has all three in it, and a silent skip is
 * better than a catalogue full of empty rows.
 *
 * **Channel 10 decides.** A MIDI file with drums on channel 10 and a bass line
 * on channel 2 is a song, not a drum pattern, and taking the whole thing would
 * put a bass line through a drum kit. Only the drum channel is kept -- and if
 * nothing is on it, the file is skipped rather than guessed at.
 */
export function readGrooveFile(bytes, path) {
  let file
  try {
    file = parseMidiFile(bytes)
  } catch {
    return null
  }

  const all = file.tracks.flatMap((track) => track.notes)
  if (!all.length) return null

  // Channel 9 counting from zero. A file with nothing there is not a drum file,
  // unless it has only one channel and somebody wrote it without thinking --
  // which is common enough in a scraped collection to be worth allowing.
  const onDrums = all.filter((note) => note.channel === DRUM_CHANNEL)
  const channels = new Set(all.map((note) => note.channel))
  const notes = onDrums.length ? onDrums : channels.size === 1 ? all : []
  if (!notes.length) return null

  const signature = file.timeSignature || { numerator: 4, denominator: 4 }
  const barPulses = Math.max(1, Math.round((signature.numerator * 4 / signature.denominator) * PPQN))

  const converted = notes
    .map((note) => ({
      at: Math.round(note.tick * PPQN / file.ppq),
      note: note.note,
      duration: Math.max(1, Math.round(note.duration * PPQN / file.ppq)),
      velocity: Math.min(127, Math.max(1, note.velocity)),
    }))
    .sort((a, b) => a.at - b.at || a.note - b.note)

  const last = converted[converted.length - 1].at
  // Rounded up to a whole bar, which is what the file already is: these are
  // authored loops, and a last note landing a pulse early does not make one
  // seven eighths of a bar long.
  const bars = Math.max(1, Math.ceil((last + 1) / barPulses))

  return {
    name: nameOf(path),
    path,
    folder: folderOf(path),
    kind: guessKind(path, bars),
    bars,
    lengthPulses: bars * barPulses,
    timeSignature: `${signature.numerator}-${signature.denominator}`,
    bpm: tempoOf(file),
    notes: converted,
    meta: metaOf(file),
  }
}

/** The tempo the file was written at, or nothing. */
function tempoOf(file) {
  const first = (file.tempos || [])[0]
  if (!first || !first.usPerQuarter) return 0
  return Math.round(60000000 / first.usPerQuarter)
}

/**
 * The words a library wrote into the file.
 *
 * "EZ Drummer", "GrooveMonkee", "Fill - About That" -- the track name is
 * routinely the pack's own name or the pattern's, and a copyright line names
 * the library outright. Which matters twice over: it is the only thing worth
 * searching several hundred thousand files by, and it is what says which kit
 * the notes were written for.
 */
function metaOf(file) {
  const out = {}
  const put = (key, value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 120 || out[key]) return
    out[key] = text
  }

  for (const track of file.tracks) {
    put('track', track.name)
    for (const entry of track.meta || []) put(entry.kind, entry.text)
  }

  return out
}

/**
 * Pick a sample that is actually of the whole thing.
 *
 * Taking the first hundred files takes the first hundred files *of one
 * subfolder* -- a tree is sorted, so the head of it is one shelf. Sampled from
 * a list of eight hundred thousand that way, a pack of every genre looked like
 * a pack of guiro patterns. Spread across the list instead.
 */
export function spread(list, count) {
  if (list.length <= count) return list.slice()
  const step = list.length / count
  const out = []
  for (let i = 0; i < count; i++) out.push(list[Math.floor(i * step)])
  return out
}

/**
 * The same, for something being read rather than something already read.
 *
 * @see spread is for a list that is all there; this is for a stream. An import
 * walks a tree of a hundred thousand files and cannot hold them, and keeping
 * the first hundred keeps the first shelf -- the same mistake spread exists to
 * avoid, wearing different clothes.
 *
 * Reservoir sampling, seeded, so the same folder samples the same files every
 * time: a classification that changed between two runs over unchanged files
 * would be untrustworthy even when it was right.
 */
export function reservoir(size, seed = 1) {
  const kept = []
  let seen = 0
  let state = (seed >>> 0) || 1

  // xorshift32. Nothing here needs a good generator, it needs the same one
  // twice.
  const next = () => {
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    return state / 0x100000000
  }

  return {
    offer(item) {
      seen++
      if (kept.length < size) { kept.push(item); return }
      const at = Math.floor(next() * seen)
      if (at < size) kept[at] = item
    },
    take: () => kept,
    get seen() { return seen },
  }
}

/**
 * What a whole folder has in common.
 *
 * Read from a sample rather than from everything: a hundred files say as much
 * as a hundred thousand about which library a shelf came from, and the point is
 * to have something to filter by before the import has finished rather than
 * after. @see spread, for why it must not be the first hundred.
 *
 * Only values that most of the sample agrees on are kept. A track name that is
 * the *pattern's* name differs in every file and tells you nothing about the
 * folder; one that is the library's name is the same in all of them.
 */
export function describeSet(samples, { agreement = 0.6, limit = 12, pitches: exact = null } = {}) {
  const counts = new Map()

  for (const groove of samples) {
    for (const [key, value] of Object.entries(groove.meta || {})) {
      const slot = counts.get(key) || new Map()
      slot.set(value, (slot.get(value) || 0) + 1)
      counts.set(key, slot)
    }
  }

  const facts = {}
  for (const [key, values] of counts) {
    const [value, seen] = [...values.entries()].sort((a, b) => b[1] - a[1])[0]
    if (seen / samples.length >= agreement) facts[key] = value
    if (Object.keys(facts).length >= limit) break
  }

  // What the notes themselves say about which kit this was written for. A pack
  // that never goes outside General MIDI's percussion range is probably GM; one
  // that uses pitches below 35 is certainly not.
  // Every pitch the library uses, not every pitch the sample uses, when the
  // caller has been counting: this is what says how much of a library a kit has
  // no drum for, and a sample would understate it. A set of at most a hundred
  // and twenty-eight numbers costs nothing to keep exactly.
  const pitches = exact ? new Set(exact) : new Set()
  if (!exact) for (const groove of samples) for (const note of groove.notes) pitches.add(note.note)
  if (pitches.size) {
    const low = Math.min(...pitches)
    const high = Math.max(...pitches)
    facts.range = `${low}-${high}`
    facts.kit = low >= 35 && high <= 59 ? 'looks like General MIDI'
              : low < 35 ? 'uses notes below General MIDI'
              : 'wider than General MIDI'
  }

  // Kept so the interface can say, against whichever kit is chosen, how much of
  // this library that kit has no drum for. A pack written for one sampler and
  // played through another loses notes silently, and a number is the only way
  // anybody would know.
  return { ...facts, pitches: [...pitches].sort((a, b) => a - b) }
}

/** Whatever the platform's separator is, one separator. Windows hands back
    backslashes and every path here is compared, split and joined. */
export function slashes(path) {
  return String(path || '').replace(/\\/g, '/')
}

/**
 * Which folders are libraries.
 *
 * A collection of collections is the normal shape of a drum library somebody has
 * actually accumulated: fifty vendors' packs sitting next to each other, each
 * with its own shelves inside it. Importing that as one library would be one row
 * holding eight hundred thousand patterns, one kit setting covering fifty
 * vendors who each wrote for a different one, and no way to remove any of it
 * without removing all of it.
 *
 * So the folders directly inside the chosen one are the libraries, and
 * everything below each is its shelves. That is the level a vendor's name is at,
 * which is the level a note map belongs to.
 *
 * A folder with no folders in it is simply itself -- one library, as before. The
 * rule needs no configuring and no knowledge of this particular collection.
 */
export function planPacks(chosen, treeIn) {
  const root = slashes(chosen.path)
  const tree = (treeIn || []).map(slashes)
  const under = (prefix) =>
    tree.filter((dir) => dir && dir.startsWith(prefix)).map((dir) => dir.slice(prefix.length))

  const top = tree.filter((dir) => dir && !dir.includes('/'))
  if (!top.length) {
    return [{ id: idForPath(root), name: chosen.name || 'library', root, shelves: tree }]
  }

  const packs = top.map((name) => ({
    id: idForPath(`${root}/${name}`),
    name,
    root: `${root}/${name}`,
    shelves: ['', ...under(`${name}/`)],
  }))

  // Files loose in the chosen folder, alongside the packs. Rare, and cheap to
  // allow for: the shelf is scanned, and if there is nothing on it no library is
  // written. @see importOnePack
  packs.unshift({
    id: idForPath(root),
    name: chosen.name || 'loose',
    root,
    shelves: [''],
  })

  return packs
}

/** A stable name for a folder, so a job that stops can pick up where it left
    off rather than importing everything twice. FNV-1a, with the length mixed
    in, which is more than enough to tell fifty folders apart. */
export function idForPath(path) {
  let hash = 0x811c9dc5
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `p${hash.toString(36)}${path.length.toString(36)}`
}

/**
 * The compact shape the catalogue is stored in, matching the shipped file.
 *
 * `byReference` leaves the notes out. Inside a plugin the library stays where it
 * is on disk and the database holds an index rather than a copy -- which for a
 * collection of this size is the difference between half a gigabyte and a few
 * tens of megabytes, and means what plays is the original file rather than a
 * transcription of it. The browser has no filesystem to point at, so it keeps
 * the notes.
 */
export function packGroove(groove, setId, index, { byReference = false } = {}) {
  // A track name that is the file's own name is the commonest thing a library
  // writes, and at eight hundred thousand rows it is eight hundred thousand
  // copies of a string already in the row. Dropping it loses nothing: it is the
  // same string.
  const meta = {}
  for (const [key, value] of Object.entries(groove.meta || {})) {
    if (value === groove.name || value === `${groove.name}.mid` || value === `${groove.name}.midi`) continue
    meta[key] = value
  }

  const row = {
    id: `${setId}:${index}`,
    s: setId,
    n: groove.name,
    p: groove.path,
    f: groove.folder,
    k: groove.kind,
    r: groove.bars,
    d: groove.lengthPulses,
    t: groove.timeSignature,
    b: groove.bpm,
    // How many hits, kept in the index because an index row has no notes to
    // count and the list line says so out loud. Free here: the file has just
    // been read.
    h: groove.notes.length,
    m: meta,
  }
  if (!byReference) {
    row.v = groove.notes.map((note) => [note.at, note.note, note.duration, note.velocity])
  }
  return row
}

/** And back, in the shape the player and the book expect. */
export function unpackGroove(row) {
  const [numerator = 4, denominator = 4] = String(row.t || '4-4').split('-').map(Number)
  return {
    id: row.id,
    setId: row.s,
    name: row.n,
    path: row.p,
    folder: row.f,
    kind: row.k,
    genre: row.f ? String(row.f).split('/')[0] : '',
    substyle: '',
    bpm: row.b || 0,
    timeSignature: row.t || '4-4',
    beatsPerBar: numerator,
    beatUnit: denominator,
    bars: row.r || 1,
    lengthPulses: row.d || 96,
    // Empty when the row is an index entry. The notes are fetched from the file
    // it points at, at the moment something needs to play it. @see byReference
    notes: (row.v || []).map(([at, note, duration, velocity]) => ({ at, note, duration, velocity })),
    hits: row.h || (row.v || []).length,
    byReference: !row.v,
    meta: row.m || {},
    origin: 'imported',
    imported: true,
  }
}
