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

// What the folders said is indexed too, at the nested key where it already
// lives. These were the facets with no index at all, which is why they were the
// ones a search could not count and had to guess at.
check('a surface is indexed', indexable({ surface: 'Ride' }).map((c) => c.name), ['surface'])
check('so is a feel', indexable({ feel: 'Shuffle' }).map((c) => c.name), ['feel'])
check('and a shelf', indexable({ folder: 'Pack/Rock' }).map((c) => c.name), ['folder'])

// Free text is the one question no index can answer, so it is the one thing
// applied as a predicate rather than as a range.
check('free text is not indexable', indexable({ text: 'carter' }), [])
check('and nothing at all is nothing', indexable({}), [])

// An empty filter is not a filter. Asking the database for every row whose
// genre is the empty string is asking for the wrong rows, not for all of them.
check('an empty genre is not a filter', indexable({ genre: '' }), [])
check('nor is no length', indexable({ bars: 0 }), [])
check('and rubbish is survivable', indexable(), [])

/* ---------------- nothing is sampled any more ---------------------------
 *
 * There used to be a stride here: a budget of rows spread evenly over the
 * catalogue, so a filter's count was a tally of what the walk happened to see
 * multiplied by the gap between steps. It reported "1 bar (494), 2 bars
 * (1,428), 3 bars (78)" over eight hundred thousand patterns -- three lengths
 * where a real library has thirty-six, adding up to exactly the two thousand
 * rows it had looked at.
 *
 * It is gone. Every filterable field is indexed, an index counts its own
 * entries without reading a row, and what is measured against a real library is
 * in scripts/filter_check.py -- which imports one and checks every count value
 * by value against a tally kept in memory.
 */

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
check('text found in the path', matchesGroove(row, { text: 'punk rock' }), true)
check('text found in the name', matchesGroove(row, { text: 'hihat' }), true)
check('text found in a tag', matchesGroove(row, { text: 'straight' }), true)
check('and text found nowhere', matchesGroove(row, { text: 'bagpipe' }), false)

// Text and a facet together: both have to hold. The index answers the facet and
// this answers the rest, which is the only way the two can be combined.
check('a facet and text together', matchesGroove(row, { genre: 'Punk', text: 'hihat' }), true)
check('and the text still has to be there',
      matchesGroove(row, { genre: 'Punk', text: 'bagpipe' }), false)

// A shelf is a prefix of the path, so choosing a folder keeps what is under it.
check('a shelf keeps what is on it', matchesGroove(row, { folder: 'Studio/11 Punk Rock' }), true)
check('and a shelf above it', matchesGroove(row, { folder: 'Studio' }), true)
check('but not a different one', matchesGroove(row, { folder: 'Studio/12 Ska' }), false)

console.log(failed ? `drum-search: ${failed} FAILED` : 'drum-search: all checks passed')
