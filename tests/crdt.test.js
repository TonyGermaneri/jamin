// The shared document. The thing worth testing is not that an edit works, it is
// that everybody ends up agreeing however the edits arrive -- so most of this is
// one property, checked many ways.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}
function ok(label, got, detail) {
  if (!got) { failed++; console.log(`FAIL ${label}${detail ? ` (${detail})` : ''}`) }
}

/** An update crosses a network, so it is copied the way a network would copy
    it -- through JSON, which is why it is base64 and not raw bytes. */
const wire = (update) => JSON.parse(JSON.stringify({ ops: update })).ops

/* ---------------- one site on its own ---------------- */

let a = createDoc('a')
check('an empty document is empty', docText(a), '')

let update = setDocText(a, 'Cmaj7')
check('typing shows up', docText(a), 'Cmaj7')
ok('and produced something to send', Boolean(update))
check('typing nothing new sends nothing', setDocText(a, 'Cmaj7'), '')

setDocText(a, 'Cmaj7 A-7')
check('appending', docText(a), 'Cmaj7 A-7')
setDocText(a, 'Cmaj7')
check('deleting', docText(a), 'Cmaj7')
setDocText(a, '')
check('deleting everything', docText(a), '')
check('and nothing is left to see', docText(a), '')

// A whole-string replacement only touches what changed.
// A whole-string replacement only touches what changed, which is no longer
// visible in the update's shape -- it is one opaque blob. What it means is that
// somebody else's edit elsewhere in the chart survives, which is checked below.
a = docFromText('a', 'Cmaj7 A-7 D-7 G7')
update = setDocText(a, 'Cmaj7 A-7 D-7 G7#11')
check('editing the end leaves the front alone', docText(a), 'Cmaj7 A-7 D-7 G7#11')
ok('and there is an update for it', Boolean(update))

/* ---------------- two sites, one edit each ---------------- */

function pair(text) {
  const one = docFromText('a', text)
  const two = createDoc('b')
  applyUpdate(two, wire(snapshot(one)))
  return [one, two]
}

let [x, y] = pair('C F G')
check('a new site catches up from a snapshot', docText(y), 'C F G')

const fromX = setDocText(x, 'C F G Am')
const fromY = setDocText(y, 'Bb C F G')
applyUpdate(x, wire(fromY))
applyUpdate(y, wire(fromX))
check('both sides see the same thing', docText(x), docText(y))
ok('and it contains both edits', docText(x).includes('Am') && docText(x).includes('Bb'), docText(x))

/* ---------------- the same spot at the same moment ---------------- */

;[x, y] = pair('CG')
const insX = setDocText(x, 'CXG')
const insY = setDocText(y, 'CYG')
applyUpdate(x, wire(insY))
applyUpdate(y, wire(insX))
check('inserting at the same point converges', docText(x), docText(y))
ok('and keeps both characters', /X/.test(docText(x)) && /Y/.test(docText(x)), docText(x))
check('and keeps what was there', docText(x).replace(/[XY]/g, ''), 'CG')

/* ---------------- delivery order does not matter ---------------- */

;[x, y] = pair('C F G Am')
// One update per edit now, rather than one op per character: Yjs keeps an
// update whose history has not arrived yet and applies it when the gap is
// filled, so the whole batch still lands however it is ordered.
const edits = [setDocText(x, 'C F G Am Bb'), setDocText(x, 'C7 F G Am Bb'), setDocText(x, 'C7 F G Am')].map(wire)

// Backwards, which means every update arrives before the one it follows.
const backwards = createDoc('c')
applyUpdate(backwards, wire(snapshot(y)))
for (const update of edits.slice().reverse()) applyUpdate(backwards, update)
check('updates applied backwards still converge', docText(backwards), docText(x))

// One at a time, in a shuffled order, with repeats thrown in.
function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const shuffled = createDoc('d')
applyUpdate(shuffled, wire(snapshot(y)))
const bag = edits.slice()
const random = seeded(12345)
while (bag.length) {
  const at = Math.floor(random() * bag.length)
  const update = bag[at]
  applyUpdate(shuffled, update)
  applyUpdate(shuffled, update)        // twice: applying one again must do nothing
  if (random() < 0.5) bag.splice(at, 1)
  else { bag.splice(at, 1); bag.push(update) }   // and again, much later
}
check('shuffled, duplicated delivery converges', docText(shuffled), docText(x))

