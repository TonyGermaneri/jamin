// The mapping, worked outwards from both published tables.
//
// Two facts stand either side of jamin: what the drummer hit, which Magenta
// publish for the Groove MIDI Dataset, and what a General MIDI kit plays on
// each note, which the MMA published in 1991. Everything in between is ours,
// and this is the check that it joins them up.
//
// It exists because the numbers do not proofread. `snareRim -> 40` looks
// perfectly reasonable and sends a rimshot to *Electric Snare*, which on an
// acoustic kit is either missing or something else entirely -- 3,614 hits, many
// of them the backbeat. Names catch that; numbers never will.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* What the drummer hit. https://magenta.tensorflow.org/datasets/groove */
const TD11 = {
  36: 'Kick',            38: 'Snare (Head)',     40: 'Snare (Rim)',   37: 'Snare X-Stick',
  48: 'Tom 1',           50: 'Tom 1 (Rim)',      45: 'Tom 2',         47: 'Tom 2 (Rim)',
  43: 'Tom 3 (Head)',    58: 'Tom 3 (Rim)',      46: 'HH Open (Bow)', 26: 'HH Open (Edge)',
  42: 'HH Closed (Bow)', 22: 'HH Closed (Edge)', 44: 'HH Pedal',
  49: 'Crash 1 (Bow)',   55: 'Crash 1 (Edge)',   57: 'Crash 2 (Bow)', 52: 'Crash 2 (Edge)',
  51: 'Ride (Bow)',      59: 'Ride (Edge)',      53: 'Ride (Bell)',
}

/* What a General MIDI kit plays. The 1991 percussion key map, 35 to 81. */
const GM = {
  35: 'Acoustic Bass Drum', 36: 'Bass Drum 1', 37: 'Side Stick', 38: 'Acoustic Snare',
  39: 'Hand Clap', 40: 'Electric Snare', 41: 'Low Floor Tom', 42: 'Closed Hi Hat',
  43: 'High Floor Tom', 44: 'Pedal Hi-Hat', 45: 'Low Tom', 46: 'Open Hi-Hat',
  47: 'Low-Mid Tom', 48: 'Hi Mid Tom', 49: 'Crash Cymbal 1', 50: 'High Tom',
  51: 'Ride Cymbal 1', 52: 'Chinese Cymbal', 53: 'Ride Bell', 54: 'Tambourine',
  55: 'Splash Cymbal', 56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap',
  59: 'Ride Cymbal 2', 60: 'Hi Bongo', 61: 'Low Bongo', 62: 'Mute Hi Conga',
  63: 'Open Hi Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale',
  67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas',
  71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro',
  75: 'Claves', 76: 'Hi Wood Block', 77: 'Low Wood Block', 78: 'Mute Cuica',
  79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle',
}

/* What each drum ought to become, judged only by the two names. Several are a
   choice rather than an answer -- GM has six toms and the kit has three, two
   crashes and the kit has two cymbals with a bow and an edge -- so any of the
   sensible destinations passes and only a wrong *instrument* fails. */
const SHOULD_BE = {
  'Kick': ['Bass Drum 1', 'Acoustic Bass Drum'],
  'Snare (Head)': ['Acoustic Snare'],
  'Snare (Rim)': ['Acoustic Snare'],                        // GM has no rimshot
  'Snare X-Stick': ['Side Stick'],
  'Tom 1': ['High Tom', 'Hi Mid Tom'],
  'Tom 1 (Rim)': ['High Tom', 'Hi Mid Tom'],
  'Tom 2': ['Low-Mid Tom', 'Low Tom'],
  'Tom 2 (Rim)': ['Low-Mid Tom', 'Low Tom'],
  'Tom 3 (Head)': ['High Floor Tom', 'Low Floor Tom'],
  'Tom 3 (Rim)': ['High Floor Tom', 'Low Floor Tom'],
  'HH Open (Bow)': ['Open Hi-Hat'],
  'HH Open (Edge)': ['Open Hi-Hat'],
  'HH Closed (Bow)': ['Closed Hi Hat'],
  'HH Closed (Edge)': ['Closed Hi Hat'],
  'HH Pedal': ['Pedal Hi-Hat'],
  'Crash 1 (Bow)': ['Crash Cymbal 1', 'Crash Cymbal 2'],
  'Crash 1 (Edge)': ['Crash Cymbal 1', 'Crash Cymbal 2'],
  'Crash 2 (Bow)': ['Crash Cymbal 1', 'Crash Cymbal 2'],
  'Crash 2 (Edge)': ['Crash Cymbal 1', 'Crash Cymbal 2'],
  'Ride (Bow)': ['Ride Cymbal 1', 'Ride Cymbal 2'],
  'Ride (Edge)': ['Ride Cymbal 1', 'Ride Cymbal 2'],
  'Ride (Bell)': ['Ride Bell'],
}

