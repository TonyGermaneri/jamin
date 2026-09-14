/**
 * The shared chart: one document, several people typing into it.
 *
 * Two machines editing the same text cannot be reconciled by sending the text.
 * Whoever wrote last would erase whoever wrote first, and with the round trip of
 * a network in between that is not a rare case -- it is what happens every time
 * two people type in the same second. So what travels is the edits, and they are
 * built so that applying them in any order lands everybody in the same place.
 *
 * This is a causal tree (an RGA). Every character carries an id that is unique
 * for all time -- the site that typed it and a counter -- and a parent: the id
 * of the character it was typed after. The document is that tree walked
 * depth-first, with a node's children ordered by id, newest first. Two people
 * inserting at the same spot therefore interleave the same way on every machine,
 * without anybody having to agree in advance who went first.
 *
 * Deleting leaves the character in place and marks it, because a later insert
 * may still name it as a parent. That is a tombstone, and they accumulate: a
 * document edited all day grows even if its text does not. For a chord chart
 * that is nothing, and it is worth knowing rather than discovering.
 *
 * There is no server and no leader. @see docs/network.md
 */

/** The key every top-level character hangs from. Not a character itself. */
const ROOT = '@'

const keyOf = (id) => `${id[0]}:${id[1]}`

/**
 * Which of two ids sorts first.
 *
 * Counter first, so a later edit takes the earlier position at the same point,
 * then the site id to break a tie. Any consistent rule will do for the tie; it
 * only has to be the same rule everywhere.
 */
function compareIds(a, b) {
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
}

/** A document nobody has typed into yet. */
export function createDoc(site) {
  return {
    site: String(site),
    counter: 0,
    nodes: new Map(), // key -> { id, parent, ch, deleted }
    children: new Map(), // parent key -> [child key], newest first
    orphans: new Map(), // parent key -> [insert ops waiting for it]
    // Deletes can outrun the insert they remove: reordered delivery, or a
    // snapshot taken between the two. Dropping one would put the character
    // back, so the deletion is remembered until the character turns up.
    pendingDeletes: new Set(),
  }
}

function place(doc, node) {
  const parentKey = node.parent === null ? ROOT : keyOf(node.parent)
  const siblings = doc.children.get(parentKey) || []

  // Newest first, so a later insert at the same point comes earlier in the
  // text. Every site does this with the same comparison and so agrees.
  let at = 0
  while (at < siblings.length) {
    const other = doc.nodes.get(siblings[at])
    if (compareIds(other.id, node.id) < 0) break
    at++
  }

  const key = keyOf(node.id)
  if (doc.pendingDeletes.delete(key)) node.deleted = true

  siblings.splice(at, 0, key)
  doc.children.set(parentKey, siblings)
  doc.nodes.set(key, node)
}

/**
 * Apply somebody's edits -- ours or anybody else's.
 *
 * Order does not matter and neither does repetition: an op already applied is
 * ignored, and an insert whose parent has not arrived yet is held until it does.
 * A transport that duplicates, reorders or briefly loses its place therefore
 * needs no help from this.
 *
 * @returns {boolean} whether the text changed
 */
export function applyOps(doc, ops) {
  let changed = false

  for (const op of ops || []) {
    if (!op || !op.id) continue

    if (op.t === 'del') {
      const node = doc.nodes.get(keyOf(op.id))
      if (node) {
        if (!node.deleted) {
          node.deleted = true
          changed = true
        }
      } else {
        doc.pendingDeletes.add(keyOf(op.id))
      }
      continue
    }

    if (op.t !== 'ins' || typeof op.ch !== 'string') continue
    if (doc.nodes.has(keyOf(op.id))) continue // already have it

    const parentKey = op.parent === null ? ROOT : keyOf(op.parent)
    if (op.parent !== null && !doc.nodes.has(parentKey)) {
      // Out of order: hold it until the character it was typed after arrives.
      const waiting = doc.orphans.get(parentKey) || []
      waiting.push(op)
      doc.orphans.set(parentKey, waiting)
      continue
    }

    place(doc, { id: op.id, parent: op.parent, ch: op.ch, deleted: false })
    changed = true

    // Keep our counter ahead of everything we have seen, so the next id we
    // mint is new to everybody rather than only to us.
    if (op.id[1] > doc.counter) doc.counter = op.id[1]

    // Anything that was waiting on this one can go in now, and so on.
    const pending = doc.orphans.get(keyOf(op.id))
    if (pending) {
      doc.orphans.delete(keyOf(op.id))
      applyOps(doc, pending)
    }
  }

  return changed
}

