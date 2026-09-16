// Drums, and the fact that nobody agrees where they live.
//
// A drum note is not a pitch: 38 is "snare", and only on a kit that put the
// snare there. These checks are about the two translations that stand between a
// corpus recorded on a Roland kit and whatever the listener has loaded.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- the corpus, read into the vocabulary ------------------- */
// Magenta's own table for the Groove MIDI Dataset. Spot-checked against the
// published mapping rather than against what the numbers look like they mean --
// 48 is Tom 1 on a TD-11 and Hi-Mid Tom in GM, which is the whole problem.
check('kick', TD11_TO_VOICE[36], 'kick')
check('snare head', TD11_TO_VOICE[38], 'snare')
check('snare rim is not the snare', TD11_TO_VOICE[40], 'snareRim')
check('cross stick', TD11_TO_VOICE[37], 'sideStick')
check('48 is the high tom, not a mid tom', TD11_TO_VOICE[48], 'tomHigh')
check('45 is the mid tom', TD11_TO_VOICE[45], 'tomMid')
check('43 is the floor tom', TD11_TO_VOICE[43], 'tomFloor')
check('the edge of a closed hat is a closed hat', TD11_TO_VOICE[22], 'hatClosed')
check('and its bow is too', TD11_TO_VOICE[42], 'hatClosed')
check('the pedal is its own voice', TD11_TO_VOICE[44], 'hatPedal')
check('58 is a floor tom rim, not a vibraslap', TD11_TO_VOICE[58], 'tomFloor')
check('55 is a crash edge, not a splash', TD11_TO_VOICE[55], 'crash1')
check('52 is a crash edge, not a china', TD11_TO_VOICE[52], 'crash2')
check('the ride bell is kept', TD11_TO_VOICE[53], 'rideBell')

/* ---------------- and written back out to a kit -------------------------- */
const gm = kitById('gm').map
check('a kick is a kick', mapDrumNote(36, gm), 36)

// A rimshot is a snare hit across head and rim -- a snare. General MIDI 40 is
// *Electric Snare*, a different instrument that an acoustic kit either does not
// have or maps to something unrelated. 3,614 hits in the corpus land here, many
// of them the backbeat, and the numbers alone do not show it.
check('a rimshot is a snare, not an electric snare', mapDrumNote(40, gm), 38)
check('and General MIDI agrees about what 40 is', gmName(40), 'Electric Snare')
check('while 38 is the one we want', gmName(38), 'Acoustic Snare')

// Every voice lands on a note General MIDI names as the thing that voice is.
const expected = {
  kick: 'Bass Drum 1', snare: 'Acoustic Snare', snareRim: 'Acoustic Snare',
  sideStick: 'Side Stick', tomHigh: 'High Tom', tomMid: 'Low-Mid Tom',
  tomFloor: 'High Floor Tom', hatClosed: 'Closed Hi Hat', hatOpen: 'Open Hi-Hat',
  hatPedal: 'Pedal Hi-Hat', crash1: 'Crash Cymbal 1', crash2: 'Crash Cymbal 2',
  ride: 'Ride Cymbal 1', rideBell: 'Ride Bell',
}
for (const [voice, name] of Object.entries(expected)) {
  if (gmName(gm[voice]) !== name) {
    failed++
    console.log(`FAIL ${voice} -> ${gm[voice]} which GM calls "${gmName(gm[voice])}", wanted "${name}"`)
  }
}
check('a TD-11 high tom lands on the GM high tom', mapDrumNote(48, gm), 50)
check('a TD-11 mid tom lands on the GM low-mid tom', mapDrumNote(45, gm), 47)
check('a hat edge lands on the closed hat', mapDrumNote(22, gm), 42)
check('a crash edge lands on the crash', mapDrumNote(55, gm), 49)
check('a pitch the corpus never uses is dropped', mapDrumNote(99, gm), null)

// Playing it back at the kit it was recorded on must change nothing at all.
const vdrums = kitById('vdrums').map
for (const pitch of [36, 38, 40, 37, 48, 45, 43, 42, 46, 44, 49, 57, 51, 53]) {
  if (mapDrumNote(pitch, vdrums) !== pitch) {
    failed++
    console.log(`FAIL V-Drums round trip: ${pitch} -> ${mapDrumNote(pitch, vdrums)}`)
  }
}

