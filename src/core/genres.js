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

/**
 * Longest first, because the longest true match wins: `Punk Rock` is punk rock
 * and not rock, `Blues Rock` is not blues, `Drum and Bass` is not bass.
 *
 * Each entry is the name as it should be shown, plus any spellings a folder
 * might use for it.
 */
const VOCABULARY = [
  // --- rock and its relatives
  ['Heavy Metal', ['heavy metal']],
  ['Death Metal', ['death metal']],
  ['Black Metal', ['black metal']],
  ['Thrash Metal', ['thrash metal', 'thrash']],
  ['Doom Metal', ['doom metal', 'doom']],
  ['Nu Metal', ['nu metal', 'nu-metal']],
  ['Metalcore', ['metalcore']],
  ['Hardcore', ['hardcore', 'hard core']],
  ['Punk Rock', ['punk rock']],
  ['Pop Punk', ['pop punk']],
  ['Post Punk', ['post punk', 'post-punk']],
  ['Punk', ['punk']],
  ['Blues Rock', ['blues rock']],
  ['Classic Rock', ['classic rock']],
  ['Hard Rock', ['hard rock']],
  ['Soft Rock', ['soft rock']],
  ['Prog Rock', ['prog rock', 'progressive rock', 'progressive', 'prog']],
  ['Psychedelic', ['psychedelic', 'psych rock', 'psychedelia']],
  ['Garage Rock', ['garage rock']],
  ['Surf Rock', ['surf rock', 'surf']],
  ['Indie Rock', ['indie rock']],
  ['Alternative', ['alternative', 'alt rock', 'alternative rock']],
  ['Grunge', ['grunge']],
  ['Emo', ['emo']],
  ['Math Rock', ['math rock']],
  ['Post Rock', ['post rock', 'post-rock']],
  ['Stoner Rock', ['stoner rock', 'stoner']],
  ['Southern Rock', ['southern rock']],
  ['Rockabilly', ['rockabilly']],
  ['Rock and Roll', ['rock and roll', "rock 'n' roll", 'rock n roll', 'rocknroll']],
  ['Metal', ['metal']],
  ['Indie', ['indie']],
  ['Rock', ['rock']],

  // --- jazz and its relatives
  ['Bebop', ['bebop', 'be bop']],
  ['Hard Bop', ['hard bop']],
  ['Cool Jazz', ['cool jazz']],
  ['Free Jazz', ['free jazz']],
  ['Jazz Fusion', ['jazz fusion', 'fusion']],
  ['Smooth Jazz', ['smooth jazz']],
  ['Gypsy Jazz', ['gypsy jazz']],
  ['Big Band', ['big band', 'bigband']],
  ['Swing', ['swing']],
  ['Dixieland', ['dixieland', 'dixie', 'trad jazz']],
  ['Ragtime', ['ragtime', 'rag time']],
  ['Jazz', ['jazz']],

  // --- blues, country, folk
  ['Delta Blues', ['delta blues']],
  ['Chicago Blues', ['chicago blues']],
  ['Shuffle', ['shuffle']],
  ['Boogie Woogie', ['boogie woogie', 'boogie-woogie', 'boogie']],
  ['Blues', ['blues']],
  ['Bluegrass', ['bluegrass', 'blue grass']],
  ['Country Rock', ['country rock']],
  ['Honky Tonk', ['honky tonk', 'honky-tonk']],
  ['Americana', ['americana']],
  ['Nashville', ['nashville']],
  ['Country', ['country']],
  ['Folk', ['folk']],
  ['Celtic', ['celtic', 'irish']],
  ['Gospel', ['gospel']],
  ['Spiritual', ['spiritual']],

  // --- soul, funk, r&b, hip hop
  ['Neo Soul', ['neo soul', 'neo-soul']],
  ['Motown', ['motown']],
  ['Soul', ['soul']],
  ['Funk', ['funk', 'funky']],
  ['Disco', ['disco']],
  ['Rhythm and Blues', ['rhythm and blues', 'r&b', 'rnb', 'r and b']],
  ['Boom Bap', ['boom bap']],
  ['Trap', ['trap']],
  ['Hip Hop', ['hip hop', 'hip-hop', 'hiphop', 'rap']],
  ['Breakbeat', ['breakbeat', 'break beat', 'breaks']],

  // --- electronic
  ['Drum and Bass', ['drum and bass', 'drum & bass', 'drum n bass', 'dnb', 'd&b']],
  ['Jungle', ['jungle']],
  ['Deep House', ['deep house']],
  ['Tech House', ['tech house']],
  ['Progressive House', ['progressive house']],
  ['House', ['house']],
  ['Techno', ['techno']],
  ['Trance', ['trance']],
  ['Dubstep', ['dubstep']],
  ['Garage', ['uk garage', '2 step', 'two step']],
  ['Ambient', ['ambient']],
  ['Downtempo', ['downtempo', 'down tempo', 'trip hop', 'trip-hop']],
  ['Industrial', ['industrial']],
  ['Synthwave', ['synthwave', 'synth wave', 'retrowave']],
  ['Electro', ['electro']],
  ['Electronic', ['electronic', 'electronica', 'edm']],
  ['Dance', ['dance']],

  // --- latin, caribbean, world
  ['Bossa Nova', ['bossa nova', 'bossa']],
  ['Samba', ['samba']],
  ['Salsa', ['salsa']],
  ['Mambo', ['mambo']],
  ['Cha Cha', ['cha cha', 'cha-cha', 'chacha']],
  ['Rumba', ['rumba', 'rhumba']],
  ['Merengue', ['merengue']],
  ['Cumbia', ['cumbia']],
  ['Tango', ['tango']],
  ['Bolero', ['bolero']],
  ['Afro-Cuban', ['afro cuban', 'afro-cuban', 'afrocuban']],
  ['Afrobeat', ['afrobeat', 'afro beat']],
  ['Latin', ['latin']],
  ['Reggaeton', ['reggaeton']],
  ['Dancehall', ['dancehall', 'dance hall']],
  ['Ska', ['ska']],
  ['Rocksteady', ['rocksteady', 'rock steady']],
  ['Dub', ['dub']],
  ['Reggae', ['reggae']],
  ['Calypso', ['calypso']],
  ['Soca', ['soca']],
  ['Highlife', ['highlife', 'high life']],
  ['Bhangra', ['bhangra']],
  ['Klezmer', ['klezmer']],
  ['Flamenco', ['flamenco']],
  ['Polka', ['polka']],
  ['Waltz', ['waltz', 'valse']],
  ['March', ['march', 'marching']],
  ['Paso Doble', ['paso doble', 'pasodoble', 'paso']],
  ['Charleston', ['charleston']],
  ['Twist', ['twist']],
  ['World', ['world', 'ethnic', 'tribal']],
  ['African', ['africa', 'african']],
  ['Asian', ['asia', 'asian', 'oriental']],
  ['Middle Eastern', ['middle east', 'middle eastern', 'arabic']],
  ['Brazilian', ['brazil', 'brazilian']],
  ['Caribbean', ['caribbean']],

  // --- pop and the rest
  ['Synth Pop', ['synth pop', 'synthpop']],
  ['Power Pop', ['power pop']],
  ['Britpop', ['britpop', 'brit pop']],
  ['K-Pop', ['k-pop', 'kpop']],
  ['J-Pop', ['j-pop', 'jpop']],
  ['Pop', ['pop']],
  ['Ballad', ['ballad', 'ballads']],
  ['Showtunes', ['showtune', 'showtunes', 'musical', 'broadway']],
  ['Classical', ['classical', 'orchestral', 'baroque']],
  ['Cinematic', ['cinematic', 'soundtrack', 'score', 'trailer']],
  ['Lounge', ['lounge', 'easy listening']],
  ['New Age', ['new age']],
  ['Christmas', ['christmas', 'holiday', 'xmas']],
  ['Military', ['military', 'drumline', 'drum corps']],
]

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
  'full', 'half', 'long', 'short', 'slow', 'fast', 'medium',
])

/** Everything a vendor puts between words, made into spaces. */
function words(segment) {
  return String(segment || '')
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

/** Built once: every spelling, pointing at the name to show for it. */
const SPELLINGS = (() => {
  const out = []
  const seen = new Set()
  for (const [name, forms] of VOCABULARY) {
    // The name itself is always a spelling of itself, or the filter could offer
    // a genre that nothing matches -- `Garage` was exactly that, spelled only
    // as `uk garage` and `2 step`.
    for (const form of [name.toLowerCase(), ...forms]) {
      const key = `${form}|${name}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ form, name, length: form.length })
    }
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
    // all, and must not be searched for substrings: `Chrome Kit` contains no
    // genre and `Dry Studio Kit` must not become a genre because of `ska` or
    // some other accident.
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
  const padded = ` ${text} `

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

/** Every genre this vocabulary knows, for a filter to offer. */
export function everyGenre() {
  return VOCABULARY.map(([name]) => name).sort((a, b) => a.localeCompare(b))
}
