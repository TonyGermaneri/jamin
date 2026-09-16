// What a folder name says about the music in it.
//
// Every path below is real, taken from a scraped collection of 774,000 files
// across about two hundred vendors. None of them agree on a structure, which is
// the whole problem: the path cannot be predicted, but the words in it can be
// recognised.
let failed = 0
function check(label, got, want) {
  if (got !== want) { failed++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }
}

/* ---------------- real paths, real answers ------------------------------ */
const real = [
  ['80´s Drummer MIDI Files/Chrome Kit/02 Heavy Metal', 'Heavy Metal'],
  ['GM MIDI Pack [360,000 files]/GM - Blues/GM - Blues DFH', 'Blues'],
  ['Superior Drummer 2 Drum Midi/000210@JAZZ/31@3-4', 'Jazz'],
  ['Studio Drummer MIDI Files/11 Punk Rock/04 Groove 170BPM', 'Punk Rock'],
  ['Studio Drummer MIDI Files/01 Pop/29 Fill 110BPM', 'Pop'],
  ['Studio Drummer MIDI Files/05 Metal/21 Fill 110BPM', 'Metal'],
  ['50´s Drummer MIDI Files/07 Indie', 'Indie'],
  ['60´s Drummer MIDI Files/Early Kit/02 Blues Rock', 'Blues Rock'],
  ['Vintage Drummer MIDI Files/06 Showtunes/01 Moonlight 125BPM', 'Showtunes'],
  ['Superior Drummer 2 Drum Midi/000110@ROCK/Progressive', 'Prog Rock'],
  ['Superior Drummer 2 Drum Midi/000410@POP/0110@HEY DW', 'Pop'],
  ['Superior Drummer 2 Drum Midi/000110@Ballad_Grooves/Ballad Groove 012', 'Ballad'],
  ['Superior Drummer 2 Drum Midi/000045@EZX_LATIN_PERCUSSION/61@CRICKETS', 'Latin'],
  ['Superior Drummer 2 Drum Midi/000055@EZXNASHVILLE/508@3#4_AND_6#8', 'Nashville'],
  ['GM MIDI Pack [360,000 files]/GM - Metal 2/GM - Metal 2 GM', 'Metal'],
  ['Afro-cuban/01 Guaguanco', 'Afro-Cuban'],
  ['Bossa/03 Bossa 120', 'Bossa Nova'],
  ['Reggae/dub one', 'Dub'],
  ['March:Tango/tango 2', 'Tango'],
  ['Hi-Hat & Noise Loops/Electronic Dance/04', 'Electronic'],
]

for (const [path, want] of real) {
  check(path.split('/').slice(-2).join('/'), genreOf(path), want)
}

/* ---------------- the longest true match wins --------------------------- */
// `Punk Rock` is punk rock and not rock; `Blues Rock` is not blues; `Drum and
// Bass` is not bass and is certainly not drums.
check('punk rock over rock', genreOf('x/Punk Rock'), 'Punk Rock')
check('blues rock over blues', genreOf('x/Blues Rock'), 'Blues Rock')
check('drum and bass is one thing', genreOf('x/Drum and Bass'), 'Drum and Bass')
check('deep house over house', genreOf('x/Deep House'), 'Deep House')
check('hard bop over bop', genreOf('x/Hard Bop'), 'Hard Bop')

/* ---------------- the deepest segment decides --------------------------- */
// A vendor puts the specific thing at the bottom and the pack's name at the
// top, so a Heavy Metal folder inside a Rock pack is heavy metal.
check('the leaf wins over the pack', genreOf('Rock Pack/02 Heavy Metal'), 'Heavy Metal')
check('and an empty leaf falls back up', genreOf('Jazz Pack/000123@/01'), 'Jazz')

/* ---------------- what is not a genre ----------------------------------- */
/*
 * Drum libraries are full of words that look like genres and are not. Left to
 * itself a matcher files half a library under whatever a vendor called their
 * snare samples, which is worse than filing it under nothing: a wrong genre is
 * a filter that lies, and an empty one is only a filter that is quiet.
 */
check('a kit is not a genre', genreOf('80s Drummer/Chrome Kit'), '')
check('nor is a dry studio kit', genreOf('Pack/Dry Studio Kit'), '')
check('nor a file drawer', genreOf('L.A.Riot.Drum.Loops/Z Files'), '')
check('nor a catalogue number', genreOf('Superior/000093@MONSTER_MIDI_PACK_1'), '')
check('nor a drummer', genreOf('Superior/000752@CARTER_BEAUFORD'), '')
check('nor a tempo', genreOf('Pack/04 Groove 170BPM'), '')
check('nor a time signature', genreOf('Pack/109@STRAIGHT_6#8'), '')
check('nor a song part', genreOf('Pack/110-S037@BRIDGE'), '')
check('nor nothing at all', genreOf(''), '')

/* ---------------- whole words only -------------------------------------- */
// On word boundaries, or a skate pack becomes ska and a housing estate becomes
// house.
check('skatepark is not ska', genreOf('x/Skatepark Sessions'), '')
check('housework is not house', genreOf('x/Housework'), '')
check('poppy is not pop', genreOf('x/Poppy Fields'), '')
// But a word next to punctuation still counts, because vendors use every
// separator there is.
check('underscores are separators', genreOf('x/HEAVY_METAL_01'), 'Heavy Metal')
check('and so are at signs', genreOf('x/000210@JAZZ'), 'Jazz')
// Two of the same length: the one mentioned first wins.
check('and ampersands', genreOf('x/Funk & Soul'), 'Funk')
check('the other way round too', genreOf('x/Soul & Funk'), 'Soul')

// A vendor's own name run into the genre, which is how half of one large pack
// is labelled. Only long names, or every pack with `skate` in it becomes ska.
check('a name run into the genre', genreOf('x/000055@EZXNASHVILLE'), 'Nashville')
check('and another', genreOf('x/000047@EZXELECTRONIC'), 'Electronic')

/* ---------------- everything a path mentions ---------------------------- */
const both = genresIn('Jazz Pack/02 Bebop/01')
check('the leaf first', both[0], 'Bebop')
check('then what it sits in', both[1], 'Jazz')

/* ---------------- the vocabulary itself --------------------------------- */
const all = everyGenre()
check('it is sorted', all[0] < all[all.length - 1], true)
check('with no repeats', all.length, new Set(all).size)
// Every name in the list has to be findable by its own name, or the filter
// would offer a genre that matches nothing.
let unreachable = 0
for (const name of all) if (genreOf(`pack/${name}`) !== name) unreachable++
check('and every genre in it can be found by its own name', unreachable, 0)

console.log(failed ? `genres: ${failed} FAILED` : 'genres: all checks passed')