// A kit with no pedal hat plays it as a closed hat rather than swallowing it.
const tr8s = kitById('tr8s').map
check('a TR-8S has no pedal hat, so it closes one', mapDrumNote(44, tr8s), 42)
check('and no ride bell, so it rides', mapDrumNote(53, tr8s), 51)
check('and no snare rim, so it hits the snare', mapDrumNote(40, tr8s), 38)

/* ---------------- a whole groove ----------------------------------------- */
const groove = [
  { at: 0, note: 36, velocity: 110, duration: 6 },
  { at: 0, note: 42, velocity: 80, duration: 6 },
  { at: 24, note: 38, velocity: 120, duration: 6 },
  { at: 36, note: 99, velocity: 90, duration: 6 },   // nothing the kit can play
]
const played = mapDrumNotes(groove, gm)
check('the unplayable note is left behind', played.length, 3)
check('and the rest keep their pitches', played.map((n) => n.note), [36, 42, 38])
check('their timing is untouched', played.map((n) => n.at), [0, 0, 24])
check('and so is their weight', played.map((n) => n.velocity), [110, 80, 120])

/* ---------------- a map somebody typed ----------------------------------- */
check('a voice that does not exist is not a voice',
      cleanKitMap({ kick: 36, trombone: 40 }), { kick: 36 })
check('a note out of range is not a note',
      cleanKitMap({ kick: 36, snare: 200, ride: -1 }), { kick: 36 })
check('and text that is a number is one', cleanKitMap({ kick: '36' }), { kick: 36 })
check('nothing at all is survivable', cleanKitMap(null), {})

/* ---------------- every kit can play every voice ------------------------- */
// A kit map with a hole in it is a drum that silently never sounds, which is
// the hardest kind of wrong to notice.
for (const kit of DRUM_KITS) {
  const missing = DRUM_VOICES.filter((voice) => !Number.isInteger(kit.map[voice.id]))
  if (missing.length) {
    failed++
    console.log(`FAIL ${kit.name} has no note for: ${missing.map((v) => v.id).join(', ')}`)
  }
}

// And every voice the corpus can produce reaches one.
const reachable = new Set(Object.values(TD11_TO_VOICE))
for (const voice of reachable) {
  if (!DRUM_VOICES.some((v) => v.id === voice)) {
    failed++
    console.log(`FAIL the corpus produces "${voice}" and the vocabulary has no such voice`)
  }
}

check('an unknown kit is General MIDI rather than silence', kitById('nope').id, 'gm')


/* ---------------- laying a groove over a span --------------------------- */
// A groove loops; it is never stretched. A two-bar groove under eight bars
// plays four times, because a drum groove slowed to twice its length is not
// that groove played slower, it is a different and much worse groove.
const bar = 96
const twoBar = {
  lengthPulses: bar * 2,
  notes: [
    { at: 0, note: 36, duration: 6, velocity: 110 },
    { at: 24, note: 38, duration: 6, velocity: 100 },
    { at: bar, note: 36, duration: 6, velocity: 105 },
  ],
}

const overEight = layOutGroove(twoBar, bar * 8, gm)
check('two bars under eight plays four times', overEight.length, 12)
check('and starts where the section does', overEight[0].at, 0)
check('and the last pass starts on bar seven', overEight[overEight.length - 1].at, bar * 7)
check('nothing lands past the end', overEight.every((n) => n.at < bar * 8), true)
check('it comes out in time order',
      overEight.every((n, i) => i === 0 || n.at >= overEight[i - 1].at), true)

// A groove that does not divide the span is cut off, which is what a drummer
// does when the section changes under them.
const overThree = layOutGroove(twoBar, bar * 3, gm)
check('an odd span cuts the last pass short', overThree.length, 5)
check('and still nothing lands past the end', overThree.every((n) => n.at < bar * 3), true)

check('no span, no groove', layOutGroove(twoBar, 0, gm).length, 0)
check('no groove, no notes', layOutGroove(null, bar * 4, gm).length, 0)

