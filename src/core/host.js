/**
 * The plugin, seen from the page.
 *
 * jamin runs in two places: a browser tab, where the DAW reaches it over MIDI
 * clock, and inside the AU, where it is the plugin's editor and the host hands
 * it the playhead directly. This module is the whole of the difference. Every
 * function here answers harmlessly when there is no plugin, so the browser build
 * takes no notice of any of it.
 *
 * JUCE injects `window.__JUCE__` into the web view and exposes two primitives on
 * it: `emitEvent(id, payload)` and `addEventListener(id, fn)`. Calling a native
 * function is a convention layered on those -- emit `__juce__invoke` with a
 * result id, wait for `__juce__complete` carrying it back. JUCE ships a
 * JavaScript module that does this, and we do it here in forty lines instead:
 * one file that jamin owns and that cannot drift out of step with a vendored
 * copy of somebody else's build.
 *
 * @see docs/plugin.md
 * @see native/plugin/PluginEditor.cpp for the other end
 */

/** 24 pulses to the quarter note, the same as the MIDI clock and score.js. */
export const PULSES_PER_QUARTER = 24

/**
 * A playhead that jumps rather than advances is a locate, and everything
 * sounding has to be released. Backwards is always a locate. Forwards needs a
 * threshold, because the host reports at frame rate and a slow frame is not a
 * locate: four beats is longer than any gap a running transport produces and
 * shorter than any jump worth calling one.
 */
const LOCATE_PULSES = 4 * PULSES_PER_QUARTER

/** Nothing may wait on the plugin for ever; a call that never completes would
 *  otherwise hold its promise, and its caller, open for the session. */
const CALL_TIMEOUT_MS = 15000
// For a dialog somebody is standing in front of, and for walking a disk.
const SLOW_CALL_TIMEOUT_MS = 10 * 60 * 1000

function backend() {
  if (typeof window === 'undefined') return null
  const juce = window.__JUCE__
  return juce && juce.backend ? juce.backend : null
}

/** True when this page is the plugin's editor rather than a browser tab. */
export function hosted() {
  return backend() !== null
}

/** A value the plugin passed in at construction, before any script ran. */
export function hostData(key, fallback = null) {
  if (typeof window === 'undefined') return fallback
  const juce = window.__JUCE__
  const data = juce && juce.initialisationData ? juce.initialisationData : null
  if (!data || !(key in data)) return fallback
  const value = data[key]
  // JUCE delivers initialisation data as single-element arrays.
  return Array.isArray(value) ? (value.length ? value[0] : fallback) : value
}

/**
 * Listen for something the plugin emits. Returns a function that stops
 * listening, so a component can clean up after itself.
 */
export function onHost(eventId, handler) {
  const bus = backend()
  if (!bus) return () => {}
  const token = bus.addEventListener(eventId, handler)
  return () => {
    try {
      bus.removeEventListener(token)
    } catch {
      // Removing a listener from a web view that is already going away is not
      // a failure worth reporting to anybody.
    }
  }
}

let nextCallId = 0
const waiting = new Map()
let completeBound = false

function bindComplete() {
  if (completeBound) return
  const bus = backend()
  if (!bus) return
  completeBound = true
  bus.addEventListener('__juce__complete', ({ promiseId, result }) => {
    const pending = waiting.get(promiseId)
    if (!pending) return
    waiting.delete(promiseId)
    clearTimeout(pending.timer)
    pending.resolve(result)
  })
}

/**
 * Call a function the plugin registered. Resolves with whatever it returned.
 * In a browser this rejects immediately rather than hanging, so a caller that
 * forgot to check `hosted()` finds out at once.
 */
export function callHost(name, ...params) {
  return ask(name, CALL_TIMEOUT_MS, params)
}

/**
 * The same, for a call that is allowed to take a while.
 *
 * Fifteen seconds is the right patience for a question the plugin answers out
 * of its own memory, and the wrong patience for two things: a file dialog,
 * which waits on a person, and a walk of somebody's disk. Both of those were
 * being cut off mid-answer and reported as nothing at all.
 *
 * Still bounded, because a call that never answers would otherwise leave an
 * import running with no way out.
 */
