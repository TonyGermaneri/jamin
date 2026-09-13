/**
 * Application state and wiring.
 *
 * Two speeds of state live here on purpose.  `live` is a plain object mutated by
 * the MIDI clock 24 times a beat -- reactivity at that rate would be pure waste,
 * and the canvas reads it directly from its animation loop.  `state` is the
 * reactive half: settings, ports, the parsed chart, and a coarse status snapshot
 * refreshed a few times a second for the readout and the dialogs.
 */

import { reactive, watch } from 'vue'
import { MidiEngine } from './core/midi.js'
import { Player } from './core/player.js'
import { parseScore } from './core/score.js'
import { loadSettings, saveSettings, defaultSettings, TEXT_KEY, SAMPLE_CHART } from './core/settings.js'
import { loadPhrases, savePhrases, uniqueName, bindPhraseInText, unbindPhraseInText } from './core/phrases.js'
import { themeById } from './core/themes.js'
import { loadChordDictionary, nameForSet } from './core/chordDictionary.js'
import { describeChord } from './core/chordParser.js'

export const engine = new MidiEngine()

export const state = reactive({
  text: '',
  score: parseScore(''),
  settings: loadSettings(),
  phrases: [],
  pendingCapture: null,
  midi: { state: 'idle', error: null, inputs: [], outputs: [] },
  status: {
    running: false,
    internal: false,
    bpm: 120,
    bar: 0,
    beat: 0,
    eventIndex: -1,
    chord: '',
    chordName: '',
    caretChord: '',
    phrase: null,
    notes: [],
  },
  ui: { settings: false, phrases: false, settingsTab: 'midi', phrasesTab: 'captured', armed: false, toast: null },
})

/** Mutated at clock rate; never watched. */
export const live = {
  pulse: 0,
  position: 0,
  bpm: 120,
  running: false,
  eventIndex: -1,
  attackAt: 0,
  lastEventAt: 0,
}

export const player = new Player(engine, state.settings)

player.getPhrase = (name) => state.phrases.find((phrase) => phrase.name === name) || null

player.onEventChange = (event, info) => {
  live.eventIndex = event.index
  live.attackAt = performance.now()
  state.status.eventIndex = event.index
  state.status.chord = event.chord && event.chord.ok ? event.chord.text : ''
  state.status.chordName = event.chord && event.chord.ok ? nameForSet(event.chord.pcs) || event.chord.quality : ''
  state.status.phrase = info.phrase
  state.status.notes = info.notes
}

player.onCapture = (capture) => {
  state.pendingCapture = { ...capture, name: '' }
  state.ui.phrases = true
  state.ui.phrasesTab = 'captured'
  state.ui.armed = player.capture.armed
  toast('Phrase captured')
}

engine.onTick = (pulse) => {
  live.pulse = pulse
  live.running = engine.running
  live.bpm = engine.bpm
  player.tick(pulse)
  live.position = player.position
}

engine.onTransport = (kind) => {
  live.running = engine.running
  player.transport(kind)
  if (kind === 'stop') state.status.notes = []
  syncStatus()
}

engine.onNoteIn = (note, velocity, on) => player.noteIn(note, velocity, on)

