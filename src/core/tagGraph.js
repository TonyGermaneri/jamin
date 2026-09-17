/**
 * A catalogue, as a graph.
 *
 * Every clip is a node. Every word in its path is a node. An edge joins a clip
 * to each word it carries. A groove filed at
 *
 *     Studio Drummer/11 Punk Rock/04 Straight HiHat Fill 170BPM.mid
 *
 * joins `studio`, `drummer`, `punk`, `rock`, `straight`, `hat`, `fill` and `170bpm`
 * -- which are the same facets the filters already read, so this is not a new
 * model of the data but a second view of the one that is there.
 *
 * That is what makes the layout mean something. Clips sharing words are pulled
 * together and words that co-occur drift together, so the picture is a map of
 * the collection's own vocabulary rather than an arrangement of dots.
 *
 * **Nothing here draws anything.** It turns paths into two typed arrays and a
 * table of words, which is all a renderer needs and all a test needs. The parts
 * that must be right have no graphics in them.
 */

import { unglue } from './genres.js'

/**
 * Words that are in every path and tell you nothing.
 *
 * A word carried by most of the catalogue cannot separate any of it -- `midi`
 * appears in nine hundred folder names and joins nothing to anything. These are
 * the ones known in advance; @see tagsFrom for the rule that catches the rest,
 * which is about how often a word actually occurs rather than about a list
 * somebody remembered to write.
 */
const EVERYWHERE = new Set([
  'midi', 'mid', 'files', 'file', 'drum', 'drums', 'loop', 'loops', 'pack',
  'packs', 'kit', 'kits', 'set', 'sets', 'sample', 'samples', 'groove',
  'grooves', 'pattern', 'patterns', 'beat', 'beats', 'wav', 'audio', 'demo',
  'new', 'old', 'copy', 'untitled', 'misc', 'other', 'various', 'and', 'the',
  'of', 'in', 'on', 'for', 'with', 'by', 'a', 'an',
  // A unit rather than a thing. `bpm` on its own joins every path that mentions
  // a tempo to every other; `170bpm` is kept whole and joins the ones that
  // share that tempo, which is a relationship.
  'bpm',
  /*
   * And what vendors call their products.
   *
   * `drummer` is on 59% of the real collection -- Superior Drummer, Studio
   * Drummer, Modern Drummer, Vintage Drummer, and one per decade -- which makes
   * it the largest word in the catalogue and the least informative. It is not a
   * library's name, so the exclusivity rule rightly leaves it alone
   * (@see libraryNames); it is a product noun, which is what this list is for
   * and where `kit`, `pack` and `loops` already are.
   */
  'drummer', 'edition', 'expansion', 'library', 'volume', 'vol',
])

/** The shortest run of letters that can be a word rather than a catalogue id. */
const SHORTEST = 3

/**
 * The words in one path.
 *
 * Split on every separator a vendor has ever used, camel case pulled apart
 * first because lowercasing is what destroys it (@see genres.js unglue), and a
 * bare number is not a word -- `000210`, `04` and `11` are catalogue positions,
 * and a graph joined on them would join the fourth file of every pack to the
 * fourth file of every other.
 *
 * A number *attached* to something is kept, because `170bpm` and `8ths` say
 * what they are.
 */
