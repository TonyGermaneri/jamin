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

  /*
   * And the rest of General MIDI percussion.
   *
   * Appended, never inserted. A DAW remembers automation by parameter index
   * and the plugin publishes one mute switch per voice in this order, so the
   * fourteen above keep their places and their automation for ever.
   * @see native/plugin/PluginProcessor.cpp
   *
   * These exist because without them a sixth of the collection is silent.
   * Counted over all 774,268 files: 14.6% of every note played is a General
   * MIDI percussion instrument this vocabulary had no voice for, so it was
   * read, filed, drawn in the list -- and dropped on the way to the
   * synthesiser. Tambourine alone is 2.24% of the corpus, congas 2.45%,
   * maracas 1.67%. Four libraries are more than half percussion; `Africa` is
   * 77% and played nothing at all.
   *
   * One voice per instrument the standard names, rather than a judgement
   * about which are alike enough to fold. Folding is how a vocabulary comes
   * to disagree with the thing it is describing, and the standard is not
   * ambiguous about these.
   */
  { id: 'clap', name: 'Hand clap' },
  { id: 'tambourine', name: 'Tambourine' },
  { id: 'cowbell', name: 'Cowbell' },
  { id: 'vibraslap', name: 'Vibraslap' },
  { id: 'bongoHigh', name: 'High bongo' },
  { id: 'bongoLow', name: 'Low bongo' },
  { id: 'congaMute', name: 'Muted conga' },
  { id: 'congaHigh', name: 'High conga' },
  { id: 'congaLow', name: 'Low conga' },
  { id: 'timbaleHigh', name: 'High timbale' },
  { id: 'timbaleLow', name: 'Low timbale' },
  { id: 'agogoHigh', name: 'High agogo' },
  { id: 'agogoLow', name: 'Low agogo' },
  { id: 'cabasa', name: 'Cabasa' },
  { id: 'maracas', name: 'Maracas' },
  { id: 'whistleShort', name: 'Short whistle' },
  { id: 'whistleLong', name: 'Long whistle' },
  { id: 'guiroShort', name: 'Short guiro' },
  { id: 'guiroLong', name: 'Long guiro' },
  { id: 'claves', name: 'Claves' },
  { id: 'woodBlockHigh', name: 'High wood block' },
  { id: 'woodBlockLow', name: 'Low wood block' },
  { id: 'cuicaMute', name: 'Muted cuica' },
  { id: 'cuicaOpen', name: 'Open cuica' },
  { id: 'triangleMute', name: 'Muted triangle' },
  { id: 'triangleOpen', name: 'Open triangle' },
]

/**
 * The fourteen a drum kit has, as against the percussion around it.
 *
 * The piano roll draws every one of these whether the pattern uses it or not
 * -- the thing most worth knowing about a beat is often that there is *no*
 * ride in it, and a row that comes and goes cannot say that. It cannot do the
 * same for forty voices, so the percussion is drawn only where it is played.
 * @see components/DrumBook.vue
 */
export const KIT_VOICES = DRUM_VOICES.slice(0, 14).map((one) => one.id)

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
  // 38, not 40. A rimshot is a snare hit with the stick across head and rim --
  // louder and sharper, but a snare. General MIDI 40 is *Electric Snare*, an
  // entirely different instrument, and on an acoustic-kit sampler it is either
  // missing or something unrelated. Magenta collapse this to the snare in their
  // own paper mapping for the same reason. The accent is lost; the drum is not,
  // and 3,614 hits in the corpus land here -- many of them the backbeat.
  snareRim: 38,
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

  // The percussion, at the numbers the standard gives them.
  clap: 39,
  tambourine: 54,
  cowbell: 56,
  vibraslap: 58,
  bongoHigh: 60,
  bongoLow: 61,
  congaMute: 62,
  congaHigh: 63,
  congaLow: 64,
  timbaleHigh: 65,
  timbaleLow: 66,
  agogoHigh: 67,
  agogoLow: 68,
  cabasa: 69,
  maracas: 70,
  whistleShort: 71,
  whistleLong: 72,
  guiroShort: 73,
  guiroLong: 74,
  claves: 75,
  woodBlockHigh: 76,
  woodBlockLow: 77,
  cuicaMute: 78,
  cuicaOpen: 79,
  triangleMute: 80,
  triangleOpen: 81,
}

