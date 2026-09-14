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
import { hosted, hostData, callHost, onHost, HostClock } from './core/host.js'
import { Player } from './core/player.js'
import { parseScore } from './core/score.js'
import {
  loadSettings,
  saveSettings,
  defaultSettings,
  mergeSettings,
  TEXT_KEY,
  SONG_PHRASE_KEY,
  ACCENT_KEY,
  FAVOURITES_KEY,
  SAMPLE_CHART,
} from './core/settings.js'
import {
  loadPhrases,
  savePhrases,
  uniqueName,
  bindPhraseInText,
  unbindPhraseInText,
  normalizePhrase,
  maxSimultaneous,
} from './core/phrases.js'
import {
  BUILTIN_PROGRESSIONS,
  loadProgressions,
  saveProgressions,
  uniqueProgressionName,
  cleanName,
  transposeChart,
  shiftToRoot,
  usesFlats,
  preferFlatForRoot,
  toShorthand,
  usesBarlines,
  parseProgressionImport,
  exportProgressions,
} from './core/progressions.js'
import { themeById } from './core/themes.js'
import { detectKey, preferFlatKey } from './core/key.js'
import { mod12 } from './core/voiceLeading.js'
import { loadLicks, lickReport, searchLicks, defaultVocabularyUrl } from './core/licks.js'
import { phrasesFromMidi } from './core/midiPhrases.js'
import { loadParts } from './core/parts.js'
import { CHORDONOMICON } from './core/importers.js'
import { chordonomiconToChart } from './core/importers.js'
import { countProgressions, pageProgressions, searchProgressions, progressionFacets, clearProgressions } from './core/progressionStore.js'
import { importChordonomiconCsv, CHORDONOMICON_CSV } from './core/csvImport.js'
import { loadChordDictionary, nameForSet } from './core/chordDictionary.js'
import { describeChord } from './core/chordParser.js'

export const engine = new MidiEngine()

