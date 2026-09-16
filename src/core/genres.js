/**
 * What a folder name says about the music in it.
 *
 * A drum library has no metadata worth the name, but it has a folder
 * structure, and vendors put the genre in it:
 *
 *     80´s Drummer MIDI Files/Chrome Kit/02 Heavy Metal
 *     GM MIDI Pack/GM - Blues/GM - Blues DFH
 *     Superior Drummer 2 Drum Midi/000210@JAZZ/31@3-4
 *     Studio Drummer MIDI Files/11 Punk Rock/04 Groove 170BPM
 *
 * The path cannot be predicted -- every vendor invents their own -- but the
 * *words* can be recognised. So every segment is read and matched against a
 * vocabulary, and a library sorts itself into genres without anybody knowing
 * what its folders are called.
 *
 * **This list is ours.** The obvious sources cannot be used: the largest list
 * on GitHub (voltraco/genres, 1,652 entries from Wikipedia) carries no licence
 * at all, and MusicBrainz's genre data is CC BY-NC-SA -- non-commercial, the
 * same restriction that keeps Chordonomicon out of this repository. Genre names
 * are facts, and a list written for this purpose ships under our own licence
 * with nothing owed to anybody.
 *
 * It is also deliberately *not* 1,652 entries. Most of those are micro-genres
 * that never appear on a drum library's shelf, and several are single common
 * words that would match a folder called `Kit` or `House` and file a rock pack
 * under something absurd. What is here is what drum libraries actually say.
 */

import VOCABULARY from '../data/genres.json'

/**
 * Spellings a drum library uses that the vocabulary does not carry.
 *
 * Kept here rather than added to the list, so the list stays exactly as it was
 * written and every addition is visible as an addition. Each one was found in a
 * real folder name: `06 Showtunes`, `EZXNASHVILLE`, a top-level `Bossa`, a
 * top-level `Afro-cuban`.
 *
 * A pair points a spelling at the name to show for it. Where the vocabulary has
 * a longer form of the same thing -- `show tune`, `nashville sound` -- that is
 * the name used, so a filter does not end up with two entries for one genre.
 */
const ALSO_SPELLED = [
  ['showtunes', 'show tune'],
  ['showtune', 'show tune'],
  ['musical', 'show tune'],
  ['broadway', 'show tune'],
  ['nashville', 'nashville sound'],
  ['bossa', 'bossa nova'],
  ['afro-cuban', 'afro-cuban'],
  ['afro cuban', 'afro-cuban'],
  ['afrocuban', 'afro-cuban'],
  ['prog', 'progressive rock'],
  ['rnb', 'r&b'],
  ['r and b', 'r&b'],
  ['dnb', 'drum and bass'],
  ['hiphop', 'hip hop'],
  ['rock n roll', 'rock and roll'],
  ["rock 'n' roll", 'rock and roll'],
  ['cha-cha', 'cha-cha-chá'],
  ['cha cha', 'cha-cha-chá'],
  ['middle east', 'middle eastern music'],
  ['middle eastern', 'middle eastern music'],
]

/**
 * A vendor's own initials, run into the genre with no space.
 *
 * `EZXMETAL!`, `EZXNASHVILLE`, `SDXROCK`. Stripped before matching, which is
 * more precise than looking for short genres inside words -- lowering that
 * threshold far enough to find `metal` inside `EZXMETAL` would also find
 * `house` inside `housework`.
 *
 * Three letters at least. A two-letter one took the front off `Adult
 * Contemporary` and turned it into nothing at all.
 */
const VENDOR_PREFIX = /^(ezx|sdx|mpx|bfd)(?=[a-z])/

/**
 * Words that look like genres and are not.
 *
 * Drum libraries are full of them: `Chrome Kit`, `Dry Studio Kit`, `Z Files`,
 * `MONSTER_MIDI_PACK_1`, `Groove 170BPM`. Left to itself a matcher files half a
 * library under whatever a vendor named their snare samples, which is worse
 * than filing it under nothing.
 */