engine.onPortsChanged = (inputs, outputs) => {
  state.midi.inputs = inputs
  state.midi.outputs = outputs
  state.midi.state = engine.state
  autoBind()
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

export async function initApp() {
  state.text = readStoredText()
  reparse()
  loadPhraseBook()
  loadChordDictionary().then(() => refreshChordName())

  engine.autoStartOnClock = state.settings.transport.autoStartOnClock
  await engine.enable()
  state.midi.state = engine.state
  state.midi.error = engine.error

  setInterval(syncStatus, 120)
}

function readStoredText() {
  try {
    const stored = localStorage.getItem(TEXT_KEY)
    return stored === null ? SAMPLE_CHART : stored
  } catch {
    return SAMPLE_CHART
  }
}

/**
 * Rank a port for first-run auto-binding.
 *
 * "First in the list" is a bad guess -- on a real rig that is usually Network
 * Session, which is almost never what anyone wants. Virtual buses are where DAW
 * clock normally arrives, and a control surface or a keyboard is never a clock
 * source. The clock input gets corrected automatically anyway the moment real
 * clock shows up somewhere else; this just makes the opening guess sane.
 */
function rankPort(port) {
  const name = (port.name || '').toLowerCase()
  if (/network session/.test(name)) return -20
  if (/push|keyboard|seaboard|lumi|key port|pedal|rise/.test(name)) return -10
  if (/iac|loopback|virtual|bus/.test(name)) return 10
  if (/daw|midipipe|bome/.test(name)) return 5
  return 0
}

const bestPort = (ports) => ports.slice().sort((a, b) => rankPort(b) - rankPort(a))[0]

/** Pick something sensible the first time, so the app works before anyone opens settings. */
function autoBind() {
  const midi = state.settings.midi
  const ports = state.midi
  if (!midi.clockInputId && ports.inputs.length && !state.settings.transport.autoDetectClock) {
    midi.clockInputId = bestPort(ports.inputs).id
  }
  if (!midi.chordOutputId && ports.outputs.length) midi.chordOutputId = bestPort(ports.outputs).id
  if (!midi.accompOutputId && ports.outputs.length) midi.accompOutputId = midi.chordOutputId
  applyPortBindings()
}

export function applyPortBindings() {
  engine.clockInputId = state.settings.midi.clockInputId
  engine.accompInputId = state.settings.midi.accompInputId
  engine.autoStartOnClock = state.settings.transport.autoStartOnClock
  engine.autoDetectClock = state.settings.transport.autoDetectClock
}

engine.onClockDetected = (portId, name) => {
  state.settings.midi.clockInputId = portId
  // Don't send chords back down the wire the clock arrived on -- that feeds
  // notes straight into whatever is driving us.
  const chordOut = state.midi.outputs.find((port) => port.id === state.settings.midi.chordOutputId)
  if (chordOut && chordOut.name === name) {
    const elsewhere = bestPort(state.midi.outputs.filter((port) => port.name !== name))
    if (elsewhere) {
      state.settings.midi.chordOutputId = elsewhere.id
      if (state.settings.midi.accompOutputId === chordOut.id) state.settings.midi.accompOutputId = elsewhere.id
    }
  }
  toast(`Following clock from ${name}`)
}

/* ------------------------------------------------------------------ *
 * Chart
 * ------------------------------------------------------------------ */

export function setText(text) {
  state.text = text
  reparse()
  persistText()
}

let textTimer = null
function persistText() {
  clearTimeout(textTimer)
  textTimer = setTimeout(() => {
    try {
      localStorage.setItem(TEXT_KEY, state.text)
    } catch {
      /* ignore */
    }
  }, 400)
}

export function reparse() {
  const chords = state.settings.chords
  state.score = parseScore(state.text, {
    beatsPerBar: state.settings.transport.beatsPerBar,
    mergeRepeats: chords.mergeRepeats,
    conventions: {
      omitThirdOnDominant11: chords.omitThirdOnDominant11,
      omitElevenOnThirteen: chords.omitElevenOnThirteen,
    },
  })
  player.setScore(state.score)
}

function refreshChordName() {
  const event = state.score.events[state.status.eventIndex]
  if (event && event.chord && event.chord.ok) {
    state.status.chordName = nameForSet(event.chord.pcs) || event.chord.quality
  }
}

/** Everything the readout and dialogs need, sampled rather than watched. */
function syncStatus() {
  engine.checkStall()
  const status = state.status
  status.running = engine.running
  status.internal = engine.internalEnabled
  status.bpm = Math.round(engine.bpm * 10) / 10
  const pulsesPerBar = state.score.pulsesPerBar || 96
  status.bar = Math.floor(live.position / pulsesPerBar) + 1
  status.beat = Math.floor((live.position % pulsesPerBar) / 24) + 1
  state.ui.armed = player.capture.armed
}

/** What the parser made of the chord under the caret. */
export function describeAt(index) {
  for (const token of state.score.tokens) {
    if (token.type !== 'chord' && token.type !== 'error') continue
    if (index >= token.start && index <= token.end) {
      if (!token.chord) return ''
      return describeChord(token.chord, token.chord.ok ? nameForSet(token.chord.pcs) : null)
    }
  }
  return ''
}

/* ------------------------------------------------------------------ *
 * Theme + settings
 * ------------------------------------------------------------------ */

export function applyTheme(id) {
  const theme = themeById(id)
  Object.assign(state.settings.theme, {
    id: theme.id,
    bg: theme.bg,
    fg: theme.fg,
    dim: theme.dim,
    accent: theme.accent,
    accentAlt: theme.accentAlt,
    error: theme.error,
  })
  state.settings.display.font = theme.font
  Object.assign(state.settings.shader, theme.shader)
}

export function resetSettings() {
  Object.assign(state.settings, defaultSettings())
  applyPortBindings()
  reparse()
}

watch(
  () => JSON.stringify(state.settings),
  () => saveSettings(state.settings),
  { flush: 'post' }
)

watch(
  () => [state.settings.transport.beatsPerBar, state.settings.chords.mergeRepeats, state.settings.chords.omitThirdOnDominant11, state.settings.chords.omitElevenOnThirteen],
  () => reparse()
)

watch(
  () => [state.settings.midi.clockInputId, state.settings.midi.accompInputId, state.settings.transport.autoStartOnClock],
  () => applyPortBindings()
)

/* ------------------------------------------------------------------ *
 * Phrase book
 * ------------------------------------------------------------------ */

function loadPhraseBook() {
  state.phrases = loadPhrases()
}

export function armCapture() {
  player.arm(state.settings.accompany.captureMode)
  state.ui.armed = true
  toast('Play over the next chord…')
}

export function disarmCapture() {
  player.disarm()
  state.ui.armed = false
}

export function keepCapture(name) {
  if (!state.pendingCapture) return null
  const phrase = {
    ...state.pendingCapture,
    name: uniqueName(state.phrases, name || `${state.pendingCapture.sourceChord}-lick`),
  }
  delete phrase.capturedAt
  phrase.createdAt = Date.now()
  state.phrases = [phrase, ...state.phrases]
  savePhrases(state.phrases)
  state.pendingCapture = null
  return phrase
}

export function deletePhrase(name) {
  state.phrases = state.phrases.filter((phrase) => phrase.name !== name)
  savePhrases(state.phrases)
}

export function renamePhrase(oldName, newName) {
  const clean = uniqueName(state.phrases.filter((p) => p.name !== oldName), newName)
  const phrase = state.phrases.find((p) => p.name === oldName)
  if (!phrase) return null
  phrase.name = clean
  savePhrases(state.phrases)
  setText(state.text.split(`{${oldName}}`).join(`{${clean}}`))
  return clean
}

/**
 * Attach a phrase to a chord by editing the chart: the dot the user sees above
 * the word is the character that creates the binding, so bindings travel with
 * the text.
 */
export function bindPhrase(phraseName, tokenIndex) {
  const token = state.score.tokens[tokenIndex ?? currentTokenIndex()]
  if (!token) {
    toast('No chord to bind to')
    return
  }
  const next = bindPhraseInText(state.text, token, phraseName)
  if (next !== null) setText(next)
  toast(phraseName ? `${token.body} → ${phraseName}` : `${token.body} → no phrase`)
}

export function unbindPhrase(tokenIndex) {
  const token = state.score.tokens[tokenIndex ?? currentTokenIndex()]
  if (!token) return
  const next = unbindPhraseInText(state.text, token)
  if (next !== null) setText(next)
}

function currentTokenIndex() {
  const event = state.score.events[state.status.eventIndex]
  if (event && event.tokens.length) return event.tokens[0]
  const first = state.score.tokens.findIndex((token) => token.type === 'chord')
  return first >= 0 ? first : null
}

export function currentToken() {
  const index = currentTokenIndex()
  return index === null ? null : state.score.tokens[index]
}

/* ------------------------------------------------------------------ *
 * Transport helpers (only used when no DAW clock is bound)
 * ------------------------------------------------------------------ */

export function toggleInternalTransport() {
  if (engine.internalEnabled) {
    engine.stopInternal()
  } else {
    engine.rewind()
    engine.startInternal(state.settings.transport.internalTempo)
  }
}

export function panic() {
  engine.panic()
  player.stopAll()
  toast('All notes off')
}

let toastTimer = null
export function toast(message) {
  state.ui.toast = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    state.ui.toast = null
  }, 2200)
}
