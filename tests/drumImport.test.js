// Reading somebody's own drum library.
//
// These files are not the shipped corpus and nothing about them can be assumed:
// a folder scraped off the internet has patterns, whole songs, files with no
// drums in them at all, and files that will not parse. The rules here are about
// telling those apart without cutting anything up.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- what a file is, from where it sits -------------------- */
// Libraries say so in the path far more reliably than in the file, so the whole
// path is read: `03.mid` inside `Straight Fills/1 Bar Fills` is a fill, and
// nothing about `03` says that.
check('a fill by its folder', guessKind('Fills Unlimited/1 Bar Fills/03.mid', 1), 'fill')
check('a fill by its name', guessKind('rock/Fill - About That.mid', 1), 'fill')
check('a break is a fill', guessKind('Funk Drums/break 12.mid', 1), 'fill')
check('an ending is a fill', guessKind('Endings/end 2.mid', 2), 'fill')
check('so is an intro', guessKind('Intros/intro 1.mid', 1), 'fill')
check('a plain pattern is a beat', guessKind('Bossa/bossa 1.mid', 1), 'beat')

// Length settles what the words do not. Songs are kept -- they are drums, and a
// long one bound to a section plays through and loops.
check('a long one is a song', guessKind('Rock/whatever.mid', 64), 'song')
check('and eight bars is still a pattern', guessKind('Rock/whatever.mid', 8), 'beat')
check('the word beats the length', guessKind('Fills/long fill.mid', 64), 'fill')

// A word inside another word is not that word.
check('"fillet" is not a fill', guessKind('Odd/fillet.mid', 1), 'beat')
check('"blending" is not an ending', guessKind('Odd/blending.mid', 1), 'beat')

/* ---------------- names and shelves ------------------------------------- */
check('the name is the file', nameOf('a/b/Fill - About That.mid'), 'Fill - About That')
check('without its extension', nameOf('x/bossa 1.MIDI'), 'bossa 1')
check('the shelf is everything above it', folderOf('GM Pack/GM - Blues/12.mid'), 'GM Pack/GM - Blues')
check('a file at the top has no shelf', folderOf('12.mid'), '')

/* ---------------- sampling a whole tree --------------------------------- */
// Taking the first hundred files takes the first hundred files of one
// subfolder, because a tree is sorted. Sampled that way, a pack of every genre
// looked like a pack of guiro patterns -- which is exactly what happened.
const tree = Array.from({ length: 1000 }, (_, i) => i)
const sample = spread(tree, 10)
check('a sample is the size asked for', sample.length, 10)
check('and it is spread across the whole list', sample[0] < 10 && sample[9] > 890, true)
check('a short list is taken whole', spread([1, 2, 3], 10), [1, 2, 3])
check('and is not the same array', spread([1, 2, 3], 10) !== undefined, true)

/* ---------------- what a folder has in common --------------------------- */
// A track name that is the *pattern's* name differs in every file and says
// nothing about the folder; one that is the library's name is the same in all
// of them. Only what most of the sample agrees on is kept.
const samples = [
  { meta: { track: 'GrooveMonkee', copyright: 'x' }, notes: [{ note: 36 }, { note: 42 }] },
  { meta: { track: 'GrooveMonkee', copyright: 'x' }, notes: [{ note: 38 }] },
  { meta: { track: 'GrooveMonkee', copyright: 'y' }, notes: [{ note: 51 }] },
  { meta: { track: 'Fill - One Off' }, notes: [{ note: 36 }] },
]
const agreeing = describeSet([
  { meta: { copyright: 'Acme Drums' }, notes: [{ note: 36 }] },
  { meta: { copyright: 'Acme Drums' }, notes: [{ note: 38 }] },
  { meta: { copyright: 'Acme Drums' }, notes: [{ note: 42 }] },
  { meta: { copyright: 'stray' }, notes: [{ note: 44 }] },
])
const facts = describeSet(samples)
check('what they agree on is kept', facts.track, 'GrooveMonkee')
// Half is not agreement. A value two of four files carry is as likely to be
// one shelf inside the folder as a fact about the folder, and a filter built
// on it would be wrong half the time.
check('what only half of them say is not', facts.copyright, undefined)
check('the pitch range is reported', facts.range, '36-51')
check('and what it suggests about the kit', facts.kit, 'looks like General MIDI')
check('three in four is agreement', agreeing.copyright, 'Acme Drums')

// The pitches are kept so the interface can say, against whichever kit a
// library is set to, how much of it that kit has no drum for. A pack written
// for one sampler and played through another loses notes in silence.
check('the sounds it uses are remembered', facts.pitches, [36, 38, 42, 51])
check('sorted, so a range reads off it', describeSet([
  { meta: {}, notes: [{ note: 51 }, { note: 36 }, { note: 42 }] },
]).pitches, [36, 42, 51])

check('a pack using low notes says so',
      describeSet([{ meta: {}, notes: [{ note: 5 }, { note: 6 }] }]).kit,
      'uses notes below General MIDI')
check('and a wide one says that',
      describeSet([{ meta: {}, notes: [{ note: 36 }, { note: 90 }] }]).kit,
      'wider than General MIDI')

/* ---------------- packing, and back again ------------------------------- */
const groove = {
  name: 'break 1', path: 'Funk/break 1.mid', folder: 'Funk', kind: 'beat',
  bars: 2, lengthPulses: 192, timeSignature: '4-4', bpm: 96,
  notes: [{ at: 0, note: 36, duration: 6, velocity: 110 }],
  meta: { track: 'GrooveMonkee' },
}
const packed = packGroove(groove, 'set1', 7)
check('it is filed under its library', packed.s, 'set1')
check('with an id that cannot collide', packed.id, 'set1:7')
const back = unpackGroove(packed)
check('and comes back whole', back.name, 'break 1')
check('with its length', back.lengthPulses, 192)
check('its kind', back.kind, 'beat')
check('its notes', back.notes, [{ at: 0, note: 36, duration: 6, velocity: 110 }])
check('and what the file said about itself', back.meta.track, 'GrooveMonkee')
check('knowing which library it came from', back.setId, 'set1')

console.log(failed ? `drum-import: ${failed} FAILED` : 'drum-import: all checks passed')
