/**
 * Joining the other machines.
 *
 * When this page was served by a jamin node -- rather than by a dev server or
 * out of the plugin's bundle -- it can hold the same chart as every other
 * machine on the network. The node found them; this connects to them.
 *
 * Three browser protocols and nothing else:
 *
 *   fetch('/doc')     everything said so far, on arriving
 *   EventSource       everything said from now on
 *   fetch POST /ops   everything we say
 *
 * `EventSource` rather than a WebSocket because the traffic is one-directional
 * and a stream that never closes is the whole requirement. The upstream is an
 * ordinary POST. Neither needs a handshake, a framing layer or a keepalive
 * protocol, and both have worked in every browser for a decade.
 *
 * Edits are carried as CRDT operations, so they can arrive in any order, twice,
 * or long after they were made. @see src/core/crdt.js and docs/network.md
 */

import { applyOps, createDoc, docText, setDocText, snapshot } from './crdt.js'
import { callHost, hosted, onHost } from './host.js'

/** How long to wait before trying the stream again, and the ceiling on that. */
const RETRY_MS = 800
const RETRY_MAX_MS = 8000

/**
 * Is this page being served by a node?
 *
 * Asked rather than assumed: a node answers `/peers` with an array, a dev server
 * answers with a 404, and the plugin's own bundle has no server behind it at
 * all. One request settles it and costs nothing.
 */
export async function nodeAvailable(origin = '') {
  if (hosted()) {
    // The plugin is a node when its networking is switched on, and asking is
    // also what switches it on for the first time.
    try {
      const state = await callHost('jaminNetwork', true)
      return Boolean(state && state.running)
    } catch {
      return false
    }
  }

  try {
    const response = await fetch(`${origin}/peers`, { cache: 'no-store' })
    if (!response.ok) return false
    return Array.isArray(await response.json())
  } catch {
    return false
  }
}

/**
 * How a session reaches its node.
 *
 * Over HTTP when the page was served by one, and through the plugin's own
 * bridge when it was not -- the editor's page comes from a `juce://` origin and
 * cannot use `fetch` against a node at all. Same traffic, shorter route, and the
 * session above does not know which it has.
 */
