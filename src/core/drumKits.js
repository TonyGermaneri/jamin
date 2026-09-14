/**
 * Drums, and the fact that nobody agrees where they live.
 *
 * A drum note is not a pitch. 38 is not "D2", it is "snare" -- and only on a kit
 * that put the snare there. The corpus was played on a Roland TD-11, General
 * MIDI put the same drums in different places, and every sampler since has had
 * its own opinion. A groove sent to the wrong map does not sound transposed, it
 * sounds like somebody hitting the wrong drums, which is worse because it reads
 * as a broken feature rather than a wrong setting.
 *
 * So nothing is mapped pitch-to-pitch. Everything goes through a vocabulary of
 * fourteen voices: the corpus is read *into* it, and a kit map writes it back
 * out. Two small tables instead of one large one per pair, and the half that
 * comes from the corpus is published by the people who recorded it.
 *
 * @see https://magenta.tensorflow.org/datasets/groove
 */

/**
 * What a drummer is actually doing, independent of where any kit put it.
 *
 * Fourteen rather than the nine the Groove paper reduces to: that reduction is
 * for training a model, and it throws away the side stick, the pedal hat and
 * the ride bell -- which are not details to a listener, they are the difference
 * between a bossa and a rock beat.
 */
export const DRUM_VOICES = [
  { id: 'kick', name: 'Kick' },
  { id: 'snare', name: 'Snare' },
  { id: 'snareRim', name: 'Snare rimshot' },
  { id: 'sideStick', name: 'Side stick' },
  { id: 'tomHigh', name: 'High tom' },
  { id: 'tomMid', name: 'Mid tom' },
  { id: 'tomFloor', name: 'Floor tom' },
  { id: 'hatClosed', name: 'Closed hi-hat' },
  { id: 'hatOpen', name: 'Open hi-hat' },
  { id: 'hatPedal', name: 'Pedal hi-hat' },
  { id: 'crash1', name: 'Crash 1' },
  { id: 'crash2', name: 'Crash 2' },
  { id: 'ride', name: 'Ride' },
  { id: 'rideBell', name: 'Ride bell' },
]

const VOICE_IDS = new Set(DRUM_VOICES.map((voice) => voice.id))

/**
 * The corpus, read into the vocabulary.
 *
 * This is Magenta's own published table for the Groove MIDI Dataset -- the kit
 * was a Roland TD-11 and its 22 pitches are listed with what each one is. The
 * bow and edge of a cymbal are one voice here because no sampler in the list
 * below has a separate note for the edge of a crash; the distinction is real and
 * there is nowhere to put it.
 */
export const TD11_TO_VOICE = {
  36: 'kick',
  38: 'snare',
  40: 'snareRim',
  37: 'sideStick',
  48: 'tomHigh',  50: 'tomHigh',      // head, rim
  45: 'tomMid',   47: 'tomMid',
  43: 'tomFloor', 58: 'tomFloor',
  46: 'hatOpen',  26: 'hatOpen',      // bow, edge
  42: 'hatClosed', 22: 'hatClosed',
  44: 'hatPedal',
  49: 'crash1',   55: 'crash1',
  57: 'crash2',   52: 'crash2',
  51: 'ride',     59: 'ride',
  53: 'rideBell',
}

/**
 * General MIDI percussion, which is the answer more often than it looks.
 *
 * Roland's TR-8S ships with exactly these numbers for all eleven voices it has.
 * Addictive Drums 2 includes a "General MIDI (GM)" map preset among its sixty-
 * odd, and XLN's own advice for a kit not in that list is to use it. Native
 * Instruments' Abbey Road drummers have a MIDI mapping page that does the same
 * job. Live's Drum Rack labels every pad with "standard GM drum equivalents".
 *
 * So jamin sends GM and lets the instrument's own mapper do the last step --
 * which is both more accurate than guessing at a proprietary layout and correct
 * when somebody changes it, because the mapper is where they would change it.
 */
export const GENERAL_MIDI = {
  kick: 36,
  snare: 38,
  snareRim: 40,
  sideStick: 37,
  tomHigh: 50,
  tomMid: 47,
  tomFloor: 43,
  hatClosed: 42,
  hatOpen: 46,
  hatPedal: 44,
  crash1: 49,
  crash2: 57,
  ride: 51,
  rideBell: 53,
}

