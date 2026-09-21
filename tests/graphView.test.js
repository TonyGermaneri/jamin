// One engine, three catalogues.
//
// The graph draws a tree, and a tree needs a path. A drum groove has one and
// the path is the whole story; a phrase has none at all and needs one made out
// of what it does have. The adapter is the only part of the graph that knows
// which catalogue it is looking at, so it is the only part worth testing here
// -- everything downstream of it is @see pathTree.js.
//
// This file used to test a graph of words joined by how often they turn up
// together, which was replaced by the tree and then went on passing by not
// running: it called a function that no longer existed, and the harness
// reported only that the file never reached its sign-off line. Hence the last
// section, which checks the adapters exist before checking what they say.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- where each catalogue's tree comes from ---------------- */
/*
 * The library first, then the path inside it.
 *
 * Without the library at the front, two vendors who both have a `Rock/Fills`
 * fold into one branch -- and they are not the same folder, they are two
 * folders with the same name in two collections.
 */
check('a groove hangs under its library',
      ADAPTERS.drums.treePath({ setId: 'p7x', path: 'Rock/Fills/04.mid' }),
      'p7x/Rock/Fills/04.mid')
check('and the built-in corpus is a library like any other',
      ADAPTERS.drums.treePath({ path: 'Shuffle/01.mid' }), 'Built in/Shuffle/01.mid')
check('a groove with only a name still has somewhere to go',
      ADAPTERS.drums.treePath({ setId: 'p7x', name: 'loose' }), 'p7x/loose')

/*
 * A phrase has no path, so one is made of what it does have.
 *
 * The song number is dropped on purpose: `POP909 #024` is *that song*, and
 * keeping it would put eight hundred single-clip branches on the map, one per
 * song, which is a list with extra steps.
 */
const phrase = { name: 'F# comp 19', kind: 'part', category: 'minor seventh',
                 origin: 'POP909 #024' }
check('a phrase is sourced, then kinded, then named',
      ADAPTERS.phrases.treePath(phrase), 'POP909/part/minor seventh/F# comp 19')
check('one captured here says so',
      ADAPTERS.phrases.treePath({ name: 'held', kind: 'lick' }),
      'captured here/lick/held')

/* ---------------- a progression is its shape ----------------------------
 *
 * It used to be genre, then decade, then length -- three facts about where
 * a progression was found rather than about the progression. Two copies of
 * ii-V-I tagged differently sat in different halves of the map, and the
 * same progression in two keys shared no node at all, because the chord
 * symbols have nothing in common. @see core/degrees.js
 */
check('a progression hangs at its first chords as degrees',
      ADAPTERS.progressions.treePath(
        { name: 'in C', text: '| D-7 | G7 | Cmaj7 | % |' }, { chords: 3 }),
      'ii7/V7/Imaj7/in C')
check('the same progression in another key is the same branch',
      ADAPTERS.progressions.treePath(
        { name: 'in Eb', text: '| F-7 | Bb7 | Ebmaj7 | % |' }, { chords: 3 })
        .split('/').slice(0, 3).join('/'),
      'ii7/V7/Imaj7')
check('how deep it groups is the dial',
      ADAPTERS.progressions.treePath(
        { name: 'in C', text: '| D-7 | G7 | Cmaj7 | % |' }, { chords: 1 }),
      'ii7/in C')

/*
 * And the progression is the leaf, not the degree.
 *
 * Without its name on the end the deepest node *is* a degree, so every
 * progression sharing a prefix collapses onto one dot: there is nothing
 * on the map that is a progression, and clicking one selects nothing.
 * Which is how it shipped, and what the right-hand panel staying empty
 * was.
 */
const shape = ADAPTERS.progressions.treePath(
  { name: 'ii–V–I major', text: '| D-7 | G7 | Cmaj7 | % |' }, { chords: 2 })
check('the last level is the progression', shape.split('/').pop(), 'ii–V–I major')
check('and the levels above it are the shape', shape.split('/').slice(0, -1), ['ii7', 'V7'])
check('an unnamed one still has a leaf of its own',
      ADAPTERS.progressions.treePath({ text: '| C |' }, { chords: 1 }).split('/').pop(),
      '(unnamed)')
check('and a progression with no chords in it says so',
      ADAPTERS.progressions.treePath({ name: 'x', text: '' }, { chords: 2 }),
      '(no chords)/x')

/* ---------------- what "group the graph by" means ----------------------- */
// Choosing a facet re-roots the tree: that facet becomes the top level and the
// folders hang underneath it. Every value a sort offers has to be readable as a
// node name, which is why the length one is "4 bars" and not "4".
const groove = { genre: 'funk', bars: 4, timeSignature: '4-4', kind: 'fill',
                 tags: { feel: 'shuffle', surface: 'brushes' } }
