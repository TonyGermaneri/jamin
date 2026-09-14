// The chart every instance in one host is holding.
//
// A DAW has no idea two instances of a plugin are related, so the channel
// between them sits outside it -- a shared memory segment. These checks are
// about what may travel through it, and they exist because the obvious answer
// is wrong in a way that only shows up once a network is involved too.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/** An instance: a session that sends nowhere, which is what the segment needs. */
function instance(site) {
  let text = ''
  const s = new Session({
    site,
    transport: localTransport(),
    onText: (t) => { text = t },
  })
  return { s, text: () => text }
}

/** The segment: one slot, last write wins, everybody reads it. */
let segment = null
const publish = (inst) => { segment = JSON.stringify({ v: 1, ops: inst.s.everything() }) }
const adopt = (inst) => inst.s.ingest(JSON.parse(segment).ops)

/* ---------------- one host, two instances, no network at all ------------- */
const a = instance('aaa')
const b = instance('bbb')

a.s.change('Cm7 F7')
publish(a)
check('the other instance takes the chart', adopt(b), true)
check('and holds the same text', b.s.text(), 'Cm7 F7')
check('reported to the application', b.text(), 'Cm7 F7')

// Idempotent: the segment is read on a timer and the same contents will be seen
// again. Applying them twice must do nothing at all.
check('applying it again changes nothing', adopt(b), false)
check('and the text is unharmed', b.s.text(), 'Cm7 F7')

// Both ways round.
b.s.change('Cm7 F7 Bb')
publish(b)
check('it goes the other way too', adopt(a), true)
check('and both agree', a.s.text(), b.s.text())

/* ---------------- the reason it carries ops and not text ----------------- */
// This is the whole point. Two instances in one host are usually *also* on the
// network, so the same edit arrives twice by two routes. Operations are
// idempotent, so the second arrival is a no-op. Text is not: turning text back
// into operations means diffing against whatever this document happens to hold,
// and if the other route has not arrived yet that diff invents new insertions
// for characters that already exist elsewhere -- and both copies survive.
const one = instance('one')
const two = instance('two')

one.s.change('C')
const overTheNetwork = snapshot(one.s.doc)     // what the stream would carry
publish(one)                                   // and what the segment carries

// Segment first, then the network says the same thing.
check('the segment delivers', adopt(two), true)
check('the network then adds nothing', two.s.ingest(overTheNetwork), false)
check('so there is one C, not two', two.s.text(), 'C')

// And the other order.
const three = instance('three')
check('the network delivers', three.s.ingest(overTheNetwork), true)
check('the segment then adds nothing', adopt(three), false)
check('still one C', three.s.text(), 'C')

// What it would have been if the segment had carried text. Documented rather
// than merely avoided: this is the failure the design is shaped around.
const four = instance('four')
four.s.change('C')                             // the same edit, made locally
check('two sites typing the same character independently both keep it',
      four.s.ingest(overTheNetwork) && four.s.text(), 'CC')

/* ---------------- an instance that arrives late ------------------------- */
const late = instance('late')
check('a newcomer is given everything', adopt(late), true)
check('and catches up in one go', late.s.text(), 'C')

/* ---------------- concurrent edits still merge -------------------------- */
const p = instance('pp')
const q = instance('qq')
p.s.change('Dm7')
publish(p)
adopt(q)

// Both edit before either has heard the other, which is what last-writer-wins
// on a text field would lose.
p.s.change('Dm7 G7')
q.s.change('Dm7 C')
const fromP = snapshot(p.s.doc)
const fromQ = snapshot(q.s.doc)
p.s.ingest(fromQ)
q.s.ingest(fromP)
check('both edits survive on both sides', p.s.text(), q.s.text())
check('and neither was lost', p.s.text().includes('G7') && p.s.text().includes('C'), true)

console.log(failed ? `shared: ${failed} FAILED` : 'shared: all checks passed')
