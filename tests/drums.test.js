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

console.log(failed ? `drums: ${failed} FAILED` : 'drums: all checks passed')
