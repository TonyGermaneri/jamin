import { unglue } from './genres.js'

/**
 * What else a drum library's paths say.
 *
 * @see genres.js reads the genre out of a folder name. There is a good deal
 * more in there, and it was found by counting rather than guessing -- 4,415
 * paths sampled across a 774,000-file collection of about two hundred vendors:
 *
 *     time signature   49.6%    `31@3-4`, `109@STRAIGHT_6#8`
 *     song part        47.3%    `110-S037@BRIDGE`, `11@FILLS`, `@THEME`
 *     feel             15.5%    `straight` alone appears 1,831 times
 *     ride surface     12.3%    `hihat` 1,233, `ride` 736, `crash` 264
 *     decade            3.9%    `80´s Drummer MIDI Files`
 *
 * The surface is the one worth having and the one nobody would think to ask
 * for: which cymbal a groove rides on is how a drummer chooses between two
 * otherwise identical patterns, and a library that can be asked for ride
 * grooves is a different instrument from one that cannot.
 *
 * Tempo and time signature are read from the file itself where possible, which
 * is better evidence than a folder name -- these are for when the file says
 * nothing, and for searching.
 */

/**
 * Each tag is a set of spellings, longest first within its own kind.
 *
 * Every one of these was taken from a real path. `#` is a slash in a filename
 * on every platform that forbids the real one, which is why `6#8` is six eight.
 */
const TAGS = {
  /** How the subdivision lies. */
  feel: [
    ['Half-time', ['half time', 'halftime', 'half-time']],
    ['Double-time', ['double time', 'doubletime', 'double-time']],
    ['Straight', ['straight', 'even']],
    ['Shuffle', ['shuffle', 'shuffled']],
    ['Swing', ['swing', 'swung', 'swingin']],
    ['Triplet', ['triplet', 'triplets', 'trip']],
    ['Linear', ['linear']],
    ['Broken', ['broken']],
    ['Four on the Floor', ['four on the floor', '4 on the floor']],
  ],

  /** What the right hand is on, which is how two otherwise identical grooves
      differ and how a drummer tells them apart. */
  surface: [
    ['Hi-hat', ['hihat', 'hi hat', 'hi-hat', 'hats', 'hat', 'hh']],
    ['Ride', ['ride', 'ride cymbal', 'ridebell', 'ride bell']],
    ['Crash', ['crash', 'crashes']],
    ['Toms', ['toms', 'tom', 'floor tom', 'tom tom']],
    ['Snare', ['snare', 'rimshot', 'rim', 'sidestick', 'side stick', 'cross stick']],
    ['Kick', ['kick', 'bass drum', 'double kick', 'double bass']],
    ['Full kit', ['fullkit', 'full kit', 'whole kit']],
    ['Percussion', ['percussion', 'perc', 'shaker', 'tambourine', 'conga', 'bongo', 'cowbell']],
  ],

  /** Where in a song it belongs. Finer than beat-or-fill, which is all the
      file itself can say. */
  part: [
    ['Intro', ['intro', 'intros', 'count in', 'countin', 'count-in']],
    ['Verse', ['verse', 'verses']],
    ['Pre-chorus', ['prechorus', 'pre chorus', 'pre-chorus']],
    ['Chorus', ['chorus', 'choruses']],
    ['Bridge', ['bridge', 'bridges', 'middle eight']],
    ['Fill', ['fill', 'fills']],
    ['Break', ['break', 'breaks', 'breakdown']],
    ['Turnaround', ['turnaround', 'turn around']],
    ['Ending', ['ending', 'endings', 'outro', 'outros', 'end']],
    ['Theme', ['theme', 'themes', 'main']],
    ['Solo', ['solo', 'solos']],
  ],

  /** When it is meant to sound like. */
  era: [
    ['1930s', ['30s', '1930s', "30´s", "30's"]],
    ['1940s', ['40s', '1940s', "40´s", "40's"]],
    ['1950s', ['50s', '1950s', "50´s", "50's"]],
    ['1960s', ['60s', '1960s', "60´s", "60's"]],
    ['1970s', ['70s', '1970s', "70´s", "70's"]],
    ['1980s', ['80s', '1980s', "80´s", "80's"]],
    ['1990s', ['90s', '1990s', "90´s", "90's"]],
    ['2000s', ['00s', '2000s', "00´s"]],
  ],
}

