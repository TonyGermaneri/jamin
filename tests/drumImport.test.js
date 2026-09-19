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

/* ---------------- sampling a stream ------------------------------------- */
// An import walks a tree it cannot hold, and keeping the first hundred keeps
// the first shelf -- the mistake spread() exists to avoid, wearing different
// clothes.
const stream = reservoir(10, 12345)
for (let i = 0; i < 1000; i++) stream.offer(i)
check('it keeps what it was asked for', stream.take().length, 10)
check('and knows how much went past', stream.seen, 1000)
// Not the first ten, which is the whole point.
check('and not the head of the stream', stream.take().every((n, i) => n === i), false)
// Spread over the stream rather than bunched in it: the last of a thousand
// should not all be under ten.
check('drawn from all of it', stream.take().some((n) => n > 500), true)

const again = reservoir(10, 12345)
for (let i = 0; i < 1000; i++) again.offer(i)
check('the same folder samples the same files', again.take(), stream.take())

const small = reservoir(10, 1)
for (let i = 0; i < 4; i++) small.offer(i)
check('a stream shorter than the sample is all of it', small.take(), [0, 1, 2, 3])

// What says how much of a library a kit has no drum for. A sample would
// understate it, so the caller counts every pitch and hands them over.
check('an exact pitch list beats a sampled one',
      describeSet([{ meta: {}, notes: [{ note: 36 }] }], { pitches: [36, 42, 99] }).pitches,
      [36, 42, 99])
check('and the verdict follows the exact list',
      describeSet([{ meta: {}, notes: [{ note: 36 }] }], { pitches: [36, 42, 99] }).kit,
      'wider than General MIDI')

/*
 * And how often each note is struck, which is the difference between a
 * warning and a footnote.
 *
 * The library screen used to count sounds: a Superior Drummer download
 * reaches a hundred and twenty-eight distinct notes, seventy-nine of which
 * have no voice, and it said so -- "79 of 128 sounds have nowhere to go" --
 * about a library that plays ninety-two per cent of its notes correctly,
 * because the seventy-nine are rare articulations struck a handful of times
 * each. The tally is what lets the screen say the eight per cent instead.
 */
const tallied = describeSet([{ meta: {}, notes: [{ note: 36 }] }],
                            { pitches: [36, 99], uses: new Map([[36, 900], [99, 3]]) })
check('the strikes are kept beside the list', tallied.pitchUse, { 36: 900, 99: 3 })
check('so a rare unplayable note is rare rather than half the list',
      Math.round(100 * tallied.pitchUse[99]
        / Object.values(tallied.pitchUse).reduce((sum, n) => sum + n, 0)),
      0)
check('a library that was never tallied says nothing rather than guessing',
      describeSet([{ meta: {}, notes: [{ note: 36 }] }], { pitches: [36] }).pitchUse,
      undefined)

/* ---------------- a collection of collections --------------------------- */
// The real shape of somebody's accumulated library: fifty vendors' packs side
// by side, two of them holding most of the files. Importing that as one library
// would be one row of eight hundred thousand patterns and one note map covering
// fifty vendors who each wrote for a different one.
//
// Only one rung of the tree is needed to decide this, and only one rung is
// asked for: a whole tree came back as one answer once, and twenty-five
// thousand paths is a megabyte and a half of JavaScript for one call.
const collection = planPacks(
  { path: '/Volumes/external/800k-drums', name: '800k-drums' },
  ['Bossa', 'Analogue Drums', 'GM MIDI Pack']
)

check('one library per pack', collection.map((pack) => pack.name),
      ['800k-drums', 'Bossa', 'Analogue Drums', 'GM MIDI Pack'])
check('rooted where it lives', collection[2].root, '/Volumes/external/800k-drums/Analogue Drums')
check('and each is walked all the way down', collection[2].deep, true)

// The loose shelf must NOT be walked down, or every pack below it is imported
// a second time -- once as itself and once as part of the collection.
check('the loose shelf is one rung only', collection[0].deep, false)
check('and it is rooted at the folder that was chosen', collection[0].root,
      '/Volumes/external/800k-drums')

// A plain pack is one library, exactly as before -- the rule needs no
// configuring and no knowledge of any particular collection.
const plain = planPacks({ path: '/loops/Funk Drums', name: 'Funk Drums' }, [])
check('a folder with no folders in it is one library', plain.length, 1)
check('named after itself', plain[0].name, 'Funk Drums')
check('and walked whole', plain[0].deep, true)

