/**
 * Playback.
 *
 * One job: when the clock says we have moved into a new chord, release the old
 * notes and sound the new ones.  Optionally, if a phrase is bound to this part
 * of the chart, play that phrase instead -- re-pointed at the current chord by
 * the voice-leading code.
 *
 * Everything is measured in MIDI pulses (24 per quarter note) so nothing here
 * has to care about tempo.  Tempo is the DAW's business.
 */

import { eventAtPulse, sameChord, wrapPulse } from './score.js'
import { realizeChord } from './voicing.js'
import { remapPhraseNotes } from './voiceLeading.js'

export class Player {
  constructor(engine, settings) {
    this.engine = engine
    this.settings = settings
    this.score = null
    this.scoreId = 0

    this.position = 0
    this.lastPosition = 0
    this.current = null
    this.currentIndex = -1
    this.local = 0

    this.chordNotes = [] // last voicing, remembered for voice leading
    this.soundingNotes = [] // what is actually held down right now
    this.chordBass = null
    this.activePhrase = null
    this.phraseQueue = []
    this.phraseCursor = 0
    this.phraseSounding = new Set()

    this.capture = { armed: false, mode: 'once', notes: [], open: new Map(), startedEvent: -1 }

    this.getPhrase = () => null
    this.onEventChange = null
    this.onCapture = null
    this.onNotes = null
  }

  /**
   * Swap in a freshly parsed chart.
   *
   * Typing reparses on every keystroke, so this has to be careful: if the chord
   * sounding right now is still the chord at this position, leave it alone.
   * Otherwise a single typo three lines away would re-articulate the chord
   * under the player's hands.
   */
  setScore(score) {
    const previous = this.current
    this.score = score
    this.scoreId++

    const event = previous ? eventAtPulse(score, this.position, this.settings.transport.loop) : null
    if (event && sameChord(event.chord, previous.chord)) {
      this.current = event
      this.currentIndex = event.index
      // The slot may have moved or changed length; re-place the phrase cursor
      // so the rest of this chord still lines up.
      this.phraseCursor = 0
      const local = this.position - event.startPulse
      while (this.phraseCursor < this.phraseQueue.length && this.phraseQueue[this.phraseCursor].at <= local) {
        this.phraseCursor++
      }
    } else {
      this.current = null
      this.currentIndex = -1
    }
  }

  /* ---------------- clock ---------------- */

  tick(rawPulse) {
    if (!this.score || !this.score.events.length) return
    const transport = this.settings.transport
    const offset = transport.latencyPulses || 0
    const position = wrapPulse(this.score, rawPulse + offset, transport.loop)
    const wrapped = position < this.lastPosition
    this.lastPosition = position
    this.position = position

    const event = eventAtPulse(this.score, position, transport.loop)
    if (!event) {
      if (this.current) this.stopAll()
      return
    }

    if (event.index !== this.currentIndex || (wrapped && this.score.events.length === 1)) {
      this.startEvent(event)
    }

    this.local = position - event.startPulse
    this.flushPhrase(this.local)
  }

  /**
   * Any transport event invalidates what is sounding.  Forgetting the current
   * event index matters: without it, stopping and starting again on the same
   * chord would leave the chart silent until the next chord came round.
   */
  transport(kind) {
    if (kind === 'stop') this.finishCapture(true)
    this.stopAll()
    this.current = null
    this.currentIndex = -1
    this.lastPosition = 0
  }

  /* ---------------- chord + phrase events ---------------- */

  startEvent(event) {
    const previous = this.current
    if (previous) this.finishCapture(false, previous)
    this.stopAll()

    this.current = event
    this.currentIndex = event.index

    if (this.capture.armed) {
      this.capture.notes = []
      this.capture.open.clear()
      this.capture.startedEvent = event.index
    }

    const chord = event.chord
    if (!chord || !chord.ok) {
      if (this.onEventChange) this.onEventChange(event, { notes: [], phrase: null })
      return
    }

    const chords = this.settings.chords
    const midi = this.settings.midi
    const accompany = this.settings.accompany

    const phrase = accompany.enabled && event.phraseId ? this.getPhrase(event.phraseId) : null
    this.activePhrase = phrase || null

    const voicing = realizeChord(chord, {
      octave: chords.octave,
      range: [chords.rangeLow, chords.rangeHigh],
      smartVoicing: chords.smartVoicing,
      bassNote: chords.bassNote,
      bassOctave: chords.bassOctave,
      maxVoices: chords.maxVoices,
      previousNotes: this.chordNotes.length ? this.chordNotes : null,
    })

    const playBlock = !phrase || accompany.mode === 'layer'
    this.chordNotes = voicing.notes.slice()
    this.soundingNotes = []
    if (playBlock) {
      for (const note of voicing.notes) this.engine.noteOn(midi.chordOutputId, midi.chordChannel, note, midi.velocity)
      this.soundingNotes = voicing.notes.slice()
    }

    if (chords.bassNote && voicing.bass !== null && (playBlock || accompany.keepBass)) {
      this.engine.noteOn(midi.bassOutputId || midi.chordOutputId, midi.bassChannel, voicing.bass, midi.velocity)
      this.chordBass = voicing.bass
    }

    this.phraseQueue = phrase ? buildPhraseQueue(phrase, chord, event, this.settings) : []
    this.phraseCursor = 0

    if (this.onEventChange) {
      this.onEventChange(event, { notes: voicing.notes, bass: voicing.bass, phrase: phrase ? phrase.name : null })
    }
    if (this.onNotes) this.onNotes(playBlock ? voicing.notes : [])
  }

