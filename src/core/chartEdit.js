/**
 * Changing the chart without typing it.
 *
 * The chart is text -- three layers with a real `<textarea>` on top, and every
 * token carrying the character range it came from (@see score.js). So every
 * one of these is a text edit, and every one of them is expressed the same
 * way: a splice saying replace `[from, to)` with this.
 *
 * A splice rather than a whole new document, for two reasons. It can be
 * applied to a string, which is what makes these testable without a browser;
 * and it can be applied by selecting that range and inserting once, which is
 * what makes the browser record it as a single undo step. Handing the editor a
 * whole new document instead sets `field.value`, and setting `value` throws the
 * native undo stack away -- which is how binding a phrase to a chord came to
 * cost somebody their undo history. @see components/ChordCanvas.vue insertText
 *
 * Every function here returns a splice, or null when there is nothing to do.
 * Nothing here knows about the DOM, the store, or Vue.
 */

/** Replace `[from, to)` with `text`. */
export function applyEdit(text, edit) {
  if (!edit) return String(text)
  return String(text).slice(0, edit.from) + edit.text + String(text).slice(edit.to)
}

/** Where the caret should sit once an edit has been applied. */
export function caretAfter(edit) {
  return edit ? edit.from + edit.text.length : -1
}

/**
 * Take a chord out, and the space that would be left behind with it.
 *
 * Two spaces where there was one is the thing that actually goes wrong when
 * something is removed from the middle of a line, so the space after goes too.
 * Never a bar line: a `|` is the shape of the song rather than a separator,
 * and in a barred chart removing one would change how long a bar is -- which
 * is not what deleting a chord means.
 *
 * At the end of a line there is no space after to take, so the one before goes
 * instead; otherwise the line is left with a trailing space.
 */
export function deleteToken(text, token) {
  if (!token) return null
  const src = String(text)
  let from = token.start
  let to = token.end

  if (src[to] === ' ') to += 1
  else if (src[from - 1] === ' ') from -= 1

  return { from, to, text: '' }
}

/**
 * Write a different chord in the same place.
 *
 * Over the *body* only, so everything the word carries comes through
 * untouched: the `.` that marks a phrase change, the `{articulation}` bound to
 * it, and the `:` of a repeat that opens on this chord. Somebody changing a
 * Dm7 to a G7 has not asked to lose the articulation they put on it.
 */
export function setChordSymbol(text, token, symbol) {
  if (!token) return null
  const wanted = String(symbol || '').trim()
  if (!wanted) return null
  const src = String(text)
  if (src.slice(token.bodyStart, token.bodyEnd) === wanted) return null
  return { from: token.bodyStart, to: token.bodyEnd, text: wanted }
}

/**
 * Give a chord an articulation, or change the one it has.
 *
 * The whole word is rewritten rather than the `{...}` alone, because a chord
 * that has no articulation yet has no `{...}` to rewrite and needs the leading
 * dot as well. One splice either way, which is one undo step either way.
 * @see phrases.js bindPhraseInText, which says the same thing as a document.
 */
export function setArticulation(text, token, name) {
  if (!token) return null
  const wanted = String(name || '').trim()
  const body = token.body
  const marked = wanted ? `.${body}{${wanted}}` : `.${body}`
  const src = String(text)
  if (src.slice(token.start, token.end) === marked) return null
  return { from: token.start, to: token.end, text: marked }
}

/** Take the articulation off, and the phrase-change dot with it. */
export function removeArticulation(text, token) {
  if (!token) return null
  const src = String(text)
  if (src.slice(token.start, token.end) === token.body) return null
  return { from: token.start, to: token.end, text: token.body }
}

/** Write a different drum pattern into a `[d:...]` mark. */
export function setDrumPattern(text, token, name) {
  if (!token) return null
  const wanted = String(name || '').trim()
  if (!wanted) return null
  const marked = `[d:${wanted}]`
  const src = String(text)
  if (src.slice(token.start, token.end) === marked) return null
  return { from: token.start, to: token.end, text: marked }
}

/**
 * Put something new in, with the spaces it needs and no more.
 *
 * Inserting into a chart is mostly a question of whether a space is wanted on
 * either side, and the answer is "unless there is one already, or the line
 * ends there". Getting it wrong is how a chart ends up with double spaces that
 * the parser reads as empty bars.
 */
export function insertAt(text, index, snippet) {
  const wanted = String(snippet || '').trim()
  if (!wanted) return null
  const src = String(text)
  const at = Math.max(0, Math.min(index, src.length))

  const before = src[at - 1]
  const after = src[at]
  const needsBefore = at > 0 && before !== ' ' && before !== '\n' && before !== undefined
  const needsAfter = after !== undefined && after !== ' ' && after !== '\n'

  return {
    from: at,
    to: at,
    text: `${needsBefore ? ' ' : ''}${wanted}${needsAfter ? ' ' : ''}`,
  }
}