/**
 * General MIDI, read *inwards*.
 *
 * The other direction. `GENERAL_MIDI` says where to send a voice; this says what
 * an arriving note means. They are not inverses of each other and cannot be: the
 * standard defines six toms and two snares where this vocabulary has three and
 * two, so several notes fold onto one voice on the way in and only one of them
 * comes back out.
 *
 * It matters because an imported library is read with this and not with the
 * corpus's own map. Without it a General MIDI pack's acoustic bass drum (35),
 * low floor tom (41) and low tom (45) are notes nothing understands, and they
 * are dropped in silence.
 */
export const GENERAL_MIDI_IN = {
  35: 'kick', 36: 'kick',
  37: 'sideStick',
  38: 'snare', 40: 'snareRim',
  41: 'tomFloor', 43: 'tomFloor',
  45: 'tomMid', 47: 'tomMid',
  48: 'tomHigh', 50: 'tomHigh',
  42: 'hatClosed', 44: 'hatPedal', 46: 'hatOpen',

  /*
   * And the hi-hat edge, which General MIDI does not define and almost every
   * drum library sends anyway.
   *
   * 22 and 26 are not in the standard -- they sit below its range entirely --
   * but a hi-hat with a separate edge articulation has to put it somewhere,
   * and these two are where the industry put it. Measured across the
   * collection they are 1.5% of every note played, in libraries whose toms
   * are at General MIDI's numbers: General MIDI kits with a Roland-style hat,
   * not Roland kits. Read as anything else they are silence.
   *
   * Which voice each is, is a judgement jamin has already made once, for the
   * Roland kit the shipped corpus was played on -- edge-closed and edge-open.
   * Agreeing with itself is worth more here than a second opinion.
   * @see TD11_TO_VOICE
   */
  22: 'hatClosed', 26: 'hatOpen',
  49: 'crash1', 55: 'crash1',
  52: 'crash2', 57: 'crash2',
  51: 'ride', 59: 'ride', 53: 'rideBell',

  /*
   * And the percussion, 39 to 81, which this table used to stop short of.
   *
   * It read twenty-one of the standard's forty-seven instruments. The other
   * twenty-six are every hand percussion General MIDI defines, and they are
   * 14.6% of every note in the collection -- read in, filed, listed, and
   * dropped in silence on the way out. A pack of congas was a pack of nothing.
   */
  39: 'clap',
  54: 'tambourine',
  56: 'cowbell',
  58: 'vibraslap',
  60: 'bongoHigh', 61: 'bongoLow',
  62: 'congaMute', 63: 'congaHigh', 64: 'congaLow',
  65: 'timbaleHigh', 66: 'timbaleLow',
  67: 'agogoHigh', 68: 'agogoLow',
  69: 'cabasa', 70: 'maracas',
  71: 'whistleShort', 72: 'whistleLong',
  73: 'guiroShort', 74: 'guiroLong',
  75: 'claves',
  76: 'woodBlockHigh', 77: 'woodBlockLow',
  78: 'cuicaMute', 79: 'cuicaOpen',
  80: 'triangleMute', 81: 'triangleOpen',
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
    in: { ...GENERAL_MIDI_IN },
    notes: 'The standard percussion map. The right answer unless you know otherwise.',
  },
  {
    id: 'tr8s',
    name: 'Roland TR-8S',
    in: { ...GENERAL_MIDI_IN },
    // Verified against Roland's own MIDI implementation chart: the TR-8S ships
    // with GM numbers for every voice it has, and has no rim, pedal hat or bell
    // -- so those fold onto the drum they belong to rather than being silent.
    map: {
      ...GENERAL_MIDI,
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
    in: { ...GENERAL_MIDI_IN },
    notes: 'A Drum Rack is whatever its pads were filled with. Live names every '
         + 'pad with its General MIDI equivalent, so a GM-laid-out kit lands '
         + 'correctly; a hand-built rack may not, and the table below is where to fix it.',
  },
  {
    id: 'addictive2',
    name: 'Addictive Drums 2',
    map: { ...GENERAL_MIDI },
    in: { ...GENERAL_MIDI_IN },
    notes: 'Set the Map Preset to “General MIDI (GM)” in AD2’s MIDI Mapping '
         + 'window. Its own map has far more articulations than this vocabulary '
         + 'has voices, so its GM preset is the accurate route rather than a guess at its layout.',
  },
  {
    id: 'abbeyroad',
    name: 'Abbey Road Drummer',
    map: { ...GENERAL_MIDI },
    in: { ...GENERAL_MIDI_IN },
    notes: 'Use the MIDI Mapping page in the instrument to select a General MIDI '
         + 'layout. As with AD2 its factory map carries articulations this '
         + 'vocabulary has no voice for.',
  },
  {
    id: 'vdrums',
    name: 'Roland V-Drums (TD-11)',
    // The kit the shipped corpus was played on, so its own table is what reads
    // a note coming in.
    in: { ...TD11_TO_VOICE },
    // The kit the corpus was recorded on: playing a groove straight back at one
    // is the one case where nothing should be translated at all.
    map: {
      kick: 36, snare: 38, snareRim: 40, sideStick: 37,
      tomHigh: 48, tomMid: 45, tomFloor: 43,
      hatClosed: 42, hatOpen: 46, hatPedal: 44,
      crash1: 49, crash2: 57, ride: 51, rideBell: 53,

      /*
       * And the percussion, at General MIDI's numbers.
       *
       * A TD-11 has no congas: there is no pad to hit and no Roland number to
       * send. But a voice with no note at all is a drum that silently never
       * sounds, and a conga in an imported library is a real note that has to
       * go somewhere -- so it goes to the number the standard gives it, which
       * is what whatever is listening downstream is most likely to understand.
       * The alternative is dropping it, which is what used to happen.
       */
      clap: 39, tambourine: 54, cowbell: 56, vibraslap: 58,
      bongoHigh: 60, bongoLow: 61,
      congaMute: 62, congaHigh: 63, congaLow: 64,
      timbaleHigh: 65, timbaleLow: 66,
      agogoHigh: 67, agogoLow: 68,
      cabasa: 69, maracas: 70,
      whistleShort: 71, whistleLong: 72,
      guiroShort: 73, guiroLong: 74,
      claves: 75,
      woodBlockHigh: 76, woodBlockLow: 77,
      cuicaMute: 78, cuicaOpen: 79,
      triangleMute: 80, triangleOpen: 81,
    },
    notes: 'The kit the corpus was played on, so the grooves go back out exactly '
         + 'as they came in. It has no percussion pads, so those voices are sent '
         + 'at their General MIDI numbers rather than dropped.',
  },
]