export const state = reactive({
  text: '',
  songPhrase: null,
  accentPhrase: null,
  /** Phrase ids the user has starred. A plain array so it serialises; the
      lookups go through favourite(), which is a Set underneath. */
  favourites: [],
  score: parseScore(''),
  settings: loadSettings(),
  phrases: [],
  progressions: [],
  licks: [],
  licksLoading: false,
  lickReport: null,
  bulk: { count: 0, importing: false, progress: '', report: null },
  pendingCapture: null,
  midi: { state: 'idle', error: null, inputs: [], outputs: [] },
  // Set once at startup and never again: whether this page is the plugin's
  // editor rather than a browser tab, and who it is if so.
  host: {
    active: false,
    instanceId: null,
    shared: false,
    // Sampled from the clock so the settings dialog can show what the host is
    // actually saying. "It does not seem to get any transport" is answerable
    // from these five numbers and from nothing else.
    messages: 0,
    hasPlayhead: false,
    ppq: 0,
    pulse: 0,
    // What the plugin made of the last chart we sent it.
    events: -1,
    compileError: null,
  },
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
    key: null,
    caret: 0,
    selection: [0, 0],
    phrase: null,
    notes: [],
  },
  ui: {
    settings: false,
    phrases: false,
    progressions: false,
    settingsTab: 'midi',
    phrasesTab: 'catalogue',
    lickTexture: 'any',
    progressionsTab: 'library',
    armed: false,
    accentArmed: false,
    /** The chord the phrase book is picking for, when it was opened by
        right-clicking one. -1 means it was opened for the song. */
    assignTo: -1,
    learningAccent: false,
    fetching: false,
    fetchProgress: '',
    toast: null,
  },
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

/**
 * One catalogue: what shipped, and what you have captured or imported. They are
 * the same kind of thing, so there is no reason to keep them in separate lists.
 */
export function catalogue() {
  return [...state.phrases, ...state.licks]
}

/** Bindings store an id; charts written before ids existed store a name. */
player.getPhrase = (ref) => {
  if (!ref) return null
  const all = catalogue()
  return all.find((phrase) => phrase.id === ref) || all.find((phrase) => phrase.name === ref) || null
}

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

/**
 * Whatever is telling us the time.
 *
 * In a browser that is MidiEngine counting clock bytes. In the plugin it is the
 * host's own playhead, reported as a position rather than counted -- which
 * cannot drift, survives a dropped message, and is the reason several instances
 * agree about the time without anything passing between them.
 *
 * Both offer `running` and `bpm` and both drive the two handlers below, so
 * nothing downstream of here knows which one it is listening to.
 */
const hostClock = new HostClock()
const clock = () => (state.host.active ? hostClock : engine)

function onTick(pulse) {
  live.pulse = pulse
  live.running = clock().running
  live.bpm = clock().bpm
  player.tick(pulse)
  live.position = player.position
}

function onTransportChange(kind) {
  live.running = clock().running
  player.transport(kind)
  if (kind === 'stop') state.status.notes = []
  syncStatus()
}

engine.onTick = onTick
engine.onTransport = onTransportChange
hostClock.onTick = onTick
hostClock.onTransport = onTransportChange

engine.onNoteIn = (note, velocity, on) => player.noteIn(note, velocity, on)

/**
 * A control change either teaches the accent its binding or fires it. Rising
 * edge only, so holding a sustain pedal down does not machine-gun.
 */
let accentHeld = false
engine.onControl = (controller, value) => {
  if (state.ui.learningAccent) {
    state.settings.midi.accentCc = controller
    state.ui.learningAccent = false
    toast(`Accent bound to CC ${controller}`)
    return
  }
  if (state.settings.midi.accentCc === null || controller !== state.settings.midi.accentCc) return
  const down = value >= 64
  if (down && !accentHeld) triggerAccent()
  accentHeld = down
}

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
  state.songPhrase = readStoredSongPhrase()
  state.accentPhrase = readStored(ACCENT_KEY)
  state.favourites = readFavourites()
  favouriteSet = new Set(state.favourites)
  reparse()
  loadPhraseBook()
  state.progressions = loadProgressions()
  loadChordDictionary().then(() => refreshChordName())
  refreshBulkCount()

  if (hosted()) await adoptHost()
  else await openWebMidi()

  setInterval(syncStatus, 120)

  // Build the lick catalogue once the chart is up. It is a few tens of
  // milliseconds off the critical path, so it is ready before anyone opens the
  // tab, and nothing waits on it if they never do.
  const build = () => ensureLicks()
  if (typeof requestIdleCallback === 'function') requestIdleCallback(build, { timeout: 4000 })
  else setTimeout(build, 1200)
}

/**
 * Running in a browser: ask for MIDI and take the clock off the wire.
 */
async function openWebMidi() {
  engine.autoStartOnClock = state.settings.transport.autoStartOnClock
  await engine.enable()
  state.midi.state = engine.state
  state.midi.error = engine.error
}

/**
 * Running as the plugin's editor: the host has a playhead, so there is no clock
 * to find and no ports to bind. Web MIDI does not exist in the web view at all,
 * which is not a loss -- asking for it would only produce a warning telling
 * somebody inside a DAW to go and use Chrome.
 */
async function adoptHost() {
  state.host.active = true
  state.host.instanceId = hostData('jaminInstanceId', null)
  state.midi.state = 'hosted'
  state.midi.error = null

  hostClock.attach()
  onHost('jaminCompiled', (report) => {
    if (!report) return
    state.host.events = report.events | 0
    state.host.compileError = report.error || null
  })

  const info = await callHost('jaminReady').catch(() => null)
  if (!info) return

  if (info.instanceId) state.host.instanceId = info.instanceId
  state.host.shared = Boolean(info.shared)

  // What this instance was last set to. It is saved with the DAW's project, so
  // reopening a session has to bring the chart back -- and the plugin has
  // already started playing it, having compiled the same thing without waiting
  // for anybody to open this window.
  adoptSavedState(info.state)
  pushToHost()
}

