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
s = parseScore('.C7{walk} F G .Am{riff} Bb', { beatsPerBar: 4 })
check('phrase change flags', s.events.map(e => e.phraseChange), [true, false, false, true, false])
check('phrase sections', s.events.map(e => e.phraseId), ['walk', 'walk', 'walk', 'riff', 'riff'])
check('dot stripped from body', s.tokens[0].body, 'C7')
check('body range', [s.tokens[0].bodyStart, s.tokens[0].bodyEnd], [1, 3])

// bare dot clears the phrase
s = parseScore('.C{riff} F .G A', { beatsPerBar: 4 })
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

console.log(failed === 0 ? 'score: all checks passed' : `score: ${failed} FAILED`)
