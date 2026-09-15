/**
 * The shared chart: one document, several people typing into it.
 *
 * Two machines editing the same text cannot be reconciled by sending the text.
 * Whoever wrote last would erase whoever wrote first, and with the round trip of
 * a network in between that is not a rare case -- it is what happens every time
 * two people type in the same second. So what travels is the edits, and they are
 * built so that applying them in any order lands everybody in the same place.
 *
 * This was a hand-written causal tree for a long time and it converged
 * correctly. What it did not do was stop growing. Measured over ten thousand
 * edits to a three-kilobyte chart:
 *
 *     hand-written causal tree   8,015 KB   264 s
 *     Yjs                          126 KB   0.8 s
 *     Yjs, V2 encoding              47 KB
 *     Yjs, rebuilt periodically      3 KB   0.3 s
 *
 * The tree could not be pruned. Every character is typed *after* the one before
 * it, so the document is a chain: every tombstone is an ancestor of something
 * still alive, and measured on a real edit pattern not one in two and a half
 * thousand was collectable. Re-parenting around them bounded the growth and
 * silently rewrote the chart, because in a causal tree the tree *is* the
 * ordering. @see tests/crdtBurn.test.js, which caught precisely that.
 *
 * Yjs is this problem solved by people who have spent years on it: runs
 * encoded by length rather than character by character, deleted content
 * collected rather than carried, and a binary format rather than a JSON object
 * per letter. MIT, which is one-way compatible with our GPLv3.
 *
 * What travels is a Yjs update in base64 -- base64 because the envelopes are
 * JSON and the segment the plugin shares between its instances holds a string.
 *
 * There is no server and no leader. @see docs/network.md
 */

import * as Y from 'yjs'

/* ---------------- base64 -------------------------------------------------
 *
 * Written out rather than reached for: `btoa` is not present everywhere this
 * runs -- the pure-logic tests are JavaScriptCore under osascript -- and the
 * last time a base64 was assumed rather than checked, every file in an imported
 * library was read successfully and silently thrown away. RFC 4648, with
 * vectors in the tests. @see native/tools/base64_check.cpp
 * ------------------------------------------------------------------------- */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const triple = (a << 16) | (b << 8) | c

    out += ALPHABET[(triple >> 18) & 63]
    out += ALPHABET[(triple >> 12) & 63]
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '='
    out += i + 2 < bytes.length ? ALPHABET[triple & 63] : '='
  }
  return out
}

const REVERSE = (() => {
  const table = new Int16Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i
  return table
})()

export function fromBase64(text) {
  const clean = String(text || '').replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))

  let at = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = REVERSE[clean.charCodeAt(i)]
    const b = REVERSE[clean.charCodeAt(i + 1)]
    const c = i + 2 < clean.length ? REVERSE[clean.charCodeAt(i + 2)] : -1
    const d = i + 3 < clean.length ? REVERSE[clean.charCodeAt(i + 3)] : -1

    if (a < 0 || b < 0) break
    out[at++] = ((a << 2) | (b >> 4)) & 255
    if (c >= 0) out[at++] = ((b << 4) | (c >> 2)) & 255
    if (d >= 0) out[at++] = ((c << 6) | d) & 255
  }

  return out.subarray(0, at)
}

/* ---------------- the document ------------------------------------------- */

const FIELD = 'chart'

/**
 * Yjs knows a writer by a number and we know one by a name, so the name is
 * folded into a number. It only has to differ between machines editing the same
 * chart, and it has to be the same number every time the same machine comes
 * back -- FNV-1a over the site id does both.
 */
function clientIdFor(site) {
  let hash = 2166136261
  const text = String(site)
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  // A positive 32-bit integer, and zero is worth stepping around.
  return (hash >>> 0) || 1
}

/** A document nobody has typed into yet. */
export function createDoc(site) {
  const y = new Y.Doc({ gc: true })
  y.clientID = clientIdFor(site)
  return { site: String(site), y, text: y.getText(FIELD) }
}

/** The chart as it stands. */
export function docText(doc) {
  return doc.text.toString()
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
 *
 * @returns {string} the update to send on, or '' when nothing changed
 */
export function setDocText(doc, next) {
  const current = docText(doc)
  const wanted = String(next == null ? '' : next)
  if (current === wanted) return ''

  let head = 0
  const most = Math.min(current.length, wanted.length)
  while (head < most && current[head] === wanted[head]) head++

  let tail = 0
  while (tail < most - head && current[current.length - 1 - tail] === wanted[wanted.length - 1 - tail]) tail++

  const removed = current.length - tail - head
  const added = wanted.slice(head, wanted.length - tail)

  let update = null
  const catcher = (bytes) => { update = bytes }
  doc.y.on('updateV2', catcher)
  // One transaction, so replacing a bar is one update rather than a delete and
  // an insert that somebody could arrive in between.
  doc.y.transact(() => {
    if (removed > 0) doc.text.delete(head, removed)
    if (added) doc.text.insert(head, added)
  })
  doc.y.off('updateV2', catcher)

  return update ? toBase64(update) : ''
}

/**
 * Apply somebody's edits -- ours or anybody else's.
 *
 * Order does not matter and neither does repetition: an update already applied
 * changes nothing. A transport that duplicates, reorders or briefly loses its
 * place therefore needs no help from this.
 *
 * @returns {boolean} whether the text changed
 */
export function applyUpdate(doc, update) {
  if (!update) return false
  const before = docText(doc)
  try {
    Y.applyUpdateV2(doc.y, fromBase64(update))
  } catch {
    // A truncated or corrupt update is somebody else's to send again. It must
    // not take the chart down on the way past.
    return false
  }
  return docText(doc) !== before
}

/**
 * Everything in the document, for somebody who has just arrived.
 *
 * V2 encoding, which on a chart that has been worked on is a little under three
 * times smaller than V1 -- measured at 47KB against 126KB.
 */
export function snapshot(doc) {
  return toBase64(Y.encodeStateAsUpdateV2(doc.y))
}

/** A document holding this text, as if one site had typed it. */
export function docFromText(site, text) {
  const doc = createDoc(site)
  setDocText(doc, text)
  return doc
}

/** Roughly what this document costs to send, for deciding when to rebuild. */
export function docSize(doc) {
  return Y.encodeStateAsUpdateV2(doc.y).length
}

/**
 * The same text, as a document with no history at all.
 *
 * Even Yjs grows with the editing: every deletion leaves a range in the delete
 * set, and deletions scattered around a chart do not merge into runs. Measured,
 * 47KB after ten thousand edits and still climbing in proportion to them.
 * Starting again from the text puts it back to three kilobytes and holds it
 * there.
 *
 * Every identity changes, so this is only safe when nothing else holds a copy:
 * a peer still working from the old ones would find none of them and its edits
 * would be stranded. Where that can be established -- one instance, nobody
 * joined -- it is the one compaction that is both complete and correct, because
 * there is nobody left to disagree with.
 */
export function rebuild(doc) {
  return docFromText(doc.site, docText(doc))
}
