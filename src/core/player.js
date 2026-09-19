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
import { buildDrumTrack } from './drums.js'
import { kitById, cleanKitMap } from './drumKits.js'
import { ChordListener } from './chordDetect.js'

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

/**
 * Notes that are on, and the port and channel each one went out on.
 *
 * Every hung note this program has produced has had the same shape: a
 * note-on was sent, something changed, and the note-off went somewhere else
 * or was never sent at all. Remembering only the pitch is what makes that
 * possible -- releasing it means asking the settings where it *would* go now,
 * and "now" is after whatever changed.
 *
 * So the address is remembered with the note. A note released through this is
 * released where it was sounded, whatever has happened to the settings since:
 * the accompaniment moved to another port, the channel changed, the part
 * switched from phrases to drums. None of those can strand it any more.
 *
 * The engine keeps its own ledger for the panic button, which is a different
 * thing: that one is every note *any* part turned on, and is the last resort.
 * This one is per part, so one part can be silenced without silencing the
 * others. @see core/midi.js panic
 */
class Held {
  /**
   * @param where a function returning what to send through. A function
   *   rather than the thing itself because the live path's way out changes:
   *   in a browser it is the MIDI engine, and inside a plugin the page has no
   *   MIDI output at all and it is a call into the processor.
   */
  constructor(where) {
    this.where = typeof where === 'function' ? where : () => where
    this.notes = new Map()
  }

  /** @returns {boolean} whether it reached a port, and was therefore kept. */
  on(out, channel, note, velocity) {
    if (!this.where().noteOn(out, channel, note, velocity)) return false
    this.notes.set(`${out}:${channel}:${note}`, { out, channel, note })
    return true
  }

  off(out, channel, note) {
    this.where().noteOff(out, channel, note)
    this.notes.delete(`${out}:${channel}:${note}`)
  }

  /** Everything, released where it was sent. */
  release() {
    const to = this.where()
    for (const one of this.notes.values()) to.noteOff(one.out, one.channel, one.note)
    this.notes.clear()
  }

  get size() { return this.notes.size }

