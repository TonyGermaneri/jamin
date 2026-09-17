// Turning a catalogue into a graph: which words become nodes, which clips join
// which, and which words turn up together.
//
// This is the half of the graph view with no graphics in it, and it is the half
// that has to be right -- a layout is only as meaningful as the edges it is
// pulled into shape by. What it does to a real collection of three quarters of
// a million paths is measured by scripts/graph_check.py; this is the rules.
let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/* ---------------- the words in a path ----------------------------------- */
// Every one of these is real, from a 774,000-file collection.
const punk = 'Studio Drummer MIDI Files/11 Punk Rock/04 Straight HiHat Fill 170BPM.mid'
/*
 * `HiHat` comes apart into `hi` and `hat`, and `hi` is too short to keep, so
 * what is left is `hat`. That is the right trade: the same splitting is what
 * turns `IndieQuirk` into indie, and a general `hat` node that every hi-hat
 * groove hangs off is more use on a map than a `hihat` node and a separate
 * `hats` node and a separate `hihats` node.
 */
check('a path becomes its words', tagsFrom(punk),
      ['studio', 'drummer', 'punk', 'rock', 'straight', 'hat', 'fill', '170bpm'])

// `midi` and `files` are in nine hundred folder names and separate nothing.
check('words that are everywhere are not words', tagsFrom(punk).includes('midi'), false)
check('nor are they', tagsFrom(punk).includes('files'), false)

/*
 * A bare number is a position in a catalogue, not a word.
 *
 * `04` is the fourth file of this pack and the fourth file of six hundred other
 * packs. A graph joined on it would tie every pack's fourth file to every other
 * pack's fourth file, which is four hundred thousand edges saying nothing.
 */
check('a bare number is not a word', tagsFrom('Vendor/000210/04.mid'), ['vendor'])
// A tempo is one word, because the clips that share it really are related --
// where a bare `bpm` would join everything that mentions a tempo at all.
check('but a tempo is', tagsFrom('Vendor/170BPM/8ths.mid'), ['vendor', '170bpm', '8ths'])

// Camel case, because a vendor who cannot type a space capitalises instead.
check('welded words come apart',
      tagsFrom('Odd Meter Drums/11_8_IndieQuirk/x.mid'), ['odd', 'meter', 'indie', 'quirk'])

// One word once, however many times the path says it.
check('a word repeated is one word', tagsFrom('Rock/Rock/Rock Beat 1.mid'), ['rock'])

// Two letters is an abbreviation or a catalogue prefix, not something to join on.
check('two letters is not a word', tagsFrom('GM/AB/Blues.mid'), ['blues'])
check('rubbish is survivable', tagsFrom(null), [])
check('and so is nothing', tagsFrom(''), [])

/* ---------------- which words are worth a node -------------------------- */
/*
 * Both ends of the range throw the map away.
 *
 * A word one clip carries is a filename: it joins that clip to nothing and puts
 * a node on the graph nobody can reach. A word most of the catalogue carries
 * joins everything to everything, which is the same as joining nothing -- and
 * that is the one people forget, because it looks like a useful big hub right
 * up until it is the only thing on screen.
 */
const catalogue = [
  ...Array.from({ length: 40 }, (_, n) => `Vendor/Rock/beat ${n + 1}.mid`),
  ...Array.from({ length: 30 }, (_, n) => `Vendor/Jazz/swing ${n + 1}.mid`),
  ...Array.from({ length: 12 }, (_, n) => `Vendor/Jazz/Bossa/one ${n + 1}.mid`),
  'Vendor/Jazz/aardvark.mid',
]
const tally = countTags(catalogue)
check('every clip was counted', tally.clips, 83)

const useful = usefulTags(tally, { least: 8, most: 0.9 })
const names = useful.map((one) => one.tag)
check('a word in a handful of clips is kept', names.includes('bossa'), true)
check('a word in one clip is not', names.includes('aardvark'), false)
// `vendor` is on all 83 of 83 -- there is nothing it fails to say, so it
// separates nothing. `jazz` at 42 of 83 separates the most a word can.
check('a word on everything is not either', names.includes('vendor'), false)
check('but a word on half of it is the most useful kind', names.includes('jazz'), true)
check('and the ones kept are counted right',
      useful.find((one) => one.tag === 'bossa').clips, 12)

