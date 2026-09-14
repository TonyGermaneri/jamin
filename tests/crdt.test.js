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

/** Ops cross a network, so they are copied the way a network would copy them. */
const wire = (ops) => JSON.parse(JSON.stringify(ops))

/* ---------------- one site on its own ---------------- */

let a = createDoc('a')
check('an empty document is empty', docText(a), '')

let ops = setDocText(a, 'Cmaj7')
check('typing shows up', docText(a), 'Cmaj7')
check('and produced one op per character', ops.length, 5)

setDocText(a, 'Cmaj7 A-7')
check('appending', docText(a), 'Cmaj7 A-7')
setDocText(a, 'Cmaj7')
check('deleting', docText(a), 'Cmaj7')
setDocText(a, '')
check('deleting everything', docText(a), '')
check('and nothing is left to see', docText(a), '')

// A whole-string replacement only touches what changed.
a = docFromText('a', 'Cmaj7 A-7 D-7 G7')
ops = setDocText(a, 'Cmaj7 A-7 D-7 G7#11')
check('editing the end leaves the front alone', ops.length, 3)
ok('and they are all inserts', ops.every((op) => op.t === 'ins'))

/* ---------------- two sites, one edit each ---------------- */

function pair(text) {
  const one = docFromText('a', text)
  const two = createDoc('b')
  applyOps(two, wire(snapshot(one)))
  return [one, two]
}

let [x, y] = pair('C F G')
check('a new site catches up from a snapshot', docText(y), 'C F G')

const fromX = setDocText(x, 'C F G Am')
const fromY = setDocText(y, 'Bb C F G')
applyOps(x, wire(fromY))
applyOps(y, wire(fromX))
check('both sides see the same thing', docText(x), docText(y))
ok('and it contains both edits', docText(x).includes('Am') && docText(x).includes('Bb'), docText(x))

/* ---------------- the same spot at the same moment ---------------- */

;[x, y] = pair('CG')
const insX = setDocText(x, 'CXG')
const insY = setDocText(y, 'CYG')
applyOps(x, wire(insY))
applyOps(y, wire(insX))
check('inserting at the same point converges', docText(x), docText(y))
ok('and keeps both characters', /X/.test(docText(x)) && /Y/.test(docText(x)), docText(x))
check('and keeps what was there', docText(x).replace(/[XY]/g, ''), 'CG')

/* ---------------- delivery order does not matter ---------------- */

;[x, y] = pair('C F G Am')
const edits = [setDocText(x, 'C F G Am Bb'), setDocText(x, 'C7 F G Am Bb'), setDocText(x, 'C7 F G Am')]
const flat = wire(edits.flat())

// Backwards, which means every insert arrives before its parent.
const backwards = createDoc('c')
applyOps(backwards, wire(snapshot(y)))
applyOps(backwards, flat.slice().reverse())
check('ops applied backwards still converge', docText(backwards), docText(x))

// One at a time, in a shuffled order, with repeats thrown in.
function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const shuffled = createDoc('d')
applyOps(shuffled, wire(snapshot(y)))
const bag = flat.slice()
const random = seeded(12345)
while (bag.length) {
  const at = Math.floor(random() * bag.length)
  const op = bag[at]
  applyOps(shuffled, [op])
  applyOps(shuffled, [op])          // twice: applying an op again must do nothing
  if (random() < 0.5) bag.splice(at, 1)
  else { bag.splice(at, 1); bag.push(op) }   // and again, much later
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
    applyOps(doc, wire(snapshot(first)))
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

    const made = wire(setDocText(doc, next))
    for (let i = 0; i < siteCount; i++) if (i !== who) outbox[i].push(...made)

    // And some of the post gets delivered, in whatever order it feels like.
    for (let i = 0; i < siteCount; i++) {
      if (!outbox[i].length || random() < 0.3) continue
      const take = 1 + Math.floor(random() * outbox[i].length)
      const batch = outbox[i].splice(0, take)
      for (let j = batch.length - 1; j > 0; j--) {
        const k = Math.floor(random() * (j + 1))
        const swap = batch[j]; batch[j] = batch[k]; batch[k] = swap
      }
      applyOps(sites[i], batch)
    }
  }

  // Everything still in the post gets through in the end.
  for (let i = 0; i < siteCount; i++) if (outbox[i].length) applyOps(sites[i], outbox[i])

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
applyOps(late, wire(snapshot(busy)))
check('a snapshot carries the deletions too', docText(late), docText(busy))
ok('and the tombstones came with it', tombstones(late) > 0, `${tombstones(late)}`)

/* ---------------- nothing falls over ---------------- */

const deep = createDoc('a')
setDocText(deep, 'x'.repeat(20000))
check('a long document survives being walked', docText(deep).length, 20000)
setDocText(deep, '')
check('and being emptied', docText(deep), '')

check('nonsense ops are ignored', applyOps(createDoc('a'), [null, {}, { t: 'ins' }, { t: 'nope', id: ['a', 1] }]), false)
check('and so is nothing at all', applyOps(createDoc('a'), null), false)

// An orphan that never gets its parent stays out rather than corrupting anything.
const orphaned = docFromText('a', 'AB')
applyOps(orphaned, [{ t: 'ins', id: ['q', 9], parent: ['q', 8], ch: 'Z' }])
check('an insert with no parent waits', docText(orphaned), 'AB')

console.log(failed === 0 ? 'crdt: all checks passed' : `crdt: ${failed} FAILED`)