export function httpTransport(origin = '') {
  return {
    async doc() {
      const response = await fetch(`${origin}/doc`, { cache: 'no-store' })
      return response.ok ? response.json() : []
    },
    async peers() {
      const response = await fetch(`${origin}/peers`, { cache: 'no-store' })
      return response.ok ? response.json() : []
    },
    send(envelope) {
      fetch(`${origin}/ops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        keepalive: true,
      }).catch(() => {})
    },
    listen(onEnvelope, onOpen, onBroken) {
      const stream = new EventSource(`${origin}/events`)
      stream.onopen = onOpen
      stream.onerror = onBroken
      stream.addEventListener('ops', (event) => {
        try {
          onEnvelope(JSON.parse(event.data))
        } catch {
          // A frame we cannot read is a frame we ignore; the log has it too.
        }
      })
      return () => stream.close()
    },
  }
}

/** The same thing, through the plugin, whose page cannot use HTTP. */
export function hostTransport() {
  return {
    async doc() {
      const log = await callHost('jaminNetDoc').catch(() => [])
      return Array.isArray(log) ? log : []
    },
    async peers() {
      const state = await callHost('jaminNetwork').catch(() => null)
      return state && Array.isArray(state.peers) ? state.peers : []
    },
    send(envelope) {
      callHost('jaminNetOps', JSON.stringify(envelope)).catch(() => {})
    },
    listen(onEnvelope, onOpen) {
      const stop = onHost('jaminNetOps', (message) => {
        if (!message || !message.envelope) return
        try {
          onEnvelope(JSON.parse(message.envelope))
        } catch {
          // As above.
        }
      })
      // There is no connection to wait for: the bridge is there or the plugin
      // is not.
      if (onOpen) onOpen()
      return stop
    },
  }
}

let nextMessage = 0

/**
 * One machine's membership of the session.
 *
 * Everything is driven from `onText`: the session says what the chart is now,
 * and the application does as it is told. Edits made here go in through
 * `change`, which returns quickly and sends in the background -- typing must
 * never wait for a network.
 */
export class Session {
  /**
   * @param {object} options
   * @param {string} options.site      unique to this browser, for op ids
   * @param {string} [options.origin]  the node; the page's own by default
   * @param {function} options.onText  called with the agreed text when it changes
   * @param {function} [options.onPeers]  called with the peer list
   * @param {function} [options.onState]  'joining' | 'joined' | 'offline'
   */
  constructor(options) {
    this.site = options.site
    this.transport = options.transport || httpTransport(options.origin || '')
    this.onText = options.onText || (() => {})
    this.onPeers = options.onPeers || (() => {})
    this.onState = options.onState || (() => {})

    this.doc = createDoc(this.site)
    this.stream = null
    this.retry = RETRY_MS
    this.stopped = false
    this.peers = []
    this.state = 'offline'
  }

  /** The chart as everybody has it. */
  text() {
    return docText(this.doc)
  }

  /**
   * Join.
   *
   * The catch-up comes first and the stream second, which is the wrong way
   * round -- anything said in between would be missed. It does not matter: an
   * op that arrives twice is ignored and one that arrives out of order is held,
   * so the stream is simply asked for the log again once it opens.
   */
  async start() {
    this.stopped = false
    this.setState('joining')
    await this.catchUp()
    this.listen()
    this.refreshPeers()
    this.peerTimer = setInterval(() => this.refreshPeers(), 4000)
  }

  stop() {
    this.stopped = true
    clearInterval(this.peerTimer)
    clearTimeout(this.retryTimer)
    if (this.stream) {
      this.stream()
      this.stream = null
    }
    this.setState('offline')
  }

  setState(next) {
    if (this.state === next) return
    this.state = next
    this.onState(next)
  }

  async catchUp() {
    try {
      const envelopes = await this.transport.doc()
      let changed = false
      for (const envelope of envelopes) {
        if (envelope && Array.isArray(envelope.ops)) {
          if (applyOps(this.doc, envelope.ops)) changed = true
        }
      }
      if (changed) this.onText(this.text())
    } catch {
      // Nothing said so far, or the node went away between one request and the
      // next. The stream will bring us up to date either way.
    }
  }

  listen() {
    if (this.stopped) return

    this.stream = this.transport.listen(
      (envelope) => {
        if (!envelope || envelope.from === this.site || !Array.isArray(envelope.ops)) return
        if (applyOps(this.doc, envelope.ops)) this.onText(this.text())
      },
      () => {
        this.retry = RETRY_MS
        this.setState('joined')
        // Anything said between the catch-up and the stream opening is still in
        // the log, so ask again rather than reasoning about the gap.
        this.catchUp()
      },
      () => {
        if (this.stopped) return
        this.setState('joining')
        if (this.stream) this.stream()
        this.stream = null
        // Backing off, because a node that is down stays down for a while and a
        // page reconnecting ten times a second helps nobody.
        this.retryTimer = setTimeout(() => this.listen(), this.retry)
        this.retry = Math.min(RETRY_MAX_MS, this.retry * 2)
      }
    )
  }

  async refreshPeers() {
    try {
      const peers = await this.transport.peers()
      if (!Array.isArray(peers)) return
      if (JSON.stringify(peers) !== JSON.stringify(this.peers)) {
        this.peers = peers
        this.onPeers(peers)
      }
    } catch {
      // Between beacons, or the node stopped. The stream's own error handling
      // is what notices that; this is only a list.
    }
  }

  /**
   * The chart changed here. Returns the ops, having already sent them.
   *
   * Nothing waits for the network: the local document is updated first and the
   * send is let go of. A send that fails is a send that fails -- the op is in
   * our log, and anybody who missed it gets it from `/doc` when they next catch
   * up.
   */
  change(text) {
    const ops = setDocText(this.doc, text)
    if (!ops.length) return ops
    this.send(ops)
    return ops
  }

  /** Hand somebody else the whole document, for a node with an empty log. */
  publishAll() {
    const ops = snapshot(this.doc)
    if (ops.length) this.send(ops)
    return ops
  }

  send(ops) {
    const envelope = {
      m: `${this.site}-${++nextMessage}`,
      from: this.site,
      ops,
    }

    this.transport.send(envelope)
  }
}