/**
 * The kits offered in the dropdown, and what is actually known about each.
 *
 * `notes` is what a person needs to do at the other end; it is shown next to the
 * choice rather than buried, because "it plays the wrong drums" is nearly always
 * a map preset left on the wrong setting and nearly never jamin.
 */
export const DRUM_KITS = [
  {
    id: 'gm',
    name: 'General MIDI',
    map: { ...GENERAL_MIDI },
    notes: 'The standard percussion map. The right answer unless you know otherwise.',
  },
  {
    id: 'tr8s',
    name: 'Roland TR-8S',
    // Verified against Roland's own MIDI implementation chart: the TR-8S ships
    // with GM numbers for every voice it has, and has no rim, pedal hat or bell
    // -- so those fold onto the drum they belong to rather than being silent.
    map: {
      ...GENERAL_MIDI,
      snareRim: 38,
      hatPedal: 42,
      rideBell: 51,
      crash2: 49,
      tomHigh: 50, tomMid: 47, tomFloor: 43,
    },
    notes: 'Factory note numbers, which are the General MIDI ones. Changed under '
         + 'UTILITY ▸ MIDI ▸ Inst Note, so check there if a voice is silent.',
  },
  {
    id: 'ableton',
    name: 'Ableton Drum Rack',
    map: { ...GENERAL_MIDI },
    notes: 'A Drum Rack is whatever its pads were filled with. Live names every '
         + 'pad with its General MIDI equivalent, so a GM-laid-out kit lands '
         + 'correctly; a hand-built rack may not, and the table below is where to fix it.',
  },
  {
    id: 'addictive2',
    name: 'Addictive Drums 2',
    map: { ...GENERAL_MIDI },
    notes: 'Set the Map Preset to “General MIDI (GM)” in AD2’s MIDI Mapping '
         + 'window. Its own map has far more articulations than this vocabulary '
         + 'has voices, so its GM preset is the accurate route rather than a guess at its layout.',
  },
  {
    id: 'abbeyroad',
    name: 'Abbey Road Drummer',
    map: { ...GENERAL_MIDI },
    notes: 'Use the MIDI Mapping page in the instrument to select a General MIDI '
         + 'layout. As with AD2 its factory map carries articulations this '
         + 'vocabulary has no voice for.',
  },
  {
    id: 'vdrums',
    name: 'Roland V-Drums (TD-11)',
    // The kit the corpus was recorded on: playing a groove straight back at one
    // is the one case where nothing should be translated at all.
    map: {
      kick: 36, snare: 38, snareRim: 40, sideStick: 37,
      tomHigh: 48, tomMid: 45, tomFloor: 43,
      hatClosed: 42, hatOpen: 46, hatPedal: 44,
      crash1: 49, crash2: 57, ride: 51, rideBell: 53,
    },
    notes: 'The kit the corpus was played on, so the grooves go back out exactly '
         + 'as they came in.',
  },
]

export const DEFAULT_KIT = 'gm'

/** A kit by id, or General MIDI. Never null: silence is not a useful failure. */
export function kitById(id) {
  return DRUM_KITS.find((kit) => kit.id === id) || DRUM_KITS[0]
}

/**
 * A corpus note, as this kit plays it.
 *
 * Null for a pitch the corpus used and the vocabulary has no voice for, which is
 * a note to drop rather than to guess at -- a wrong drum is louder than a
 * missing one.
 */
export function mapDrumNote(note, map) {
  const voice = TD11_TO_VOICE[note]
  if (!voice) return null
  const out = map && map[voice]
  return Number.isInteger(out) && out >= 0 && out <= 127 ? out : null
}

/** A whole groove, once. Notes the kit cannot play are left behind. */
export function mapDrumNotes(notes, map) {
  const out = []
  for (const note of notes || []) {
    const pitch = mapDrumNote(note.note, map)
    if (pitch === null) continue
    out.push({ ...note, note: pitch })
  }
  return out
}

/** A custom map, sanitised: known voices, whole numbers, in range. */
export function cleanKitMap(map) {
  const out = {}
  for (const [voice, note] of Object.entries(map || {})) {
    if (!VOICE_IDS.has(voice)) continue
    const pitch = Math.round(Number(note))
    if (Number.isFinite(pitch) && pitch >= 0 && pitch <= 127) out[voice] = pitch
  }
  return out
}
