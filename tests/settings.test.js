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

console.log(failed === 0 ? 'settings: all checks passed' : `settings: ${failed} FAILED`)