// Biggest first, then alphabetical, so the same catalogue always numbers its
// words the same way -- which is what lets a layout computed once still line up
// with the table next time it is loaded.
check('the order is stable', names, ['jazz', 'rock', 'swing', 'bossa', 'one'])
check('and it is the same twice',
      usefulTags(countTags(catalogue), { least: 8, most: 0.9 }).map((o) => o.tag), names)

/* ---------------- one word, not two ------------------------------------- */
/*
 * Measured on a real collection, `hats` and `hat` came out as two nodes with
 * five thousand clips on one and three thousand on the other: the same concept
 * split in half and each half twice as far from everything it belongs near.
 *
 * Folded from the data rather than by a stemmer. A plural folds only when the
 * singular is also in this collection, so a rule that has never seen a word
 * cannot be wrong about it.
 */
const drumkit = [
  ...Array.from({ length: 30 }, (_, n) => `Pack/Closed Hat/x${n}.mid`),
  ...Array.from({ length: 20 }, (_, n) => `Pack/Open Hats/y${n}.mid`),
  ...Array.from({ length: 10 }, (_, n) => `Pack/Bass Drum/z${n}.mid`),
]
const kit = usefulTags(countTags(drumkit), { least: 4, most: 0.9 })
const hat = kit.find((one) => one.tag === 'hat')
// Into whichever form the collection actually says, so the node is called what
// the music calls it -- here `hat`, which 30 clips say against 20 for `hats`.
check('hats and hat are one word', Boolean(hat), true)
check('carrying both sets of clips', hat.clips, 50)
check('and hats is not a node of its own',
      kit.some((one) => one.tag === 'hats'), false)

// `bass` does not become `bas`, because nothing in this collection says `bas`.
check('a word that merely ends in s is left alone',
      kit.some((one) => one.tag === 'bass'), true)

/*
 * And two different words that happen to differ by an `s` stay two words.
 *
 * Measured on a real collection, `blue` turned up 19 times and `blues` 15,737 --
 * a colour somebody mentioned and a genre a sixth of the catalogue is in. The
 * first rule folded the genre into the colour and renamed fifteen thousand
 * clips after nineteen. Two forms of one word turn up in comparable numbers;
 * two different words do not.
 */
const colours = [
  ...Array.from({ length: 400 }, (_, n) => `Pack/Blues/b${n}.mid`),
  ...Array.from({ length: 3 }, (_, n) => `Pack/Blue Monk/m${n}.mid`),
  // Something else to be, so `blues` is a large part of the collection rather
  // than the whole of it and the ceiling has something to measure against.
  ...Array.from({ length: 400 }, (_, n) => `Pack/Reggae/r${n}.mid`),
]
const kept = usefulTags(countTags(colours), { least: 2, most: 0.9 }).map((one) => one.tag)
check('a genre is not renamed after a colour', kept.includes('blues'), true)
check('and the colour keeps its own node', kept.includes('blue'), true)

// And a clip that said the plural reaches the singular's node.
const kitGraph = buildGraph(drumkit.map((path) => ({ path })), { least: 4, most: 0.9 })
const hatNode = kitGraph.tags.findIndex((one) => one.tag === 'hat')
let onHat = 0
for (let i = 1; i < kitGraph.clipEdges.length; i += 2) {
  if (kitGraph.clipEdges[i] === hatNode) onHat++
}
check('every clip that said either joins the one node', onHat, 50)

/*
 * And a clip saying both forms joins it once, not twice.
 *
 * Measured on 300,000 real clips this was the heaviest edge in the whole
 * collection -- `fill·fill`, 26,459 times -- a line drawn from a node to
 * itself, because a path saying `Fills/fill 3.mid` reached the folded node
 * twice and every pair-counting walk then paired it with itself.
 */
const bothForms = buildGraph(
  Array.from({ length: 20 }, (_, n) => ({ path: `Pack/Hats/closed hat ${n}.mid` })),
  { least: 4, most: 0.9 }
)
const reached = []
for (let i = 0; i < bothForms.clipEdges.length; i += 2) {
  if (bothForms.clipEdges[i] === 0) reached.push(bothForms.clipEdges[i + 1])
}
check('a clip saying a word twice joins it once',
      reached.length, new Set(reached).size)
