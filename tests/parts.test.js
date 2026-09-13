let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

// Entries shaped exactly as scripts/extract_pop909.html emits them. The notes
// are already rooted on C, so the chord symbol supplies degrees, not a key.
const RAW = [
  { n: 'F comp 1', k: 'part', c: 'F', d: 96, s: '219',
    v: [[0, 36, 24, 70], [0, 60, 24, 64], [0, 64, 24, 62], [24, 67, 24, 60]] },
  { n: 'Dm7 comp 1', k: 'part', c: 'Dm7', d: 48, s: '007',
    v: [[0, 38, 12, 80], [6, 60, 12, 55], [6, 65, 12, 55]] },
  { n: 'broken', k: 'part', c: 'Hzz', d: 48, s: '001', v: [[0, 60, 24, 90]] },
]

const parts = RAW.map(entryToPart).filter(Boolean)
check('unreadable chords are dropped', parts.length, 2)
check('ids are stable', parts.map((p) => p.id), ['p0', 'p1'])
check('notes carry their velocity', parts[0].notes[0], { at: 0, note: 36, velocity: 70, duration: 24 })
check('already rooted on C', parts.map((p) => p.rootPc), [0, 0])
check('degrees, not a key', parts[0].sourcePcs, [0, 4, 7])
check('minor seventh degrees', parts[1].sourcePcs, [0, 3, 7, 10])
check('quality matches the degrees', parts[0].quality, '0,4,7')
check('kind is part', parts[0].kind, 'part')
check('polyphony counted', parts[0].voices, 3)
check('the song is remembered', parts[0].song, '219')


// Moving it keeps both hands and the degrees.
const notes = parts[0].notes.map((n) => n.note)
const target = parseChord('Ab')
const moved = realizePhrase(notes, { rootPc: 0, pcs: parts[0].sourcePcs },
  { rootPc: target.rootPc, pcs: target.absPcs }, { range: [28, 100] })
const degrees = (list, root) => [...new Set(list.map((n) => ((n % 12) - root + 12) % 12))].sort((a, b) => a - b)
check('degrees survive', degrees(moved, 8), [0, 4, 7])
check('the spread survives', Math.max(...moved) - Math.min(...moved), Math.max(...notes) - Math.min(...notes))
check('the bass stays underneath', moved[0] < moved[1], true)

console.log(failed === 0 ? 'parts: all checks passed' : `parts: ${failed} FAILED`)