function adoptSavedState(saved) {
  if (!saved) return
  try {
    const request = JSON.parse(saved)
    if (typeof request.text === 'string' && request.text.length) state.text = request.text
    if ('songPhrase' in request) state.songPhrase = request.songPhrase || null
    if (request.settings) state.settings = mergeSettings(state.settings, request.settings)
    reparse()
  } catch {
    // A state written by an older version is not worth refusing to start over.
  }
}

/* ------------------------------------------------------------------ *
 * Compiling, when we are the plugin's editor
 * ------------------------------------------------------------------ */

let hostGeneration = 0
let compileTimer = null
/** The event the armed accent lands on, or null. @see triggerAccent */
let accentAt = null

/**
 * Everything this instance needs to make its own noise, in one payload.
 *
 * The phrases are resolved here rather than sent as names, because the
 * catalogue is a browser thing -- it is fetched, it lives in IndexedDB, and the
 * headless compiler inside the plugin has neither. Only the phrases this chart
 * actually uses go, which is one or two of several thousand.
 */
function compileRequest() {
  const phrases = {}
  const include = (ref) => {
    if (!ref || phrases[ref]) return
    const phrase = player.getPhrase(ref)
    if (phrase) phrases[ref] = phrase
  }

  include(state.songPhrase)
  for (const event of state.score.events) include(event.phraseId)

  return JSON.stringify({
    text: state.text,
    settings: state.settings,
    songPhrase: state.songPhrase,
    phrases,
    accentAt,
    accent: accentAt === null ? null : accentPhrase(),
    generation: ++hostGeneration,
  })
}

/**
 * Hand the plugin a new song to play.
 *
 * Debounced, because this is called on every keystroke and only the last one is
 * worth compiling. A quarter of a second is below the point at which a pause in
 * typing feels like waiting, and far above the cost of the compile.
 */
function pushToHost() {
  if (!state.host.active) return
  clearTimeout(compileTimer)
  compileTimer = setTimeout(() => {
    callHost('jaminCompile', compileRequest()).catch(() => {})
  }, 250)
}

function readStored(key) {
  try {
    return localStorage.getItem(key) || null
  } catch {
    return null
  }
}

const readStoredSongPhrase = () => readStored(SONG_PHRASE_KEY)

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
    perChordPhrases: state.settings.accompany.perChordPhrases,
    songPhrase: state.songPhrase,
    conventions: {
      omitThirdOnDominant11: chords.omitThirdOnDominant11,
      omitElevenOnThirteen: chords.omitElevenOnThirteen,
    },
  })
  player.setScore(state.score)
  if (!clock().running) state.status.eventIndex = -1
  state.status.key = detectKey(state.score)
}

function refreshChordName() {
  const event = state.score.events[state.status.eventIndex]
  if (event && event.chord && event.chord.ok) {
    state.status.chordName = nameForSet(event.chord.pcs) || event.chord.quality
  }
}

