// Timeline checks for the score parser.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// bars, repeats, commas
let s = parseScore('F,F- C', { beatsPerBar: 4 })
check('3 events', s.events.length, 3)
check('half bars', s.events.map(e => e.endPulse - e.startPulse), [48, 48, 96])
check('spans', s.events.map(e => e.startPulse), [0, 48, 96])
check('total', s.totalPulses, 192)

s = parseScore('C C F', { beatsPerBar: 4 })
check('merged repeat -> 2 events', s.events.length, 2)
check('merged length', s.events[0].endPulse - s.events[0].startPulse, 192)
check('merged bars', s.events[0].bars, 2)
check('merged tokens', s.events[0].tokens.length, 2)

s = parseScore('C C F', { beatsPerBar: 4, mergeRepeats: false })
check('unmerged', s.events.length, 3)

// beats per bar
s = parseScore('C', { beatsPerBar: 3 })
check('3/4 bar', s.totalPulses, 72)

// barlines are decoration
s = parseScore('| C F | G A |', { beatsPerBar: 4 })
check('barlines ignored', s.events.length, 4)
check('barline tokens', s.tokens.filter(t => t.type === 'barline').length, 3)

// % repeats the previous bar
s = parseScore('C % F', { beatsPerBar: 4 })
check('percent events', s.events.length, 2)
check('percent length', s.events[0].endPulse, 192)

// character ranges must point at the typed text
s = parseScore('Am7 Dii', { beatsPerBar: 4 })
check('token range 0', [s.tokens[0].start, s.tokens[0].end], [0, 3])
check('token range 1', [s.tokens[1].start, s.tokens[1].end], [4, 7])
check('token text', s.tokens[1].text, 'Dii')
check('inversion parsed', s.tokens[1].chord.inversion, 2)

// phrase marks
s = parseScore('.C7{walk} F G .Am{riff} Bb', { beatsPerBar: 4, perChordPhrases: true })
check('phrase change flags', s.events.map(e => e.phraseChange), [true, false, false, true, false])
check('phrase sections', s.events.map(e => e.phraseId), ['walk', 'walk', 'walk', 'riff', 'riff'])
check('dot stripped from body', s.tokens[0].body, 'C7')
check('body range', [s.tokens[0].bodyStart, s.tokens[0].bodyEnd], [1, 3])

// bare dot clears the phrase
s = parseScore('.C{riff} F .G A', { beatsPerBar: 4, perChordPhrases: true })
check('phrase cleared', s.events.map(e => e.phraseId), ['riff', 'riff', null, null])

// multi-line
s = parseScore('C F\nG Am', { beatsPerBar: 4 })
check('lines', s.lines.length, 2)
check('line of last token', s.tokens[3].line, 1)
check('line 2 offsets', [s.tokens[2].start, s.tokens[2].end], [4, 5])
check('events across lines', s.events.length, 4)

// lookup
s = parseScore('C F G', { beatsPerBar: 4 })
check('at 0', eventAtPulse(s, 0).index, 0)
check('at 95', eventAtPulse(s, 95).index, 0)
check('at 96', eventAtPulse(s, 96).index, 1)
check('wrapped', eventAtPulse(s, 288 + 10).index, 0)
check('no loop past end', eventAtPulse(s, 500, false), null)

// bad chords do not throw and stay in the timeline as errors
s = parseScore('C Hzz G', { beatsPerBar: 4 })
check('error token type', s.tokens[1].type, 'error')
check('still 3 events', s.events.length, 3)


// labels are decoration, and survive containing spaces
s = parseScore('[Verse 1] C F [A] G', { beatsPerBar: 4 })
check('labels do not consume bars', s.events.length, 3)
check('label token type', s.tokens[0].type, 'label')
check('a label keeps its spaces', s.tokens[0].text, '[Verse 1]')
check('short labels work too', s.tokens.filter(t => t.type === 'label').map(t => t.text), ['[Verse 1]', '[A]'])
check('label offsets are right', [s.tokens[0].start, s.tokens[0].end], [0, 9])
check('chords after a label still parse', s.tokens[1].chord.ok, true)
check('an unclosed bracket is just an unreadable chord', parseScore('[oops C').tokens[0].type, 'error')

// a no-chord bar still takes up time
s = parseScore('C N.C. F', { beatsPerBar: 4 })
check('no-chord is an event', s.events.length, 3)
check('no-chord takes a bar', s.events[1].endPulse - s.events[1].startPulse, 96)
check('no-chord parses', s.events[1].chord.ok, true)
check('no-chord is silent', s.events[1].chord.silent, true)
check('no-chord is not an error token', s.tokens[1].type, 'chord')
check('adjacent no-chords merge', parseScore('N.C. N.C. C', { beatsPerBar: 4 }).events.length, 2)



