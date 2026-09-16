// How a search of an imported catalogue decides what to read.
//
// The catalogue is too big to read. Three quarters of a million patterns in
// the browser's own database, and a filter changes on every keystroke, so a
// search is given a budget of rows and has to spend it well.
//
// It spent it badly, and the symptom was a filter that lied: the dropdown
// offered `Progressive (429)` and the list beneath it showed one pattern. The
// facets sampled the whole library evenly, so they knew the genre was in there;
// the search read the rows in the order they were written and stopped after
// forty thousand, which in a collection that size is the first pack or two.
// Both numbers were honestly arrived at and they were answering different
// questions.
//
// These are the two decisions, on their own: which index to walk, and how far
// apart to step. What they do to a real library is measured elsewhere, against
// a real one -- @see scripts/import_check.py, which is where this was caught.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- which index could be walked --------------------------- */
// Order is what they are worth trying, not what gets used: the one that holds
// fewest rows wins, and only the database knows that. But a filter that has no
// index cannot be a candidate at all, and that is decidable here.
check('a library', indexable({ set: 'p2f4k9' }).map((c) => c.name), ['set'])
check('a genre', indexable({ genre: 'Progressive' }).map((c) => c.name), ['genre'])
check('both, so the narrower can be chosen',
      indexable({ set: 'p2f4k9', genre: 'Progressive' }).map((c) => c.name), ['set', 'genre'])
check('and the value to walk it at',
      indexable({ genre: 'Progressive' })[0].value, 'Progressive')

// The genre is the one that was missing, and the one the die roll asks for.
// Without it a search for a genre walks every row there is.
check('genre is indexable at all', indexable({ genre: 'Jazz' }).length, 1)

// Nothing an index can answer. This is the case that has to sample.
check('a surface is not indexed', indexable({ surface: 'Ride' }), [])
check('nor a feel', indexable({ feel: 'Shuffle' }), [])
check('nor free text', indexable({ text: 'carter' }), [])
check('and nothing at all is nothing', indexable({}), [])

// An empty filter is not a filter. Asking the database for every row whose
// genre is the empty string is asking for the wrong rows, not for all of them.
check('an empty genre is not a filter', indexable({ genre: '' }), [])
check('nor is no length', indexable({ bars: 0 }), [])
check('and rubbish is survivable', indexable(), [])

/* ---------------- how far apart to step --------------------------------- */
// The whole of the bug, in one number. A budget that cannot cover the library
// is spent across all of it rather than on the front of it.
check('a budget that covers it walks every row', strideFor(500, 40000), 1)
check('and exactly covering it still walks every row', strideFor(40000, 40000), 1)
check('a library twice the budget is read every other row', strideFor(80000, 40000), 2)
check('and the real one, every nineteenth', strideFor(774000, 40000), 19)

// Stepping is a whole number of rows, so a stride always covers the library --
// rounding up would walk off the end of it and read less than the budget.
check('the stride never overshoots', strideFor(79999, 40000), 1)
check('and 774,000 in nineteens is the whole of it', 19 * Math.floor(774000 / 19) <= 774000, true)

check('an empty library needs no stride', strideFor(0, 40000), 1)
check('nor does a missing one', strideFor(-1, 40000), 1)
check('and no budget is not a divide by zero', strideFor(774000, 0), 1)

/* ---------------- what a row is tested against -------------------------- */
// Packed field names, because there are three quarters of a million of these
// and every character is paid for once per row.
const row = {
  n: 'Straight HiHat 04', p: 'Studio/11 Punk Rock/04.mid', f: 'Studio/11 Punk Rock',
  k: 'beat', r: 2, t: '4/4', g: 'Punk', x: { surface: 'Hi-hat', feel: 'Straight' }, m: {},
}

check('a genre it has', matchesGroove(row, { genre: 'Punk' }), true)
check('a genre it has not', matchesGroove(row, { genre: 'Jazz' }), false)
check('a tag it has', matchesGroove(row, { surface: 'Hi-hat' }), true)
check('a tag it has not', matchesGroove(row, { surface: 'Ride' }), false)
check('two at once', matchesGroove(row, { genre: 'Punk', feel: 'Straight' }), true)
check('and one of them wrong is no', matchesGroove(row, { genre: 'Punk', feel: 'Swing' }), false)
check('no filters is everything', matchesGroove(row, {}), true)

// The whole path, not just the name: a vendor puts the kit, the drummer and the
// tempo in there, none of which is a filter and all of which somebody types.
check('text found in the path', matchesGroove(row, { needle: 'punk rock' }), true)
check('text found in the name', matchesGroove(row, { needle: 'hihat' }), true)
check('text found in a tag', matchesGroove(row, { needle: 'straight' }), true)
check('and text found nowhere', matchesGroove(row, { needle: 'bagpipe' }), false)

// A shelf is a prefix of the path, so choosing a folder keeps what is under it.
check('a shelf keeps what is on it', matchesGroove(row, { folder: 'Studio/11 Punk Rock' }), true)
check('and a shelf above it', matchesGroove(row, { folder: 'Studio' }), true)
check('but not a different one', matchesGroove(row, { folder: 'Studio/12 Ska' }), false)

console.log(failed ? `drum-search: ${failed} FAILED` : 'drum-search: all checks passed')