check('by genre', ADAPTERS.drums.facet(groove, 'genre'), 'funk')
check('by length, said in words', ADAPTERS.drums.facet(groove, 'bars'), '4 bars')
check('one bar is singular', ADAPTERS.drums.facet({ bars: 1 }, 'bars'), '1 bar')
check('no length is no branch', ADAPTERS.drums.facet({}, 'bars'), '')
check('by time signature', ADAPTERS.drums.facet(groove, 'signature'), '4-4')
check('by kind', ADAPTERS.drums.facet(groove, 'kind'), 'fill')
// Anything else is one of the tags read out of the folder names, which is where
// most of what somebody would sort by actually lives. @see core/drumTags.js
check('by a tag', ADAPTERS.drums.facet(groove, 'feel'), 'shuffle')
check('by another tag', ADAPTERS.drums.facet(groove, 'surface'), 'brushes')
check('a tag it has not got', ADAPTERS.drums.facet(groove, 'era'), '')
check('and no tags at all', ADAPTERS.drums.facet({}, 'feel'), '')

check('phrases sort by where they came from',
      ADAPTERS.phrases.facet(phrase, 'source'), 'POP909')
check('and by category', ADAPTERS.phrases.facet(phrase, 'category'), 'minor seventh')
check('progressions sort by decade',
      ADAPTERS.progressions.facet({ decade: '1970' }, 'decade'), '1970s')

/* ---------------- the dropdown matches the adapter ---------------------- */
/*
 * Every "group the graph by" choice has to be one `facet` understands, and the
 * first has to be the default the view opens on. A choice the adapter does not
 * answer is a dropdown entry that silently groups everything under one node.
 */
for (const [name, adapter] of Object.entries(ADAPTERS)) {
  check(`${name} has a tree path`, typeof adapter.treePath, 'function')
  check(`${name} has a label`, typeof adapter.label, 'string')

  /*
   * A catalogue may offer no grouping choice at all, and one does.
   * Progressions are grouped by what a progression *is* -- its first few
   * chords as degrees -- and there is no second arrangement of that worth
   * offering, so the dropdown is gone and a slider says how deep. An empty
   * list is a statement; a list whose first entry is not the default is a
   * view that opens on something nobody chose.
   */
  if (!adapter.sorts.length) continue
  check(`${name} opens on its own arrangement`, adapter.sorts[0].value, '')
  const answered = adapter.sorts
    .slice(1)
    .filter((sort) => adapter.facet(groove, sort.value) !== undefined)
  check(`every ${name} sort is one the adapter knows`,
        answered.length, adapter.sorts.length - 1)
  check(`${name} sorts are all named`,
        adapter.sorts.every((sort) => Boolean(sort.title)), true)
}

/* ---------------- a phrase is filed by what it does -------------------- */
/*
 * The map used to read `category`, which for POP909's 8,168 parts is the
 * quality of the chord the part was played over. Every part filed under
 * fifteen chord names, a thousand to each: the ball of nothing this was
 * reported as. What a part *does* is in its own name, and the list pane had
 * been reading it that way all along.
 */
const comp = { name: 'F# comp 19', kind: 'part', category: 'Major Triad',
               origin: 'POP909 #024', sourceChord: 'F#', voices: 4 }
check('a part is filed by what it does, then the harmony, then its texture',
      ADAPTERS.phrases.treePath(comp), 'POP909/comp/Major Triad/4 voices/F# comp 19')
check('and grouping by that agrees', ADAPTERS.phrases.facet(comp, 'behaviour'), 'comp')

// Impro-Visor's own labels were always real, and are left alone.
const lick = { name: 'minor', kind: 'lick', category: 'minor', origin: 'Impro-Visor' }
check('a lick keeps its own vocabulary',
      ADAPTERS.phrases.treePath(lick), 'Impro-Visor/lick/minor/minor')

// Anything captured here has neither, and still gets filed rather than heaped.
check('a captured phrase is filed by its kind',
      ADAPTERS.phrases.treePath({ name: 'held', kind: 'lick' }),
      'captured here/lick/held')

/* ---------------- a progression is filed by when and how long ---------- */
check('one bar is singular', ADAPTERS.progressions.facet({ bars: 1 }, 'bars'), '1 bar')

/* A shape shorter than the dial is not padded out. A two-chord vamp under
   a setting of four sits two levels deep, beside everything else that
   starts the same way -- which is where somebody looking for it would go.
   The depth, not the names: which key `| C | G |` is in is a coin flip on
   two chords and the detector's business, not this check's. */
check('a short progression is as deep as it is long',
      ADAPTERS.progressions.treePath({ name: 'x', text: '| C | G |' }, { chords: 4 })
        .split('/').length,
      3)

console.log(failed ? `graph-view: ${failed} FAILED` : 'graph-view: all checks passed')