// One phrase for the whole song is the default -- until the chart names one.
// These three used to assert that dots were "parsed, just not acted on" with
// the setting off. They are acted on now: a phrase written against a chord is
// an instruction, and a switch in a dialog ignoring it is the program arguing
// with what is written in front of somebody.
s = parseScore('C F G', { beatsPerBar: 4, songPhrase: 'riff' })
check('the song phrase covers every chord', s.events.map(e => e.phraseId), ['riff', 'riff', 'riff'])
s = parseScore('.C7{walk} F G', { beatsPerBar: 4, songPhrase: 'riff' })
check('but a named phrase takes over from where it is written',
      s.events.map(e => e.phraseId), ['walk', 'walk', 'walk'])
check('and the dot is still parsed', s.tokens[0].phraseChange, true)
s = parseScore('C F G', { beatsPerBar: 4 })
check('no song phrase and no markup, no phrase', s.events.map(e => e.phraseId), [null, null, null])
s = parseScore('.C7{walk} F G', { beatsPerBar: 4 })
check('markup alone is enough', s.events.map(e => e.phraseId), ['walk', 'walk', 'walk'])
s = parseScore('.C7{walk} F G', { beatsPerBar: 4, perChordPhrases: true, songPhrase: 'riff' })
check('per-chord mode uses the dots, not the song phrase', s.events.map(e => e.phraseId), ['walk', 'walk', 'walk'])

/* ---------------- bar lines: the way everyone else writes it ---------------- */
// Two chords in a bar split it. This is the convention fake books, lead sheets
// and iReal Pro all use, and it only turns on when bar lines are present.
s = parseScore('| Dm7 G7 | Cmaj7 |', { beatsPerBar: 4 })
check('two bars, not three', s.events.length, 3)
check('the first two split a bar', s.events.slice(0, 2).map(e => e.endPulse - e.startPulse), [48, 48])
check('the third gets a whole one', s.events[2].endPulse - s.events[2].startPulse, 96)
check('two bars in total', s.totalPulses, 192)

// Three in a bar divide it in three.
s = parseScore('| C F G | Am |', { beatsPerBar: 4 })
check('thirds of a bar', s.events.slice(0, 3).map(e => e.endPulse - e.startPulse), [32, 32, 32])

// `/` holds the chord before it, so each symbol is a beat.
s = parseScore('| C / Am / |', { beatsPerBar: 4 })
check('four beats, two chords', s.events.length, 2)
check('two beats each', s.events.map(e => e.endPulse - e.startPulse), [48, 48])
s = parseScore('| C / / / |', { beatsPerBar: 4 })
check('one chord held all bar', s.events.length, 1)
check('for the whole bar', s.events[0].endPulse, 96)

// `%` repeats the bar before it, `x` the two before it.
s = parseScore('| C | % | F |', { beatsPerBar: 4 })
check('percent extends', s.events.map(e => e.bars), [2, 1])
s = parseScore('| C | F | x |', { beatsPerBar: 4 })
check('x repeats two bars', s.totalPulses, 96 * 4)

// Bar lines are still drawn.
s = parseScore('| C | F |', { beatsPerBar: 4 })
check('barline tokens survive', s.tokens.filter(t => t.type === 'barline').length, 3)
check('and take no time', s.totalPulses, 192)
check('empty cells are not bars', parseScore('| C | | F |', { beatsPerBar: 4 }).events.length, 2)
check('leading and trailing bars are fine', parseScore('C | F', { beatsPerBar: 4 }).events.length, 2)

// Without bar lines the quick shorthand is unchanged.
s = parseScore('C F G', { beatsPerBar: 4 })
check('shorthand: a space is a bar', s.events.map(e => e.bars), [1, 1, 1])
s = parseScore('F,F- C', { beatsPerBar: 4 })
check('shorthand: commas still split', s.events.map(e => e.endPulse - e.startPulse), [48, 48, 96])
s = parseScore('C / F', { beatsPerBar: 4 })
check('shorthand: a slash holds for another bar', s.events.map(e => e.bars), [2, 1])

// Commas inside a bar are just another separator.
s = parseScore('| Dm7, G7 | C |', { beatsPerBar: 4 })
check('commas inside bar lines', s.events.map(e => e.endPulse - e.startPulse), [48, 48, 96])

// Labels and phrase dots survive both ways.
s = parseScore('[A] | .C7{walk} G7 | F |', { beatsPerBar: 4, perChordPhrases: true })
check('a label takes no time', s.events.length, 3)
check('the dot still marks a phrase change', s.tokens.find(t => t.body === 'C7').phraseChange, true)
check('label came through', s.tokens[0].type, 'label')