export function tagsFrom(path) {
  const out = []
  const seen = new Set()

  const text = unglue(String(path || ''))
    .toLowerCase()
    .replace(/\.(mid|midi)\b/g, ' ')
    // A tempo is one word. unglue puts a space between a letter and a digit,
    // which is right for `HiHat8ths` and wrong for `170BPM` -- and a tempo is
    // worth a node, since the clips sharing one really are related, while a
    // bare `bpm` joins everything that mentions a tempo at all.
    .replace(/(\d{2,3})\s*bpm/g, '$1bpm')

  for (const word of text.split(/[^a-z0-9#]+/)) {
    const clean = word.trim()
    if (!clean) continue
    if (/^[0-9]+$/.test(clean)) continue              // a position, not a word
    if (clean.replace(/[^a-z]/g, '').length < SHORTEST) continue
    if (EVERYWHERE.has(clean)) continue
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }

  return out
}

/**
 * How rare a word has to be to be worth keeping, and how common.
 *
 * Both ends throw the map away. A word carried by one clip is a filename rather
 * than a relationship -- it joins that clip to nothing and adds a node nobody
 * can reach. A word carried by most of the catalogue joins everything to
 * everything, which is the same as joining nothing.
 *
 * Measured rather than chosen: @see scripts/graph_check.py reports what each
 * floor keeps over a real collection, because the right answer is a fact about
 * somebody's folders.
 */
export const LEAST_CLIPS = 8

/**
 * And the ceiling is very near the top, on purpose.
 *
 * It is tempting to throw away anything common, and wrong. A word carried by
 * forty per cent of the catalogue separates that forty from the other sixty,
 * which is the most a single word can tell you -- dropping it would take `rock`
 * out of a rock-heavy collection and leave the map without its largest true
 * feature.
 *
 * The word worth dropping is the one on *everything*: a vendor's own name in
 * every path under it says nothing about any of them, because there is nothing
 * it fails to say. That is what this catches, with a little room for the
 * near-misses.
 */
export const MOST_SHARE = 0.9

/**
 * Count every word in a catalogue, so the useful ones can be told from the rest.
 *
 * `paths` is anything iterable of strings. Returns the words with how many
 * clips carry each, biggest first -- which is also the order that makes a
 * sensible node id, since the commonest words are the hubs everything else
 * hangs off.
 */
export function countTags(paths) {
  const counts = new Map()
  const perClip = []
  let clips = 0

  for (const path of paths) {
    clips++
    const tags = tagsFrom(path)
    perClip.push(tags)
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }

  return { counts, clips, singular: singularise(counts) }
}

/**
 * `hats` and `hat` are one word.
 *
 * Measured on a real collection they came out as two nodes with five thousand
 * clips on one and three thousand on the other -- the same concept, split in
 * half, twice as far from everything it should be near. So are `fill`/`fills`
 * and `tom`/`toms`.
 *
 * Folded from the data rather than by a stemmer: a plural is folded only when
 * the singular is *also* in this collection, so `bass` is not turned into `bas`
 * and `hits` is left alone unless something else says `hit`. A rule that cannot
 * be wrong about a word it has never seen.
 *
 * Returns a map from word to the word it should count as; words not in it stand
 * for themselves.
 */
export function singularise(counts, { evenly = 0.1 } = {}) {
  const folds = new Map()

  for (const word of counts.keys()) {
    if (!word.endsWith('s') || word.length < 4) continue
    const bare = word.slice(0, -1)
    if (!counts.has(bare)) continue

    const many = counts.get(word)
    const one = counts.get(bare)

    /*
     * Two forms of one word turn up in comparable numbers. Two different words
     * that happen to differ by an `s` do not.
     *
     * Measured on a real collection: `hat` 3,044 and `hats` 5,105 are plainly
     * the same drum. `blue` 19 and `blues` 15,737 are plainly not the same
     * word -- and folding on the singular alone renamed a genre carried by
     * fifteen thousand clips after a colour mentioned by nineteen.
     */
    if (Math.min(many, one) / Math.max(many, one) < evenly) continue

    // Into whichever the collection actually says, so the node is called what
    // the music calls it.
    if (many > one) folds.set(bare, word)
    else folds.set(word, bare)
  }

  return folds
}

/**
 * The words worth putting on a graph, from a tally.
 *
 * Returns them in a stable order -- by count, then alphabetically -- so the
 * same catalogue always yields the same node ids, and a layout computed once
 * still lines up with the table the next time it is loaded.
 */
export function usefulTags({ counts, clips, singular }, { least = LEAST_CLIPS, most = MOST_SHARE } = {}) {
  const ceiling = Math.max(least, Math.floor(clips * most))

  // Plurals folded into their singulars first, so `hat` carries the clips that
  // said `hats` too. @see singularise
  const folded = new Map()
  for (const [word, n] of counts) {
    const to = (singular && singular.get(word)) || word
    folded.set(to, (folded.get(to) || 0) + n)
  }

  return [...folded.entries()]
    .filter(([, n]) => n >= least && n <= ceiling)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([tag, n]) => ({ tag, clips: n }))
}

/**
 * The whole graph, as the arrays a GPU wants.
 *
 * One pass to count and one to build, because which words are worth keeping is
 * not knowable until they have all been seen.
 *
 * `clipEdges` is a flat `Uint32Array` of pairs -- clip index, tag index, clip
 * index, tag index -- rather than an array of objects, because three quarters
 * of a million clips carrying six words each is four and a half million pairs
 * and an object apiece is a gigabyte of garbage.
 *
 * Those edges never reach a line renderer. They are what pulls a clip toward
 * its words, and four million hairlines is a grey wash. What gets drawn is
 * @see coOccurrence, which is thousands.
 */
export function buildGraph(items, {
  least = LEAST_CLIPS, most = MOST_SHARE,
  pathOf = (one) => one.path,
  groupOf = null,
} = {}) {
  const rows = [...items]
  const paths = rows.map(pathOf)
  const tally = countTags(paths)
  const labels = groupOf ? libraryNames(paths, rows.map(groupOf), tally) : new Set()
  const kept = usefulTags(tally, { least, most })
    .filter((one) => !labels.has(one.tag))

  const index = new Map()
  kept.forEach((one, at) => index.set(one.tag, at))
  // And the plurals reach the same node as their singulars.
  for (const [word, to] of tally.singular) {
    if (index.has(to)) index.set(word, index.get(to))
  }

  /*
   * Which nodes one clip reaches, each once.
   *
   * Two words can be one node -- `fill` and `fills` fold together -- and a path
   * saying both would otherwise join that node twice, which shows up as a word
   * paired with itself: `fill·fill`, 26,459 times, the heaviest edge in the
   * whole collection and a line from a node to itself.
   */
  const nodesOf = (row) => {
    const mine = new Set()
    for (const tag of tagsFrom(pathOf(row))) {
      const which = index.get(tag)
      if (which !== undefined) mine.add(which)
    }
    return mine
  }

  // Counted before it is filled, so the array is allocated once at the size it
  // needs rather than grown four million times.
  let pairs = 0
  for (const row of rows) pairs += nodesOf(row).size

  const clipEdges = new Uint32Array(pairs * 2)
  let at = 0
  for (let clip = 0; clip < rows.length; clip++) {
    for (const which of nodesOf(rows[clip])) {
      clipEdges[at++] = clip
      clipEdges[at++] = which
    }
  }

  return { tags: kept, index, clipEdges, clips: rows.length, everyTag: tally.counts.size }
}

/**
 * Words that are a library's name rather than a thing.
 *
 * Measured on the real collection this was the single worst feature of the map.
 * `Superior Drummer 2 Drum Midi [425,000 files]` is one pack of four hundred and
 * twenty-five thousand files -- fifty-five per cent of the whole catalogue --
 * and its name is on every path inside it. So `superior` and `drummer` came out
 * as the two largest words in the collection, and the three strongest
 * relationships in the entire graph were `drummer·superior`,
 * `drummer·variation` and `superior·variation`.
 *
 * None of which is about music. It is one vendor's folder naming, drawn as the
 * dominant structure of the map, and it survived the share ceiling honestly:
 * fifty-five per cent is well under it, because the word really is on that much
 * of the catalogue.
 *
 * The thing that tells a library's name from a real word is *where else it
 * appears*. `blues` turns up in the blues pack and in a dozen others; `superior`
 * turns up in the Superior pack and nowhere at all. So a word is a label when it
 * covers nearly all of one library and nearly nothing outside it -- which the
 * library filter already handles, and which a map has no use for.
 */
export function libraryNames(paths, groups, tally, { covers = 0.8, concentrated = 0.9 } = {}) {
  const inGroup = new Map()      // word -> group -> count
  const groupSize = new Map()

  paths.forEach((path, at) => {
    const group = groups[at]
    if (!group) return
    groupSize.set(group, (groupSize.get(group) || 0) + 1)
    for (const tag of tagsFrom(path)) {
      const folded = (tally.singular && tally.singular.get(tag)) || tag
      let per = inGroup.get(folded)
      if (!per) { per = new Map(); inGroup.set(folded, per) }
      per.set(group, (per.get(group) || 0) + 1)
    }
  })

  const labels = new Set()
  for (const [word, per] of inGroup) {
    let biggest = null
    let total = 0
    for (const [group, n] of per) {
      total += n
      if (!biggest || n > biggest.n) biggest = { group, n }
    }
    if (!biggest) continue

    const ofTheLibrary = biggest.n / Math.max(1, groupSize.get(biggest.group) || 1)
    const ofTheWord = biggest.n / Math.max(1, total)

    /*
     * On nearly every clip of one library, and nearly nowhere else.
     *
     * Both numbers were measured on the real collection rather than picked, and
     * the first does most of the work. Of the twelve commonest words, only
     * `superior` is on more than 80% of any one library:
     *
     *     superior   ofLib 1.000   ofWord 0.949   (a pack name)
     *     variation  ofLib 0.733   ofWord 0.999
     *     straight   ofLib 0.677   ofWord 0.882
     *     hat        ofLib 0.579   ofWord 0.941
     *     rock       ofLib 0.205   ofWord 0.786
     *
     * The second exists to protect a word that *is* most of one small library
     * but lives elsewhere too. It sat at 0.95 first, which put `superior` --
     * measured at 0.949 -- on the wrong side of it by a thousandth, and a
     * threshold that decides the shape of the map on the third decimal place is
     * not a threshold, it is a coincidence. At 0.9 both cases clear it
     * comfortably in opposite directions.
     */
    if (ofTheLibrary >= covers && ofTheWord >= concentrated) labels.add(word)
  }
  return labels
}

/**
 * Which words turn up together, which is the graph anybody actually looks at.
 *
 * The clip edges position things; these are what is drawn. Two words are joined
 * when enough clips carry both, and the weight is how many -- so `punk` sits
 * near `rock` because the collection says so rather than because anybody said
 * it should.
 *
 * Counted from the clip edges rather than from the paths again: they are
 * already sorted by clip, so one walk gathers each clip's words and every pair
 * among them. A clip carrying n words contributes n(n-1)/2 pairs, which is why
 * `mostPerClip` exists -- a path with thirty words in it is a vendor's
 * catalogue line, and it would contribute four hundred pairs of nonsense.
 */
export function coOccurrence(clipEdges, { least = 4, mostPerClip = 12 } = {}) {
  const together = new Map()
  const mine = []
  let clip = -1

  const close = () => {
    if (mine.length < 2 || mine.length > mostPerClip) return
    for (let a = 0; a < mine.length; a++) {
      for (let b = a + 1; b < mine.length; b++) {
        // A node is not related to itself. It cannot happen once a clip's
        // nodes are deduplicated (@see buildGraph), and this is here so that
        // nothing downstream has to wonder.
        if (mine[a] === mine[b]) continue
        // Ordered, so `a,b` and `b,a` are one pair rather than two.
        const key = mine[a] < mine[b] ? `${mine[a]},${mine[b]}` : `${mine[b]},${mine[a]}`
        together.set(key, (together.get(key) || 0) + 1)
      }
    }
  }

  for (let i = 0; i < clipEdges.length; i += 2) {
    if (clipEdges[i] !== clip) {
      close()
      clip = clipEdges[i]
      mine.length = 0
    }
    mine.push(clipEdges[i + 1])
  }
  close()

  const edges = []
  for (const [key, n] of together) {
    if (n < least) continue
    const [a, b] = key.split(',')
    edges.push([Number(a), Number(b), n])
  }

  // Heaviest first: a renderer that has to stop somewhere should stop at the
  // weak end, and a reader looking at the top of the list should see the
  // strongest relationships in the collection.
  edges.sort((one, two) => two[2] - one[2] || one[0] - two[0] || one[1] - two[1])
  return edges
}

/**
 * The tag edges as the two arrays a renderer takes.
 *
 * Separate from @see coOccurrence because the counting and the packing are
 * different jobs and only one of them is interesting to test.
 */
export function packEdges(edges) {
  const pairs = new Uint32Array(edges.length * 2)
  const weight = new Float32Array(edges.length)
  edges.forEach(([a, b, n], at) => {
    pairs[at * 2] = a
    pairs[at * 2 + 1] = b
    weight[at] = n
  })
  return { pairs, weight }
}
