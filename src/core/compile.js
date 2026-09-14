/**
 * The song, compiled.
 *
 * A chart plus a phrase plus the settings is a fixed list of notes at fixed
 * pulses. Nothing about it depends on what happens at play time, so it can be
 * worked out once, ahead of the playhead, and performed by something that knows
 * nothing about harmony. That is what the plugin does: this produces the list,
 * and native C++ plays it against the host's transport.
 *
 * **It does not reimplement any of that.** It runs the real Player against a
 * synthetic clock, with an engine that writes down what it was asked to send
 * instead of sending it. So the compiled sequence is, by construction, exactly
 * what the browser would have played -- including every correction the player
 * has ever had -- and it cannot drift, because there is nothing to drift from.
 *
 * This module is also the plugin's only entry point into the music code, and it
 * is deliberately free of anything browser-shaped: no DOM, no storage, no fetch.
 * That is what lets it run headless in JavaScriptCore inside the plugin, so the
 * chart still compiles when the editor window is shut.
 *
 * @see native/plugin/Compiler.h
 * @see docs/plugin.md
 */

import { parseScore } from './score.js'
import { Player } from './player.js'
import { WHOLE_SONG } from './drumBindings.js'

/**
 * The parse options the chart is read with.
 *
 * Exported because the application parses the same text for the screen and the
 * plugin compiles it for the ear, and the two disagreeing would be a chart that
 * looks like one thing and plays as another.
 */
export function scoreOptions(settings, songPhrase = null) {
  const chords = settings.chords
  return {
    beatsPerBar: settings.transport.beatsPerBar,
    mergeRepeats: chords.mergeRepeats,
    perChordPhrases: settings.accompany.perChordPhrases,
    songPhrase,
    conventions: {
      omitThirdOnDominant11: chords.omitThirdOnDominant11,
      omitElevenOnThirteen: chords.omitElevenOnThirteen,
    },
  }
}

/**
 * An engine that writes down what it was told to play.
 *
 * The Player talks to a MIDI port; this answers to exactly the part of that it
 * uses. `noteOn` reports success, as a real port does when it accepted the note
 * -- the player only remembers notes that got through, and a recorder that said
 * no would produce a sequence with no note-offs in it at all.
 *
 * Ports do not exist inside a plugin: the host decides where the track goes. So
 * the port is dropped here and only the channel survives, which is the part the
 * user set and the only part a plugin can honour.
 */
class Recorder {
  constructor() {
    this.pulse = 0
    this.events = []
  }

  noteOn(_outputId, channel, note, velocity) {
    if (note < 0 || note > 127) return false
    this.events.push([this.pulse, 0x90 | (clampChannel(channel) & 0x0f), note, clampVelocity(velocity)])
    return true
  }

  noteOff(_outputId, channel, note) {
    if (note < 0 || note > 127) return false
    this.events.push([this.pulse, 0x80 | (clampChannel(channel) & 0x0f), note, 0])
    return true
  }

  /** The sustain pedal reaches the plugin as an ordinary status byte, because
      a sequence event is a status and two data bytes and always was. */
  controlChange(_outputId, channel, controller, value) {
    if (controller < 0 || controller > 127) return false
    this.events.push([
      this.pulse,
      0xb0 | (clampChannel(channel) & 0x0f),
      controller,
      Math.min(127, Math.max(0, value | 0)),
    ])
    return true
  }
}

// Channels are zero-based throughout jamin -- MidiEngine sends `0x90 | channel`
// straight out -- so this is a range check and not a conversion. Treating them
// as one-based here put every note a channel low, which the suite caught and a
// DAW would have reported as silence.
const clampChannel = (channel) => Math.min(15, Math.max(0, channel | 0))
const clampVelocity = (velocity) => Math.min(127, Math.max(1, velocity | 0))

