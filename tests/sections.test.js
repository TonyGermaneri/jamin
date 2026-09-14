// Sections, and the drum marks that sit among them.
//
// A bracket used to be something to read. It is a span now: a section runs from
// its own label to the next one, which is what lets a groove be bound to "the
// chorus" rather than to a bar number that moves the moment anybody edits.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

const BAR = 96
const names = (text) => parseScore(text).sections.map((s) => s.name)
const spans = (text) => parseScore(text).sections.map((s) => [s.startPulse, s.endPulse])

/* ---------------- a section is a span ------------------------------------ */
const song = parseScore('[Intro] | C | F |\n[Verse] | G | Am | F | C |\n[Chorus] | F | G |')

check('every label is a section', song.sections.map((s) => s.name), ['Intro', 'Verse', 'Chorus'])
check('the first starts at nought', song.sections[0].startPulse, 0)
check('and ends where the next begins', song.sections[0].endPulse, BAR * 2)
check('the middle one is four bars', song.sections[1].endPulse - song.sections[1].startPulse, BAR * 4)
check('and the last runs to the end of the chart', song.sections[2].endPulse, song.totalPulses)

check('a section knows its first chord', song.sections[1].firstEvent, 2)
check('and its last', song.sections[1].lastEvent, 5)

// Every chord knows which section it is in, which is the half the drums use.
check('chords carry their section',
      song.events.map((e) => e.sectionName),
      ['Intro', 'Intro', 'Verse', 'Verse', 'Verse', 'Verse', 'Chorus', 'Chorus'])

/* ---------------- charts without sections still work --------------------- */
const plain = parseScore('| C | F | G |')
check('no labels, no sections', plain.sections.length, 0)
check('and the chords say so', plain.events[0].sectionName, null)

// A label before anything, and a label with nothing after it.
check('a trailing section is empty but real', parseScore('| C |\n[Outro]').sections.length, 1)
check('and says it is empty', parseScore('| C |\n[Outro]').sections[0].empty, true)

// Two sections with the same name are two sections. A song has two choruses.
check('a repeated name is not one section', names('[Verse] C\n[Chorus] F\n[Verse] G'),
      ['Verse', 'Chorus', 'Verse'])
check('and they have different spans',
      spans('[Verse] C\n[Chorus] F\n[Verse] G').length, 3)

/* ---------------- the drum marks ----------------------------------------- */
check('a groove by name', drumMark('[d:halftime]'), { kind: 'groove', name: 'halftime' })
check('spaces do not matter', drumMark('[ d : halftime ]'), { kind: 'groove', name: 'halftime' })
check('case does not either', drumMark('[D:Halftime]'), { kind: 'groove', name: 'Halftime' })
check('no fill into the next one', drumMark('[d:nofill]'), { kind: 'nofill' })
check('a fill after all', drumMark('[d:fill]'), { kind: 'fill' })
check('drums out', drumMark('[d:none]'), { kind: 'off' })
check('and the other ways of saying it', drumMark('[d:off]'), { kind: 'off' })

// It must not eat the brackets that mean other things.
check('a section is not a drum mark', drumMark('[Verse 1]'), null)
check('nor is a pedal mark', drumMark('[p]'), null)
check('nor an empty one', drumMark('[d:]'), null)
check('nor a chord', drumMark('C'), null)

// And the other marks must not eat this one.
check('a drum mark is not a section', parseScore('[d:funk] C').sections.length, 0)
check('it is its own token', parseScore('[d:funk] C').tokens[0].type, 'drum')
check('a section still is one', parseScore('[Verse] C').tokens[0].type, 'label')
check('and a pedal mark still is', parseScore('[p] C').tokens[0].type, 'pedal')

/* ---------------- what the marks do to the chords ------------------------ */
const marked = parseScore('[Verse] | C | [d:halftime] | F | G |\n[Chorus] | Am |')
check('a groove applies from where it is written',
      marked.events.map((e) => e.drums), [null, 'halftime', 'halftime', 'halftime'])
check('and the section is unaffected',
      marked.events.map((e) => e.sectionName), ['Verse', 'Verse', 'Verse', 'Chorus'])

const stopped = parseScore('[d:funk] | C | [d:none] | F |')
check('drums out means no groove', stopped.events.map((e) => e.drums), ['funk', null])
check('and no fill either', stopped.events.map((e) => e.noFill), [false, true])

const quiet = parseScore('[d:funk] | C | [d:nofill] | F |\n[Chorus] | G |')
check('nofill keeps the groove', quiet.events.map((e) => e.drums), ['funk', 'funk', 'funk'])
check('but stops the fill', quiet.events.map((e) => e.noFill), [false, true, false])
check('and a new section starts asking for one again', quiet.events[2].noFill, false)

console.log(failed ? `sections: ${failed} FAILED` : 'sections: all checks passed')