/** Everything the readout and dialogs need, sampled rather than watched. */
function syncStatus() {
  // Watching for a clock that stopped arriving only means anything when the
  // clock is arriving as bytes. A host reports a position whether or not it is
  // moving, so there is nothing to go quiet.
  if (!state.host.active) engine.checkStall()
  const status = state.status
  const source = clock()
  status.running = source.running
  status.internal = engine.internalEnabled
  status.bpm = Math.round(source.bpm * 10) / 10
  const pulsesPerBar = state.score.pulsesPerBar || 96
  if (state.host.active) {
    state.host.messages = hostClock.messages
    state.host.hasPlayhead = hostClock.hasPlayhead
    state.host.ppq = Math.round(hostClock.ppq * 1000) / 1000
    state.host.pulse = hostClock.pulse
  }
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

/**
 * Move the whole chart. Spelling follows the key it lands in, so going up a
 * semitone from F gives Gb rather than F#, and down from C gives B rather than
 * Cb.
 */
export function transposeSong(semitones) {
  if (!semitones || !state.text.trim()) return
  const current = state.status.key
  const preferFlat = current
    ? preferFlatKey(mod12(current.tonicPc + semitones), current.mode)
    : usesFlats(state.text)

  const next = transposeChart(state.text, semitones, { preferFlat })
  if (next === state.text) return
  setText(next)
  const landed = state.status.key
  toast(landed ? `Transposed to ${landed.name}` : `Transposed ${semitones > 0 ? 'up' : 'down'}`)
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
  () => {
    saveSettings(state.settings)
    pushToHost()
  },
  { flush: 'post' }
)

// The chart and the phrase bound to it are the other two things that decide
// what comes out. Everything else the plugin is told is derived from these.
watch(() => [state.text, state.songPhrase], () => pushToHost())

watch(
  () => [
    state.settings.transport.beatsPerBar,
    state.settings.chords.mergeRepeats,
    state.settings.chords.omitThirdOnDominant11,
    state.settings.chords.omitElevenOnThirteen,
    state.settings.accompany.perChordPhrases,
  ],
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
  // Stored rooted on C, so what you played over one chord works over any.
  const phrase = normalizePhrase({
    ...state.pendingCapture,
    id: newPhraseId(),
    kind: 'captured',
    category: 'captured here',
    name: uniqueName(state.phrases, name || `${state.pendingCapture.sourceChord}-lick`),
  })
  delete phrase.capturedAt
  phrase.createdAt = Date.now()
  phrase.voices = maxSimultaneous(phrase.notes)
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
 * Put a phrase to work.
 *
 * Normally that means the whole song: one phrase, no markup in the chart. With
 * per-chord articulations on it instead edits the chart, because the dot the
 * user sees above the word is the character that creates the binding -- so those
 * bindings travel with the text.
 */
export function setSongPhrase(phraseName) {
  state.songPhrase = phraseName || null
  try {
    if (state.songPhrase) localStorage.setItem(SONG_PHRASE_KEY, state.songPhrase)
    else localStorage.removeItem(SONG_PHRASE_KEY)
  } catch {
    /* ignore */
  }
  reparse()
  toast(phraseName ? `${phraseName} → whole song` : 'Phrase cleared')
}

export function bindPhrase(phraseName, tokenIndex) {
  if (!state.settings.accompany.perChordPhrases) {
    setSongPhrase(phraseName)
    return
  }
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

/**
 * The chord "now" means.
 *
 * While the DAW is running that is the one you can hear. Stopped, it is the one
 * under the cursor -- which is also the only answer that stays right when you
 * edit the chart, since the playing event index goes stale the moment the text
 * changes underneath it.
 */
function currentTokenIndex() {
  if (clock().running) {
    const event = state.score.events[state.status.eventIndex]
    if (event && event.tokens.length) return event.tokens[0]
  }

  const caret = state.status.caret
  let containing = -1
  let preceding = -1
  let first = -1

  state.score.tokens.forEach((token, index) => {
    if (token.type !== 'chord' || !token.chord || !token.chord.ok) return
    if (first < 0) first = index
    if (token.start <= caret && caret <= token.end) containing = index
    if (token.start <= caret) preceding = index
  })

  if (containing >= 0) return containing
  if (preceding >= 0) return preceding
  return first >= 0 ? first : null
}

export function currentToken() {
  const index = currentTokenIndex()
  return index === null ? null : state.score.tokens[index]
}

/**
 * Read a MIDI performance into the phrase book.
 *
 * One phrase per chord, with whatever was being played at the time -- two hands,
 * real voicings, real rhythm. The chord is read off the notes unless the file
 * came with annotations, so this works on a part you played into your own DAW as
 * readily as on a published corpus.
 */
export function importMidiPhrases(bytes, options = {}) {
  let result
  try {
    result = phrasesFromMidi(bytes, {
      beatsPerBar: state.settings.transport.beatsPerBar,
      ...options,
    })
  } catch (error) {
    toast(`Could not read that MIDI file: ${error.message}`)
    return { phrases: [], error: error.message }
  }

  if (!result.phrases.length) {
    toast('Nothing usable in that file')
    return result
  }

  const added = result.phrases.map((phrase) => ({
    ...phrase,
    id: newPhraseId(),
    kind: 'imported',
    category: 'imported from MIDI',
    name: uniqueName(state.phrases, phrase.name),
    createdAt: Date.now(),
  }))
  state.phrases = [...added, ...state.phrases]
  savePhrases(state.phrases)
  toast(`${added.length} phrase${added.length === 1 ? '' : 's'} from MIDI`)
  return { ...result, added }
}

/* ------------------------------------------------------------------ *
 * The accent
 * ------------------------------------------------------------------ */

/** Right-clicking a phrase in the catalogue puts it here. */
export function setAccentPhrase(ref) {
  state.accentPhrase = ref || null
  try {
    if (state.accentPhrase) localStorage.setItem(ACCENT_KEY, state.accentPhrase)
    else localStorage.removeItem(ACCENT_KEY)
  } catch {
    /* ignore */
  }
  const phrase = player.getPhrase(state.accentPhrase)
  toast(phrase ? `Accent: ${phrase.name}` : 'Accent cleared')
}

/* ------------------------------------------------------------------ *
 * Favourites
 * ------------------------------------------------------------------ */

let favouriteSet = new Set()

function readFavourites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVOURITES_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((one) => typeof one === 'string') : []
  } catch {
    return []
  }
}

/** Is this phrase starred? Takes an entry or a reference. */
export function favourite(entry) {
  const ref = typeof entry === 'string' ? entry : entry && (entry.id || entry.name)
  return Boolean(ref) && favouriteSet.has(ref)
}

/**
 * Star or unstar a phrase.
 *
 * Kept by id where there is one and by name otherwise, which is the same rule
 * the accent uses -- a phrase captured before ids existed has only a name, and
 * losing somebody's favourites to a schema detail would be a poor trade.
 */
export function toggleFavourite(entry) {
  const ref = typeof entry === 'string' ? entry : entry && (entry.id || entry.name)
  if (!ref) return false

  if (favouriteSet.has(ref)) favouriteSet.delete(ref)
  else favouriteSet.add(ref)

  state.favourites = [...favouriteSet]
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(state.favourites))
  } catch {
    // A full or disabled store loses the list on reload; it must not stop the
    // click from registering.
  }
  return favouriteSet.has(ref)
}