const NOT_A_GENRE = new Set([
  'kit', 'kits', 'midi', 'file', 'files', 'pack', 'packs', 'loop', 'loops',
  'groove', 'grooves', 'beat', 'beats', 'fill', 'fills', 'drum', 'drums',
  'drummer', 'percussion', 'perc', 'bpm', 'vol', 'volume', 'part', 'parts',
  'set', 'sets', 'library', 'lib', 'sample', 'samples', 'session', 'sessions',
  'intro', 'outro', 'verse', 'chorus', 'bridge', 'ending', 'endings', 'theme',
  'straight', 'triplet', 'even', 'odd', 'basic', 'simple', 'complex',
  'dry', 'wet', 'room', 'hall', 'studio', 'live', 'acoustic', 'vintage',
  'modern', 'classic', 'new', 'old', 'misc', 'other', 'various', 'assorted',
  // In the vocabulary as genres, and useless as ones here: a drum library is
  // full of folders called `MIDI Music` and `Traditional Kit`, and a filter
  // offering `Music` tells nobody anything.
  'music', 'traditional', 'instrumental',
  'full', 'half', 'long', 'short', 'slow', 'fast', 'medium',
])

/**
 * Words run together, pulled apart.
 *
 * A vendor who cannot put a space in a folder name capitalises instead, and
 * `11_8_IndieQuirk` is an eleven-eight indie groove with the word indie welded
 * to the word quirk. Lowercasing first destroys the only evidence of where one
 * word ends, so this happens before that.
 *
 * Two rules, which between them are what camel case is: a small letter or digit
 * followed by a capital is a break, and a run of capitals followed by a capital
 * and a small letter is a break before the last capital -- so `GMBlues` is GM
 * Blues rather than GMB lues, and `GM` alone is left as it is.
 */
export function unglue(text) {
  return String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // And a letter running into a digit, which is the third way a vendor joins
    // two words: `FullKitHiHat8ths` is a hi-hat groove in eighths, and without
    // this the hat is welded to the eighths and reads as neither.
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
}

