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

/** CC 64. The sustain pedal, everywhere, since 1983. */
const SUSTAIN = 64

/**
 * How far before the chord change the pedal comes up, in pulses.
 *
 * It cannot come up *at* the change. Everything at a chord boundary happens on
 * one pulse, so the lift and the press that follows it land on the same sample
 * offset -- and an instrument working through a block in order sees CC64 0
 * immediately undone by CC64 127. The lift may as well not have been sent: the
 * chord sustains straight through the change, which is the smear the pedal
 * exists to avoid.
 *
 * One pulse is 1/24 of a quarter note -- about 20ms at 120bpm. Long enough to be
 * a separate event at any tempo and any block size, short enough that nothing is
 * heard to stop early. Nothing is, in fact: the notes of the outgoing chord are
 * still keyed down at that point, so the lift only damps what has already been
 * released, which is exactly what lifting a pedal does.
 */
const PEDAL_LIFT_PULSES = 1

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
    this.accent = null // armed, waiting for the next chord: { phrase, index }
    this.activePhrase = null
    this.phraseQueue = []
    this.phraseCursor = 0
    this.phraseSounding = new Set()
    // The phrase as it sounded over the last chord, so the next chord places it
    // in the register nearest to where it just was.
    this.lastPhraseNotes = null

    // Where the sustain pedal is currently held down, as [outputId, channel]
    // pairs. Remembered rather than recomputed, because the settings may have
    // changed between pressing it and having to let it go.
    this.pedalDown = []

    this.capture = { armed: false, mode: 'once', notes: [], open: new Map(), startedEvent: -1 }

    this.getPhrase = () => null
    this.onEventChange = null
    this.onCapture = null
    this.onNotes = null
    this.onAccentSpent = null
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

    // Up before the change, down again after it. @see PEDAL_LIFT_PULSES
    if (this.pedalDown.length) {
      const lift = Math.max(event.startPulse + 1, event.endPulse - PEDAL_LIFT_PULSES)
      if (position >= lift) this.releasePedal()
    }
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

    // An accent replaces whatever this chord was going to play, and is not
    // gated on the accompaniment being switched on: it is a deliberate gesture
    // rather than part of the arrangement.
    const accented = this.accentFor(event)
    const phrase = accented || (accompany.enabled && event.phraseId ? this.getPhrase(event.phraseId) : null)
    if (accented) {
      this.accent = null
      if (this.onAccentSpent) this.onAccentSpent(event)
    }
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

    if (this.pedalFor(event)) {
      const targets = []
      if (playBlock) targets.push([midi.chordOutputId, midi.chordChannel])
      if (phrase) targets.push([midi.accompOutputId || midi.chordOutputId, midi.accompChannel])
      // The two can be the same port and channel, and pressing it twice would
      // mean letting it go twice.
      const seen = new Set()
      this.pressPedal(targets.filter(([out, channel]) => {
        const key = `${out}:${channel}`
        return seen.has(key) ? false : (seen.add(key), true)
      }))
    }

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
   * Whether this chord wants the pedal.
   *
   * The chart wins where it says anything: `[p]` and `[np]` set it from the
   * point they appear, and the switch is what applies to everything before the
   * first mark and to a chart with no marks at all. @see pedalMark
   */
  pedalFor(event) {
    const marked = event ? event.pedal : null
    if (marked === true || marked === false) return marked
    return !!this.settings.accompany.pedal
  }

  /**
   * Hold the pedal for this chord, wherever this chord is sounding.
   *
   * Not simply the chord channel: in `replace` mode a bound phrase is the only
   * thing playing and it goes to the accompaniment channel, so a pedal sent to
   * the chords would be a switch that audibly did nothing. The bass drone is
   * left out -- it is already held for the whole chord by not being
   * re-articulated, and pedalling it would only tie it across the chord change.
   */
  pressPedal(targets) {
    for (const [outputId, channel] of targets) {
      if (this.engine.controlChange(outputId, channel, SUSTAIN, 127)) {
        this.pedalDown.push([outputId, channel])
      }
    }
  }

  /**
   * Let it go.
   *
   * Called from stopAll(), which every chord change and every transport stop
   * goes through -- so the pedal is lifted before the next chord sounds and
   * pressed again once it has, and there is one place that does it rather than
   * three that have to agree. Sustaining across the change is the sound of a
   * pedal nobody is listening to.
   */
  releasePedal() {
    for (const [outputId, channel] of this.pedalDown) {
      this.engine.controlChange(outputId, channel, SUSTAIN, 0)
    }
    this.pedalDown = []
  }

  /**
   * Arm the accent.
   *
   * The accent does not play over the top of what is already happening; it
   * **replaces the next phrase**, and it waits for the next chord to do it.
   * That is what makes it musical rather than a sound effect: a phrase belongs
   * to a chord, so the moment to swap one in is the moment the chord changes,
   * and pressing the button half a bar early has to mean the same thing as
   * pressing it a beat early.
   *
   * @param phrase  what to play instead
   * @param index   the event to play it on, or null for whichever comes next
   */
  armAccent(phrase, index = null) {
    this.accent = phrase && phrase.notes && phrase.notes.length ? { phrase, index } : null
    return this.accent !== null
  }

  /** Forget an armed accent that has not been spent. */
  disarmAccent() {
    const had = this.accent !== null
    this.accent = null
    return had
  }

  /** Whether this event is the one the accent has been waiting for. */
  accentFor(event) {
    if (!this.accent) return null
    if (this.accent.index !== null && this.accent.index !== event.index) return null
    return this.accent.phrase
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
    const midi = this.settings.midi
    for (const note of this.soundingNotes) this.engine.noteOff(midi.chordOutputId, midi.chordChannel, note)
    this.soundingNotes = []
    const accompOut = midi.accompOutputId || midi.chordOutputId
    for (const note of this.phraseSounding) this.engine.noteOff(accompOut, midi.accompChannel, note)
    this.phraseSounding.clear()
    const bassOut = midi.bassOutputId || midi.chordOutputId
    for (const note of this.droneNotes) this.engine.noteOff(bassOut, midi.bassChannel, note)
    this.droneNotes = []
    // After the note-offs, which is the gesture a pianist makes: the keys come
    // up and then the pedal does. Either order ends in silence -- a note-off
    // under a held pedal is deferred, not ignored -- but this is the one that
    // reads correctly in a piano roll, and leaving it out is what would ring.
    this.releasePedal()
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