/**
 * The text, and the id of each character in it.
 *
 * Walked with an explicit stack rather than recursively: a chart is one
 * character per level -- each typed after the one before it -- so a recursive
 * walk would be as deep as the document is long and would fall over on a chart
 * nobody would think twice about writing.
 */
function walk(doc) {
  const text = []
  const ids = []
  const stack = [[ROOT, 0]]

  while (stack.length) {
    const frame = stack[stack.length - 1]
    const siblings = doc.children.get(frame[0])

    if (!siblings || frame[1] >= siblings.length) {
      stack.pop()
      continue
    }

    const key = siblings[frame[1]++]
    const node = doc.nodes.get(key)
    if (!node) continue

    if (!node.deleted) {
      text.push(node.ch)
      ids.push(node.id)
    }
    stack.push([key, 0])
  }

  return { text: text.join(''), ids }
}

/** What the document says. */
export function docText(doc) {
  return walk(doc).text
}

/** How many characters are being kept only because something might name them. */
export function tombstones(doc) {
  let count = 0
  for (const node of doc.nodes.values()) if (node.deleted) count++
  return count
}

function nextId(doc) {
  doc.counter += 1
  return [doc.site, doc.counter]
}

/**
 * Bring the document to this text, and say what that took.
 *
 * The editor hands over a whole string rather than a list of edits -- it is a
 * text area, and a whole string is what a text area knows. So the change is
 * recovered by comparing: a common prefix, a common suffix, and whatever differs
 * between them is a delete and an insert. For typing that is one character, for
 * a paste it is the pasted run, and for an edit three lines away it leaves
 * everything else alone -- which is the part that matters when somebody else is
 * typing at the same time.
 */
export function setDocText(doc, next) {
  const { text: current, ids } = walk(doc)
  const wanted = String(next == null ? '' : next)
  if (current === wanted) return []

  let head = 0
  const most = Math.min(current.length, wanted.length)
  while (head < most && current[head] === wanted[head]) head++

  let tail = 0
  while (tail < most - head && current[current.length - 1 - tail] === wanted[wanted.length - 1 - tail]) tail++

  const removed = ids.slice(head, current.length - tail)
  const added = wanted.slice(head, wanted.length - tail)
  const ops = []

  for (const id of removed) {
    const node = doc.nodes.get(keyOf(id))
    if (node && !node.deleted) {
      node.deleted = true
      ops.push({ t: 'del', id })
    }
  }

  // Typed after whatever is still to the left of the change -- the character
  // before it, not a position. Positions move when somebody else types; a
  // character does not.
  let parent = head > 0 ? ids[head - 1] : null

  for (const ch of added) {
    const id = nextId(doc)
    place(doc, { id, parent, ch, deleted: false })
    ops.push({ t: 'ins', id, parent, ch })
    parent = id
  }

  return ops
}

/**
 * Everything in the document, for somebody who has just arrived.
 *
 * Emitted depth-first in document order, so every parent comes before its
 * children and the receiver never has to hold anything back.
 */
export function snapshot(doc) {
  const ops = []
  const stack = [[ROOT, 0]]

  while (stack.length) {
    const frame = stack[stack.length - 1]
    const siblings = doc.children.get(frame[0])
    if (!siblings || frame[1] >= siblings.length) {
      stack.pop()
      continue
    }

    const key = siblings[frame[1]++]
    const node = doc.nodes.get(key)
    if (!node) continue

    ops.push({ t: 'ins', id: node.id, parent: node.parent, ch: node.ch })
    if (node.deleted) ops.push({ t: 'del', id: node.id })
    stack.push([key, 0])
  }

  return ops
}

/** A document holding this text, as if one site had typed it. */
export function docFromText(site, text) {
  const doc = createDoc(site)
  setDocText(doc, text)
  return doc
}