  flushPhrase(local) {
    const midi = this.settings.midi
    const outputId = midi.accompOutputId || midi.chordOutputId
    const channel = midi.accompChannel
    let guard = 0
    while (this.phraseCursor < this.phraseQueue.length && guard++ < 256) {
      const item = this.phraseQueue[this.phraseCursor]
      if (item.at > local) break
      this.phraseCursor++
      if (item.on) {
        this.engine.noteOn(outputId, channel, item.note, item.velocity)
        this.phraseSounding.add(item.note)
      } else {
        this.engine.noteOff(outputId, channel, item.note)
        this.phraseSounding.delete(item.note)
      }
    }
  }

  stopAll() {
    const midi = this.settings.midi
    for (const note of this.soundingNotes) this.engine.noteOff(midi.chordOutputId, midi.chordChannel, note)
    this.soundingNotes = []
    if (this.chordBass !== null) {
      this.engine.noteOff(midi.bassOutputId || midi.chordOutputId, midi.bassChannel, this.chordBass)
    }
    const accompOut = midi.accompOutputId || midi.chordOutputId
    for (const note of this.phraseSounding) this.engine.noteOff(accompOut, midi.accompChannel, note)
    this.phraseSounding.clear()
    this.chordBass = null
    this.phraseQueue = []
    this.phraseCursor = 0
    if (this.onNotes) this.onNotes([])
  }

  /* ---------------- Mr. Accompany Me ---------------- */

  arm(mode = 'once') {
    this.capture.armed = true
    this.capture.mode = mode
    this.capture.notes = []
    this.capture.open.clear()
    this.capture.startedEvent = this.currentIndex
  }

  disarm() {
    this.capture.armed = false
    this.capture.open.clear()
    this.capture.notes = []
  }

  noteIn(note, velocity, on) {
    const midi = this.settings.midi
    if (this.settings.accompany.monitor && midi.accompOutputId) {
      if (on) this.engine.noteOn(midi.accompOutputId, midi.accompChannel, note, velocity)
      else this.engine.noteOff(midi.accompOutputId, midi.accompChannel, note)
    }
    if (!this.capture.armed || !this.current) return

    const quantize = this.settings.accompany.quantize || 0
    const at = quantize > 0 ? Math.round(this.local / quantize) * quantize : this.local

    if (on) {
      this.capture.open.set(note, { at, note, velocity })
    } else {
      const open = this.capture.open.get(note)
      if (!open) return
      this.capture.open.delete(note)
      this.capture.notes.push({ ...open, duration: Math.max(1, at - open.at) })
    }
  }

  /** Close the books on the chord we just left and hand the result to the UI. */
  finishCapture(force, event = this.current) {
    if (!this.capture.armed || !event) return
    if (this.capture.startedEvent !== event.index && !force) return

    const length = event.endPulse - event.startPulse
    for (const [note, open] of this.capture.open) {
      this.capture.notes.push({ ...open, note, duration: Math.max(1, length - open.at) })
    }
    this.capture.open.clear()

    const notes = this.capture.notes.slice().sort((a, b) => a.at - b.at)
    this.capture.notes = []

    if (notes.length && this.onCapture) {
      this.onCapture({
        notes,
        lengthPulses: length,
        sourcePcs: event.chord && event.chord.ok ? event.chord.absPcs : [0, 4, 7],
        sourceChord: event.chord && event.chord.ok ? event.chord.text : '?',
        bars: event.bars,
        capturedAt: Date.now(),
      })
    }

    if (this.capture.mode === 'once') this.capture.armed = false
    else this.capture.startedEvent = -1
  }
}

/**
 * Lay a phrase over one chord event: re-point every note at the new harmony,
 * then fit it to the length of the slot.
 */
export function buildPhraseQueue(phrase, chord, event, settings) {
  const accompany = settings.accompany
  const chords = settings.chords
  const slot = event.endPulse - event.startPulse
  const source = phrase.lengthPulses || slot

  const mapped = remapPhraseNotes(
    phrase.notes.map((n) => n.note),
    phrase.sourcePcs,
    chord.absPcs,
    {
      keepRegister: accompany.keepRegister,
      snapNonChordTones: accompany.snapNonChordTones,
      range: [chords.rangeLow, chords.rangeHigh],
    }
  )

  const passes = []
  if (accompany.fit === 'repeat' && source > 0) {
    for (let start = 0; start < slot; start += source) passes.push({ offset: start, scale: 1 })
  } else if (accompany.fit === 'truncate') {
    passes.push({ offset: 0, scale: 1 })
  } else {
    passes.push({ offset: 0, scale: source > 0 ? slot / source : 1 })
  }

  const queue = []
  for (const pass of passes) {
    phrase.notes.forEach((played, index) => {
      const at = pass.offset + played.at * pass.scale
      const end = at + Math.max(1, played.duration * pass.scale)
      if (at >= slot) return
      queue.push({ at, on: true, note: mapped[index], velocity: played.velocity })
      queue.push({ at: Math.min(end, slot - 1), on: false, note: mapped[index], velocity: 0 })
    })
  }

  // Note-offs sort before note-ons at the same instant so a repeated note
  // re-articulates instead of being cut short by its own predecessor.
  queue.sort((a, b) => a.at - b.at || Number(a.on) - Number(b.on))
  return queue
}