// The notes come out on the kit, not on the corpus's own numbers.
const tomGroove = { lengthPulses: bar, notes: [{ at: 0, note: 48, duration: 6, velocity: 90 }] }
check('a TD-11 high tom reaches the GM high tom',
      layOutGroove(tomGroove, bar, gm)[0].note, 50)
check('and the V-Drums one is left alone',
      layOutGroove(tomGroove, bar, kitById('vdrums').map)[0].note, 48)

/* ---------------- and placing a fill ------------------------------------ */
// The easy thing to get backwards: a fill leads *into* the change, so it ends
// where the section ends rather than starting there.
const oneBarFill = {
  lengthPulses: bar,
  notes: [
    { at: 0, note: 43, duration: 6, velocity: 100 },
    { at: 48, note: 38, duration: 6, velocity: 110 },
  ],
}

const placed = placeFill(oneBarFill, bar * 4, gm)
check('a one-bar fill occupies the last bar', placed[0].at, bar * 3)
check('and ends where the section does', placed[placed.length - 1].at, bar * 3 + 48)
check('not at the beginning', placed[0].at !== 0, true)

const twoBarFill = { ...oneBarFill, lengthPulses: bar * 2 }
check('a two-bar fill takes the last two', placeFill(twoBarFill, bar * 4, gm)[0].at, bar * 2)

// Half a fill is a mistake; playing the groove instead is not.
check('a fill that will not fit is refused', placeFill(twoBarFill, bar, gm).length, 0)
check('one that exactly fits is not', placeFill(oneBarFill, bar, gm).length, 2)
check('and it starts at nought when it does', placeFill(oneBarFill, bar, gm)[0].at, 0)

check('no fill, no notes', placeFill(null, bar * 4, gm).length, 0)


/* ---------------- the whole part, from a chart --------------------------- */
const beat = { id: 'b1', lengthPulses: bar, bars: 1, kind: 'beat',
  notes: [{ at: 0, note: 36, duration: 6, velocity: 110 },
          { at: 48, note: 38, duration: 6, velocity: 100 }] }
const fillGroove = { id: 'f1', lengthPulses: bar, bars: 1, kind: 'fill',
  notes: [{ at: 0, note: 43, duration: 6, velocity: 100 }] }

const chart = parseScore('[Verse] | C | F | G | Am |\n[Chorus] | F | G |')
const track = buildDrumTrack(chart, {
  groove: () => beat,
  fill: () => fillGroove,
  map: gm,
  fillOnEveryBoundary: true,
})

check('it comes out in time order',
      track.every((n, i) => i === 0 || n.at >= track[i - 1].at), true)

// Four bars of verse: three of groove, and the fourth is the fill leading into
// the chorus. Then two bars of chorus with nothing after it to lead into.
const kicks = track.filter((n) => n.note === 36).map((n) => n.at)
check('the groove stops where the fill starts', kicks, [0, bar, bar * 2, bar * 4, bar * 5])
check('the fill is in the last bar of the verse',
      track.filter((n) => n.note === 43).map((n) => n.at), [bar * 3])
check('and the last section gets no fill, having nothing to lead into',
      track.filter((n) => n.at >= bar * 4 && n.note === 43).length, 0)

// Switched off, it simply plays through.
const noFills = buildDrumTrack(chart, { groove: () => beat, fill: () => fillGroove, map: gm,
                                        fillOnEveryBoundary: false })
check('no fills means the groove plays the whole section',
      noFills.filter((n) => n.note === 36).map((n) => n.at),
      [0, bar, bar * 2, bar * 3, bar * 4, bar * 5])

// [d:nofill] stops the one it is written in.
const quietBoundary = buildDrumTrack(parseScore('[Verse] | C | [d:nofill] | F |\n[Chorus] | G |'),
                                     { groove: () => beat, fill: () => fillGroove, map: gm })
check('nofill stops the fill into the next section',
      quietBoundary.filter((n) => n.note === 43).length, 0)

// Nothing bound is silence, not an invention.
check('nothing bound plays nothing',
      buildDrumTrack(chart, { groove: () => null, map: gm }).length, 0)