/**
 * Built once. The order a kind is written in is the order it is tried in.
 *
 * Specificity, not spelling length. `FullKit HiHat 8ths` says both, and the
 * answer is the hi-hat -- the cymbal is what distinguishes this groove and the
 * kit is only context. Length would have answered `Full kit`, because
 * `fullkit` has more letters in it than `hihat` does. So the list is ordered by
 * hand: the specific surfaces first, `Full kit` and `Percussion` last.
 *
 * Within one name the longest spelling still wins, so `ride bell` is found
 * before `ride`.
 */
const LOOKUP = Object.fromEntries(
  Object.entries(TAGS).map(([kind, entries]) => {
    const out = []
    for (const [name, forms] of entries) {
      for (const form of [...forms].sort((a, b) => b.length - a.length)) {
        out.push({ form, name })
      }
    }
    return [kind, out]
  })
)

/**
 * A path, flattened into words.
 *
 * Every separator a vendor has ever used becomes a space, and `#` becomes a
 * slash first -- it stands in for one in a filename on every platform that
 * forbids the real character, which is why `6#8` is six eight and not
 * something with a hash in it.
 */
function flatten(path) {
  // Camel case before lowercasing, because lowercasing is what destroys it.
  // `FullKit HiHat 8ths` and `11_8_IndieQuirk` are both one word to a vendor
  // and three to anybody reading them. @see genres.js unglue
  return unglue(path)
    .toLowerCase()
    .replace(/(\d)\s*#\s*(\d)/g, '$1/$2')
    .replace(/[_@\-[\]{}()!,;:.\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The first tag of this kind the path mentions, or ''. */
function tagIn(text, kind) {
  const padded = ` ${text} `
  for (const { form, name } of LOOKUP[kind]) {
    if (padded.includes(` ${form} `)) return name
  }
  return ''
}

/**
 * The time signature a path claims, as `3/4`.
 *
 * Only the ones that are actually metres. A path is full of numbers separated
 * by punctuation -- catalogue numbers, dates, tempo ranges -- and reading
 * `2-13` as a time signature would fill the filter with nonsense.
 */
const METRES = new Set([
  '2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '9/4', '12/4',
  '3/8', '5/8', '6/8', '7/8', '9/8', '11/8', '12/8', '15/8',
  '2/2', '3/2',
])

export function signatureIn(path) {
  /*
   * Its own normalising, because flatten() throws slashes away -- they are
   * path separators -- and a time signature is two numbers with a slash in it.
   *
   * Vendors write it three ways and all three are in this one collection:
   * `6#8`, because a filename may not contain a slash on most platforms;
   * `3-4`, because a hyphen is safe everywhere; and the real thing where the
   * platform allows it. The list of metres is what keeps `2-13` and `1-16`
   * from becoming time signatures.
   */
  const text = String(path || '')
    .toLowerCase()
    // Underscore too. A vendor whose folders are `11_8_IndieQuirk` and
    // `7_8_FunkStep` is writing eleven-eight and seven-eight, and a pack called
    // Odd Meter Drums where the metre is the whole point was reading none of
    // them. The list of metres is still what keeps `2_13` from becoming one.
    .replace(/(\d)\s*[#_-]\s*(\d)/g, '$1/$2')

  for (const found of text.matchAll(/(?<!\d)(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/g)) {
    const metre = `${found[1]}/${found[2]}`
    if (METRES.has(metre)) return metre
  }
  return ''
}

/** The tempo a path claims, or 0. Written as `170BPM` or `120 bpm`. */
export function tempoIn(path) {
  const found = flatten(path).match(/\b(\d{2,3})\s*bpm\b/)
  if (!found) return 0
  const bpm = Number(found[1])
  // A drum library is not played at four beats a minute or at six hundred.
  return bpm >= 30 && bpm <= 300 ? bpm : 0
}

/**
 * Everything a path says about a pattern, as enum values.
 *
 * Read over the whole path rather than segment by segment: a vendor puts the
 * feel in one folder and the surface in another, and both are about the file at
 * the bottom of it.
 */
export function tagsFor(path) {
  const text = flatten(path)
  const out = {}

  for (const kind of Object.keys(TAGS)) {
    const found = tagIn(text, kind)
    if (found) out[kind] = found
  }

  const signature = signatureIn(path)
  if (signature) out.signature = signature

  const tempo = tempoIn(path)
  if (tempo) out.tempo = tempo

  return out
}

/** Every value of one kind, for a filter to offer. */
export function everyTag(kind) {
  return (TAGS[kind] || []).map(([name]) => name)
}

/** The kinds themselves, with something to call them. */
export const TAG_KINDS = [
  { key: 'feel', label: 'Feel' },
  { key: 'surface', label: 'Played on' },
  { key: 'part', label: 'Part of a song' },
  { key: 'era', label: 'Era' },
]
