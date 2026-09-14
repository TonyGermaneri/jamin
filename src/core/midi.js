/**
 * Web MIDI plumbing: ports, clock, note IO.
 *
 * The DAW is in charge.  We listen for clock (0xF8), start/continue/stop and
 * song position, and derive everything else -- tempo, bar, beat -- from that.
 * Nothing here decides when a chord should play; that is the player's job.
 *
 * Access is requested as soon as the app loads and the ports light up the
 * moment the browser grants permission, so the only thing left for the user to
 * do is pick which ports to use.
 */

export const CLOCK = 0xf8
export const START = 0xfa
export const CONTINUE = 0xfb
export const STOP = 0xfc
export const SONG_POSITION = 0xf2
export const PPQN = 24

export const ANY_INPUT = '__any__'

export class MidiEngine {
  constructor() {
    this.access = null
    this.state = 'idle' // idle | requesting | ready | denied | unsupported
    this.error = null
    this.inputs = []
    this.outputs = []

    this.clockInputId = ''
    this.accompInputId = ''

    this.running = false
    this.pulse = 0
    this.bpm = 120
    this.lastClockAt = 0
    this.clockSeen = false
    this.autoStartOnClock = true
    // With no clock source chosen, watch every input and adopt whichever one is
    // actually sending clock. Binding ports is the one job left to the user;
    // this removes most of it.
    this.autoDetectClock = true
    this._clockCandidates = new Map()
    // Some DAWs send clock the whole time, stopped or not. Once we have seen an
    // explicit Stop we wait for a real Start before running again.
    this._sawStop = false

    this.internalEnabled = false
    this.internalTempo = 120
    this._internalTimer = null
    this._internalNext = 0

    // Hooks, assigned by the app.
    this.onTick = null
    this.onTransport = null
    this.onNoteIn = null
    this.onControl = null
    this.onPortsChanged = null
    this.onClockDetected = null

    this._sounding = new Map() // `${outputId}:${channel}:${note}` -> true
    this._handle = this._handle.bind(this)
  }