  /** The pitches, for anything that wants to know what is ringing. */
  pitches() { return [...this.notes.values()].map((one) => one.note) }
}

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
    // What is actually held down right now, and where each note went. @see Held
    this.chordHeld = new Held(engine)
    this.droneHeld = new Held(engine)  // the held root under the accompaniment
    this.accent = null // armed, waiting for the next chord: { phrase, index }
    this.activePhrase = null
    this.phraseQueue = []
    this.phraseCursor = 0
    this.phraseHeld = new Held(engine)
    // The phrase as it sounded over the last chord, so the next chord places it
    // in the register nearest to where it just was.
    this.lastPhraseNotes = null

    // Where the sustain pedal is currently held down, as [outputId, channel]
    // pairs. Remembered rather than recomputed, because the settings may have
    // changed between pressing it and having to let it go.
    this.pedalDown = []

    // The drum part, worked out once when the chart changes rather than decided
    // beat by beat. It depends on nothing that happens at play time.
    this.drumTrack = []
    this.drumCursor = 0
    this.drumHeld = new Held(engine)
    /** Armed, waiting for the next section. @see armDrumAccent */
    this.drumAccent = null

    /**
     * Mr. Accompany Me, listening.
     *
     * It used to wait for a chord to be written down and record what was played
     * over it. Now the playing comes first: the notes are heard, named as a
     * chord, and that chord is articulated. Nothing is kept -- there is no
     * recording here, only what is sounding now.
     */
    this.listener = new ChordListener()
    this.listener.onChord = (heard) => this.hearChord(heard)
    this.live = {
      heard: null,          // what detectChord last said, or null
      phrase: null,
      queue: [],
      cursor: 0,
      startPulse: 0,
      lengthPulses: 0,
    }
    /*
     * Where a heard chord goes out.
     *
     * The chart's own notes are not sent from here when jamin is a plugin --
     * the page compiles the song and the processor performs it -- but a chord
     * somebody is playing right now cannot be compiled in advance, so the
     * live path is the one thing that has to leave the page in real time. In
     * a browser that is the MIDI engine; in a plugin the application points
     * this at the processor. @see store.js liveOutput
     */
    this.liveOut = engine
    this.liveHeld = new Held(() => this.liveOut)

    /**
     * Latched: the hands can come off and the chord goes on.
     *
     * The "Chord Hold" of an arranger keyboard -- what lets somebody take a
     * hand off the chord and play over it. Bound to the sustain pedal by
     * default, which is the pedal already under their foot.
     */
    this.holding = false
    /**
     * Which part this instance is playing: `phrases` or `drums`.
     *
     * Not a setting. It belongs to the track rather than to the person -- one
     * instance on a piano and one on a kit is the ordinary arrangement -- so it
     * does not follow somebody into their next session.
     */
    this.sends = 'phrases'
    /** Note numbers somebody has silenced. @see store.setDrumVoiceMuted */
    this.mutedNotes = new Set()

    /** The phrase a heard chord is played through. The catalogue is the
        application's, so the application chooses. */
    this.getLivePhrase = () => null
    this.onHeard = null

    this.getPhrase = () => null
    /** name or span -> a groove. The catalogue is a browser thing, as the
        phrase catalogue is, so the application supplies it. */
    this.getGroove = () => null
    this.getFill = () => null
    /** The drum instrument on this track: one kit, every groove through it.
        Which library a groove came from is the *inbound* question, below.
        @see store.kitMapFor */
    this.getKitMap = () => ({ ...kitById(this.settings.drums.kit).map,
                              ...cleanKitMap(this.settings.drums.customMap) })
    /** How an arriving note is read. Null means the shipped corpus's own
        table, which is what an unimported groove is written in. */
    this.getInboundMap = () => null
    this.onEventChange = null
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
    this.rebuildDrums()

    const event = previous ? eventAtPulse(score, this.position, this.settings.transport.loop) : null
    const stays = Boolean(event && sameChord(event.chord, previous.chord))
    /*
     * Whatever is bound to this chord has to still be the thing that is
     * playing, or what is playing has to stop.
     *
     * The chord surviving an edit is not enough. Point the same chord at a
     * different phrase and the queue in hand belongs to the old one -- every
     * note-off still to come is for notes the new phrase never sounded, and
     * the notes actually ringing have no note-off anywhere at all. Same for
     * an accent armed or spent. So the binding is compared as well as the
     * chord, and a change is treated as a change.
     */
    const rebound = stays
      && (event.phraseId !== previous.phraseId || event.pedal !== previous.pedal)

    if (stays && !rebound) {
      this.current = event
      this.currentIndex = event.index
      // The slot may have moved or changed length; re-place the phrase cursor
      // so the rest of this chord still lines up.
      this.phraseCursor = 0
      const local = this.position - event.startPulse
      while (this.phraseCursor < this.phraseQueue.length && this.phraseQueue[this.phraseCursor].at <= local) {
        this.phraseCursor++
      }
      return
    }

    /*
     * And this is where the notes were left hanging.
     *
     * Forgetting the current event without releasing what it sounded meant
     * the note-offs were owed to an event that no longer existed. Sometimes
     * the next tick collected the debt -- `startEvent` stops everything
     * first -- and sometimes nothing ever did: delete the chord under the
     * playhead and there is no next event to start; delete the last one and
     * `tick` returns before it looks; stop the transport and there is no
     * next tick at all. In a DAW that is a note held until the track is
     * disarmed.
     *
     * Editing a chart while it plays is the ordinary way to use this
     * program, so the ordinary case has to be right rather than usually
     * right.
     */
    this.stopAll()
    this.current = null
    this.currentIndex = -1
  }

  /* ---------------- clock ---------------- */

  tick(rawPulse) {
    const transport = this.settings.transport
    const offset = transport.latencyPulses || 0

    /*
     * A chart with nothing in it is still a clock, and somebody may be
     * playing into it.
     *
     * This used to return here, which made Mr. Accompany Me useless on an
     * empty notepad -- the one state somebody is in when they open jamin to
     * play rather than to read. The chord is heard, named and articulated
     * against the bare clock, through the last articulation chosen; there is
     * no chart to take a phrase from, and `liveSlot` has always known how
     * long a bar is without one.
     *
     * The release is the other half: clearing the text while it played used
     * to leave the last chord ringing, because this returned before it
     * looked at what was held.
     */
    if (!this.score || !this.score.events.length) {
      if (this.chordHeld.size || this.phraseHeld.size || this.droneHeld.size
          || this.drumHeld.size) {
        this.stopAll()
      }
      this.position = Math.max(0, rawPulse + offset)
      this.lastPosition = this.position
      this.hearTick()
      this.flushLive(this.position)
      return
    }
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
    // Settled on the clock as well as from the interface, so a chord heard
    // mid-bar is articulated on the next pulse rather than on the next frame.
    this.hearTick()
    this.flushLive(position)
    // Driven from the song position, not the chord: a groove runs across chord
    // changes and stops at a section, which is a different clock.
    this.flushDrums(position, wrapped)

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
    this.forgetHeld()
    this.stopAll()
    // Unlike a chord change, this really is the drums starting again.
    this.drumCursor = 0
    this.current = null
    this.currentIndex = -1
    this.lastPosition = 0
    this.lastPhraseNotes = null
  }

  /* ---------------- chord + phrase events ---------------- */

  startEvent(event) {
    this.stopAll()

    this.current = event
    this.currentIndex = event.index

    // Somebody playing beats the chart, when they have asked for that. The
    // event still runs -- the drums and the pedal follow the song, not the
    // hands -- but the harmony comes from the keyboard.
    if (this.overriding()) {
      this.activePhrase = null
      this.phraseQueue = []
      this.phraseCursor = 0
      if (this.onEventChange) this.onEventChange(event, { notes: [], phrase: null })
      return
    }

    const chord = event.chord
    if (!chord || !chord.ok) {
      if (this.onEventChange) this.onEventChange(event, { notes: [], phrase: null })
      return
    }

    const chords = this.settings.chords
    const midi = this.settings.midi
    const accompany = this.settings.accompany

    /*
     * One output, one part.
     *
     * A plugin plays into the track it is on, so everything it sends arrives at
     * the same instrument -- and a drum sampler takes every note on every
     * channel. Ableton's Drum Rack does not look at the channel at all, so
     * chords land on whichever pads sit under them and the kit plays the
     * harmony. Sending both is not a preference, it is a mistake with a
     * setting in front of it.
     *
     * So it is one or the other. @see sends
     */
    if (this.sends === 'drums') {
      this.activePhrase = null
      this.phraseQueue = []
      this.phraseCursor = 0
      this.chordNotes = []
      if (this.onEventChange) this.onEventChange(event, { notes: [], phrase: null })
      if (this.onNotes) this.onNotes([])
      return
    }

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
    if (playBlock) {
      // Only notes that actually reached a port are remembered. With no output
      // bound yet, recording them anyway would fire note-offs for notes that
      // were never turned on the moment a port is chosen.
      for (const note of voicing.notes) {
        this.chordHeld.on(midi.chordOutputId, midi.chordChannel, note, midi.velocity)
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
      this.droneHeld.on(outputId, midi.bassChannel, note, midi.velocity)
    }
  }

  /**
   * Arm a groove to replace the next section's.
   *
   * The phrase accent waits for a chord; this waits for a section, because that
   * is the unit a drummer thinks in -- firing a new groove halfway through a
   * verse is a mistake, not a gesture.
   */
  armDrumAccent(groove) {
    this.drumAccent = groove || null
    this.rebuildDrums()
    return this.drumAccent !== null
  }

  /**
   * The drum part for this chart, in this kit.
   *
   * Rebuilt whenever the chart changes, which is every keystroke -- so it is
   * built from the parsed score rather than re-read from anywhere, and it is
   * nothing but arithmetic over a list that is already in memory.
   */
  rebuildDrums() {
    this.drumTrack = []
    this.drumCursor = 0

    const drums = this.settings.drums
    if (!drums || !drums.enabled || !this.score) return

    // The accent replaces whatever the next section was going to play, and is
    // not gated on the bindings: it is a deliberate gesture rather than part of
    // the arrangement, which is how the phrase accent works too.
    const accent = this.drumAccent
    let spent = false

    // The map is asked for per groove rather than fixed for the track: an
    // imported library is written for its own instrument, and a chart can use
    // one section from one library and the next from another.
    this.drumTrack = buildDrumTrack(this.score, {
      groove: (span) => {
        if (accent && !spent) { spent = true; return accent }
        return this.getGroove(span)
      },
      fill: (span) => this.getFill(span),
      map: (groove) => this.getKitMap(groove),
      inbound: (groove) => this.getInboundMap(groove),
      fillOnEveryBoundary: drums.fillOnEveryBoundary !== false,
    })
  }

  /**
   * Everything the drums do between the last pulse and this one.
   *
   * Played literally. Nothing here goes near the voice leading: a drum note is
   * an instrument and not a pitch, and transposing one turns a snare into a
   * tom. It is the one part of jamin that plays exactly what it was given.
   */
  flushDrums(position, wrapped) {
    if (this.sends !== 'drums') return

    if (!this.drumTrack.length) return

    const midi = this.settings.midi
    const outputId = midi.drumOutputId || midi.chordOutputId
    const channel = midi.drumChannel ?? 9

    if (wrapped) {
      this.stopDrums()
      this.drumCursor = 0
    }

    // The cursor only ever moves forward, so a locate backwards has to find its
    // place again rather than play the whole song to catch up.
    if (this.drumCursor > 0 && this.drumTrack[this.drumCursor - 1].at > position) {
      this.stopDrums()
      this.drumCursor = 0
    }

    while (this.drumCursor < this.drumTrack.length
           && this.drumTrack[this.drumCursor].at <= position) {
      const hit = this.drumTrack[this.drumCursor++]
      // A drum somebody has taken out. Not sent at velocity nought: a note-on
      // at zero is a note-off, and a stream of those is not silence.
      //
      // Unquantised here on purpose. In a browser there is no separate audio
      // thread reading a compiled sequence, so the change is simply the state
      // from the next hit -- and the next hit of the drum being silenced is
      // exactly where a bar line would have put it for every pattern that
      // strikes it on the one. @see store.setDrumVoiceMuted
      if (this.mutedNotes && this.mutedNotes.has(hit.note)) continue
      this.drumHeld.on(outputId, channel, hit.note, hit.velocity)
    }

    // Drums are struck, not held: the note-off is a formality the instrument
    // ignores, but leaving them on would stack a hundred held notes on one
    // channel and some samplers do count them.
    this.drumHeld.release()
  }

  stopDrums() {
    this.drumHeld.release()
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
        this.phraseHeld.on(outputId, channel, item.note, item.velocity)
      } else {
        this.phraseHeld.off(outputId, channel, item.note)
      }
    }
  }

  stopAll() {
    // Each to the port and channel it was sounded on, which is not necessarily
    // where the settings point now. @see Held
    this.chordHeld.release()
    this.phraseHeld.release()
    this.droneHeld.release()
    // What the hands are holding is *not* stopped here. stopAll() runs on every
    // chord change and the hands do not answer to chords -- the same rule the
    // drums follow. A real stop goes through transport(), which calls
    // forgetHeld().

    // After the note-offs, which is the gesture a pianist makes: the keys come
    // up and then the pedal does. Either order ends in silence -- a note-off
    // under a held pedal is deferred, not ignored -- but this is the one that
    // reads correctly in a piano roll, and leaving it out is what would ring.
    this.releasePedal()
    this.phraseQueue = []
    this.phraseCursor = 0
    // The sounding notes go, but *not* the cursor. stopAll() runs on every
    // chord change, and the drums do not answer to chords -- a groove runs
    // across them and stops at a section. Resetting here replayed every hit in
    // the song from the top at each new chord, which is as bad as it sounds.
    // A real stop goes through transport(), which does reset it.
    this.stopDrums()
    if (this.onNotes) this.onNotes([])
  }

  /* ---------------- Mr. Accompany Me ----------------
   *
   * It listens now rather than recording. Notes arrive, the chord they make is
   * named, and that chord is played through a phrase -- all of it while the
   * keys are still down. Nothing is stored: what you hear is what is being
   * held, and letting go ends it.
   *
   * Two ways to sit with the chart, and it is a real choice rather than a
   * default with an escape hatch:
   *
   *   merge      the chart plays its own chords and this plays over the top.
   *              Two parts, which is what a second player in the room is.
   *   override   while anything is held the chart's harmony gives way and the
   *              hands decide it. The drums and the pedal still follow the
   *              song, because they follow the song and not the hands.
   */

  /** True while somebody is holding something and has asked to be in charge. */
  overriding() {
    const accompany = this.settings.accompany
    return Boolean(accompany.listen && accompany.liveMode === 'override' && this.live.heard)
  }

  /** One note in or out, from a keyboard or from the host. */
  noteIn(note, velocity, on, now = Date.now()) {
    const midi = this.settings.midi
    if (this.settings.accompany.monitor && midi.accompOutputId) {
      if (on) this.engine.noteOn(midi.accompOutputId, midi.accompChannel, note, velocity)
      else this.engine.noteOff(midi.accompOutputId, midi.accompChannel, note)
    }

    if (!this.settings.accompany.listen) return
    this.listener.settleMs = this.settings.accompany.settleMs || 60
    this.listener.note(note, on, now)
  }

  /**
   * Give the listener a chance to settle.
   *
   * Called from the clock and from the interface both, because a chord is worth
   * naming on screen whether or not the transport is rolling -- it just cannot
   * be *articulated* while stopped, since a phrase is a rhythm and a stopped
   * transport has no time to lay it on.
   */
  hearTick(now = Date.now()) {
    if (!this.settings.accompany.listen) {
      if (this.live.heard) this.hearChord(null)
      return
    }
    this.listener.tick(now)
  }

  /**
   * A chord was heard, or the hands came off.
   *
   * The phrase is built the same way the chart builds one -- same function,
   * same voice leading -- over a slot of its own making. @see buildPhraseQueue
   */
  hearChord(heard) {
    /*
     * Latched, so the hands coming off is not the chord ending.
     *
     * Only the hands lifting is ignored. A new chord still replaces the old
     * one and is held in its turn, which is what makes this playable: the
     * left hand moves from chord to chord and the right is free the whole
     * time. Letting go of Hold is what ends it. @see setHolding
     */
    if (!heard && this.holding && this.live.heard) return

    this.stopLive()
    this.live.heard = heard || null

    if (heard) {
      const phrase = this.getLivePhrase()
      this.live.phrase = phrase || null
      if (phrase) {
        const event = this.liveSlot()
        const built = buildPhraseQueue(phrase, heard.chord, event, this.settings, null)
        this.live.queue = built.queue
        this.live.startPulse = this.position
        this.live.lengthPulses = event.endPulse - event.startPulse
        this.live.cursor = 0
      }
    } else {
      this.live.phrase = null
      this.live.queue = []
      this.live.lengthPulses = 0
    }

    // The chart was holding its tongue for a chord that has now gone, so it
    // needs to be asked again.
    if (!heard && this.settings.accompany.liveMode === 'override' && this.current) {
      const resume = this.current
      this.currentIndex = -1
      this.startEvent(resume)
    }

    if (this.onHeard) this.onHeard(heard)
  }

  /**
   * The slot a heard chord is laid over.
   *
   * A written chord knows how long it lasts because the bar says so. A held one
   * does not -- it lasts until the hands move -- so it is given a length and
   * repeats for as long as it is held. A bar is the default because a phrase is
   * written to fill one.
   */
  liveSlot() {
    const bars = Math.max(1, this.settings.accompany.liveBars || 1)
    const perBar = this.score && this.score.pulsesPerBar ? this.score.pulsesPerBar : 96
    const length = bars * perBar
    return {
      index: -1,
      startPulse: 0,
      endPulse: length,
      bars,
      chord: this.live.heard ? this.live.heard.chord : null,
      phraseId: null,
    }
  }

  /**
   * The heard chord's notes, up to here.
   *
   * Loops rather than stopping: the hands are still down, so the phrase comes
   * round again. Rebuilt on each pass so the voice leading carries on from
   * where it was rather than jumping back.
   */
  flushLive(position) {
    if (!this.live.queue.length || !this.live.lengthPulses) return

    const midi = this.settings.midi
    const outputId = midi.accompOutputId || midi.chordOutputId
    const channel = midi.accompChannel

    let local = position - this.live.startPulse
    if (local < 0) {
      // The transport looped underneath a held chord.
      this.live.startPulse = position
      local = 0
      this.live.cursor = 0
    }

    while (local >= this.live.lengthPulses) {
      this.live.startPulse += this.live.lengthPulses
      local -= this.live.lengthPulses
      this.live.cursor = 0
    }

    let guard = 0
    while (this.live.cursor < this.live.queue.length && guard++ < 256) {
      const item = this.live.queue[this.live.cursor]
      if (item.at > local) break
      this.live.cursor++
      if (item.on) this.liveHeld.on(outputId, channel, item.note, item.velocity)
      else this.liveHeld.off(outputId, channel, item.note)
    }
  }

  /** Everything the heard chord has sounding, off. */
  stopLive() {
    this.liveHeld.release()
    this.live.cursor = 0
  }

  /**
   * Hold, pressed or let go.
   *
   * Letting go only ends the chord if the hands are already off it. Somebody
   * lifting their foot while still holding the keys has not stopped playing
   * the chord, and taking it away from under them would be a hole in the
   * middle of a bar.
   */
  setHolding(on) {
    const next = Boolean(on)
    if (next === this.holding) return
    this.holding = next
    if (!next && !this.listener.holding) this.hearChord(null)
  }

  /** The hands are off, whatever the keyboard thinks. A locate or a stop. */
  forgetHeld() {
    // Including a latched chord. A stop is not the hands moving -- it is the
    // music ending -- and a chord left latched across it would come back
    // sounding on its own.
    this.holding = false
    this.listener.clear()
    this.live.heard = null
    this.live.queue = []
    this.stopLive()
    this.live.heard = null
    this.live.queue = []
    this.live.phrase = null
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