/**
 * Compile a chart into a sequence.
 *
 * @param {object} request
 * @param {string} request.text        the chart as typed
 * @param {object} request.settings    the whole settings object
 * @param {object} [request.phrases]   phrase id -> phrase, already resolved by
 *                                     the page, because the catalogue is a
 *                                     browser thing and this is not
 * @param {object} [request.grooves]  groove id -> groove, resolved by the page
 *                                     for the same reason the phrases are
 * @param {object} [request.drumBindings] section name -> { groove, fill }
 * @param {string} [request.songPhrase] the phrase bound to the whole song
 * @param {number} [request.accentAt]  an event index whose phrase is replaced by
 *                                     the accent, or absent for none
 * @param {number} [request.generation] echoed back, so a stale answer is
 *                                     recognisable as one
 */
export function compileSong(request) {
  const settings = request && request.settings
  const text = request && typeof request.text === 'string' ? request.text : ''
  const generation = (request && request.generation) || 0

  if (!settings) return { events: [], lengthPulses: 0, generation, chords: 0 }

  const score = parseScore(text, scoreOptions(settings, request.songPhrase || null))
  const total = score.totalPulses | 0
  if (!total || !score.events.length) {
    return { events: [], lengthPulses: 0, generation, chords: score.events.length }
  }

  const phrases = request.phrases || {}
  const recorder = new Recorder()
  const player = new Player(recorder, settings)
  player.getPhrase = (id) => phrases[id] || null

  // The drums, resolved the same way and for the same reason: the catalogue is
  // two and a half thousand grooves in a browser's memory, and the compiler
  // runs inside a plugin that has neither.
  const grooves = request.grooves || {}
  const bindings = request.drumBindings || {}
  const bound = (span, what) => {
    // What the chart said beats what the drum book has bound, which is the same
    // order of precedence the pedal marks use.
    if (what === 'groove' && span.groove && grooves[span.groove]) return grooves[span.groove]
    const row = bindings[span.sectionName ?? WHOLE_SONG] || bindings[WHOLE_SONG] || {}
    const id = what === 'fill' ? row.fill : row.groove
    return (id && grooves[id]) || null
  }
  player.getGroove = (span) => bound(span, 'groove')
  player.getFill = (span) => bound(span, 'fill')

  player.setScore(score)

  // The accent replaces one chord's phrase, and which chord is decided by
  // whoever pressed the button -- the page works out where the playhead will be
  // by the time this compile lands and names that event.
  if (typeof request.accentAt === 'number' && request.accent) {
    player.armAccent(request.accent, request.accentAt)
  }

  // One pass, a pulse at a time. The player is a state machine driven by the
  // clock, so this is the clock -- and stepping it rather than sampling it is
  // what makes the result identical to a real performance instead of merely
  // similar to one.
  for (let pulse = 0; pulse < total; pulse++) {
    recorder.pulse = pulse
    player.tick(pulse)
  }

  // Whatever is still held at the end has to be released, and the place for
  // those releases is the top of the next pass -- the sequence loops, so pulse
  // `total` is never reached. Recorded at pulse 0 and moved to the front, so
  // they precede that pass's note-ons rather than cancelling them.
  const heldFrom = recorder.events.length
  recorder.pulse = 0
  player.stopAll()
  const releases = recorder.events.splice(heldFrom)
  recorder.events.unshift(...releases)

  return {
    events: recorder.events,
    lengthPulses: total,
    generation,
    chords: score.events.length,
  }
}

/**
 * The entry point the plugin calls, across a boundary that only carries strings.
 * Never throws: a compiler that throws inside a JSContext takes the audio thread
 * to silence with no way to say why, so a failure comes back as an empty
 * sequence carrying its own explanation.
 */
export function compileJson(json) {
  try {
    return JSON.stringify(compileSong(JSON.parse(json)))
  } catch (error) {
    return JSON.stringify({
      events: [],
      lengthPulses: 0,
      generation: 0,
      error: String((error && error.message) || error),
    })
  }
}