export function accentPhrase() {
  return player.getPhrase(state.accentPhrase)
}

/**
 * Arm the accent for the next chord.
 *
 * It replaces the phrase that chord was going to play rather than sounding on
 * top of it, and it waits for the chord change to do it -- pressing the button
 * half a bar early means the same thing as pressing it a beat early, which is
 * what makes it playable.
 *
 * Pressing it again while armed disarms it, so a misfire is one press to undo.
 */
export function triggerAccent() {
  const phrase = accentPhrase()
  if (!phrase) {
    toast('No accent phrase yet — right-click one in the catalogue')
    return false
  }

  if (state.ui.accentArmed) {
    player.disarmAccent()
    state.ui.accentArmed = false
    accentAt = null
    if (state.host.active) pushToHost()
    toast('Accent cancelled')
    return false
  }

  // Inside the plugin the notes come from a sequence compiled ahead of the
  // playhead, so the accent has to name the event it lands on rather than
  // waiting to be noticed. In a browser tab the player takes whichever event
  // comes next.
  const index = state.host.active ? eventIndexForAccent() : null
  player.armAccent(phrase, index)
  state.ui.accentArmed = true
  accentAt = index

  if (state.host.active) pushToHost()
  toast(`Accent armed — ${phrase.name}`)
  return true
}

/**
 * Which event the accent should land on.
 *
 * The next one, unless the next one is so close that a compile could not reach
 * the plugin in time -- in which case the one after, because an accent that
 * arrives a moment late has missed its chord entirely, and landing on the
 * following chord is at least the thing you asked for.
 */
