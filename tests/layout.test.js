let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
function near(label, got, want, tol = 0.001) {
  if (Math.abs(got - want) > tol) { failed++; console.log(`FAIL ${label}: got ${got} want ${want}`) }
}

// Pretend monospace: every glyph is 60 units wide at the reference size.
const measure = (text) => text.length * 60
const display = { padding: 20, minFontSize: 18, maxFontSize: 200, lineHeight: 1.2, fitLines: true }

// 'C F G' is 5 chars = 300 units at reference 100 -> to fill 560px the scale is
// 560/300, i.e. a font size of 186.67px.
let score = parseScore('C F G', { beatsPerBar: 4 })
let layout = layoutChart(score, { width: 600, measure, display })
near('fitted font size', layout.lines[0].fontSize, (560 / 300) * 100)
near('line fills the width', layout.lines[0].width, 560)
check('token count', layout.lines[0].tokens.length, 3)
near('first token x', layout.lines[0].tokens[0].x, 20)
near('second token x', layout.lines[0].tokens[1].x, 20 + 120 * (560 / 300))

// A long line shrinks, a short line grows -- but both stay inside the clamps.
score = parseScore('C', { beatsPerBar: 4 })
layout = layoutChart(score, { width: 600, measure, display })
near('single chord hits the cap', layout.lines[0].fontSize, 200)

score = parseScore('Cmaj7 Dmin7 G7alt Cmaj7 Dmin7 G7alt Cmaj7 Dmin7 G7alt Cmaj7 Dmin7', { beatsPerBar: 4 })
layout = layoutChart(score, { width: 300, measure, display })
check('long line clamps at the floor', layout.lines[0].fontSize, 18)

// Lines stack, tallest first here.
score = parseScore('C\nC F G H I J K', { beatsPerBar: 4 })
layout = layoutChart(score, { width: 600, measure, display })
check('two lines', layout.lines.length, 2)
near('second line starts below the first', layout.lines[1].top, layout.lines[0].top + layout.lines[0].height)
check('lines have independent sizes', layout.lines[0].fontSize > layout.lines[1].fontSize, true)

// Caret and hit testing must agree with each other.
score = parseScore('C F G', { beatsPerBar: 4 })
layout = layoutChart(score, { width: 600, measure, display })
for (const index of [0, 1, 2, 3, 4, 5]) {
  const caret = caretRect(layout, index, measure)
  const back = indexAtPoint(layout, caret.x, caret.y + 5, measure)
  if (back !== index) { failed++; console.log(`FAIL roundtrip caret ${index} -> ${back}`) }
}

// Clicks past the end of a line land at the end of that line.
check('click past end', indexAtPoint(layout, 99999, 30, measure), 5)
check('click before start', indexAtPoint(layout, -50, 30, measure), 0)

// Vertical movement keeps the horizontal position across differently-sized lines.
score = parseScore('CCCC\nDDDDDDDD', { beatsPerBar: 4 })
layout = layoutChart(score, { width: 600, measure, display })
const down = verticalMove(layout, 2, 1, measure)
check('down lands on line 2', down >= 5 && down <= 13, true)
check('up from line 2 returns to line 1', verticalMove(layout, down, -1, measure) <= 4, true)
check('up from the top goes home', verticalMove(layout, 2, -1, measure), 0)

// Phrase markers do not shift the body rectangle off the word.
score = parseScore('.C7{walk} F', { beatsPerBar: 4 })
layout = layoutChart(score, { width: 600, measure, display })
const first = layout.lines[0].tokens[0]
check('body rect starts after the dot', first.bodyX > first.x, true)
near('body width is 2 glyphs', first.bodyW / first.w, 2 / 9)

// Empty lines still take up space.
score = parseScore('C\n\nF', { beatsPerBar: 4 })
layout = layoutChart(score, { width: 600, measure, display })
check('blank line height', layout.lines[1].height, 18 * 1.2)
check('blank line has no tokens', layout.lines[1].tokens.length, 0)

// Lines carrying a phrase dot get headroom so the marks clear the capitals.
score = parseScore('.C7{walk} F\nC7 F', { beatsPerBar: 4 })
layout = layoutChart(score, { width: 600, measure, display })
check('marked line reserves headroom', layout.lines[0].markSpace > 0, true)
check('plain line reserves none', layout.lines[1].markSpace, 0)
near('text starts below the marks', layout.lines[0].textTop, layout.lines[0].top + layout.lines[0].markSpace)
check('token rects start below the marks', layout.lines[0].tokens[0].y, layout.lines[0].textTop)
check('the dot fits above the glyphs', layout.lines[0].markSpace > layout.lines[0].fontSize * 0.1, true)
const marked = caretRect(layout, 1, measure)
check('caret sits in the text band', marked.y >= layout.lines[0].textTop, true)


console.log(failed === 0 ? 'layout: all checks passed' : `layout: ${failed} FAILED`)
