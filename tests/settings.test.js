let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// --- merging keeps what was saved and fills in what is new ---
let merged = mergeSettings(defaultSettings(), { midi: { velocity: 40 } })
check('a saved value survives', merged.midi.velocity, 40)
check('an untouched one takes the default', merged.midi.chordChannel, 0)
check('a whole new section appears', typeof merged.accompany.perChordPhrases, 'boolean')
check('unknown keys are ignored', mergeSettings(defaultSettings(), { nonsense: 1 }).nonsense, undefined)
check('nothing saved is just the defaults', mergeSettings(defaultSettings(), null).midi.velocity, 90)

// --- which is exactly why a changed default needs a migration ---
// Stretching to fit was the old default. It is a tempo change, so anyone who
// had run the app before would go on hearing it having never chosen it.
const old = { version: 1, accompany: { fit: 'stretch' } }
check('the old default is corrected', migrateSettings(old).accompany.fit, 'follow')
check('so is repeat', migrateSettings({ accompany: { fit: 'repeat' } }).accompany.fit, 'follow')
check('and truncate', migrateSettings({ accompany: { fit: 'truncate' } }).accompany.fit, 'follow')
check('the version is stamped', migrateSettings(old).version, SETTINGS_VERSION)
check('the original is not mutated', old.accompany.fit, 'stretch')

// A deliberate choice made after the migration is left alone.
const chosen = { version: SETTINGS_VERSION, accompany: { fit: 'stretch' } }
check('a current choice stands', migrateSettings(chosen).accompany.fit, 'stretch')
check('migrating twice changes nothing', migrateSettings(migrateSettings(old)).accompany.fit, 'follow')

// Everything else is left where it was.
const rich = { version: 1, midi: { velocity: 55 }, accompany: { fit: 'stretch', quantize: 6 } }
check('other settings survive migration', migrateSettings(rich).midi.velocity, 55)
check('and so do siblings in the same section', migrateSettings(rich).accompany.quantize, 6)

// Junk in, junk out, without throwing.
check('null', migrateSettings(null), null)
check('not an object', migrateSettings('x'), 'x')
check('no accompany section', migrateSettings({ version: 1 }).version, SETTINGS_VERSION)

// --- the whole round trip ---
const upgraded = mergeSettings(defaultSettings(), migrateSettings({ version: 1, accompany: { fit: 'stretch' } }))
check('an upgraded install keeps the rhythm', upgraded.accompany.fit, 'follow')
check('and a fresh one does too', defaultSettings().accompany.fit, 'follow')
check('a fresh install is already current', defaultSettings().version, SETTINGS_VERSION)

/* ---------------- one bass setting instead of two ---------------- */
// Chords had their own bass note and phrases had "keep the bass under a phrase".
// The phrase book's one does both jobs, so the other two go -- carrying the old
// answer across rather than silently turning off something that was on.
const hadBass = migrateSettings({ version: 3, chords: { bassNote: true, bassOctave: 2 }, accompany: {} })
check('the old chord bass turns the remaining one on', hadBass.accompany.bass, true)
check('one octave down, as that one defaults', hadBass.accompany.bassOctaves, 1)
check('and the old setting is gone', hadBass.chords.bassNote, undefined)
check('along with its octave', hadBass.chords.bassOctave, undefined)

const hadNoBass = migrateSettings({ version: 3, chords: { bassNote: false }, accompany: {} })
check('off stays off', hadNoBass.accompany.bass, undefined)

const alreadyChosen = migrateSettings({ version: 3, chords: { bassNote: true }, accompany: { bass: false } })
check('a choice already made in the new place wins', alreadyChosen.accompany.bass, false)

check('keepBass goes too', migrateSettings({ version: 3, accompany: { keepBass: true } }).accompany.keepBass, undefined)
check('a fresh install has no chord bass setting', defaultSettings().chords.bassNote, undefined)
check('and its bass is off', defaultSettings().accompany.bass, false)


/* ---------------- snapping became the default ---------------- */
check('a fresh install snaps', defaultSettings().accompany.snapNonChordTones, true)
// It was never settable before, so nobody chose the old value.
check('and so does an upgraded one', migrateSettings({ version: 4, accompany: { snapNonChordTones: false } })
  .accompany.snapNonChordTones, true)
check('even with no accompany section at all',
  migrateSettings({ version: 4 }).accompany.snapNonChordTones, true)


/* ---------------- networking ---------------- */
check('networking is on out of the box', defaultSettings().network.enabled, true)
check('the version moved with it', defaultSettings().version, SETTINGS_VERSION)

// Somebody upgrading gets it on too, without losing what they had set.
const older = { version: 5, accompany: { speed: 2 }, chords: { octave: 3 } }
const moved = migrateSettings(older)
check('an upgrade switches networking on', moved.network.enabled, true)
check('and keeps what was there', [moved.accompany.speed, moved.chords.octave], [2, 3])
check('and stamps the version', moved.version, SETTINGS_VERSION)

// And somebody who had turned it off keeps it off.
const refused = migrateSettings({ version: 5, network: { enabled: false } })
check('a choice already made is not overridden', refused.network.enabled, false)

console.log(failed === 0 ? 'settings: all checks passed' : `settings: ${failed} FAILED`)