function eventIndexForAccent() {
  const events = state.score.events
  if (!events.length) return null

  const current = live.eventIndex >= 0 ? live.eventIndex : 0
  const event = events[current]
  let index = (current + 1) % events.length

  if (event && clock().running) {
    const bpm = clock().bpm > 20 ? clock().bpm : 120
    const msPerPulse = 60000 / (bpm * 24)
    const remaining = (event.endPulse - live.position) * msPerPulse
    // The debounce plus a compile plus the plugin's collection tick.
    if (remaining < 450) index = (index + 1) % events.length
  }

  return index
}

/** The accent has been played; put the plugin back to the plain song. */
player.onAccentSpent = () => {
  state.ui.accentArmed = false
  if (accentAt === null) return
  accentAt = null
  if (state.host.active) pushToHost()
}

/* ------------------------------------------------------------------ *
 * Lick catalogue
 * ------------------------------------------------------------------ */

/**
 * Build the catalogue, or rebuild it from somewhere else.
 *
 * `{ text }` for a vocabulary file the user opened, `{ url }` to pull one over
 * the network, `{ force: true }` to redo the shipped one.
 */
export async function ensureLicks(options = {}) {
  const rebuilding = options.force || options.text !== undefined || options.url
  if (state.licks.length && !rebuilding) return state.licks
  if (state.licksLoading && !rebuilding) return state.licks

  state.licksLoading = true
  try {
    // One catalogue, two sources: Impro-Visor's single lines and POP909's
    // two-handed parts. They share a phrase model, so they share a list.
    const [licks, parts] = await Promise.all([loadLicks(options), loadParts()])
    state.licks = [...parts, ...licks]
    state.lickReport = { ...lickReport(), parts: parts.length }
  } finally {
    state.licksLoading = false
  }
  if (state.lickReport && state.lickReport.error) toast(`Could not read that vocabulary: ${state.lickReport.error}`)
  return state.licks
}

export { defaultVocabularyUrl, CHORDONOMICON, CHORDONOMICON_CSV }

/** The chord a lick would be adopted onto: the one playing, else the first. */
export function targetChord() {
  const token = currentToken()
  return token && token.chord && token.chord.ok && !token.chord.silent ? token.chord : null
}

/**
 * What the catalogue shows.
 *
 * Deliberately not filtered by the chord you are on. A phrase is stored as
 * degrees and re-pointed at whatever chord it lands on, so every one of them
 * fits every chord -- hiding some of them would be pretending otherwise.
 */
export function visibleLicks(query) {
  let pool = catalogue()
  if (state.ui.lickTexture === 'hands') pool = pool.filter((item) => item.voices > 1)
  else if (state.ui.lickTexture === 'line') pool = pool.filter((item) => !(item.voices > 1))
  return searchLicks(pool, query)
}

let phraseSerial = 0

/** Ids have to survive being written into a chart, so keep them plain. */
function newPhraseId() {
  phraseSerial += 1
  return `u${Date.now().toString(36)}${phraseSerial.toString(36)}`
}

/** Put a phrase to work: the whole song, or this chord if that is turned on. */
export function usePhrase(entry) {
  if (!entry) return
  bindPhrase(entry.id || entry.name)
}

/**
 * Copy a lick into the phrase book. It becomes an ordinary phrase -- editable,
 * bindable, indistinguishable from one you played.
 */
export function adoptLick(lick, bind = false) {
  const phrase = {
    id: newPhraseId(),
    // The catalogue's own names often start with the chord already.
    name: uniqueName(
      state.phrases,
      lick.name.startsWith(lick.sourceChord) ? lick.name : `${lick.sourceChord}-${lick.name}`
    ),
    notes: lick.notes.map((note) => ({ ...note })),
    lengthPulses: lick.lengthPulses,
    sourcePcs: lick.sourcePcs.slice(),
    sourceChord: lick.sourceChord,
    kind: lick.kind,
    // Carried explicitly: the catalogue is already rooted on C, and leaving this
    // to a default would make that a coincidence rather than a fact.
    rootPc: lick.rootPc ?? 0,
    originalRoot: lick.originalRoot,
    category: lick.category,
    bars: lick.lengthPulses / 96,
    origin: lick.kind === 'part' ? `POP909 #${lick.song}` : 'Impro-Visor',
    createdAt: Date.now(),
  }
  state.phrases = [phrase, ...state.phrases]
  savePhrases(state.phrases)
  if (bind) bindPhrase(phrase.name)
  else toast(`Kept ${phrase.name}`)
  return phrase
}