check('and a chart with no chords has no part',
      buildDrumTrack(parseScore(''), { groove: () => beat, map: gm }).length, 0)

// A chart with no sections still has drums.
const sectionless = buildDrumTrack(parseScore('| C | F |'), { groove: () => beat, map: gm })
check('a chart with no sections is one span', sectionless.filter((n) => n.note === 36).map((n) => n.at),
      [0, bar])

// A [d:...] inside a section changes the groove from where it is written.
const other = { ...beat, id: 'b2', notes: [{ at: 0, note: 42, duration: 6, velocity: 90 }] }
const swapped = buildDrumTrack(parseScore('[Verse] | C | [d:other] | F |'), {
  groove: (span) => (span.groove === 'other' ? other : beat),
  map: gm,
  fillOnEveryBoundary: false,
})
check('the first bar is the bound groove', swapped.filter((n) => n.at < bar).map((n) => n.note), [36, 38])
check('and the second is what the chart asked for', swapped.filter((n) => n.at >= bar).map((n) => n.note), [42])

/* ---------------- bindings and the chart drifting apart ------------------ */
let bound = {}
bound = bindGroove(bound, 'Verse', 'b1')
bound = bindGroove(bound, 'Chorus', 'b2')
bound = bindGroove(bound, 'Chorus', 'f9', 'fill')
check('a groove is bound', bound.Verse.groove, 'b1')
check('and a fill separately', bound.Chorus, { groove: 'b2', fill: 'f9' })

const rows = reconcileBindings(bound, chart.sections)
check('every section in the chart has a row', rows.map((r) => r.name), ['Verse', 'Chorus'])
check('in the order the chart has them', rows[0].name, 'Verse')
check('and none of them is stale', rows.every((r) => !r.stale), true)

// The chorus marker is deleted from the chart. The assignment is not lost.
const cut = parseScore('[Verse] | C | F |')
const afterCut = reconcileBindings(bound, cut.sections)
check('the section that went is kept', afterCut.map((r) => r.name), ['Verse', 'Chorus'])
check('and marked stale', afterCut.find((r) => r.name === 'Chorus').stale, true)
check('with its groove intact', afterCut.find((r) => r.name === 'Chorus').groove, 'b2')

// Stale ones can be deleted; live ones cannot, because they would come back.
check('a stale binding can be forgotten',
      'Chorus' in forgetBinding(bound, 'Chorus', cut.sections), false)
check('a live one cannot', 'Verse' in forgetBinding(bound, 'Verse', cut.sections), true)
check('and putting the marker back brings the binding with it',
      reconcileBindings(bound, chart.sections).find((r) => r.name === 'Chorus').stale, false)

// A part nobody has chosen a groove for still gets a row to choose one in.
const empty = reconcileBindings({}, chart.sections)
check('an unassigned part is still listed', empty.length, 2)
check('and says it is waiting', unassigned(empty), 2)

// A chart with no sections binds as a whole.
check('a chart with no sections has one row',
      reconcileBindings({}, []).map((r) => r.name), [WHOLE_SONG])
check('and it knows what it is', reconcileBindings({}, [])[0].wholeSong, true)

// Two choruses are one binding, not two rows.
check('a repeated section is one row',
      reconcileBindings({}, parseScore('[A] C\n[B] F\n[A] G').sections).map((r) => r.name), ['A', 'B'])

/* ---------------- the drums, and nothing else ---------------------------- */
/*
 * A plugin has one MIDI output -- the track it is on -- so the chords go out on
 * channel 1 and the drums on channel 10, and it is the instrument that decides
 * whether to care. A drum sampler generally does not: Ableton's Drum Rack takes
 * every note on every channel, so the chords land on whichever pads sit under
 * them and the kit plays the harmony.
 */
