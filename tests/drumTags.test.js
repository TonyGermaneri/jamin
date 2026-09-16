// What else a drum library's paths say.
//
// Every path below is real, from a 774,000-file collection. The facets were
// found by counting rather than guessing -- 4,415 paths sampled -- and the two
// biggest were not the ones anybody would have picked: what the right hand is
// on (49%), and where in a song the pattern belongs (22%).
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- what the right hand is on ----------------------------- */
// The one worth having and the one nobody thinks to ask for: two otherwise
// identical grooves differ by which cymbal they ride, and that is how a drummer
// tells them apart.
check('a hi-hat groove', tagsFor('Pack/Rock/FullKit HiHat 8ths').surface, 'Hi-hat')
check('a ride groove', tagsFor('Pack/Jazz/Ride Pattern 03').surface, 'Ride')
check('crashes', tagsFor('Pack/000043@GRIND_&_BLAST/Crash Hits').surface, 'Crash')
check('toms', tagsFor('Pack/Tribal/Floor Tom Groove').surface, 'Toms')
check('percussion', tagsFor('Pack/000045@EZX_LATIN_PERCUSSION/61@CRICKETS').surface, 'Percussion')
check('and the whole kit', tagsFor('Superior/FullKit Variation 12').surface, 'Full kit')
// Welded together, which is how half the collection writes it.
check('a hi-hat with no space in it', tagsFor('Pack/Rock/FullKitHiHat8ths').surface, 'Hi-hat')

/* ---------------- feel --------------------------------------------------- */
check('straight', tagsFor('Pack/109@STRAIGHT_6#8').feel, 'Straight')
check('shuffle', tagsFor('Pack/Blues Shuffle 120').feel, 'Shuffle')
check('swing', tagsFor('Pack/Jazz/Swing Ride').feel, 'Swing')
check('triplets', tagsFor('Pack/30@GRIND (1#16_Triplet)').feel, 'Triplet')
check('half time', tagsFor('Pack/Half-time Groove').feel, 'Half-time')
check('linear', tagsFor('Linear Drums/01 Funk').feel, 'Linear')

/* ---------------- where in a song --------------------------------------- */
check('a fill', tagsFor('Pack/000310@ODDGROOVES/11@FILLS').part, 'Fill')
check('a theme', tagsFor('Pack/000052@EZXMETAL!/150-S033@THEME').part, 'Theme')
check('a bridge', tagsFor('Pack/000054@EZXMETALHEADS/110-S037@BRIDGE').part, 'Bridge')
check('an intro', tagsFor('Pack/Intros/03').part, 'Intro')
check('an ending', tagsFor('Ending/end 2').part, 'Ending')

/* ---------------- the decade -------------------------------------------- */
// Vendors write the apostrophe four different ways, including the acute accent
// that a Mac types by accident.
check('an acute accent', tagsFor("80´s Drummer MIDI Files/Chrome Kit").era, '1980s')
check('a real apostrophe', tagsFor("60's Drummer/Early Kit").era, '1960s')
check('and none at all', tagsFor('70s Rock/01').era, '1970s')

/* ---------------- time signature ---------------------------------------- */
/*
 * Three spellings, all of them in this one collection. `#` because a filename
 * may not contain a slash on most platforms, `-` because a hyphen is safe
 * everywhere, and the real thing where the platform allows it.
 */
check('a hash for a slash', signatureIn('Pack/109@STRAIGHT_6#8'), '6/8')
check('a hyphen for a slash', signatureIn('Pack/000210@JAZZ/31@3-4'), '3/4')
check('and a slash for a slash', signatureIn('Pack/7/8 Odd Meter'), '7/8')
check('the first one wins', signatureIn('Pack/508@3#4_AND_6#8'), '3/4')

// The list of metres is what keeps a path full of numbers from filling the
// filter with nonsense. A catalogue number is not a time signature.
// Underscore too. A pack called Odd Meter Drums whose folders are
// `11_8_IndieQuirk` and `7_8_FunkStep` was reading none of its own metres.
check('an underscore for a slash', signatureIn('Odd Meter Drums/11_8_IndieQuirk'), '11/8')
check('and another', signatureIn('Odd Meter Drums/7_8_FunkStep'), '7/8')

check('a catalogue number is not a metre', signatureIn('Pack/150-S033@THEME'), '')
check('nor is a subdivision', signatureIn('Pack/30@GRIND (1#16_Triplet)'), '')
check('nor a range', signatureIn('Pack/Grooves 2-13'), '')
check('nor a year', signatureIn('Pack/1950-1960'), '')

/* ---------------- tempo -------------------------------------------------- */
check('tempo stuck to the name', tempoIn('Pack/04 Groove 170BPM'), 170)
check('tempo with a space', tempoIn('Pack/03@ATARI 120 BPM'), 120)
check('and none at all', tempoIn('Pack/000210@JAZZ/31@3-4'), 0)
// A drum library is not played at four beats a minute or at six hundred.
check('an absurd tempo is not a tempo', tempoIn('Pack/900BPM'), 0)

/* ---------------- everything at once ------------------------------------ */
const all = tagsFor('Studio Drummer MIDI Files/11 Punk Rock/04 Straight HiHat Fill 170BPM')
check('the feel', all.feel, 'Straight')
check('the surface', all.surface, 'Hi-hat')
check('the part', all.part, 'Fill')
check('the tempo', all.tempo, 170)

// A path that says nothing says nothing, rather than guessing.
check('a drummer is not a tag', tagsFor('Superior/000752@CARTER_BEAUFORD'), {})
check('nor is a catalogue', tagsFor('Superior/000093@MONSTER_MIDI_PACK_1'), {})

/* ---------------- what a filter can offer -------------------------------- */
check('every feel', everyTag('feel').includes('Shuffle'), true)
check('every surface', everyTag('surface').includes('Ride'), true)
check('and nothing for a kind that does not exist', everyTag('nonsense'), [])
check('the kinds have labels', TAG_KINDS.every((k) => k.key && k.label), true)

console.log(failed ? `drum-tags: ${failed} FAILED` : 'drum-tags: all checks passed')
