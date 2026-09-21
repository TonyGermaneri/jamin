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
 * One name each. It offered both spellings where a place has two -- `B` and
 * `Cb`, `F#` and `Gb` -- on the reasoning that which is right is a question
 * about the key. True, and it made five of the twelve places two tiny
 * targets stacked on each other, to answer a question nobody asked at the
 * moment of pointing at a note. The chart is text: somebody who wants `Gb`
 * writes `Gb`.
 *
 * The one kept is the one lead sheets use. Sharps up the sharp side as far
 * as F#, flats down the flat side -- which is where the circle of fifths
 * has put the join since the eighteenth century.
 *
 * `natural` says which ring it is drawn on: the seven naturals outside, the
 * five accidentals inside. @see canvas/chordWheel.js
 */
export const WHEEL = [
  { pc: 0, name: 'C', natural: true },
  { pc: 7, name: 'G', natural: true },
  { pc: 2, name: 'D', natural: true },
  { pc: 9, name: 'A', natural: true },
  { pc: 4, name: 'E', natural: true },
  { pc: 11, name: 'B', natural: true },
  { pc: 6, name: 'F#', natural: false },
  { pc: 1, name: 'Db', natural: false },
  { pc: 8, name: 'Ab', natural: false },
  { pc: 3, name: 'Eb', natural: false },
  { pc: 10, name: 'Bb', natural: false },
  { pc: 5, name: 'F', natural: true },
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