/* ---------------- the property, many sites, many edits ---------------- */

const WORDS = ['C', 'F', 'G7', 'A-7', 'Bbmaj7', ' ', '|', '\n', 'Db9']

function converge(seed, siteCount, rounds) {
  const random = seeded(seed)
  const sites = []
  const outbox = []

  const first = docFromText('s0', 'C F G')
  sites.push(first)
  outbox.push([])

  for (let i = 1; i < siteCount; i++) {
    const doc = createDoc(`s${i}`)
    applyUpdate(doc, wire(snapshot(first)))
    sites.push(doc)
    outbox.push([])
  }

  for (let round = 0; round < rounds; round++) {
    // Somebody types.
    const who = Math.floor(random() * siteCount)
    const doc = sites[who]
    const text = docText(doc)
    const at = Math.floor(random() * (text.length + 1))

    let next
    if (random() < 0.35 && text.length > 2) {
      const cut = Math.min(text.length - at, 1 + Math.floor(random() * 4))
      next = text.slice(0, at) + text.slice(at + cut)
    } else {
      next = text.slice(0, at) + WORDS[Math.floor(random() * WORDS.length)] + text.slice(at)
    }

    const made = setDocText(doc, next)
    if (made) for (let i = 0; i < siteCount; i++) if (i !== who) outbox[i].push(wire(made))

    // And some of the post gets delivered, in whatever order it feels like.
    for (let i = 0; i < siteCount; i++) {
      if (!outbox[i].length || random() < 0.3) continue
      const take = 1 + Math.floor(random() * outbox[i].length)
      const batch = outbox[i].splice(0, take)
      for (let j = batch.length - 1; j > 0; j--) {
        const k = Math.floor(random() * (j + 1))
        const swap = batch[j]; batch[j] = batch[k]; batch[k] = swap
      }
      for (const update of batch) applyUpdate(sites[i], update)
    }
  }

  // Everything still in the post gets through in the end.
  for (let i = 0; i < siteCount; i++) for (const update of outbox[i]) applyUpdate(sites[i], update)

  const answers = sites.map(docText)
  const distinct = [...new Set(answers)]
  return distinct.length === 1 ? null : distinct
}

let disagreements = 0
for (let seed = 1; seed <= 25; seed++) {
  const answers = converge(seed, 4, 120)
  if (answers) {
    disagreements++
    if (disagreements === 1) {
      console.log(`FAIL seed ${seed} produced ${answers.length} different texts`)
      for (const one of answers.slice(0, 2)) console.log(`     ${JSON.stringify(one.slice(0, 70))}`)
    }
  }
}
check('twenty-five runs of four sites all agree', disagreements, 0)

ok('and a bigger crowd agrees too', converge(99, 7, 400) === null)

/* ---------------- a late arrival ---------------- */

const busy = docFromText('a', 'C F G')
for (let i = 0; i < 30; i++) setDocText(busy, `${docText(busy)} ${WORDS[i % WORDS.length]}`)
setDocText(busy, docText(busy).slice(0, 20))

const late = createDoc('z')
applyUpdate(late, wire(snapshot(busy)))
check('a snapshot carries the deletions too', docText(late), docText(busy))
// What a deletion leaves behind is Yjs's business now -- a range in a delete
// set rather than a character kept for ever. What is checked is that it
// travelled: the late arrival sees the cut, not the text before it.
ok('and the cut came with it', docText(late).length === 20, `${docText(late).length}`)

/* ---------------- nothing falls over ---------------- */

const deep = createDoc('a')
setDocText(deep, 'x'.repeat(20000))
check('a long document survives being walked', docText(deep).length, 20000)
setDocText(deep, '')
check('and being emptied', docText(deep), '')

check('nonsense is ignored', applyUpdate(createDoc('a'), 'not base64 at all!!'), false)
check('and so is nothing at all', applyUpdate(createDoc('a'), null), false)
check('and so is an empty update', applyUpdate(createDoc('a'), ''), false)

// An orphan that never gets its parent stays out rather than corrupting anything.
const orphaned = docFromText('a', 'AB')
applyUpdate(orphaned, [{ t: 'ins', id: ['q', 9], parent: ['q', 8], ch: 'Z' }])
check('an insert with no parent waits', docText(orphaned), 'AB')

console.log(failed === 0 ? 'crdt: all checks passed' : `crdt: ${failed} FAILED`)