  /** Ask for access. Ports are auto-listed and auto-listened the instant we get it. */
  async enable() {
    if (!navigator.requestMIDIAccess) {
      this.state = 'unsupported'
      this.error = 'This browser has no Web MIDI. Chrome, Edge and Opera do.'
      return false
    }
    if (this.state === 'ready') return true
    this.state = 'requesting'
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
      this.state = 'ready'
      this.access.onstatechange = () => this._refresh()
      this._refresh()
      return true
    } catch (err) {
      this.state = 'denied'
      this.error = err && err.message ? err.message : String(err)
      return false
    }
  }

  _refresh() {
    if (!this.access) return
    this.inputs = [...this.access.inputs.values()].map(describe)
    this.outputs = [...this.access.outputs.values()].map(describe)
    // One listener per input, dispatched by id -- rebinding a port is then just
    // a variable change, no listener churn.
    for (const input of this.access.inputs.values()) input.onmidimessage = this._handle
    if (this.onPortsChanged) this.onPortsChanged(this.inputs, this.outputs)
  }

  _input(id) {
    if (!this.access || !id) return null
    return this.access.inputs.get(id) || null
  }

  output(id) {
    if (!this.access || !id) return null
    return this.access.outputs.get(id) || null
  }

  _handle(event) {
    const data = event.data
    if (!data || !data.length) return
    const status = data[0]
    const portId = event.target && event.target.id

    if (status >= 0xf8 || status === SONG_POSITION) {
      if (this._listensForClock(portId)) this._clockMessage(status, data, event.timeStamp)
      else if (status === CLOCK) this._considerClockSource(portId)
      return
    }

    const type = status & 0xf0

    // Control changes go to the app from any input: a pedal or a fader used to
    // fire something is rarely on the port the notes come from.
    if (type === 0xb0) {
      if (this.onControl) this.onControl(data[1], data[2] ?? 0, portId)
      return
    }

    if (type !== 0x90 && type !== 0x80) return
    if (!this._listensForAccomp(portId)) return

    const note = data[1]
    const velocity = data[2] ?? 0
    const on = type === 0x90 && velocity > 0
    if (this.onNoteIn) this.onNoteIn(note, velocity, on, event.timeStamp)
  }

  /**
   * A port nobody asked us to listen to is sending clock. Take a few pulses to
   * be sure it is a steady source rather than a stray byte, then adopt it.
   */
  _considerClockSource(portId) {
    if (!this.autoDetectClock || this.clockInputId || !portId) return
    const seen = (this._clockCandidates.get(portId) || 0) + 1
    this._clockCandidates.set(portId, seen)
    if (seen < 8) return
    this.clockInputId = portId
    this._clockCandidates.clear()
    const port = this.inputs.find((candidate) => candidate.id === portId)
    if (this.onClockDetected) this.onClockDetected(portId, port ? port.name : portId)
  }

  _listensForClock(portId) {
    if (!this.clockInputId) return false
    return this.clockInputId === ANY_INPUT || this.clockInputId === portId
  }

  _listensForAccomp(portId) {
    if (!this.accompInputId) return false
    return this.accompInputId === ANY_INPUT || this.accompInputId === portId
  }

  _clockMessage(status, data, timeStamp) {
    switch (status) {
      case CLOCK: {
        this.clockSeen = true
        if (this.lastClockAt) {
          const delta = timeStamp - this.lastClockAt
          if (delta > 0.5 && delta < 200) {
            const instant = 60000 / (delta * PPQN)
            // Clock jitter is nasty; smooth hard but stay responsive to real changes.
            this.bpm = this.bpm ? this.bpm * 0.9 + instant * 0.1 : instant
          }
        }
        this.lastClockAt = timeStamp
        if (!this.running && this.autoStartOnClock && !this._sawStop) this._start(true)
        if (!this.running) return
        this.pulse++
        if (this.onTick) this.onTick(this.pulse, timeStamp)
        break
      }
      case START:
        this.pulse = 0
        this._start(false)
        break
      case CONTINUE:
        this._start(false)
        break
      case STOP:
        this.running = false
        this.lastClockAt = 0
        this._sawStop = true
        if (this.onTransport) this.onTransport('stop')
        break
      case SONG_POSITION: {
        const sixteenths = (data[1] & 0x7f) | ((data[2] & 0x7f) << 7)
        this.pulse = sixteenths * 6
        if (this.onTransport) this.onTransport('position')
        break
      }
      default:
        break
    }
  }

  _start(fromClock) {
    this.running = true
    if (!fromClock) this._sawStop = false
    if (this.onTransport) this.onTransport(fromClock ? 'clock-start' : 'start')
  }

  /**
   * Some hosts just stop sending clock instead of sending Stop. If the clock
   * goes quiet for longer than a slow bar's worth of pulses, call it stopped.
   */
  checkStall(now = performance.now()) {
    if (!this.running || this.internalEnabled || !this.lastClockAt) return
    if (now - this.lastClockAt < 400) return
    this.running = false
    this.lastClockAt = 0
    if (this.onTransport) this.onTransport('stop')
  }

  /* ---------------- internal clock (only when no DAW is bound) ------------- */

  startInternal(tempo) {
    this.stopInternal()
    this.internalEnabled = true
    this.internalTempo = tempo || this.internalTempo
    this.bpm = this.internalTempo
    this.running = true
    this._internalNext = performance.now()
    const step = () => {
      const interval = 60000 / (this.internalTempo * PPQN)
      const now = performance.now()
      let guard = 0
      while (this._internalNext <= now && guard++ < 64) {
        this.pulse++
        if (this.onTick) this.onTick(this.pulse, this._internalNext)
        this._internalNext += interval
      }
      this._internalTimer = setTimeout(step, Math.max(1, this._internalNext - performance.now()))
    }
    if (this.onTransport) this.onTransport('start')
    step()
  }

  stopInternal() {
    if (this._internalTimer) clearTimeout(this._internalTimer)
    this._internalTimer = null
    if (this.internalEnabled) {
      this.internalEnabled = false
      this.running = false
      if (this.onTransport) this.onTransport('stop')
    }
  }

  rewind() {
    this.pulse = 0
    if (this.onTransport) this.onTransport('position')
  }

  /* ---------------- note output ---------------- */

  /** @returns {boolean} whether the note actually reached a port. */
  noteOn(outputId, channel, note, velocity) {
    const port = this.output(outputId)
    if (!port) return false
    const n = clamp7(note)
    port.send([0x90 | (channel & 0x0f), n, clamp7(velocity)])
    this._sounding.set(`${outputId}:${channel}:${n}`, true)
    return true
  }

  noteOff(outputId, channel, note) {
    const port = this.output(outputId)
    if (!port) return false
    const n = clamp7(note)
    port.send([0x80 | (channel & 0x0f), n, 0])
    this._sounding.delete(`${outputId}:${channel}:${n}`)
    return true
  }

  /** A control change. Used for the sustain pedal; nothing else sends one yet. */
  controlChange(outputId, channel, controller, value) {
    const port = this.output(outputId)
    if (!port) return false
    port.send([0xb0 | (channel & 0x0f), clamp7(controller), clamp7(value)])
    return true
  }

  /** Release everything we personally turned on, then send All Notes Off. */
  panic() {
    for (const key of [...this._sounding.keys()]) {
      const [outputId, channel, note] = key.split(':')
      this.noteOff(outputId, Number(channel), Number(note))
    }
    this._sounding.clear()
    if (!this.access) return
    for (const port of this.access.outputs.values()) {
      for (let channel = 0; channel < 16; channel++) {
        try {
          // Sustain first, and it is not optional. All Notes Off on a synth
          // holding the pedal down turns the notes off and leaves them ringing,
          // which is exactly the state a panic button exists to get out of.
          port.send([0xb0 | channel, 64, 0])
          port.send([0xb0 | channel, 123, 0])
        } catch {
          /* a port can vanish mid-send; nothing useful to do about it */
        }
      }
    }
  }
}

function describe(port) {
  return { id: port.id, name: port.name || port.id, manufacturer: port.manufacturer || '', state: port.state }
}

const clamp7 = (n) => Math.max(0, Math.min(127, Math.round(n)))
