// What a chart costs after a day of typing.
//
// This exists because of a measured fault, not a theory. Opening the plugin
// editor took 37 seconds of CPU on a machine that had been used for a couple of
// days -- all of it inside JUCE's `String::replace`, escaping the shared chart
// on its way to the page. The chart was `snapshot(doc)`: every operation ever
// performed on the document, tombstones and all, published on every keystroke
// and escaped quadratically on every window open.
//
// So the question this asks is not "does it work" but "what does it cost, and
// does the cost stop growing".
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
function report(label, ok, detail) {
  if (!ok) { failed++; console.log(`FAIL ${label}: ${detail}`) }
}

/**
 * Somebody working on a chart, which is not the same as somebody typing for ever.
 *
 * A chord chart is a page. It is edited thousands of times and stays a page:
 * bars get rewritten, sections get moved, a line is added and a line is cut. So
 * the text here hovers around the size of a real chart while the *edit count*
 * climbs -- which is the whole question. A test that appends ten thousand lines
 * measures the cost of a novel, and every diff-based editor is slow on a novel
 * whatever its garbage collection does.
 */
const CEILING = 3000

function edit(doc, round) {
  const bars = ['| Cmaj7 | A-7 |', '| D-7 | G7 |', '| F | Bb |', '| E-7b5 | A7 |']
  const line = bars[round % bars.length]
  const text = docText(doc)

  // Rewriting a bar in the middle is what makes tombstones, and tombstones are
  // the thing that grows.
  if (round % 3 === 0 && text.length > 40) {
    const at = Math.floor(text.length / 2)
    return setDocText(doc, text.slice(0, at) + line + text.slice(at + line.length))
  }

  // Kept to the size of a chart: past the ceiling, a line comes out for every
  // line that goes in.
  if (text.length > CEILING) {
    return setDocText(doc, text.slice(0, 200) + text.slice(200 + line.length + 1))
  }

  return setDocText(doc, `${text}\n${line}`)
}

/* ---------------- how it grows ------------------------------------------ */

const ROUNDS = 10000
const REBUILD_ABOVE = 16 * 1024          // what the store uses. @see compactIfAlone
let doc = docFromText('burn', '| C |')
const marks = []
let rebuilds = 0

for (let round = 1; round <= ROUNDS; round++) {
  edit(doc, round)

  // The same housekeeping the store does when this instance is the only one
  // holding the chart: start again from the text, which is the one compaction
  // that is complete and correct.
  if (docSize(doc) > REBUILD_ABOVE) {
    doc = rebuild(doc)
    rebuilds++
  }

  if (round % 250 === 0) {
    marks.push({ round, text: docText(doc).length, bytes: docSize(doc) })
  }
}

const half = Math.floor(marks.length / 2)
const early = marks.slice(0, half)
const older = marks.slice(half)
const peak = (rows, field) => rows.reduce((most, row) => Math.max(most, row[field]), 0)

console.log(`  text ${peak(marks, 'text')} chars at its largest, ${rebuilds} rebuilds`)
console.log(`  first half:  ${(peak(early, 'bytes') / 1024).toFixed(1)}KB at its largest`)
console.log(`  second half: ${(peak(older, 'bytes') / 1024).toFixed(1)}KB at its largest`)

check('the text survives ten thousand edits', docText(doc).length > 0, true)
report('and stays the size of a chart', peak(marks, 'text') < CEILING * 2,
       `peaked at ${peak(marks, 'text')} characters`)

/**
 * The question the whole test exists to ask.
 *
 * The hand-written causal tree this replaced reached eight megabytes over these
 * same ten thousand edits, and `publishShared` serialises the whole document on
 * every keystroke -- so the chart got slower the longer it was worked on, which
 * is exactly how it was found.
 *
 * The second five thousand edits must cost no more than the first five
 * thousand. Compared at the peaks, because compaction is a sawtooth and the
 * troughs would flatter it.
 */
report('the second five thousand edits cost no more than the first',
       peak(older, 'bytes') <= peak(early, 'bytes') * 1.25 + 1024,
       `first half ${(peak(early, 'bytes') / 1024).toFixed(1)}KB, `
       + `second ${(peak(older, 'bytes') / 1024).toFixed(1)}KB`)

report('and the whole document stays under what it is rebuilt at',
       peak(marks, 'bytes') < REBUILD_ABOVE * 1.5,
       `peaked at ${(peak(marks, 'bytes') / 1024).toFixed(1)}KB against a ceiling of `
       + `${(REBUILD_ABOVE / 1024).toFixed(0)}KB`)

/* ---------------- the one compaction that is safe ----------------------- */
const beforeText = docText(doc)
const beforeBytes = docSize(doc)
const fresh = rebuild(doc)
check('a rebuilt document says exactly the same thing', docText(fresh), beforeText)
report('and carries no history at all',
       docSize(fresh) <= beforeBytes,
       `${beforeBytes} bytes became ${docSize(fresh)}`)

const afterRebuild = createDoc('after')
applyUpdate(afterRebuild, snapshot(fresh))
check('somebody arriving after a rebuild sees the chart', docText(afterRebuild), beforeText)

/* ---------------- and it still converges -------------------------------- */
// Compaction is only allowed if a document rebuilt from the compacted snapshot
// is the same document. Anything less is a corruption that happens to be small.
const arrived = createDoc('newcomer')
applyUpdate(arrived, snapshot(doc))
check('somebody arriving sees the same chart', docText(arrived), docText(doc))

// Two sites editing at once still interleave the same way on both, which is the
// one thing a causal tree exists to guarantee and the thing compaction is most
// likely to break.
const alice = docFromText('alice', 'C F G')
const bob = createDoc('bob')
applyUpdate(bob, snapshot(alice))

const fromAlice = setDocText(alice, 'C Fmaj7 G')
const fromBob = setDocText(bob, 'C F G7')
applyUpdate(bob, fromAlice)
applyUpdate(alice, fromBob)
check('two people typing at once agree', docText(alice), docText(bob))

// And after a compaction on one side only, which is the awkward case: an
// instance that has compacted and one that has not must still agree.
const compacted = createDoc('compacted')
applyUpdate(compacted, snapshot(alice))
const late = setDocText(alice, `${docText(alice)} |`)
applyUpdate(compacted, late)
check('a compacted document still takes later edits',
      docText(compacted), docText(alice))

console.log(failed ? `crdt-burn: ${failed} FAILED` : 'crdt-burn: all checks passed')