/** Everything a vendor puts between words, made into spaces. */
function words(segment) {
  return unglue(segment)
    .toLowerCase()
    // A leading number or catalogue id: "02 Heavy Metal", "000210@JAZZ",
    // "GM - Blues", "150-S033@THEME".
    .replace(/^[\s\d]*[@#:-]*\s*/, '')
    .replace(/[_@#!()[\]{}.,:;/\\+*"']+/g, ' ')
    .replace(/\b\d+\s*bpm\b/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A name as it should be shown. The vocabulary is lowercase throughout.
 *
 * Hyphens are word breaks -- `afro-cuban` is Afro-Cuban -- and the small joining
 * words stay small unless they start the name, so it is `Drum and Bass` rather
 * than `Drum And Bass`.
 */
const SMALL = new Set(['and', 'or', 'of', 'the', 'in', 'on', 'a', 'n'])

function titled(name) {
  const caps = (word, first) => {
    if (word === 'r&b') return 'R&B'
    if (!first && SMALL.has(word)) return word
    return word.charAt(0).toUpperCase() + word.slice(1)
  }

  let at = 0
  return String(name).replace(/[^\s-]+/g, (word) => caps(word, at++ === 0))
}

/**
 * Two characters is not a genre anybody can find by accident on purpose.
 *
 * The vocabulary has a handful -- `lu`, and others of that shape -- and a
 * two-letter word turns up inside folder names constantly. Three is short
 * enough to keep `dub`, `ska`, `rap`, `emo` and `idm`, which are real and which
 * whole-word matching protects.
 */
const TOO_SHORT = 3

/** Built once: every spelling, pointing at the name to show for it. */
const SPELLINGS = (() => {
  const known = new Set(VOCABULARY)
  const out = []
  const seen = new Set()

  const add = (form, name) => {
    const spelling = String(form).toLowerCase().trim()
    if (spelling.length < TOO_SHORT || seen.has(spelling)) return
    if (NOT_A_GENRE.has(spelling)) return
    seen.add(spelling)
    out.push({ form: spelling, name: titled(name), length: spelling.length })
  }

  for (const name of VOCABULARY) add(name, name)
  // A spelling pointed at a name the vocabulary already has is an alias; one
  // pointed at a name it does not is a genre this library needed and the list
  // did not carry.
  for (const [form, name] of ALSO_SPELLED) {
    add(form, name)
    if (!known.has(name)) add(name, name)
  }

  // Longest first, so `punk rock` is tried before `punk` and before `rock`.
  return out.sort((a, b) => b.length - a.length)
})()

/**
 * The genre a path is about, or ''.
 *
 * Read from the *deepest* segment first, because that is where a vendor puts
 * the specific thing -- `80´s Drummer/Chrome Kit/02 Heavy Metal` is heavy
 * metal, and the pack it sits in is just the pack. The first segment that says
 * something wins; a segment that says nothing is passed over rather than
 * guessed at.
 */
export function genreOf(path) {
  const segments = String(path || '').split(/[/\\]+/).filter(Boolean)

  for (let i = segments.length - 1; i >= 0; i--) {
    const text = words(segments[i])
    if (!text) continue
    // A segment that is only a word from the not-a-genre list says nothing at
    // all, and must not be searched for substrings: `Dry Studio Kit` must not
    // become a genre because of some accident inside it.
    if (NOT_A_GENRE.has(text)) continue

    const found = matchIn(text)
    if (found) return found
  }

  return ''
}

/** Every genre a whole path mentions, deepest first, without repeats. */
export function genresIn(path) {
  const segments = String(path || '').split(/[/\\]+/).filter(Boolean)
  const found = []
  for (let i = segments.length - 1; i >= 0; i--) {
    const name = matchIn(words(segments[i]))
    if (name && !found.includes(name)) found.push(name)
  }
  return found
}

/** Long enough that finding it inside another word is not an accident.
    `nashville` in `EZXNASHVILLE` is meant; `ska` in `skatepark` is not, and
    `house` in `housework` is exactly the length that makes the difference. */
const RUN_ON = 6

/**
 * The best genre in one piece of text.
 *
 * On word boundaries first, so `Ballad_Grooves` is a ballad and `Skatepark` is
 * not ska. Longest spelling wins -- `Punk Rock` beats `Punk` and `Rock` -- and
 * where two are the same length the one mentioned first does, so `Funk & Soul`
 * is funk.
 *
 * Failing that, a long spelling is looked for inside a word, because vendors
 * run their own name into the genre: `EZXNASHVILLE`, `EZXELECTRONIC`. Only long
 * ones, or every pack with `skate` in it becomes ska.
 */
function matchIn(text) {
  if (!text) return ''
  // `EZXMETAL` is metal with a vendor's initials welded on the front.
  const bare = text.replace(VENDOR_PREFIX, '')
  const padded = ` ${bare} `

  let best = null
  for (const { form, name, length } of SPELLINGS) {
    const at = padded.indexOf(` ${form} `)
    if (at < 0) continue
    // Sorted longest first, so the first length seen is the best available;
    // after that only an earlier position can improve on it.
    if (!best) best = { name, length, at }
    else if (length === best.length && at < best.at) best = { name, length, at }
    else if (length < best.length) break
  }
  if (best) return best.name

  for (const { form, name, length } of SPELLINGS) {
    if (length >= RUN_ON && padded.includes(form)) return name
  }
  return ''
}

/**
 * Whether two catalogues mean the same genre.
 *
 * Three vocabularies have to agree here and none of them was written with the
 * others in mind. The bundled corpus says `afrocuban`, `neworleans`, `hiphop`.
 * The imported catalogue says `Afro-Cuban`, `Hip Hop`, in title case from the
 * genre list. The progressions say `jazz`, `blues`, `modal`. Comparing them as
 * written matches almost nothing.
 *
 * So they are compared with the spaces, hyphens and case taken out, which is
 * enough for every pair that actually occurs.
 */
const plainly = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '')

export function sameGenre(a, b) {
  const left = plainly(a)
  const right = plainly(b)
  if (!left || !right) return false
  // One containing the other catches `jazz` against `jazzfusion` and `blues`
  // against `bluesrock`, which are the same answer for choosing a drum part.
  return left === right || left.includes(right) || right.includes(left)
}

/** The bars of a progression, without its leading and trailing pipes. */
function barsOfProgression(text) {
  return String(text || '')
    .split('|')
    .map((bar) => bar.trim())
    .filter(Boolean)
}

/**
 * A whole song from the things to hand.
 *
 * One progression supplies the harmony, because a song has one set of changes
 * and six unrelated ones is a medley. What differs between sections is how they
 * are *played*: each gets its own articulation, written into the chart against
 * its first chord, and its own groove and fill.
 *
 * Written into the chart rather than held somewhere else, so it can be read,
 * edited and understood afterwards -- and so the phrase markers mean the chart
 * asks for per-chord articulation whether or not the setting is on.
 * @see resolvePhraseSections
 */
/** Every genre this vocabulary knows, for a filter to offer. */
export function everyGenre() {
  return [...new Set(SPELLINGS.map((entry) => entry.name))].sort((a, b) => a.localeCompare(b))
}