// The mode is reported so the UI can say which one is in force.
check('barline mode detected', parseScore('| C |').barlines, true)
check('shorthand detected', parseScore('C F').barlines, false)
// Forced on with no bar lines, the whole line is one bar the chords divide.
check('and can be forced', parseScore('C F', { barlines: true }).events.length, 2)
check('sharing a single bar', parseScore('C F', { barlines: true }).totalPulses, 96)


/* ---------------- repeats ---------------- */
// The compact form: a colon opens, a colon and a count closes.
s = parseScore(':Am7 Am7 Bbmaj7 Bbmaj7:16', { beatsPerBar: 4 })
check('sixteen times through four bars', s.events.length, 16 * 2)
check('sixty-four bars in all', s.totalPulses, 96 * 64)
check('it still reads as two chords', s.events.slice(0, 2).map(e => e.chord.text), ['Am7', 'Bbmaj7'])
check('and each pass is two bars of each', s.events.slice(0, 2).map(e => e.bars), [2, 2])
check('the last pass ends the chart', s.events[s.events.length - 1].endPulse, 96 * 64)

// Every pass points at the same typed words, so the chord lights up each time.
check('one token per chord, not sixty-four', s.tokens.filter(t => t.type === 'chord').length, 4)
check('the first chord sounds in sixteen events',
  s.events.filter(e => e.tokens.includes(0)).length, 16)

// The conventional spelling does the same thing.
s = parseScore('|: Am7 | Bbmaj7 :|16', { beatsPerBar: 4 })
check('conventional repeat marks', s.events.length, 32)
check('same length', s.totalPulses, 96 * 32)
check('repeat marks are their own token type', s.tokens.filter(t => t.type === 'repeat').length, 2)
check('and take no time of their own', parseScore('|: C :|2', { beatsPerBar: 4 }).totalPulses, 192)

// A bare close means twice, as on paper.
s = parseScore('|: C | F :|', { beatsPerBar: 4 })
check('a bare repeat is twice', s.totalPulses, 96 * 4)
check('four events', s.events.length, 4)

// Repeats nest inside a normal chart.
s = parseScore('C |: F | G :| Am', { beatsPerBar: 4 })
check('before, during and after', s.events.map(e => e.chord.text), ['C', 'F', 'G', 'F', 'G', 'Am'])
check('six bars', s.totalPulses, 96 * 6)

// Harte still parses: `C:7` is a chord, not a repeat, when nothing is open.
s = parseScore('C:7 F:maj7', { beatsPerBar: 4 })
check('harte is not a repeat count', s.events.length, 2)
check('and reads as the chord it is', s.events[0].chord.intervals, [0, 4, 7, 10])
check('nor is the second one', s.events[1].chord.intervals, [0, 4, 7, 11])

// A close with nothing open says so instead of guessing.
check('close with nothing open', parseScore('C F:|4', { beatsPerBar: 4 }).tokens.some(t => t.type === 'error'), true)

// Phrase dots survive a repeat opener.
s = parseScore(':.C7{walk} F:2', { beatsPerBar: 4, perChordPhrases: true })
check('dot and repeat together', s.tokens[0].phraseChange, true)
check('body is just the chord', s.tokens[0].body, 'C7')
check('and it repeats', s.events.length, 4)


/* ---------------- the chart beats the setting --------------------------- */
// Writing `{p2551}` against a chord is an instruction. A switch in a dialog
// quietly ignoring it is the program arguing with what somebody has written in
// front of them, so the markup turns per-chord articulation on for this chart.
// The setting only decides what happens to a chart that says nothing.
s = parseScore('.C7{walk} F G .Am{riff} Bb', { beatsPerBar: 4, perChordPhrases: false })
check('a named phrase is honoured with the setting off',
      s.events.map((e) => e.phraseId), ['walk', 'walk', 'walk', 'riff', 'riff'])

// Before the first marker, the song's own phrase carries on -- silence up to
// the first marker would be a worse reading of "respect what the chart says".
s = parseScore('C F .G{riff} Am', { beatsPerBar: 4, perChordPhrases: false, songPhrase: 'song' })
check('the song phrase holds until the chart says otherwise',
      s.events.map((e) => e.phraseId), ['song', 'song', 'riff', 'riff'])

// A chart that says nothing is still one phrase for the whole song.
s = parseScore('C F G Am', { beatsPerBar: 4, perChordPhrases: false, songPhrase: 'song' })
check('a chart with no markup is unchanged',
      s.events.map((e) => e.phraseId), ['song', 'song', 'song', 'song'])

// And with the setting on, nothing about the old behaviour moves: no marker
// yet means no phrase yet.
s = parseScore('C F .G{riff} Am', { beatsPerBar: 4, perChordPhrases: true })
check('with the setting on it still waits for the first marker',
      s.events.map((e) => e.phraseId), [null, null, 'riff', 'riff'])

console.log(failed === 0 ? 'score: all checks passed' : `score: ${failed} FAILED`)
