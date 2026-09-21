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

/* ---------------- what the kit dropdown actually offers ------------------
 *
 * Six names, and four of them send exactly General MIDI. That is the right
 * answer for all four -- General MIDI is the only layout an instrument can
 * be assumed to take, and jamin has no way to read what is loaded on the
 * other end of a MIDI cable -- but it is indistinguishable from the
 * dropdown being ignored unless something says so. Reported as
 * "General MIDI (GM)" was not a thing the panel could have said, because
 * it did not know.
 *
 * The check is not that AD2 *should* be General MIDI. It is that
 * `sameAsGeneralMidi` tells the truth about whichever kits are, so the day
 * one of them gets a real vendor layout the panel stops claiming it.
 */
const ids = DRUM_VOICES.map((one) => one.id)

/*
 * Against kits made here, not against a second copy of the function.
 *
 * The first version of this asked whether `sameAsGeneralMidi(kit)` agreed
 * with a reimplementation of `sameAsGeneralMidi` over the same kit, which
 * is two expressions of one idea and passes whatever either of them says.
 * Moving AD2's kick to note 24 did not fail it. These have known answers.
 */
check('a map that is General MIDI says so',
      sameAsGeneralMidi({ map: { ...GENERAL_MIDI } }), true)
check('one voice moved and it does not',
      sameAsGeneralMidi({ map: { ...GENERAL_MIDI, kick: 24 } }), false)
check('nor does one with a voice missing',
      sameAsGeneralMidi({ map: (() => {
        const map = { ...GENERAL_MIDI }
        delete map.ride
        return map
      })() }), false)
check('and nothing at all is not General MIDI', sameAsGeneralMidi(null), false)

// Which of the shipped kits are is a fact worth having written down, so
// that changing one is a deliberate act with a failing check attached.
check('three of the six shipped kits send plain General MIDI',
      DRUM_KITS.filter(sameAsGeneralMidi).map((one) => one.id),
      ['gm', 'ableton', 'abbeyroad'])

/* ---------------- what a kit has to reach, and what it may not ---------
 *
 * Every kit piece, on every kit. A voice with no number is a drum that
 * silently never sounds, which is the one failure nobody can see -- and
 * the kick, the snare and the hats are on every drum kit there is.
 *
 * Percussion is a different question and the answer is per instrument. A
 * TD-11 has no congas and leaves the General MIDI percussion numbers
 * empty, so sending a conga to 63 might land on something downstream and
 * certainly harms nothing. Addictive Drums 2 has no congas either and
 * *uses* 63 for a ride choke, so the same reasoning gives the opposite
 * answer: nowhere to send it, so it is not sent.
 */
const pieces = DRUM_VOICES.filter((one) => !one.percussion).map((one) => one.id)
const percussion = DRUM_VOICES.filter((one) => one.percussion).map((one) => one.id)
check('the vocabulary is fourteen kit pieces and the rest percussion',
      [pieces.length, percussion.length], [14, 26])

for (const kit of DRUM_KITS) {
  const missing = pieces.filter((id) => !Number.isInteger(kit.map[id]))
  check(`${kit.id} sends every kit piece somewhere`, missing, [])
  const out = ids.filter((id) => Number.isInteger(kit.map[id])
    && (kit.map[id] < 0 || kit.map[id] > 127))
  check(`${kit.id} sends them all inside the MIDI range`, out, [])
}

/*
 * Two voices on one note is a fold, and a fold is allowed where the
 * instrument really has one thing.
 *
 * General MIDI has no rimshot, so the rimshot goes where the snare goes;
 * the TR-8S has no rim, pedal hat or bell and folds four. Both are stated
 * in the kits themselves. What is worth checking is that AD2, which has a
 * separate sample for every one of these, does not fold any of them --
 * that is the whole reason for reading its keymap rather than sending it
 * General MIDI.
 */
const ad2 = DRUM_KITS.find((one) => one.id === 'addictive2')
const folds = (kit) => {
  const notes = pieces.map((id) => kit.map[id])
  return notes.length - new Set(notes).size
}
check('General MIDI folds the rimshot onto the snare', folds(kitById('gm')), 1)
check('and the TR-8S folds four', folds(kitById('tr8s')), 4)
check('Addictive Drums 2 folds nothing', folds(ad2), 0)

/* AD2 is the one that omits, and it omits exactly the percussion. Read off
   the keymap XLN ship with the product, so the numbers are a citation
   rather than a recollection. @see core/drumKits.js */
check('Addictive Drums 2 reaches every kit piece',
      pieces.filter((id) => !Number.isInteger(ad2.map[id])), [])
check('and none of the percussion, because it has none',
      percussion.filter((id) => Number.isInteger(ad2.map[id])), [])
check('its toms are AD2 Tom 1, 2 and 3',
      [ad2.map.tomHigh, ad2.map.tomMid, ad2.map.tomFloor], [71, 69, 67])
check('its ride is the tip and its bell the bell',
      [ad2.map.ride, ad2.map.rideBell], [60, 61])
check('and its side stick is not its rimshot',
      ad2.map.sideStick !== ad2.map.snareRim, true)

// And what that costs, said out loud: a note the kit cannot play is left
// behind rather than sent somewhere wrong. @see mapDrumNotes
const conga = mapDrumNotes([{ at: 0, note: 63, velocity: 100 }], ad2.map, GENERAL_MIDI_IN)
check('a conga is dropped on a kit with no congas', conga.length, 0)
const snare = mapDrumNotes([{ at: 0, note: 38, velocity: 100 }], ad2.map, GENERAL_MIDI_IN)
check('and the snare still arrives', snare.map((one) => one.note), [38])

// A kit somebody worked out themselves is a plain map, and has to survive
// the same cleaning as any other. @see store.js kitFor
check('a hand-made map cleans to notes',
      cleanKitMap({ kick: '36', snare: 38, nonsense: 9, ride: 999 }),
      { kick: 36, snare: 38 })