/**
 * What General MIDI calls each percussion note.
 *
 * Shown beside the number in the Kit tab. A mapping that sends the rimshot to
 * "Electric Snare" is obviously wrong the moment the words are on screen and
 * nearly impossible to notice from the numbers -- which is exactly how it
 * shipped. Names make the table proofread itself.
 */
export const GM_PERCUSSION = {
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

/** What GM calls this note, or a plain number for one it does not name. */
export function gmName(note) {
  return GM_PERCUSSION[note] || (Number.isInteger(note) ? `note ${note}` : '')
}

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
export function mapDrumNote(note, map, inbound = TD11_TO_VOICE) {
  const voice = inbound[note]
  if (!voice) return null
  const out = map && map[voice]
  return Number.isInteger(out) && out >= 0 && out <= 127 ? out : null
}

/**
 * A whole groove, once. Notes the kit cannot play are left behind.
 *
 * Each note keeps the voice it came from. Once it is mapped, its number belongs
 * to the kit and says nothing about what was struck -- 38 might be a snare or
 * might be whatever somebody typed into the Kit tab -- so reading it backwards
 * to light up a drum would be reading the wrong end. The voice is the fact; the
 * number is the destination.
 */
export function mapDrumNotes(notes, map, inbound = TD11_TO_VOICE) {
  const out = []
  for (const note of notes || []) {
    const voice = inbound[note.note]
    const pitch = mapDrumNote(note.note, map, inbound)
    if (pitch === null) continue
    out.push({ ...note, note: pitch, voice })
  }
  return out
}

/**
 * Which note map a pile of drum MIDI was written for.
 *
 * Deterministic, and deliberately about the *core kit* rather than the whole
 * histogram. Measured across 760 packs and three quarters of a million files,
 * almost everything is General MIDI where it counts and vendor-specific
 * everywhere else: a sixties drummer library puts its kick on 36, its snare on
 * 38 and its hats on 42 exactly as General MIDI says, and then hangs its own
 * articulations off 92 and 97 where General MIDI has nothing. Judging such a
 * pack by its full range calls it unknown; judging it by its kick and snare
 * calls it what it is.
 *
 * So: where do the kick, the snare and the hi-hats live? That is the question
 * every drum map answers differently and every drum pattern asks constantly.
 *
 *   22 or 26 carrying weight   a Roland V-Drums kit -- General MIDI has no
 *                              percussion at all below 35, so these cannot be
 *                              anything else
 *   the core kit where GM puts it   General MIDI
 *   the weight up in the hand percussion   General MIDI, with no kit in it
 *   none of the above          unknown, and say so rather than guess
 *
 * `coverage` is the number that actually matters to a listener: how much of
 * this pack the chosen map can play at all. A pack can be correctly identified
 * as General MIDI and still lose a third of its notes, because the vocabulary
 * here has fourteen voices and a sampled drum library has ninety.
 */
export function classifyKit(histogram) {
  const entries = Object.entries(histogram || {}).map(([note, n]) => [Number(note), Number(n)])
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  if (!total) return { kit: DEFAULT_KIT, confidence: 0, coverage: 0, reason: 'nothing to look at' }

  const weight = (test) => entries.reduce((sum, [note, n]) => sum + (test(note) ? n : 0), 0) / total
  const on = (notes) => weight((note) => notes.has(note))

  const hatEdge = on(new Set([22, 26]))
  // The toms are what separates a Roland kit from General MIDI: a TD-11 puts
  // them on 48/45/43 and General MIDI on 50/47/43. The hi-hat edge notes are
  // *not* enough on their own -- measured across the collection, 66,101 files
  // in packs using 22 and 26 put their toms exactly where General MIDI does,
  // and calling those Roland would move every tom on every one of them.
  const rolandToms = on(new Set([48, 45]))
  const gmToms = on(new Set([50, 47]))
  const vdrums = hatEdge >= 0.02 && rolandToms > gmToms ? hatEdge : 0

  const kick = on(new Set([35, 36]))
  const snare = on(new Set([37, 38, 40]))
  const hats = on(new Set([42, 44, 46]))
  const percussion = weight((note) => note >= 60 && note <= 81)
  const core = kick + snare + hats

  // What this kit can make sense of on the way *in*. Not the notes it sends --
  // that is the other direction and answers a different question.
  const playable = (kit) => {
    const understood = kitById(kit).in || GENERAL_MIDI_IN
    return weight((note) => Boolean(understood[note]))
  }

  /**
   * A verdict a kit cannot actually play is not a verdict -- but neither is no
   * verdict at all.
   *
   * Two faults, one after the other. First, every pack was called General MIDI
   * whatever was in it: measured across the collection, `Africa`, `Asia` and
   * `Europe` put **100% of their notes outside anything General MIDI can
   * read** -- hand-percussion packs living between 60 and 81, where a
   * vocabulary of fourteen kit voices has no room at all -- and each was
   * named, filed and silent on playback.
   *
   * The fix for that was to refuse: below a threshold, name nothing and let the
   * library follow whatever the Kit tab said. Which is worse, because it is not
   * an answer. Which numbering a library's files are written in is a **fact
   * about those files**; it does not change when somebody picks a different
   * drum instrument for the track, and a library whose map follows a global
   * setting is one whose notes move under it for reasons that have nothing to
   * do with the library.
   *
   * So there is always a kit. When the obvious one cannot read the notes, every
   * kit is tried and the one that reads the most wins -- and when they are all
   * poor, the best of a bad set is still named and `coverage` says plainly how
   * bad. A wrong answer you can see and change beats a deferral you cannot.
   */
  const ENOUGH = 0.6

  /** Whichever kit makes sense of the most of this, when the likely one does not. */
  const bestOfAll = () => DRUM_KITS
    .map((kit) => ({ id: kit.id, covered: playable(kit.id) }))
    .sort((a, b) => b.covered - a.covered)[0] || { id: DEFAULT_KIT, covered: 0 }

  const verdict = (kit, confidence, reason) => {
    const covered = playable(kit)
    if (covered >= ENOUGH) return { kit, confidence, coverage: covered, reason }

    const best = bestOfAll()
    return {
      kit: best.id,
      confidence: 0,
      coverage: best.covered,
      reason: `${Math.round((1 - covered) * 100)}% of these notes are outside `
        + `${kitById(kit).name}; ${kitById(best.id).name} reads the most of them `
        + `(${Math.round(best.covered * 100)}%)`,
    }
  }

  if (vdrums >= 0.02) {
    return verdict('vdrums', Math.min(1, vdrums * 10),
                   'hi-hat edge notes and toms where a Roland kit puts them')
  }

  if (core >= 0.30) {
    return verdict('gm', Math.min(1, core / 0.5),
                   'kick, snare and hats are where General MIDI puts them')
  }

  if (percussion >= 0.40) {
    return verdict('gm', Math.min(1, percussion), 'hand percussion, in the General MIDI range')
  }

  // Nothing is where a standard kit would be, which is still not a reason to
  // leave the library without a map. @see verdict
  const best = bestOfAll()
  return { kit: best.id, confidence: 0, coverage: best.covered,
           reason: `nothing here is where a standard kit would be; ${kitById(best.id).name} `
             + `reads ${Math.round(best.covered * 100)}% of it` }
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