// Windows hands back backslashes and every path here is compared and joined.
const windows = planPacks({ path: 'D:\\drums', name: 'drums' }, ['Rock'])
check('roots are built with one kind of separator', windows[1].root, 'D:/drums/Rock')

// Stable, so a job that stops picks up where it left off rather than importing
// everything a second time.
check('a folder always gets the same name',
      idForPath('/x/Analogue Drums'), idForPath('/x/Analogue Drums'))
check('and two folders do not share one',
      idForPath('/x/Analogue Drums') === idForPath('/x/Vintage Drums'), false)
check('nor do near misses', idForPath('/x/a') === idForPath('/x/b'), false)

/* ---------------- walking a library ------------------------------------- */
// This is the path that failed in somebody's hands: the whole tree was asked
// for in one answer, twenty-five thousand paths came back as a megabyte and a
// half of JavaScript, and what the page saw was an empty list -- which looks
// exactly like a folder with no drums in it. Now every crossing is one folder.

/** A pretend filesystem, and a record of every question asked of it. */
function fakeDisk(layout) {
  const asked = { listFolders: [], scanFiles: [], readFiles: [] }
  const at = (where) => layout[where] || { folders: [], files: [] }
  return {
    asked,
    listFolders: async (where) => { asked.listFolders.push(where); return at(where).folders },
    scanFiles: async (where) => { asked.scanFiles.push(where); return at(where).files },
    readFiles: async (where, names) => {
      asked.readFiles.push([where, names.join(',')])
      return names.map((name) => `${where}/${name}`)
    },
  }
}

const shelves = {
  '/lib/Rock': { folders: ['Fills', 'Beats'], files: ['a.mid'] },
  '/lib/Rock/Fills': { folders: ['2 bar'], files: ['f1.mid', 'f2.mid'] },
  '/lib/Rock/Fills/2 bar': { folders: [], files: ['deep.mid'] },
  '/lib/Rock/Beats': { folders: [], files: [] },
}

const disk = fakeDisk(shelves)
const seen = []
for await (const step of walkLibrary({ root: '/lib/Rock', deep: true }, disk, 2)) {
  seen.push({ shelf: step.shelf, names: step.names, opens: step.opensShelf })
}

check('every folder is reached', disk.asked.scanFiles.sort(),
      ['/lib/Rock', '/lib/Rock/Beats', '/lib/Rock/Fills', '/lib/Rock/Fills/2 bar'])
// Breadth first: a rung at a time, so the top of a library starts producing
// rows while the bottom of it is still being found. Paths are relative to the
// library, because that is what the library is rooted at and therefore what a
// file is found by later.
check('a rung at a time', seen.map((s) => s.shelf),
      ['', 'Fills', 'Beats', 'Fills/2 bar'])
check('and carry their own names', seen[1].names, ['f1.mid', 'f2.mid'])
check('a folder with nothing in it still counts',
      seen.find((s) => s.shelf === 'Beats'), { shelf: 'Beats', names: [], opens: true })
check('every folder opens exactly once', seen.filter((s) => s.opens).length, 4)

// Batched, because the crossing costs more than the read.
const many = fakeDisk({ '/lib/P': { folders: [], files: ['1', '2', '3', '4', '5'] } })
const batches = []
for await (const step of walkLibrary({ root: '/lib/P', deep: true }, many, 2)) {
  batches.push(step.names.length)
}
check('files come in handfuls', batches, [2, 2, 1])
check('and only the first opens the folder', many.asked.readFiles.length, 3)

// The loose shelf at the top of a collection of collections must NOT be walked
// down: everything below it belongs to one of the packs, and walking it would
// import the entire collection a second time.
const shallow = fakeDisk(shelves)
const loose = []
for await (const step of walkLibrary({ root: '/lib/Rock', deep: false }, shallow, 8)) {
  loose.push(step.shelf)
}
check('a one-rung library stays on its rung', loose, [''])
check('and never asks what is below it', shallow.asked.listFolders, [])

// Breaking out closes the walk, which is what Stop does.
const stopper = fakeDisk(shelves)
for await (const step of walkLibrary({ root: '/lib/Rock', deep: true }, stopper, 8)) {
  if (step) break
}
check('stopping asks nothing more', stopper.asked.scanFiles, ['/lib/Rock'])

console.log(failed ? `drum-import: ${failed} FAILED` : 'drum-import: all checks passed')