/* ------------------------------------------------------------------ *
 * Progression library
 * ------------------------------------------------------------------ */

/** Built-ins first-class alongside saved ones, but never editable. */
export function allProgressions() {
  return [...state.progressions, ...BUILTIN_PROGRESSIONS]
}

export function saveProgression(name, text) {
  const body = String(text || '').trim()
  if (!body) {
    toast('Nothing to save')
    return null
  }
  const progression = {
    name: uniqueProgressionName(allProgressions(), name || 'Progression'),
    text: body,
    tags: [],
    source: '',
    createdAt: Date.now(),
  }
  state.progressions = [progression, ...state.progressions]
  saveProgressions(state.progressions)
  toast(`Saved ${progression.name}`)
  return progression
}

export function deleteProgression(name) {
  state.progressions = state.progressions.filter((item) => item.name !== name)
  saveProgressions(state.progressions)
}

export function renameProgression(oldName, newName) {
  const item = state.progressions.find((entry) => entry.name === oldName)
  if (!item) return null
  const clean = uniqueProgressionName(allProgressions().filter((entry) => entry.name !== oldName), newName)
  item.name = clean
  saveProgressions(state.progressions)
  return clean
}

/**
 * Work out the text a progression would contribute, already transposed.
 * Shared by the preview and the insert so the two can never disagree.
 */
export function renderProgression(progression, targetPc, spelling = 'auto') {
  if (!progression) return ''
  if (targetPc === null || targetPc === undefined) return progression.text
  const preferFlat =
    spelling === 'flats' ? true : spelling === 'sharps' ? false : preferFlatForRoot(targetPc)
  return transposeChart(progression.text, shiftToRoot(progression.text, targetPc), { preferFlat })
}

/**
 * Put a progression into the chart.
 *
 * `caret` drops it where the cursor is (replacing a selection), `append` starts
 * a fresh line at the end, `replace` takes the whole chart over.
 */
export function insertProgression(progression, { mode = 'replace', targetPc = null, spelling = 'auto' } = {}) {
  let body = renderProgression(progression, targetPc, spelling)
  if (!body) return

  // A single bar line changes how the whole chart reads, so a bar-lined
  // progression dropped into a chart written in the shorthand would silently
  // regroup what is already there. Match the chart instead of overruling it.
  const replacing = mode === 'replace' || !state.text.trim()
  if (!replacing && usesBarlines(body) && !usesBarlines(state.text)) {
    body = toShorthand(body)
  }

  if (mode === 'replace') {
    setText(body)
  } else if (mode === 'append') {
    const current = state.text.replace(/\s+$/, '')
    setText(current ? `${current}\n${body}` : body)
  } else {
    const [from, to] = state.status.selection[0] <= state.status.selection[1]
      ? state.status.selection
      : [state.status.selection[1], state.status.selection[0]]
    const before = state.text.slice(0, from)
    const after = state.text.slice(to)
    const pad = before && !/\s$/.test(before) ? ' ' : ''
    const tail = after && !/^\s/.test(after) ? ' ' : ''
    setText(before + pad + body + tail + after)
  }

  state.ui.progressions = false
  toast(`${progression.name} → chart`)
}

export function importProgressionJson(json, { targetPc = null, spelling = 'auto' } = {}) {
  const result = parseProgressionImport(json)
  if (!result.ok) {
    toast(result.error || 'Nothing imported')
    return result
  }
  const existing = allProgressions()
  const added = result.progressions.map((item) => ({
    ...item,
    // Transposed on the way in, if a key was asked for, so what lands in the
    // library is already in the key you want to read it in.
    text: targetPc === null ? item.text : renderProgression(item, targetPc, spelling),
    name: uniqueProgressionName(existing.concat(state.progressions), cleanName(item.name)),
    createdAt: Date.now(),
  }))
  state.progressions = [...added, ...state.progressions]
  saveProgressions(state.progressions)
  toast(`Imported ${added.length} progression${added.length === 1 ? '' : 's'}`)
  return { ...result, added }
}