/* ---------------- our copy of the GM map is the published one ------------ */
for (const [note, name] of Object.entries(GM)) {
  if (GM_PERCUSSION[note] !== name) {
    failed++
    console.log(`FAIL GM name ${note}: ours "${GM_PERCUSSION[note]}", published "${name}"`)
  }
}
check('and it covers the whole percussion range', Object.keys(GM_PERCUSSION).length, 47)

/* ---------------- every corpus sound reaches the instrument it is -------- */
for (const [pitch, hit] of Object.entries(TD11)) {
  const voice = TD11_TO_VOICE[pitch]
  if (!voice) {
    failed++
    console.log(`FAIL corpus pitch ${pitch} (${hit}) reaches no voice at all`)
    continue
  }

  const note = GENERAL_MIDI[voice]
  const plays = GM[note]
  if (!SHOULD_BE[hit].includes(plays)) {
    failed++
    console.log(`FAIL ${hit} (${pitch}) -> ${voice} -> ${note} which GM plays as "${plays}"`)
    console.log(`     it should reach one of: ${SHOULD_BE[hit].join(', ')}`)
  }
}

/* ---------------- and nothing is dropped on the floor -------------------- */
/*
 * A corpus pitch with no voice is a drum silently thrown away, and a voice
 * nothing can reach is a row in the Kit tab that never sounds.
 *
 * "Reachable" used to mean reachable from the *corpus's* kit, which was right
 * while the vocabulary was exactly the kit the corpus was played on. It is not
 * any more: the vocabulary carries General MIDI's percussion so that imported
 * libraries can be heard, and the Groove MIDI Dataset was played on a Roland
 * TD-11, which has no congas and no cuica. Requiring the corpus to reach them
 * would be requiring the TD-11 to have hardware it does not have.
 *
 * So the invariant is that every voice is reachable from *some* kit -- there
 * is a way to play each of them -- and separately that every pitch the corpus
 * uses reaches one.
 */
const reached = new Set()
for (const kit of DRUM_KITS) {
  for (const voice of Object.values(kit.in || {})) reached.add(voice)
}
for (const voice of Object.keys(GENERAL_MIDI)) {
  if (!reached.has(voice)) {
    failed++
    console.log(`FAIL the voice "${voice}" is in the kit maps but no kit can reach it`)
  }
}
for (const pitch of Object.keys(TD11)) {
  if (!TD11_TO_VOICE[pitch]) {
    failed++
    console.log(`FAIL corpus pitch ${pitch} has no voice`)
  }
}
check('the corpus uses twenty-two sounds', Object.keys(TD11).length, 22)
check('and every one of them is mapped', Object.keys(TD11).filter((p) => TD11_TO_VOICE[p]).length, 22)

/* ---------------- the kit the corpus was played on changes nothing ------- */
const vdrums = DRUM_KITS.find((kit) => kit.id === 'vdrums').map
for (const [pitch, hit] of Object.entries(TD11)) {
  // Only the pitches that are their voice's canonical note round-trip exactly;
  // an edge or a rim folds onto the drum it belongs to, which is correct.
  const out = vdrums[TD11_TO_VOICE[pitch]]
  if (!Object.keys(TD11).includes(String(out))) {
    failed++
    console.log(`FAIL V-Drums sends ${hit} (${pitch}) to ${out}, which the TD-11 does not use`)
  }
}

console.log(failed ? `drum-map: ${failed} FAILED` : 'drum-map: all checks passed')

/* ---------------- reading a V-Drums shelf ------------------------------- *
 *
 * The TD-11's table is a map of its twenty pads, and used alone as a *reading*
 * map that is what it does: everything not on a pad reads as nothing. Shelves
 * get classified as V-Drums on the strength of their hat edges at 22 and 26,
 * which no General MIDI kit defines -- and a Latin percussion shelf that does
 * that then lost its congas, its shakers and its kick, arriving as a two-bar
 * funk groove of thirty-two hits with no notes in it at all.
 *
 * So the kit reads General MIDI underneath and its own pads on top. Roland
 * wins where the two disagree, because the shelf was judged to be Roland.
 */
