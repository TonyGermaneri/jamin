/**
 * Shorthand chord parser.
 *
 * Reads the kind of thing you'd scribble on a napkin -- `A- C B5 Dii C7ii Gm Amin
 * A Amaj Amajor` -- and turns it into a root plus a stack of intervals measured in
 * semitones above that root.  Intervals are deliberately NOT reduced mod 12: a 9th
 * stays at 14 so the voicer knows to put it above the 7th.
 *
 * Grammar, loosely:
 *
 *     root  := [A-G] accidental*
 *     chord := root quality? extension? modifier* inversion? ('/' root)?
 *
 * Inversions are the roman-numeral suffixes: `i` 1st, `ii` 2nd, `iii` 3rd.
 */

const LETTER_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const SHARP = /[#♯]/
const FLAT = /[b♭]/

export const PC_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const PC_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Default harmonic conventions. Overridable per-call from the settings store. */
export const DEFAULT_CONVENTIONS = {
  // A dominant 11 with a major 3rd grinds the 3rd against the 11th; drop the 3rd.
  omitThirdOnDominant11: true,
  // 13 chords conventionally skip the natural 11 for the same reason.
  omitElevenOnThirteen: true,
}

/* ------------------------------------------------------------------ *
 * Suffix token table
 * ------------------------------------------------------------------ */

// `cs: true` means the token is matched case-sensitively -- that is the only way
// to keep `M` (major) and `m` (minor) apart.
const TOKENS = [
  // minor-major, before plain minor/major so the longer spelling wins
  ...expand(['minormajor', 'minmaj', 'mmaj', 'minmaj7', '-maj', '-Δ', '-^'], minorMajor),
  { t: 'mM', cs: true, fn: minorMajor },
  { t: '-M', cs: true, fn: minorMajor },

  ...expand(['halfdiminished', 'halfdim', 'hdim', 'ø', 'Ø'], halfDim),
  ...expand(['diminished', 'dim'], dim),
  { t: '°', fn: dim },
  { t: 'o', cs: true, fn: dim },
  ...expand(['augmented', 'aug'], aug),
  { t: '+', fn: aug },

  ...expand(['major', 'maj', 'ma'], major),
  { t: 'Δ', fn: major },
  { t: '^', fn: major },
  { t: 'M', cs: true, fn: major },

  ...expand(['minor', 'min', 'mi'], minor),
  { t: 'm', cs: true, fn: minor },
  { t: '-', fn: minor },

  ...expand(['sus2', 'sus9'], (s) => { s.sus = 2 }),
  ...expand(['sus4', 'sus11', 'sus'], (s) => { s.sus = 5 }),
  ...expand(['power'], (s) => { s.omit.add(3) }),
  // Dominant is already the default quality, but people write it out anyway.
  ...expand(['dominant', 'dom'], () => {}),

  ...expand(['add9', 'add2'], (s) => { s.adds.push(14) }),
  ...expand(['add11', 'add4'], (s) => { s.adds.push(17) }),
  ...expand(['add13', 'add6'], (s) => { s.adds.push(21) }),

  ...expand(['no3', 'omit3'], (s) => { s.omit.add(3) }),
  ...expand(['no5', 'omit5'], (s) => { s.omit.add(5) }),
  ...expand(['no7', 'omit7'], (s) => { s.omit.add(7) }),

  ...expand(['alt'], (s) => {
    s.seventh = 10
    s.adds.push(13, 15, 18, 20)
    s.omit.add(5)
    s.quality = 'altered'
  }),

  ...expand(['b5'], (s) => { s.alter[5] = 6 }),
  ...expand(['#5', '+5'], (s) => { s.alter[5] = 8 }),
  ...expand(['b9'], (s) => { s.alter[9] = 13; s.touch(9) }),
  ...expand(['#9', '+9'], (s) => { s.alter[9] = 15; s.touch(9) }),
  ...expand(['b11'], (s) => { s.alter[11] = 16; s.touch(11) }),
  ...expand(['#11', '+11', '#4'], (s) => { s.alter[11] = 18; s.touch(11) }),
  ...expand(['b13', 'b6'], (s) => { s.alter[13] = 20; s.touch(13) }),
  ...expand(['#13'], (s) => { s.alter[13] = 22; s.touch(13) }),

  ...expand(['6/9', '69'], (s) => { s.sixth = true; s.adds.push(14) }),
  ...expand(['13'], (s) => { s.seventh = seventhFor(s); s.extTop = 13 }),
  ...expand(['11'], (s) => { s.seventh = seventhFor(s); s.extTop = 11 }),
  ...expand(['9'], (s) => { s.seventh = seventhFor(s); s.extTop = Math.max(s.extTop, 9) }),
  ...expand(['7'], (s) => { s.seventh = seventhFor(s) }),
  ...expand(['6'], (s) => { s.sixth = true }),
  // Bare 5 and 3 are "triad without the degree that isn't written".
  ...expand(['5'], (s) => { s.omit.add(3) }),
  // Harte's `1` is the root on its own.
  ...expand(['1'], (s) => { s.omit.add(3); s.omit.add(5) }),
  ...expand(['3'], (s) => { s.omit.add(5) }),
  ...expand(['4'], (s) => { s.sus = 5 }),
  ...expand(['2'], (s) => { s.sus = 2 }),
].sort((a, b) => b.t.length - a.t.length)

function expand(list, fn) {
  return list.map((t) => ({ t, cs: false, fn }))
}

function minor(s) { s.third = 3; s.quality = 'minor' }
function major(s) { s.majorSeventh = true; if (s.quality === 'major') s.quality = 'major' }
function minorMajor(s) { s.third = 3; s.majorSeventh = true; s.seventh = 11; s.quality = 'minor-major' }
function dim(s) { s.third = 3; s.fifth = 6; s.diminished = true; s.quality = 'diminished' }
function halfDim(s) { s.third = 3; s.fifth = 6; s.seventh = 10; s.quality = 'half-diminished' }
function aug(s) { s.fifth = 8; s.quality = 'augmented' }

function seventhFor(s) {
  if (s.majorSeventh) return 11
  if (s.diminished) return 9
  return 10
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * Split a raw chord word into its root and everything after it.
 *
 * Sharps may be written `#`, `♯` or `s`; flats `b` or `♭`.  Accidentals glued to
 * the letter always belong to the root, so `Bb5` is a B-flat power chord -- write
 * `B(b5)` when you mean B with a flattened fifth.
 *
 * The one place `s` could be misread is `sus`: `Fsus4` is F suspended, not F#
 * followed by nonsense.  So an `s` counts as a sharp unless `sus` starts there.
 * `F#sus4` is spelled `Fssus4` (or just `F#sus4`), which stays unambiguous
 * because the first `s` is not followed by `us`.
 */
function readRoot(text) {
  const first = /^[A-Ga-g]/.exec(text)
  if (!first) return null

  let pc = LETTER_PC[text[0].toLowerCase()]
  let accidental = ''
  let i = 1
  let flats = 0

  while (i < text.length) {
    const ch = text[i]
    if (ch === '#' || ch === '♯') {
      pc += 1
      accidental += '#'
      i += 1
    } else if (ch === 'b' || ch === '♭') {
      pc -= 1
      accidental += 'b'
      flats += 1
      i += 1
    } else if ((ch === 's' || ch === 'S') && !/^sus/i.test(text.slice(i))) {
      pc += 1
      accidental += '#'
      i += 1
    } else {
      break
    }
  }

  return {
    pc: ((pc % 12) + 12) % 12,
    name: text[0].toUpperCase() + accidental,
    length: i,
    prefersFlat: flats > 0,
  }
}

/** `N`, `NC`, `N.C.` -- a bar with no chord in it. */
const NO_CHORD = /^(n|nc|n\.c\.|no ?chord|silence|rest)$/i

/**
 * Harte writes the bass as a scale degree rather than a note name: `C:maj/5` is
 * C major over G.  Only read that way for chords written in Harte form, because
 * outside it `C6/9` is the six-nine chord and not C6 over a ninth.
 */
const DEGREE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 }

function readDegree(text) {
  const m = /^([#b]?)(\d{1,2})$/.exec(text)
  if (!m) return null
  const base = DEGREE_SEMITONES[Number(m[2])]
  if (base === undefined) return null
  return base + (m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0)
}

/**
 * Harte writes added and omitted degrees in parentheses: `C:maj(9)` is a major
 * triad plus a ninth, not a major ninth chord, and `C:maj(*5)` drops the fifth.
 * Only applied when a `:` marked the word as Harte, so `C(9)` keeps meaning what
 * it always did here.
 */
function expandHarteParens(suffix) {
  return suffix.replace(/\(([^)]*)\)/g, (_, body) =>
    body
      .split(',')
      .map((part) => harteDegree(part.trim()))
      .join('')
  )
}

function harteDegree(part) {
  if (!part) return ''
  if (part.startsWith('*')) return `no${part.slice(1).replace(/[#b]/g, '')}`
  if (/^b7$/i.test(part)) return '7'
  if (/^7$/.test(part)) return 'maj7'
  if (/^[#b]/.test(part)) return part
  return `add${part}`
}

/**
 * Peel a trailing roman-numeral inversion off the suffix.
 *
 * The one genuinely ambiguous case is `Cmi`, which is C minor rather than C major
 * in first inversion -- a bare `i` directly after an `m` is read as the minor
 * spelling.  Use `C-i` or `Cmini` if you want the inversion.
 */
function readInversion(suffix) {
  const m = /(i{1,3})$/.exec(suffix)
  if (!m) return { suffix, inversion: 0 }
  const head = suffix.slice(0, suffix.length - m[1].length)
  if (m[1] === 'i' && /m$/i.test(head)) return { suffix, inversion: 0 }
  return { suffix: head, inversion: m[1].length }
}

function readBass(suffix, rootPc, harte) {
  const idx = suffix.lastIndexOf('/')
  if (idx < 0) return { suffix, bass: null }
  const tail = suffix.slice(idx + 1)

  if (/^[A-Ga-g](?:#|♯|b|♭|s|S)*$/.test(tail)) {
    const note = readRoot(tail)
    if (note && note.length === tail.length) return { suffix: suffix.slice(0, idx), bass: note }
  }

  const degree = harte ? readDegree(tail) : null
  if (degree !== null) {
    const pc = (((rootPc + degree) % 12) + 12) % 12
    return { suffix: suffix.slice(0, idx), bass: { pc, name: pcName(pc), length: tail.length, prefersFlat: false } }
  }

  return { suffix, bass: null }
}

function newState() {
  const state = {
    third: 4,
    fifth: 7,
    sixth: false,
    seventh: null,
    extTop: 0,
    sus: null,
    adds: [],
    alter: {},
    omit: new Set(),
    majorSeventh: false,
    diminished: false,
    quality: 'major',
    touched: new Set(),
  }
  state.touch = (degree) => state.touched.add(degree)
  return state
}

/**
 * Parse one chord word (no leading `.`, no trailing `{phrase}` -- the score
 * tokenizer strips those first).
 *
 * @returns {{ok: boolean}} on failure, otherwise a full chord description.
 */
export function parseChord(text, conventions = DEFAULT_CONVENTIONS) {
  const raw = String(text || '').trim()
  if (!raw) return { ok: false, text: raw, error: 'empty' }

  // A bar with nothing in it still takes up time.
  if (NO_CHORD.test(raw)) {
    return {
      ok: true,
      silent: true,
      text: raw,
      rootPc: null,
      rootName: 'N.C.',
      prefersFlat: false,
      quality: 'no chord',
      intervals: [],
      pcs: [],
      absPcs: [],
      inversion: 0,
      bassPc: null,
      bassName: null,
      tokens: [],
    }
  }

  const root = readRoot(raw)
  if (!root) return { ok: false, text: raw, error: 'no root' }

  let suffix = raw.slice(root.length)
  // Harte separates root from quality with a colon: `C:maj7`, `A:7`.
  const harte = suffix.startsWith(':')
  if (harte) suffix = expandHarteParens(suffix.slice(1))
  suffix = suffix.replace(/[()\s]/g, '').replace(/no3d/gi, 'no3')

  const bassRead = readBass(suffix, root.pc, harte)
  suffix = bassRead.suffix
  const invRead = readInversion(suffix)
  suffix = invRead.suffix

  const state = newState()
  const consumed = []
  let i = 0
  while (i < suffix.length) {
    const token = matchToken(suffix, i)
    if (!token) {
      return { ok: false, text: raw, error: `unexpected "${suffix.slice(i)}"`, errorAt: i }
    }
    token.fn(state)
    consumed.push(token.t)
    i += token.t.length
  }

  const intervals = buildIntervals(state, conventions)
  // `pcs` is root-relative (that is how the chord dictionary indexes sets);
  // `absPcs` is the actual pitch classes, which is what voice leading needs.
  const pcs = [...new Set(intervals.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b)
  const absPcs = [...new Set(pcs.map((n) => (n + root.pc) % 12))].sort((a, b) => a - b)

  return {
    ok: true,
    text: raw,
    rootPc: root.pc,
    rootName: root.name,
    prefersFlat: root.prefersFlat,
    quality: state.quality,
    intervals,
    pcs,
    absPcs,
    inversion: invRead.inversion,
    bassPc: bassRead.bass ? bassRead.bass.pc : null,
    bassName: bassRead.bass ? bassRead.bass.name : null,
    tokens: consumed,
  }
}

function matchToken(suffix, i) {
  for (const token of TOKENS) {
    const slice = suffix.slice(i, i + token.t.length)
    if (token.cs ? slice === token.t : slice.toLowerCase() === token.t.toLowerCase()) return token
  }
  return null
}

function buildIntervals(s, conventions) {
  const out = [0]
  const dominantEleven =
    s.extTop === 11 && s.sus === null && s.third === 4 && conventions.omitThirdOnDominant11

  if (s.sus !== null) out.push(s.sus)
  else if (!s.omit.has(3) && !dominantEleven) out.push(s.third)

  if (!s.omit.has(5)) out.push(s.alter[5] ?? s.fifth)
  if (s.sixth) out.push(9)
  if (s.seventh !== null && !s.omit.has(7)) out.push(s.seventh)

  const stack = []
  if (s.extTop >= 9) stack.push(9)
  if (s.extTop >= 11) stack.push(11)
  if (s.extTop >= 13) stack.push(13)
  for (const degree of s.touched) if (!stack.includes(degree)) stack.push(degree)

  const skipEleven =
    s.extTop >= 13 && conventions.omitElevenOnThirteen && s.alter[11] === undefined && s.sus === null

  const natural = { 9: 14, 11: 17, 13: 21 }
  for (const degree of stack.sort((a, b) => a - b)) {
    if (degree === 11 && skipEleven) continue
    out.push(s.alter[degree] ?? natural[degree])
  }
  out.push(...s.adds)

  return [...new Set(out)].sort((a, b) => a - b)
}

/** Human-readable root name, spelled sharp or flat to match how it was typed. */
export function pcName(pc, preferFlat = false) {
  const table = preferFlat ? PC_NAMES_FLAT : PC_NAMES_SHARP
  return table[((pc % 12) + 12) % 12]
}

const INVERSION_LABEL = ['', '1st inv', '2nd inv', '3rd inv']

/** Short description of what the parser decided a chord word means. */
export function describeChord(chord, dictionaryName) {
  if (!chord || !chord.ok) return chord?.error ? `?  ${chord.error}` : '?'
  if (chord.silent) return 'no chord'
  const parts = [chord.rootName]
  if (dictionaryName) parts.push(dictionaryName)
  else parts.push(chord.quality)
  if (chord.bassName) parts.push(`/ ${chord.bassName}`)
  if (chord.inversion) parts.push(INVERSION_LABEL[chord.inversion])
  return parts.join(' ')
}