export function callHostSlowly(name, ...params) {
  return ask(name, SLOW_CALL_TIMEOUT_MS, params)
}

function ask(name, timeout, params) {
  const bus = backend()
  if (!bus) return Promise.reject(new Error(`No plugin host for ${name}`))

  bindComplete()
  const id = nextCallId++

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error(`${name} did not answer within ${Math.round(timeout / 1000)}s`))
    }, timeout)

    waiting.set(id, { resolve, timer })
    bus.emitEvent('__juce__invoke', { name, params, resultId: id })
  })
}

/**
 * Open a link outside the web view.
 *
 * A plugin's web view cannot download a file. JUCE wires up the file-open panel,
 * so choosing a file to read works, but there is no download handling at all --
 * a link that saves something does nothing, and does it without an error. So
 * anything that would have downloaded is handed to the system browser instead,
 * which can.
 *
 * Returns true if it was handled, false if this is an ordinary tab and the link
 * should be left to behave like a link.
 */
export async function openOutside(url) {
  if (!hosted()) return false
  try {
    return Boolean(await callHost('jaminOpenUrl', String(url)))
  } catch {
    return false
  }
}

/**
 * The host's transport, in the shape the player already understands.
 *
 * In a browser the clock arrives as a stream of 0xF8 bytes and MidiEngine counts
 * them. In the plugin there is no clock and no counting: the host reports where
 * the playhead is, several times a frame, and the pulse is arithmetic. That is
 * strictly better -- it cannot drift, it survives a dropped message, and a
 * locate is a number changing rather than something to be inferred -- and it is
 * why every instance agrees about the time without anything being shared
 * between them.
 *
 * `update` is deliberately pure of anything browser-shaped so it can be tested
 * without a host. @see tests/host.test.js
 */
export class HostClock {
  constructor() {
    this.running = false
    this.bpm = 120
    this.pulse = 0
    this.ppq = 0
    this.numerator = 4
    this.denominator = 4
    this.hasPlayhead = false

    // How many reports have arrived. Zero while playing is the whole diagnosis
    // when somebody says the plugin does not know the DAW is running.
    this.messages = 0

    // The same two hooks MidiEngine offers, so the store wires either one the
    // same way.
    this.onTick = null
    this.onTransport = null

    this._lastPulse = null
  }

  /** Subscribe to the plugin. Returns a function that unsubscribes. */
  attach() {
    return onHost('jaminTransport', (message) => this.update(message))
  }

  /**
   * One report from the host. Emits a transport change when the state actually
   * changed and a tick when the playhead moved, and nothing at all when neither
   * did -- an idle instance should cost nothing.
   */
  update(message) {
    if (!message) return
    this.messages++

    if (typeof message.bpm === 'number' && message.bpm > 0) this.bpm = message.bpm
    if (typeof message.numerator === 'number') this.numerator = message.numerator
    if (typeof message.denominator === 'number') this.denominator = message.denominator
    if (typeof message.hasPlayhead === 'boolean') this.hasPlayhead = message.hasPlayhead

    const playing = Boolean(message.playing)
    const ppq = typeof message.ppq === 'number' && isFinite(message.ppq) ? message.ppq : 0

    // A host counting in can report a negative position. There is no such pulse.
    this.ppq = ppq
    const pulse = Math.max(0, Math.round(ppq * PULSES_PER_QUARTER))

    if (playing !== this.running) {
      this.running = playing
      this._lastPulse = playing ? null : this._lastPulse
      if (this.onTransport) this.onTransport(playing ? 'start' : 'stop')
    }

    if (!playing) {
      this.pulse = pulse
      return
    }

    const jumped = this._lastPulse !== null
      && (pulse < this._lastPulse || pulse - this._lastPulse > LOCATE_PULSES)

    if (jumped && this.onTransport) this.onTransport('position')

    const moved = this._lastPulse === null || pulse !== this._lastPulse
    this._lastPulse = pulse
    this.pulse = pulse

    if (moved && this.onTick) this.onTick(pulse)
  }

  /** Forget where the playhead was, so the next report counts as fresh. */
  reset() {
    this._lastPulse = null
    this.running = false
    this.pulse = 0
    this.messages = 0
  }
}