/**
 * A row from the big store is kept in the dialect it arrived in; converting it
 * is cheap and only happens for one you actually look at.
 */
export function rowToProgression(row) {
  if (!row) return null
  return {
    id: `c${row.n}`,
    name: row.name,
    text: chordonomiconToChart(row.chords),
    bars: row.bars,
    tags: [row.genre, row.decade && `${row.decade}s`].filter(Boolean),
    source: 'Chordonomicon',
    bulk: true,
  }
}

export async function refreshBulkCount() {
  state.bulk.count = await countProgressions()
  return state.bulk.count
}

/** Read the downloaded CSV. Streamed, so the file's size is not the limit. */
export async function importChordonomiconFile(file, options = {}) {
  state.bulk.importing = true
  state.bulk.progress = 'reading…'
  try {
    const report = await importChordonomiconCsv(file, {
      ...options,
      onProgress: ({ rows, bytes, total }) => {
        const share = total ? Math.round((bytes / total) * 100) : 0
        state.bulk.progress = `${rows.toLocaleString()} progressions · ${share}%`
      },
    })
    state.bulk.report = report
    await refreshBulkCount()
    toast(`${report.rows.toLocaleString()} progressions imported`)
    return report
  } catch (error) {
    toast(`Could not read that file: ${error.message}`)
    state.bulk.report = { error: error.message }
    return null
  } finally {
    state.bulk.importing = false
    state.bulk.progress = ''
  }
}

export async function forgetBulkProgressions() {
  await clearProgressions()
  await refreshBulkCount()
  toast('Imported progressions cleared')
}

/** The hand-written ones: yours, then the built-ins. */
function smallList(query) {
  const all = allProgressions()
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return all
  return all.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.text.toLowerCase().includes(needle) ||
      (item.tags || []).some((tag) => tag.toLowerCase().includes(needle))
  )
}

/**
 * One page of the library, drawn from the small list first and the big store
 * after it. Only the page is ever in memory.
 */
export async function progressionPage(offset, limit, query = '', filters = {}) {
  const small = smallList(query).filter((item) => {
    // The hand-written progressions carry neither, so asking for a genre or a
    // decade is asking for imported rows and they drop out -- which is right:
    // they genuinely are not from the 1970s.
    if (filters.genre && String(item.genre || '') !== filters.genre) return false
    if (filters.decade && String(item.decade || '') !== filters.decade) return false
    return true
  })

  const narrowed = Boolean(filters.genre || filters.decade)

  if (!query && !narrowed) {
    const rows = small.slice(offset, offset + limit)
    const shortfall = limit - rows.length
    if (shortfall > 0 && state.bulk.count) {
      const from = Math.max(0, offset - small.length)
      const more = await pageProgressions(from, shortfall)
      rows.push(...more.map(rowToProgression))
    }
    return { rows, total: small.length + state.bulk.count, partial: false }
  }

  // Searching or narrowing the big store is a scan, so it is bounded and says so.
  const found = state.bulk.count
    ? await searchProgressions(query, 300, 60000, filters)
    : { rows: [], complete: true }
  const combined = [...small, ...found.rows.map(rowToProgression)]
  return {
    rows: combined.slice(offset, offset + limit),
    total: combined.length,
    partial: !found.complete,
  }
}

/** Genre and decade, as the imported collection actually has them. */
export async function progressionFacetList() {
  if (!state.bulk.count) return { genres: [], decades: [] }
  try {
    return await progressionFacets()
  } catch {
    return { genres: [], decades: [] }
  }
}

export function exportProgressionJson() {
  return exportProgressions(state.progressions)
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
