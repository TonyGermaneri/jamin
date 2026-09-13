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
import { realizePhrase } from './voiceLeading.js'

const mod = (n, m) => ((n % m) + m) % m

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
    this.droneNotes = [] // the held root under the accompaniment, if asked for
    this.accentTimers = [] // an accent is a gesture, not part of the chart
    this.activePhrase = null
    this.phraseQueue = []
    this.phraseCursor = 0
    this.phraseSounding = new Set()
    // The phrase as it sounded over the last chord, so the next chord places it
    // in the register nearest to where it just was.
    this.lastPhraseNotes = null

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
    this.lastPhraseNotes = null
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
      maxVoices: chords.maxVoices,
      previousNotes: this.chordNotes.length ? this.chordNotes : null,
    })

    const playBlock = !phrase || accompany.mode === 'layer'
    this.chordNotes = voicing.notes.slice()
    this.soundingNotes = []
    if (playBlock) {
      // Only remember notes that actually reached a port. With no output bound
      // yet, recording them anyway would fire note-offs for notes that were
      // never turned on the moment a port is chosen.
      for (const note of voicing.notes) {
        if (this.engine.noteOn(midi.chordOutputId, midi.chordChannel, note, midi.velocity)) {
          this.soundingNotes.push(note)
        }
      }
    }

    if (phrase) {
      const built = buildPhraseQueue(phrase, chord, event, this.settings, this.lastPhraseNotes)
      this.phraseQueue = built.queue
      this.lastPhraseNotes = built.notes
    } else {
      this.phraseQueue = []
      this.lastPhraseNotes = null
    }
    this.phraseCursor = 0

    this.startDrone(chord)

    if (this.onEventChange) {
      this.onEventChange(event, { notes: voicing.notes, phrase: phrase ? phrase.name : null })
    }
    if (this.onNotes) this.onNotes(playBlock ? voicing.notes : [])
  }

  /**
   * A held root under everything, if asked for -- the thing a bass player would
   * be doing. Sustained for the whole chord rather than articulated, so it sits
   * under the phrase instead of competing with it.
   */
  startDrone(chord) {
    const accompany = this.settings.accompany
    if (!accompany.bass || chord.rootPc === null || chord.rootPc === undefined) return

    const midi = this.settings.midi
    // The bass port and channel, not the accompaniment one. This is the bass,
    // and sending it where the phrases go puts it on a channel that may well not
    // be listened to -- which is exactly how it came to look broken.
    const outputId = midi.bassOutputId || midi.chordOutputId
    const octaves = Math.max(0, accompany.bassOctaves ?? 1)
    // A slash chord says what belongs in the bass, so play that.
    const pitch = chord.bassPc ?? chord.rootPc
    const root = (accompany.octave ?? 4) * 12 + 12 + pitch - octaves * 12

    const wanted = [root]
    if (accompany.doubleBass) wanted.push(root - 12)

    for (const note of wanted) {
      if (note < 0 || note > 127) continue
      if (this.engine.noteOn(outputId, midi.bassChannel, note, midi.velocity)) this.droneNotes.push(note)
    }
  }

  /**
   * Fire the accent phrase over whatever chord is current.
   *
   * Scheduled in real time rather than in pulses, for two reasons: it plays over
   * the top of whatever the chart is doing rather than replacing it, and it
   * works when the transport is stopped, which is when you are most likely to be
   * poking at it.
   *
   * @returns {boolean} whether anything was played
   */
  triggerAccent(phrase) {
    if (!phrase || !phrase.notes || !phrase.notes.length) return false
    const chord = this.current && this.current.chord
    if (!chord || !chord.ok || chord.silent) return false

    const accompany = this.settings.accompany
    const chords = this.settings.chords
    const midi = this.settings.midi
    const outputId = midi.accompOutputId || midi.chordOutputId

    const notes = realizePhrase(
      phrase.notes.map((n) => n.note),
      { rootPc: phrase.rootPc ?? 0, pcs: phrase.sourcePcs },
      { rootPc: chord.rootPc, pcs: chord.absPcs },
      {
        home: [(accompany.octave ?? 4) * 12 + 12],
        anchor: null,
        snapNonChordTones: accompany.snapNonChordTones,
        range: [accompany.rangeLow ?? chords.rangeLow, accompany.rangeHigh ?? chords.rangeHigh],
      }
    )

    const bpm = this.engine.bpm > 20 ? this.engine.bpm : 120
    const speed = accompany.speed > 0 ? accompany.speed : 1
    const msPerPulse = 60000 / (bpm * 24 * speed)

    this.stopAccent()
    phrase.notes.forEach((played, index) => {
      const note = notes[index]
      const at = played.at * msPerPulse
      const off = at + Math.max(1, played.duration) * msPerPulse
      this.accentTimers.push(setTimeout(() => this.engine.noteOn(outputId, midi.accompChannel, note, midi.velocity), at))
      this.accentTimers.push(setTimeout(() => this.engine.noteOff(outputId, midi.accompChannel, note), off))
    })
    return true
  }

  stopAccent() {
    for (const timer of this.accentTimers) clearTimeout(timer)
    this.accentTimers = []
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
        if (this.engine.noteOn(outputId, channel, item.note, item.velocity)) this.phraseSounding.add(item.note)
      } else {
        this.engine.noteOff(outputId, channel, item.note)
        this.phraseSounding.delete(item.note)
      }
    }
  }

  stopAll() {
    this.stopAccent()
    const midi = this.settings.midi
    for (const note of this.soundingNotes) this.engine.noteOff(midi.chordOutputId, midi.chordChannel, note)
    this.soundingNotes = []
    const accompOut = midi.accompOutputId || midi.chordOutputId
    for (const note of this.phraseSounding) this.engine.noteOff(accompOut, midi.accompChannel, note)
    this.phraseSounding.clear()
    const bassOut = midi.bassOutputId || midi.chordOutputId
    for (const note of this.droneNotes) this.engine.noteOff(bassOut, midi.bassChannel, note)
    this.droneNotes = []
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
export function buildPhraseQueue(phrase, chord, event, settings, anchor = null) {
  const accompany = settings.accompany
  const chords = settings.chords
  const slot = event.endPulse - event.startPulse

  // Speed is a deliberate change of rate, unlike stretching to fit, which is an
  // accident of the chord's length. At 2 the phrase covers half the ground.
  const speed = accompany.speed > 0 ? accompany.speed : 1
  const rate = 1 / speed
  const source = Math.max(1, Math.round((phrase.lengthPulses || slot) * rate))

  // Where a phrase sits when it is not following the one before it.
  const home = [(accompany.octave ?? 4) * 12 + 12]

  const mapped = realizePhrase(
    phrase.notes.map((n) => n.note),
    { rootPc: phrase.rootPc ?? 0, pcs: phrase.sourcePcs },
    { rootPc: chord.rootPc, pcs: chord.absPcs },
    {
      home,
      anchor: accompany.keepRegister ? anchor : null,
      snapNonChordTones: accompany.snapNonChordTones,
      range: [accompany.rangeLow ?? chords.rangeLow, accompany.rangeHigh ?? chords.rangeHigh],
    }
  )

  const queue = []
  const add = (at, index, length) => {
    const stop = Math.min(at + Math.max(1, length), slot - 1)
    queue.push({ at, on: true, note: mapped[index], velocity: phrase.notes[index].velocity })
    queue.push({ at: stop, on: false, note: mapped[index], velocity: 0 })
  }

  if (accompany.fit === 'stretch') {
    // Squeeze or spread the phrase to fill the chord exactly. Musically this is
    // a tempo change -- a bar of phrase in half a bar of chord plays twice as
    // fast -- which is why it is no longer the default.
    // Stretching fills the chord exactly, so speed has nothing left to do.
    const scale = (phrase.lengthPulses || slot) > 0 ? slot / (phrase.lengthPulses || slot) : 1
    phrase.notes.forEach((played, index) => {
      const at = played.at * scale
      if (at >= slot) return
      add(at, index, played.duration * scale)
    })
  } else {
    /*
     * Natural rate: the rhythm is whatever was played, and the chord decides
     * only the harmony. `follow` keeps the pattern running with the chart, so a
     * chord lasting half a bar gets the half of the pattern that belongs to
     * that stretch of time rather than the whole thing rushed through it.
     * `restart` begins the pattern again on every chord and cuts it short.
     */
    const offset = accompany.fit === 'restart' || source <= 0 ? 0 : mod(event.startPulse, source)
    const step = source > 0 ? source : slot

    for (let pass = 0, base = -offset; base < slot && pass < 64; pass++, base += step) {
      phrase.notes.forEach((played, index) => {
        const at = base + played.at * rate
        // Only notes that begin inside this chord: one that began under the
        // chord before was already played there, and released when it changed.
        if (at < 0 || at >= slot) return
        add(at, index, played.duration * rate)
      })
    }
  }

  // Note-offs sort before note-ons at the same instant so a repeated note
  // re-articulates instead of being cut short by its own predecessor.
  queue.sort((a, b) => a.at - b.at || Number(a.on) - Number(b.on))
  return { queue, notes: mapped }
}