check('and nothing is related to itself',
      coOccurrence(bothForms.clipEdges, { least: 2 }).some(([a, b]) => a === b), false)

/* ---------------- the clip edges ---------------------------------------- */
const graph = buildGraph(catalogue.map((path) => ({ path })), { least: 8, most: 0.9 })
check('a node per clip', graph.clips, 83)
check('and a node per useful word', graph.tags.length, 5)
check('every word it saw is reported', graph.everyTag > graph.tags.length, true)

// Flat pairs rather than objects: three quarters of a million clips carrying
// six words each is four and a half million pairs, and an object apiece is a
// gigabyte of garbage.
check('the edges are a flat typed array', graph.clipEdges.constructor.name, 'Uint32Array')
check('and hold pairs', graph.clipEdges.length % 2, 0)

// The first clip is `Vendor/Rock/beat 1.mid`, which keeps `rock` and `beat`.
const firstClipTags = []
for (let i = 0; i < graph.clipEdges.length; i += 2) {
  if (graph.clipEdges[i] === 0) firstClipTags.push(graph.tags[graph.clipEdges[i + 1]].tag)
}
check('a clip joins the words it carries', firstClipTags.sort(), ['rock'])

// Nothing joins a word that was thrown away.
let beyond = 0
for (let i = 1; i < graph.clipEdges.length; i += 2) {
  if (graph.clipEdges[i] >= graph.tags.length) beyond++
}
check('and nothing joins a word that is not there', beyond, 0)

/* ---------------- which words turn up together -------------------------- */
// The clip edges position things; these are what actually gets drawn.
const together = coOccurrence(graph.clipEdges, { least: 4 })
const pair = (a, b) => together.find(([x, y]) =>
  (graph.tags[x].tag === a && graph.tags[y].tag === b)
  || (graph.tags[x].tag === b && graph.tags[y].tag === a))

check('jazz and swing turn up together', Boolean(pair('jazz', 'swing')), true)
check('as often as there are clips with both', pair('jazz', 'swing')[2], 30)
check('jazz and bossa too', pair('jazz', 'bossa')[2], 12)
// Nothing in this catalogue is both rock and jazz.
check('and rock and jazz never do', pair('rock', 'jazz'), undefined)

// One pair, not two: `a,b` and `b,a` are the same relationship.
const jazzSwing = together.filter(([x, y]) => {
  const names2 = [graph.tags[x].tag, graph.tags[y].tag].sort().join()
  return names2 === 'jazz,swing'
})
check('a pair is counted once', jazzSwing.length, 1)

// Heaviest first, so a renderer that has to stop somewhere stops at the weak
// end and a reader sees the strongest relationships first.
check('the strongest comes first',
      together.every((one, at) => at === 0 || together[at - 1][2] >= one[2]), true)

/*
 * A path with thirty words in it is a vendor's catalogue line, and it would
 * contribute four hundred and thirty-five pairs on its own -- more than the
 * rest of the collection put together, all of them nonsense.
 */
const wordy = buildGraph(
  Array.from({ length: 20 }, () => ({ path: 'a/bb/ccc/ddd/eee/fff/ggg/hhh/iii/jjj/kkk/lll/mmm/nnn/ooo.mid' })),
  { least: 2, most: 1 }
)
check('a path of nothing but words is ignored',
      coOccurrence(wordy.clipEdges, { least: 2, mostPerClip: 12 }).length, 0)
check('while a reasonable one is not',
      coOccurrence(wordy.clipEdges, { least: 2, mostPerClip: 40 }).length > 0, true)

/* ---------------- and the shape a renderer takes ------------------------ */
const packed = packEdges(together)
check('pairs are a typed array', packed.pairs.constructor.name, 'Uint32Array')
check('weights are floats', packed.weight.constructor.name, 'Float32Array')
check('two indices per edge', packed.pairs.length, together.length * 2)
check('one weight per edge', packed.weight.length, together.length)
check('and they line up', packed.weight[0], together[0][2])

check('nothing at all is survivable', buildGraph([]).tags.length, 0)
check('and produces no edges', coOccurrence(new Uint32Array(0)).length, 0)

console.log(failed ? `tag-graph: ${failed} FAILED` : 'tag-graph: all checks passed')