const vdrumsIn = DRUM_KITS.find((kit) => kit.id === 'vdrums').in
check('a V-Drums shelf still reads its own floor tom rim', vdrumsIn[58], 'tomFloor')
check('and its own tom rims', [vdrumsIn[50], vdrumsIn[47]], ['tomHigh', 'tomMid'])
check('but a conga on it is a conga, not silence', vdrumsIn[63], 'congaHigh')
check('and a bass drum at 35 is a kick', vdrumsIn[35], 'kick')
check('and a clap is a clap', vdrumsIn[39], 'clap')

/* Every kit must be able to read at least what General MIDI defines: a kit
   that reads less than the standard turns a correct classification into
   silence, which is the fault above. */
for (const kit of DRUM_KITS) {
  for (const pitch of Object.keys(GENERAL_MIDI_IN)) {
    if (!kit.in[pitch]) {
      failed++
      console.log(`FAIL ${kit.id} cannot read note ${pitch}, which General MIDI defines`)
    }
  }
}

/* ---------------- a library's own reading of its notes ------------------ *
 *
 * The kit says which numbering a library is written in, and for a library
 * that is written in somebody's numbering that is the whole question. A
 * sampled library is written in its own: Superior Drummer's Latin percussion
 * has congas at 94 to 97 and a cajon at 10 to 14, which no standard defines
 * and no published table lists. jamin asks rather than guessing, and this is
 * where the answer is kept.
 */
check('a correction is kept', cleanInMap({ 94: 'congaHigh' }), { 94: 'congaHigh' })
check('a note outside MIDI is not', cleanInMap({ 128: 'kick', '-1': 'kick' }), {})
check('nor a voice that does not exist', cleanInMap({ 94: 'triangleFlat' }), {})
check('and the note comes back as a number', Object.keys(cleanInMap({ '94': 'kick' })), ['94'])

/* ---------------- what a library's folder names say --------------------- *
 *
 * Evidence, not inference: a folder that is almost entirely one note and is
 * named after an instrument has been labelled by the people who made it. A
 * folder named after a groove has not, and must not be read as though it had
 * -- which is the whole reason the share matters.
 */
const shelves = new Map([
  // Named after the instrument, and almost all one note: this is a label.
  ['48@TIMBALES/05@SALSA', { 17: 90, 38: 10 }],
  // Named after the instrument, but the note is a tenth of what is played:
  // the folder is about the groove that happens to include it.
  ['19@_BONGOS/20@MARVIN_FUNK', { 29: 10, 36: 50, 38: 40 }],
  // Named after nothing in particular. Evidence of where, not of what.
  ['02@MARVIN_FUNK_SWING/13@GROOVE_13', { 94: 80, 36: 20 }],
])
const learnt = learnInbound(shelves, GENERAL_MIDI_IN)

check('a folder named after an instrument names its note',
      learnt.hints[17].voice, 'timbaleHigh')
check('and says how much of the evidence agreed', learnt.hints[17].share, 100)
check('but not when the note is a tenth of what it plays',
      learnt.hints[29], undefined)
check('and a folder named after a groove names nothing',
      learnt.hints[94], undefined)
check('a note the kit already reads is not asked about',
      learnt.hints[36], undefined)

// The half that is never a guess: where each unreadable note is played, which
// is what somebody who knows the library needs in order to recognise it.
check('where the note lives is recorded either way',
      learnt.where[94].map((one) => one.shelf),
      ['02@MARVIN_FUNK_SWING/13@GROOVE_13'])
check('with how much of that folder it is',
      learnt.where[94][0].share, 80)
check('and a note the kit reads is not listed at all',
      learnt.where[36], undefined)

/* A note the library cannot agree with itself about makes no suggestion.
   Note 24 on the real Superior Drummer download lives in folders called
   `HATS_OPEN_VARIATIONS` and in folders called `Snare Roughs`; the majority
   of forty-five thousand hits is not the truth, it is the majority. */
const argued = learnInbound(new Map([
  ['150-S0803@HATS_OPEN', { 24: 95, 38: 5 }],
  ['Snare Roughs/Ruffs on the beat', { 24: 90, 38: 10 }],
]), GENERAL_MIDI_IN)
check('a contested note is not suggested', argued.hints[24], undefined)
check('but where it lives is still reported', argued.where[24].length, 2)