;(() => {
  const heard = []
  const engine = {
    noteOn: (_o, channel, note) => (heard.push({ channel, note }), true),
    noteOff: () => true,
  }
  const settings = defaultSettings()
  settings.midi.chordOutputId = 'out'
  settings.midi.drumOutputId = 'out'
  settings.drums.enabled = true

  const beat = {
    id: 'k', name: 'k', kind: 'beat', bars: 1, lengthPulses: 96,
    notes: [{ at: 0, note: 36, duration: 6, velocity: 100 }],
  }

  const player = new Player(engine, settings)
  player.sends = 'drums'
  player.getGroove = () => beat
  player.getFill = () => null
  player.setScore(parseScore('| Cmaj7 | F | G |', { beatsPerBar: 4 }))
  for (let p = 1; p <= 200; p++) player.tick(p)

  const onDrums = heard.filter((n) => n.channel === settings.midi.drumChannel)
  const elsewhere = heard.filter((n) => n.channel !== settings.midi.drumChannel)

  check('the drums still play', onDrums.length > 0, true)
  check('and nothing else does', elsewhere.length, 0)
})()

// The other way round: articulations play and the drums stay quiet, even with
// a groove bound and the drums switched on. One output, one part.
;(() => {
  const heard = []
  const engine = {
    noteOn: (_o, channel, note) => (heard.push({ channel, note }), true),
    noteOff: () => true,
  }
  const settings = defaultSettings()
  settings.midi.chordOutputId = 'out'
  settings.midi.drumOutputId = 'out'
  settings.drums.enabled = true

  const beat = {
    id: 'k', name: 'k', kind: 'beat', bars: 1, lengthPulses: 96,
    notes: [{ at: 0, note: 36, duration: 6, velocity: 100 }],
  }

  const player = new Player(engine, settings)
  player.sends = 'phrases'
  player.getGroove = () => beat
  player.getFill = () => null
  player.setScore(parseScore('| Cmaj7 | F |', { beatsPerBar: 4 }))
  for (let p = 1; p <= 190; p++) player.tick(p)

  const onDrums = heard.filter((n) => n.channel === settings.midi.drumChannel)
  check('the chords play', heard.length > onDrums.length, true)
  check('and the drums do not', onDrums.length, 0)
})()

/* ---------------- the 1 lands on the 1 ----------------------------------- */
/*
 * A groove is locked to the song's bars, not to its own length.
 *
 * An imported library is full of patterns whose bar is not the song's: a 3/4
 * pattern is 72 pulses against a 4/4 song's 96. Looped at its own length it
 * walks off the grid -- hits at 72, 144, 216, 360 -- and its downbeat is on the
 * 1 only every fourth time round. It sounds like a timing bug and it was one.
 */
const gmMap = kitById('gm').map
const oneKick = (lengthPulses) => ({
  id: 'k', name: 'k', kind: 'beat', bars: 1, lengthPulses,
  notes: [{ at: 0, note: 36, duration: 6, velocity: 100 }],
})
const gridOf = (lengthPulses, chart = '| C | F | G | Am | C | F |') => buildDrumTrack(
  parseScore(chart, { beatsPerBar: 4 }),
  { groove: () => oneKick(lengthPulses), fill: () => null, map: gmMap, inbound: null,
    fillOnEveryBoundary: false },
).map((note) => note.at)

check('a pattern in the song\'s own metre', gridOf(96), [0, 96, 192, 288, 384, 480])
// The one that was broken: 72 against 96.
check('a three-four pattern in a four-four song', gridOf(72), [0, 96, 192, 288, 384, 480])
check('and nothing of it lands off the bar', gridOf(72).filter((at) => at % 96), [])
// A two-bar pattern keeps its own phase -- it belongs on odd bars, not on every
// bar -- but those are still bar lines.
check('a two-bar pattern comes round every two bars', gridOf(192), [0, 192, 384])
// A length that is no whole number of bars is given the bars it needs.
check('an odd length is rounded up to whole bars', gridOf(150), [0, 192, 384])

// A section beginning mid-bar must not take the drums off the 1 with it.
const midBar = parseScore('| C [B] F | G | Am |', { beatsPerBar: 4 })
const acrossSections = buildDrumTrack(midBar, {
  groove: () => oneKick(96), fill: () => null, map: gmMap, inbound: null,
  fillOnEveryBoundary: false,
}).map((note) => note.at)
check('a section starting mid-bar leaves the grid alone',
      acrossSections.filter((at) => at % 96), [])

