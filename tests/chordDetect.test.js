// What somebody is playing, as a chord.
//
// The old Mr. Accompany Me waited for a chord to be written down and recorded
// what was played over it. This is the other way round, so the notes have to
// name themselves -- and the answer is a chord *name*, handed back through the
// same parser the chart uses, so there is only one definition of a chord here.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

const nameOf = (pitches) => { const d = detectChord(pitches); return d ? d.name : null }

/* ---------------- triads ------------------------------------------------ */
check('a major triad', nameOf([60, 64, 67]), 'C')
check('a minor triad', nameOf([60, 63, 67]), 'C-')
check('a diminished triad', nameOf([60, 63, 66]), 'C°')
check('an augmented triad', nameOf([60, 64, 68]), 'C+')
check('a suspended fourth', nameOf([60, 65, 67]), 'Csus4')
check('a suspended second', nameOf([60, 62, 67]), 'Csus2')
// Two notes still say something. A third says which triad it is the third of,
// which is what somebody stabbing two notes means; a fifth with no third in it
// says only that, and is a quality in its own right.
check('a major third implies its triad', nameOf([60, 64]), 'C')
check('a minor third likewise', nameOf([60, 63]), 'C-')
check('a bare fifth is a bare fifth', nameOf([60, 67]), 'C5')
check('one note is nothing', nameOf([60]), null)
check('no notes is nothing', nameOf([]), null)

/* ---------------- sevenths and beyond ----------------------------------- */
check('a dominant seventh', nameOf([60, 64, 67, 70]), 'C7')
check('a major seventh', nameOf([60, 64, 67, 71]), 'Cmaj7')
check('a minor seventh', nameOf([60, 63, 67, 70]), 'C-7')
check('a minor-major seventh', nameOf([60, 63, 67, 71]), 'C-maj7')
check('a half-diminished', nameOf([60, 63, 66, 70]), 'C-7b5')
check('a diminished seventh', nameOf([60, 63, 66, 69]), 'Cdim7')
check('a sixth', nameOf([60, 64, 67, 69]), 'C6')
check('a minor sixth', nameOf([60, 63, 67, 69]), 'C-6')
check('an added ninth', nameOf([60, 62, 64, 67]), 'Cadd9')
check('a seventh suspended fourth', nameOf([60, 65, 67, 70]), 'C7sus4')
check('a ninth', nameOf([60, 62, 64, 67, 70]), 'C9')
check('a minor ninth', nameOf([60, 62, 63, 67, 70]), 'C-9')
check('a major ninth', nameOf([60, 62, 64, 67, 71]), 'Cmaj9')
check('a flat ninth', nameOf([60, 61, 64, 67, 70]), 'C7b9')
check('a sharp ninth', nameOf([60, 63, 64, 67, 70]), 'C7#9')

/* ---------------- how it is played -------------------------------------- */
// Octaves and doublings are the same chord. Somebody plays with two hands.
check('spread over octaves', nameOf([36, 52, 60, 64, 67, 79]), 'C')
check('doubled notes change nothing', nameOf([60, 64, 64, 67, 72]), 'C')
// Order is irrelevant; the lowest note is the bass wherever it appears.
check('written in any order', nameOf([67, 60, 64]), 'C')

// An inversion whose bass is not the root is a slash chord, which is something
// somebody played on purpose rather than an accident to be normalised away.
check('first inversion says so', nameOf([64, 67, 72]), 'C/E')
check('second inversion too', nameOf([67, 72, 76]), 'C/G')
check('and a seventh in the bass', nameOf([70, 72, 76, 79]), 'C7/Bb')

/* ---------------- the awkward cases ------------------------------------- */
// Three notes that are both a C triad and the top of an A minor seventh are a C
// triad: that is what somebody playing three notes means, and it is why the
// table is ordered simplest first.
check('the simpler reading wins a tie', nameOf([60, 64, 67]), 'C')
// The root is always a note that is actually being held. Every rootless
// voicing is also some other chord that *does* have its root, so naming the
// absent one is a coin toss -- an E, a Bb and a D is an E half-diminished,
// which is a real chord somebody really played, not a rootless C7 that they
// might have meant.
check('a rootless voicing is read as what is there', nameOf([64, 70, 74]), 'E-7b5')
check('and so is the classic rootless dominant', nameOf([64, 67, 71, 74]), 'E-7')
// The invariant behind both: whatever comes back is rooted on a held note.
for (const voicing of [[64, 70, 74], [64, 67, 71, 74], [60, 64, 67, 70], [62, 65, 69]]) {
  const d = detectChord(voicing)
  const heldPcs = voicing.map((n) => ((n % 12) + 12) % 12)
  check(`the root of ${d.name} is a note being played`, heldPcs.includes(d.rootPc), true)
}
// A note the chord has no room for counts against it harder than a missing one:
// playing a note is evidence, leaving one out is only absence.
check('a wrong note is not ignored', nameOf([60, 64, 67, 61]) !== 'C', true)

/* ---------------- the chord is a real chord ----------------------------- */
// The whole point of answering with a name: it goes back through the chart's
// own parser, so a detected chord has every field a typed one has.
const found = detectChord([60, 64, 67, 70])
check('it comes back parsed', found.chord.ok, true)
check('with a root', found.chord.rootPc, 0)
check('and the pitch classes voice leading needs', found.chord.absPcs, [0, 4, 7, 10])
check('and it knows what was held', found.pitches, [60, 64, 67, 70])

/* ---------------- settling ---------------------------------------------- */
// Four fingers do not land in the same millisecond, and every note on the way
// down is briefly a different chord. Reacting to each one is four chords for one
// gesture, so the listener waits for the notes to stop moving.
const heard = []
const listener = new ChordListener({ settleMs: 60 })
listener.onChord = (d) => heard.push(d ? d.name : null)

listener.note(60, true, 0)
listener.tick(10)
listener.note(64, true, 12)
listener.tick(20)
listener.note(67, true, 25)
listener.tick(40)
check('nothing is said while the hand is still moving', heard, [])

listener.tick(100)
check('and one chord once it stops', heard, ['C'])

// Holding the same chord says it once, not once per tick.
listener.tick(200)
listener.tick(300)
check('a held chord is not repeated', heard, ['C'])

// Adding a note makes a different chord, and that is worth saying.
listener.note(70, true, 310)
listener.tick(380)
check('a note added is a new chord', heard, ['C', 'C7'])

// Letting go says so, so whatever was playing can stop.
listener.clear()
check('and letting go says nothing is held', heard, ['C', 'C7', null])
check('clearing twice stays quiet', (listener.clear(), heard.length), 3)

// A note that was already down is not a change, so it must not restart the
// clock -- an aftertouch-happy keyboard would otherwise never settle.
const steady = new ChordListener({ settleMs: 60 })
const said = []
steady.onChord = (d) => said.push(d ? d.name : null)
steady.note(60, true, 0)
steady.note(63, true, 5)
steady.note(67, true, 10)
check('a repeated note-on is not a change', steady.note(67, true, 50), false)
steady.tick(80)
check('so it still settles on time', said, ['C-'])

console.log(failed ? `chord-detect: ${failed} FAILED` : 'chord-detect: all checks passed')
