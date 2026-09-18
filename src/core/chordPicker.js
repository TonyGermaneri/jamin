/**
 * What the chord picker offers: a wheel of fifths, and the colourings.
 *
 * Only the vocabulary lives here -- no component, no DOM. It is a list because
 * the arrangement is the design: the wheel is in fifths because that is the
 * order chords actually move in, and the qualities are grouped by what they
 * are rather than alphabetically, so `sus2` is next to `sus4` and the
 * diminished family is in one row.
 *
 * Everything offered has to be something the parser reads. There is a check
 * that walks every entry here through `parseChord` and fails if any of it is
 * a symbol jamin cannot play -- a picker that writes an unparseable chord into
 * somebody's chart is worse than no picker. @see tests/chartEdit.test.js
 */

/**
 * The twelve places on the wheel, clockwise from C.
 *
 * Two names where a place has two: the sharp side and the flat side of the
 * wheel meet at the bottom, and which spelling is right there is a question
 * about the key rather than about the note. Both are offered and the one
 * clicked is the one written.
 */
export const WHEEL = [
  { pc: 0, names: ['C'] },
  { pc: 7, names: ['G'] },
  { pc: 2, names: ['D'] },
  { pc: 9, names: ['A'] },
  { pc: 4, names: ['E'] },
  { pc: 11, names: ['B', 'Cb'] },
  { pc: 6, names: ['F#', 'Gb'] },
  { pc: 1, names: ['C#', 'Db'] },
  { pc: 8, names: ['G#', 'Ab'] },
  { pc: 3, names: ['D#', 'Eb'] },
  { pc: 10, names: ['A#', 'Bb'] },
  { pc: 5, names: ['F'] },
]

/**
 * The colourings, four across and five down, twice.
 *
 * Grouped by family reading left to right and down: the plain triads and
 * sevenths first, because they are most of every chart; then the sixths, then
 * the diminished and augmented family together, then the suspensions, then the
 * extensions. The last cell of the first page opens the second.
 *
 * `''` is a major triad -- what you get by writing the root on its own -- and
 * is shown as `maj` so the cell is not an empty box.
 */
export const QUALITIES = [
  [
    { write: '', show: 'maj' }, { write: 'm', show: 'm' },
    { write: '7', show: '7' }, { write: 'maj7', show: 'maj7' },

    { write: 'm7', show: 'm7' }, { write: 'mMaj7', show: 'mMaj7' },
    { write: '6', show: '6' }, { write: 'm6', show: 'm6' },

    { write: 'dim', show: 'dim' }, { write: 'dim7', show: 'dim7' },
    { write: 'm7b5', show: 'm7♭5' }, { write: 'aug', show: 'aug' },

    { write: 'sus2', show: 'sus2' }, { write: 'sus4', show: 'sus4' },
    { write: '7sus4', show: '7sus4' }, { write: 'add9', show: 'add9' },

    { write: '9', show: '9' }, { write: 'm9', show: 'm9' },
    { write: '13', show: '13' }, { more: true, show: '…' },
  ],
  [
    { write: 'maj9', show: 'maj9' }, { write: 'maj13', show: 'maj13' },
    { write: '11', show: '11' }, { write: 'm11', show: 'm11' },

    { write: 'm13', show: 'm13' }, { write: '69', show: '6/9' },
    { write: 'm69', show: 'm6/9' }, { write: 'add11', show: 'add11' },

    { write: '7b9', show: '7♭9' }, { write: '7#9', show: '7♯9' },
    { write: '7b5', show: '7♭5' }, { write: '7#5', show: '7♯5' },

    { write: '7#11', show: '7♯11' }, { write: '13#11', show: '13♯11' },
    { write: 'maj7#11', show: 'maj7♯11' }, { write: 'alt', show: 'alt' },

    { write: 'power', show: '5' }, { write: '7sus2', show: '7sus2' },
    { write: 'add13', show: 'add13' }, { back: true, show: '‹' },
  ],
]

/**
 * The marks that are not chords.
 *
 * A slot in a chart can hold things that have no root and no colouring -- hold
 * the last chord, repeat the last bar, no chord at all. They belong in the
 * same picker because they answer the same question: what goes here. A small
 * table under the wheel, rather than a row of the quality grid, because they
 * are a different kind of answer.
 */
export const MARKS = [
  { write: '/', show: '/', what: 'hold the chord for another beat' },
  { write: '%', show: '%', what: 'the same as the bar before' },
  { write: 'x', show: 'x', what: 'the same as the last two bars' },
  { write: 'N.C.', show: 'N.C.', what: 'no chord' },
]

/** The symbol a root and a colouring make together. */
export function chordSymbol(root, quality) {
  return `${root}${quality || ''}`
}