/* ---------------- three states, one control ------------------------------ */
// Any pattern can be a groove or a fill. What a library *calls* a pattern is a
// guess from its file name and its length, and a guess is not a rule -- a
// two-bar pattern nobody labelled is a perfectly good fill, and refusing it is
// the interface arguing with somebody about their own library.

// A beat goes round: nothing, the part's groove, the part's fill, nothing.
check('a beat offers itself as a groove first', nextSlot('', 'beat'), 'groove')
check('then as a fill', nextSlot('groove', 'beat'), 'fill')
check('then comes off', nextSlot('fill', 'beat'), '')

// A fill starts at the other end, because a fill played for eight bars is a bad
// first result -- but both slots are still reachable from either start.
check('a fill offers itself as a fill first', nextSlot('', 'fill'), 'fill')
check('and can still be a groove', nextSlot('fill', 'fill'), 'groove')
check('before coming off', nextSlot('groove', 'fill'), '')

// Moving between slots has to actually leave the first one, or a pattern ends
// up being both the section's groove and the fill that leads out of it.
let cycled = cycleBinding({}, 'Verse', 'g1', 'beat')
check('one step binds it as the groove', cycled.bindings.Verse, { groove: 'g1', fill: null })
check('and says where it landed', cycled.slot, 'groove')

cycled = cycleBinding(cycled.bindings, 'Verse', 'g1', 'beat')
check('the next step moves it to the fill', cycled.bindings.Verse, { groove: null, fill: 'g1' })
check('and does not leave it in both', cycled.bindings.Verse.groove, null)

cycled = cycleBinding(cycled.bindings, 'Verse', 'g1', 'beat')
check('and the last takes it off entirely', cycled.bindings.Verse, undefined)

// Two different patterns, one part: the groove and the fill are separate slots
// and cycling one does not disturb the other.
let both = cycleBinding({}, 'Chorus', 'beat1', 'beat').bindings
both = cycleBinding(both, 'Chorus', 'fill1', 'fill').bindings
check('a part holds a groove and a fill at once',
      both.Chorus, { groove: 'beat1', fill: 'fill1' })
check('and each knows its own slot', slotOf(both, 'Chorus', 'beat1'), 'groove')
check('including the other one', slotOf(both, 'Chorus', 'fill1'), 'fill')

// A part holds one fill, so stepping a groove *into* the fill slot takes the
// slot over. That is what binding means and it is the surprising half of a
// three-state control, so it is pinned rather than left to be discovered.
const takenOver = cycleBinding(both, 'Chorus', 'beat1', 'beat').bindings
check('stepping into the fill slot takes it', takenOver.Chorus, { groove: null, fill: 'beat1' })
check('and the pattern that was there is no longer in either slot',
      slotOf(takenOver, 'Chorus', 'fill1'), '')

// Clearing a slot outright leaves the other alone -- which is what the two
// crosses on the Parts tab do, and is why cycling is not the only way out.
const clearedGroove = bindGroove(both, 'Chorus', null, 'groove')
check('clearing the groove leaves the fill', clearedGroove.Chorus, { groove: null, fill: 'fill1' })
const clearedFill = bindGroove(both, 'Chorus', null, 'fill')
check('and clearing the fill leaves the groove', clearedFill.Chorus, { groove: 'beat1', fill: null })

check('a pattern bound nowhere is in no slot', slotOf({}, 'Verse', 'g1'), '')
check('and nothing cycles without a groove', cycleBinding({}, 'Verse', null, 'beat').slot, '')

/* ---------------- the drums do not answer to chords ---------------------- */
// A groove runs across chord changes and stops at a section, which is a
// different clock. The player calls stopAll() on every chord change, and for a
// while that reset the drum cursor too -- so every hit in the song replayed
// from the top at each new chord. Three bars came out as six.
;(() => {
  const sent = []
  const s = defaultSettings()
  s.midi.chordOutputId = 'x'
  s.midi.drumChannel = 9
  const engine = {
    noteOn: (_o, ch, note) => (ch === 9 && sent.push(`${note}`), true),
    noteOff: () => true,
    controlChange: () => true,
  }
  const p = new Player(engine, s)
  // This instance is the one playing the drums. One output plays one part.
  p.sends = 'drums'
  p.getGroove = () => beat
  p.getFill = () => null
  const score = parseScore('[Verse] | C | F |\n[Chorus] | G |', { beatsPerBar: 4 })
  p.setScore(score)
  for (let pulse = 0; pulse < score.totalPulses; pulse++) p.tick(pulse)

  // One bar of groove over three bars of chart: three kicks and three snares,
  // and a chord change in the middle of it that must not restart anything.
  check('a chord change does not rewind the drums', sent.length, 6)
  check('and the hits are the groove, once per bar', sent.join(' '), '36 38 36 38 36 38')
})()

/* ---------------- finding a fill that suits a beat ----------------------- */
// The corpus does not hand you one: beats and fills were recorded in separate
// sessions, and the median beat has no fill of its own at all. So it is found
// by genre, time signature and tempo, widening until something turns up.
const pool = [
  { id: 'f-rock-120', kind: 'fill', genre: 'rock', timeSignature: '4-4', bpm: 120, bars: 1 },
  { id: 'f-rock-160', kind: 'fill', genre: 'rock', timeSignature: '4-4', bpm: 160, bars: 1 },
  { id: 'f-rock-124-2', kind: 'fill', genre: 'rock', timeSignature: '4-4', bpm: 124, bars: 2 },
  { id: 'f-jazz-120', kind: 'fill', genre: 'jazz', timeSignature: '4-4', bpm: 120, bars: 1 },
  { id: 'f-rock-34', kind: 'fill', genre: 'rock', timeSignature: '3-4', bpm: 120, bars: 1 },
  { id: 'b-rock', kind: 'beat', genre: 'rock', timeSignature: '4-4', bpm: 120, bars: 1 },
]
const rockBeat = { kind: 'beat', genre: 'rock', timeSignature: '4-4', bpm: 122, bars: 2 }

check('the nearest tempo in the same genre', matchingFill(rockBeat, pool).id, 'f-rock-120')
check('a beat is never offered as a fill',
      matchingFill(rockBeat, pool).kind, 'fill')
check('and the time signature has to match',
      matchingFill({ ...rockBeat, timeSignature: '3-4' }, pool).id, 'f-rock-34')

// A genre with no fills of its own still gets one, because five genres in the
// corpus have none at all and silence is not a better answer.
const afro = { kind: 'beat', genre: 'afrobeat', timeSignature: '4-4', bpm: 118, bars: 1 }
check('a genre with no fills falls back rather than refusing',
      Boolean(matchingFill(afro, pool)), true)
check('and stays in the right time signature', matchingFill(afro, pool).timeSignature, '4-4')

// Length can be demanded when the space is only one bar.
check('a one-bar fill when that is what fits',
      matchingFill(rockBeat, pool, { bars: 1 }).bars, 1)
check('and a two-bar one when it is asked for',
      matchingFill(rockBeat, pool, { bars: 2 }).id, 'f-rock-124-2')

// Nothing at all is survivable.
check('no fills, no answer', matchingFill(rockBeat, [], {}), null)
check('no beat, no answer', matchingFill(null, pool), null)
check('and nothing in that signature is null rather than wrong',
      matchingFill({ ...rockBeat, timeSignature: '7-8' }, pool), null)

// A mapped note keeps the voice it came from. Its number now belongs to the kit
// and says nothing about what was struck -- 38 might be a snare or might be
// whatever somebody typed into the Kit tab -- so reading it backwards to light
// up a drum would be reading the wrong end.
const carried = mapDrumNotes([{ at: 0, note: 48, duration: 6, velocity: 90 }], gm)
check('a mapped note says which voice it is', carried[0].voice, 'tomHigh')
check('and its number is the kit\'s', carried[0].note, 50)
check('even when the kit moved it somewhere odd',
      mapDrumNotes([{ at: 0, note: 48, duration: 6, velocity: 90 }],
                   { ...gm, tomHigh: 71 })[0].voice, 'tomHigh')

console.log(failed ? `drums: ${failed} FAILED` : 'drums: all checks passed')
