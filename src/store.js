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
import { hosted, hostData, callHost, callHostSlowly, onHost, HostClock } from './core/host.js'
import { nodeAvailable, Session, httpTransport, hostTransport, localTransport } from './core/net.js'
import { loadDrums, loadedDrums, drumReport, buildDrumTrack, matchingFill, fitsBars } from './core/drums.js'
import { kitById, cleanKitMap, classifyKit, mapDrumNotes } from './core/drumKits.js'
import {
  readGrooveFile, describeSet, packGroove, unpackGroove, spread, planPacks, slashes, reservoir, walkLibrary,
} from './core/drumImport.js'
import {
  listSets, putSet, deleteSet, putGrooves, countGrooves,
  searchGrooves, grooveFacets, getGrooves,
} from './core/drumStore.js'
import {
  loadDrumBindings, saveDrumBindings, reconcileBindings, bindGroove,
  forgetBinding, slotOf, cycleBinding, WHOLE_SONG,
} from './core/drumBindings.js'
import { resourceOk } from './core/fetchResource.js'
import { rebuild, docSize } from './core/crdt.js'
import { realizeChord } from './core/voicing.js'
import { scoreOptions } from './core/compile.js'
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
  DRUM_ACCENT_KEY,
  DRUM_LIBRARY_KEY,
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
  // What Mr. Accompany Me can hear right now: the chord under somebody's
  // fingers, named. Nothing is kept -- this is what is sounding, not a
  // recording of it. @see core/chordDetect.js
  heard: { name: '', pitches: [] },
  midi: { state: 'idle', error: null, inputs: [], outputs: [] },
  // Set once at startup and never again: whether this page is the plugin's
  // editor rather than a browser tab, and who it is if so.
  // Several machines holding the same chart. Empty until this page turns out
  // to have been served by a node. @see src/core/net.js
  net: { joined: false, state: 'offline', peers: [], site: null, address: null },
  // The drum catalogue, and which groove plays where. @see core/drums.js
  drums: [],
  // Libraries somebody imported, and what a search of them last found. The
  // catalogue itself is not held in memory -- it can be three quarters of a
  // million patterns. @see core/drumStore.js
  drumSets: [],
  drumHits: [],
  drumSearch: { scanned: 0, partial: false },
  drumFilters: { set: '', kind: '', bars: 0, signature: '', text: '', folder: '' },
  // A batch job. `total` is the browser's, which knows how many files it was
  // handed; the plugin walks a tree it has not counted, so it measures itself in
  // packs and shelves, which it does know up front.
  drumImport: {
    running: false, read: 0, total: 0, skipped: 0, name: '', cancel: false,
    readBase: 0, skippedBase: 0,
    packs: 0, packsDone: 0, packsKept: 0, packsMade: 0, pack: '',
    shelves: 0, shelvesDone: 0, trouble: '',
  },
  // What the catalogue is taking on disk, when the browser will say.
  drumStorage: { usage: 0, quota: 0 },
  // Imported grooves the chart has bound, fetched out of the database and kept
  // here. The catalogue itself is far too big to hold, but the four or five a
  // song actually uses have to be findable by id like any other groove.
  drumBound: {},
  drumBindings: {},
  drumAccent: null,
  // What is being heard right now: the section the playhead is in, and the drums
  // struck since the last frame. Both are worked out from the chart and the
  // position rather than reported by anything -- inside the plugin the notes are
  // played by native code the page never hears. @see syncDrumsPlaying
  playing: { section: null, voices: [] },
  drumReport: { grooves: 0, error: null },

  // Every instance of jamin in this host: which track each is on, what it is
  // playing, and whether it may be heard. @see jamin::Roster
  roster: { me: null, instances: [] },

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
    drums: false,
    drumsTab: 'grooves',
    drumAccentArmed: false,
    /// Which instance the phrase book is pointed at. Null is this one.
    targetInstance: null,
    progressionsTab: 'library',
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

player.onHeard = (found) => {
  state.heard = found ? { name: found.name, pitches: found.pitches } : { name: '', pitches: [] }
}

/**
 * The phrase a heard chord is articulated through.
 *
 * The chart's own, so playing along sounds like the song rather than like a
 * second program: whatever the chord under the playhead is using. An armed
 * accent beats it, as an accent beats everything, and the song's default phrase
 * stands in when the chart has nothing to say.
 */
player.getLivePhrase = () => {
  const accent = player.getPhrase(state.accentPhrase)
  if (accent) return accent
  const here = player.current && player.current.phraseId
  return player.getPhrase(here || state.songPhrase)
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

  await joinNetwork()

  setInterval(syncStatus, 120)

  // Build the lick catalogue once the chart is up. It is a few tens of
  // milliseconds off the critical path, so it is ready before anyone opens the
  // tab, and nothing waits on it if they never do.
  state.drumBindings = loadDrumBindings()
  state.drumFilters.set = readStored(DRUM_LIBRARY_KEY) || ''

  // The imported catalogue is not opened at all unless this chart needs it.
  //
  // An imported groove's id carries its library -- `p2f4k9:1841` -- where a
  // bundled one is `g1841`, so whether a chart has any is a question about
  // strings rather than about a database. A chart that binds nothing imported
  // costs nothing here, which for somebody who has never imported anything is
  // every chart. @see packGroove, openDrumBook
  if (boundToImported(state.drumBindings)) {
    refreshDrumSets().then(() => rememberBoundGrooves().then(refreshDrums))
  }
  state.drumAccent = readStored(DRUM_ACCENT_KEY)
  loadDrums().then((list) => {
    state.drums = list
    state.drumReport = drumReport()
    // The part can only be built once the catalogue is here, and the plugin is
    // already playing the chords while it arrives.
    refreshDrums()
  })

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

  // Another instance in this host changed the chart. @see adoptShared
  /**
   * Another instance in this host changed the chart.
   *
   * The event carries a generation number and nothing else; the chart itself is
   * fetched over the resource scheme. An event's payload is escaped by JUCE with
   * two quadratic `String::replace` calls, so a chart carrying a day's editing
   * cost thirty-six seconds of CPU to deliver -- every time a window opened.
   * Bytes fetched are bytes; nothing escapes them.
   */
  onHost('jaminSong', async (song) => {
    if (!song || typeof song.generation !== 'number') return
    if (song.generation === lastSharedGeneration) return
    lastSharedGeneration = song.generation

    try {
      const response = await fetch('jamin-song.json', { cache: 'no-store' })
      if (!resourceOk(response)) return
      adoptShared(await response.text())
    } catch {
      /* a chart that cannot be fetched is the chart we already have */
    }
  })

  // Somebody joined, left, was muted, soloed or renamed.
  onHost('jaminRoster', (roster) => adoptRoster(roster))

  /**
   * What is being played into this track.
   *
   * In a browser the keyboard reaches the page directly through Web MIDI. In
   * the plugin the notes arrive on the audio thread, which must not go near a
   * web view, so they are copied out and handed over on a timer. Either way
   * they end up in the same place. @see Player.noteIn
   */
  onHost('jaminHeard', (notes) => {
    if (!Array.isArray(notes)) return
    for (const item of notes) {
      if (!item || typeof item.note !== 'number') continue
      player.noteIn(item.note, item.velocity | 0, Boolean(item.on))
    }
  })

  // Another window asked this instance to play something. Only this instance
  // can act on it: the catalogue the name is looked up in is here.
  onHost('jaminSetPhrase', (request) => {
    if (request && typeof request.phrase === 'string') {
      setSongPhrase(request.phrase || null)
    }
  })

  // A DAW nudged the articulation, or rolled the dice. Both are the same act as
  // clicking in the phrase book, so they go through the same door.
  onHost('jaminPhraseStep', (nudge) => stepSongPhrase((nudge && nudge.step) | 0))
  onHost('jaminPhraseRandom', () => randomSongPhrase())

  adoptRoster(await callHost('jaminRoster').catch(() => null))

  const info = await callHost('jaminReady').catch(() => null)
  if (!info) return

  if (info.instanceId) state.host.instanceId = info.instanceId
  state.host.shared = Boolean(info.shared)
  // Held for joinNetwork, which runs next and wants it before it asks the
  // network anything. jaminReady is answered once, not twice.
  hostedSong = typeof info.song === 'string' ? info.song : null

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
/** The shared chart we last fetched. @see jaminSong */
let lastSharedGeneration = -1
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
function compileRequest(grooves = null) {
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
    grooves: grooves || groovesInUse(),
    drumBindings: state.drumBindings,
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
  compileTimer = setTimeout(async () => {
    // The grooves are fetched before the request is built, because a library
    // the plugin points at keeps its notes in the file rather than in the row.
    const grooves = await resolvedGroovesInUse()
    callHost('jaminCompile', compileRequest(grooves)).catch(() => {})
  }, 250)
}

/* ------------------------------------------------------------------ *
 * The network
 * ------------------------------------------------------------------ */

let session = null
/** Set while the session is writing, so its own text does not come straight
    back out as a local edit and round the loop again. */
let applyingRemote = false

/** What the segment held when this page started. @see adoptHost */
let hostedSong = null

/**
 * Join the other machines, if this page was served by one of them.
 *
 * Asked rather than configured: a node answers /peers, and a dev server or the
 * plugin's own bundle does not. Nothing is switched on, nothing is typed, and a
 * page that is not on a node carries on exactly as before.
 */
async function joinNetwork() {
  const { enabled, secret } = state.settings.network

  // Three ways this can go, and the shared segment is why there are three.
  //
  // A plugin always has a session, even with no password and no network at all:
  // several instances in one host hold one chart through the segment, which
  // needs no port and nothing configured, and that still wants a document to
  // hold. A browser only has one when there is a node to talk to.
  const networked = enabled && Boolean(secret)
    && (hosted() || typeof EventSource === 'function')
    && (await nodeAvailable(secret))

  if (!networked && !hosted()) return

  const site = `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`
  state.net.site = site

  // Where somebody else would reach this machine. The plugin knows its own
  // port; a browser is already looking at the answer.
  if (networked && hosted()) {
    const where = await callHost('jaminNetwork', true, secret).catch(() => null)
    if (where && where.port) state.net.address = `http://${where.name}.local:${where.port}/`
  } else if (networked) {
    state.net.address = window.location.origin + '/'
  }

  session = new Session({
    site,
    transport: !networked ? localTransport() : hosted() ? hostTransport(secret) : httpTransport(secret),
    onText: (text) => {
      if (text === state.text) return
      applyingRemote = true
      try {
        setText(text)
      } finally {
        applyingRemote = false
      }
      // An edit that arrived over the network goes into the segment too, so an
      // instance in this host that is not on the network still sees it.
      publishShared()
    },
    onPeers: (peers) => { state.net.peers = peers },
    onState: (net) => {
      state.net.state = net
      state.net.joined = net === 'joined'
    },
  })

  // Whatever the other instances in this host had already agreed, before the
  // network is asked anything: the segment is the fastest thing here, and for an
  // instance with no password it is the only thing. @see adoptShared
  if (hosted()) adoptShared(hostedSong)

  await session.start()

  if (session.text()) {
    session.onText(session.text())
  } else if (state.text) {
    // An empty session takes whatever this page already had -- somebody has to
    // go first, and the one that arrives with a chart is a better candidate
    // than the one that arrives with nothing.
    //
    // Unless somebody else is already here. A node keeps only what it was told
    // while it was running, so one that has just started has an empty log even
    // when the others have a chart between them -- and going first on the
    // strength of that means a track opened an hour into a session imposes
    // whatever the DAW saved with it on everybody. Ask once more, then defer:
    // an instance that stays empty is a nuisance, one that overwrites the song
    // is not.
    if (session.peers.length) await session.catchUp()

    if (session.text()) session.onText(session.text())
    else if (!session.peers.length) session.change(state.text)
  }

  if (networked) state.net.joined = true
  publishShared()
}

/* ------------------------------------------------------------------ *
 * The chart every instance in this host is holding
 *
 * A DAW has no idea that two instances of a plugin are related, so the channel
 * between them sits outside it: a shared memory segment with the chart in it.
 * No port, no password, nothing to configure, and it works when the network is
 * switched off entirely. @see jamin::SongBus
 *
 * What travels is the document as operations, never the text. @see Session#ingest
 * ------------------------------------------------------------------ */

/** True while applying what the segment said, so it is not written straight back. */
let applyingShared = false

/**
 * The op log grows with the editing and cannot be pruned.
 *
 * Tombstones cannot be collected in this document -- it is a chain, every one
 * of them is an ancestor of something alive, and re-parenting rewrites the
 * chart. @see crdt.js for the measurement behind that.
 *
 * What *is* safe is starting again from the text, which throws the history away
 * entirely. It needs nobody else to be holding a copy, because every id changes
 * and a peer working from the old ones would find none of them. So it happens
 * only when this instance is demonstrably alone: nobody on the network, and no
 * other instance in this host.
 */
/*
 * Bytes, not nodes: what this costs is what gets published on every keystroke.
 *
 * Measured over ten thousand edits to a three-kilobyte chart, Yjs settles at
 * about 47KB and goes on climbing in proportion to the editing -- every
 * deletion leaves a range in the delete set, and deletions scattered around a
 * chart do not merge into runs. Starting again from the text puts it back to
 * three kilobytes. Rebuilding at sixteen means a solo chart never costs more
 * than that to publish, and the rebuild itself is a fraction of a millisecond.
 */
const REBUILD_ABOVE = 16 * 1024

function alone() {
  if (state.net.joined && state.net.peers.length) return false
  const others = (state.roster.instances || []).filter((row) => row.id !== state.roster.me)
  return others.length === 0
}

function compactIfAlone() {
  if (!session || !alone()) return false
  if (docSize(session.doc) < REBUILD_ABOVE) return false

  session.doc = rebuild(session.doc)
  return true
}

/** Put this instance's whole document in the segment. */
function publishShared() {
  if (!hosted() || !session || applyingShared) return
  compactIfAlone()
  const update = session.everything()
  if (!update) return
  // v2: one Yjs update in base64, where v1 was an array of JSON operations --
  // a different thing entirely, so the version says so rather than letting an
  // older instance try to read it as ops.
  callHost('jaminPublishSong', JSON.stringify({ v: 2, ops: update })).catch(() => {})
}

/** Take what another instance in this host put there. */
function adoptShared(json) {
  if (!hosted() || !session || !json) return false

  let carried = null
  try {
    carried = JSON.parse(json)
  } catch {
    return false                     // written by a version that meant something else
  }

  // A v1 segment holds an array of causal-tree operations, which this cannot
  // read and must not guess at. Ignoring it leaves the chart this instance
  // already has, and the next publish overwrites the segment with v2.
  if (!carried || carried.v !== 2 || typeof carried.ops !== 'string') return false

  applyingShared = true
  try {
    return session.ingest(carried.ops)
  } finally {
    applyingShared = false
  }
}

/* ------------------------------------------------------------------ *
 * The other instances of jamin in this host
 *
 * One window, every track. A DAW hides a plugin's window behind whichever
 * track is selected, so controlling eight instances means clicking through
 * eight tracks -- and by the time you get there the moment has gone. The tabs
 * put all of them in one place.
 *
 * Muting here is not the DAW's mute. A DAW mutes audio, after the notes have
 * been played; this decides whether the notes happen at all, and lands on a bar
 * line. @see jamin::Roster
 * ------------------------------------------------------------------ */

function adoptRoster(roster) {
  if (!roster || !Array.isArray(roster.instances)) return
  state.roster.me = roster.me || state.roster.me
  state.roster.instances = roster.instances
}

/** This instance, as the roster has it. */
export function myInstance() {
  return state.roster.instances.find((i) => i.id === state.roster.me) || null
}

/** Mute a track's *notes*, on the next bar line unless the settings say sooner. */
export function setInstanceMuted(id, muted) {
  callHost('jaminSetInstance', id, 'muted', Boolean(muted)).then(adoptRosterJson).catch(() => {})
}

export function setInstanceSoloed(id, soloed) {
  callHost('jaminSetInstance', id, 'soloed', Boolean(soloed)).then(adoptRosterJson).catch(() => {})
}

/** Ask an instance to play an articulation. Ours we can simply set. */
export function setInstancePhrase(id, phraseName) {
  if (!id || id === state.roster.me) {
    setSongPhrase(phraseName || null)
    return
  }
  callHost('jaminSetInstance', id, 'phrase', phraseName || '').then(adoptRosterJson).catch(() => {})
}

function adoptRosterJson(json) {
  if (typeof json !== 'string') return
  try {
    adoptRoster({ me: state.roster.me, instances: JSON.parse(json) })
  } catch {
    /* the next event carries it anyway */
  }
}

/** Tell the host what this instance is playing, so its tab says something true. */
function describeInstance() {
  if (hosted()) callHost('jaminDescribe', state.songPhrase || '').catch(() => {})
}

/* ------------------------------------------------------------------ *
 * Picking an articulation without pointing at it
 *
 * There are several thousand phrases, so a knob that scrolls through them is
 * the only control surface gesture that makes sense -- and a die is the only
 * one that makes sense when you do not know what you want.
 * ------------------------------------------------------------------ */

/**
 * What stepping and the dice move across: the phrase book's filtered list.
 *
 * Not the whole catalogue. Ten thousand phrases under a knob is not a control,
 * it is a scroll bar with no end -- whereas the 362 pads, or the 89 in F#, is a
 * set you can hold in your head and turn through. The filters are what make the
 * knob mean something, so the knob follows them.
 *
 * Kept outside the reactive state on purpose: it is the phrase book's own array,
 * thousands of entries long, and making it reactive would make every keystroke
 * in the search box walk all of it.
 */
let phrasePool = null

/** The phrase book says what it is showing. @see components/PhraseBook.vue */
export function setPhrasePool(list) {
  phrasePool = Array.isArray(list) && list.length ? list : null
}

/** The filtered list, or everything if the book has not narrowed it. */
function steppable() {
  return phrasePool && phrasePool.length ? phrasePool : catalogue()
}

/** The next articulation, or the previous one. Wraps, and stays inside the
    filters. */
export function stepSongPhrase(by) {
  const list = steppable()
  if (!list.length || !by) return

  // Not found is -1, which with a step of +1 lands on 0 -- so nudging up from
  // a phrase the filters have since excluded starts at the top of the list
  // rather than doing nothing.
  const at = list.findIndex((entry) => (entry.id || entry.name) === state.songPhrase)
  const next = list[(((at + by) % list.length) + list.length) % list.length]
  if (next) setSongPhrase(next.id || next.name)
}

/** One at random, from the same filtered list. */
export function randomSongPhrase(pool = null) {
  const list = pool && pool.length ? pool : steppable()
  if (!list.length) return null
  const pick = list[Math.floor(Math.random() * list.length)]
  if (pick) setSongPhrase(pick.id || pick.name)
  return pick
}

/* ------------------------------------------------------------------ *
 * The drums
 *
 * A groove is an articulation like any other -- it is just that its notes are
 * instruments rather than pitches, so nothing about it is transposed. What the
 * chart says beats what the drum book has bound, the same way the pedal marks
 * beat the pedal switch. @see core/drums.js
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Dragging something out into the arrangement
 *
 * Three kinds of thing can be dragged and they are not the same shape, so each
 * says for itself what it is: notes, a length, a tempo, a channel and a name.
 * @see core/dragOut.js for the gesture, core/midiWrite.js for the file
 * ------------------------------------------------------------------ */

/**
 * A drum groove, as the kit currently plays it.
 *
 * Mapped rather than raw: the library's own numbering read in, the drum
 * instrument on this track written out, so the clip lands on the same drums it
 * sounds like here. Channel 10, which is where a DAW looks for a kit.
 */
export async function midiForGroove(groove) {
  if (!groove) return null
  const whole = groove.byReference ? await notesFor(groove) : groove
  if (!whole || !whole.notes.length) return null

  const played = mapDrumNotes(whole.notes, kitMapFor(), inboundMapFor(whole) || undefined)
  if (!played.length) return null

  return {
    notes: played,
    name: whole.name,
    bpm: whole.bpm || Math.round(clock().bpm) || 120,
    channel: 9,
    numerator: whole.beatsPerBar || 4,
    denominator: whole.beatUnit || 4,
    lengthPulses: whole.lengthPulses || 0,
  }
}

/**
 * A phrase, as it was played.
 *
 * Phrases are stored rooted on C -- as degrees measured from the chord they
 * were played over -- so what goes out is the phrase over its own root, with
 * the chord it came from in the name. Re-pointing it would mean choosing a
 * chord on somebody's behalf, and the one they want is in their arrangement,
 * which we cannot see.
 */
export function midiForPhrase(phrase) {
  if (!phrase || !phrase.notes || !phrase.notes.length) return null
  const over = phrase.sourceChord && phrase.sourceChord !== '?' ? ` over ${phrase.sourceChord}` : ''
  return {
    notes: phrase.notes,
    name: `${phrase.name}${over}`,
    bpm: Math.round(clock().bpm) || 120,
    channel: Math.max(0, (state.settings.midi.accompChannel | 0) - 1),
    lengthPulses: phrase.lengthPulses || 0,
  }
}

/**
 * A progression, voiced.
 *
 * A progression is chords rather than notes, so it has to be played before it
 * can be a clip -- through the same voicing the chart uses, so what lands in
 * the arrangement is what this would have sounded like here.
 */
export function midiForProgression(entry) {
  const text = entry && (typeof entry === 'string' ? entry : entry.text)
  if (!text) return null

  const score = parseScore(text, scoreOptions(state.settings, null))
  if (!score.events.length) return null

  const chords = state.settings.chords
  const notes = []
  let previous = null

  for (const event of score.events) {
    if (!event.chord || !event.chord.ok) continue
    const voicing = realizeChord(event.chord, {
      octave: chords.octave,
      range: [chords.rangeLow, chords.rangeHigh],
      smartVoicing: chords.smartVoicing,
      maxVoices: chords.maxVoices,
      previousNotes: previous,
    })
    if (voicing.notes.length) previous = voicing.notes

    const length = Math.max(1, event.endPulse - event.startPulse)
    for (const note of voicing.notes) {
      notes.push({ at: event.startPulse, note, duration: length, velocity: state.settings.midi.velocity })
    }
  }

  if (!notes.length) return null

  return {
    notes,
    name: (entry && entry.name) || 'progression',
    bpm: Math.round(clock().bpm) || 120,
    channel: Math.max(0, (state.settings.midi.chordChannel | 0) - 1),
    numerator: score.beatsPerBar || 4,
    denominator: 4,
    lengthPulses: score.totalPulses || 0,
  }
}

/**
 * A groove by id, from wherever it is.
 *
 * Three places, and all three are needed. The bundled corpus is in memory. An
 * imported catalogue is not -- it can be three quarters of a million patterns
 * -- so what is on screen is whatever the last search found, and what the chart
 * has bound is fetched once and kept. A binding that could not be resolved
 * would be a part that silently plays nothing.
 */
export function grooveById(id) {
  if (!id) return null
  return state.drums.find((groove) => groove.id === id)
      || state.drumBound[id]
      || state.drumHits.find((groove) => groove.id === id)
      || null
}

/**
 * Fetch the imported grooves this chart binds, so they can be found by id.
 *
 * Called whenever the bindings change or a library arrives. A handful of rows
 * out of a database of several hundred thousand; the notes come later and only
 * if something plays. @see notesFor
 */
export async function rememberBoundGrooves() {
  const wanted = new Set()
  for (const row of Object.values(state.drumBindings || {})) {
    for (const id of [row.groove, row.fill]) {
      if (!id || state.drums.some((groove) => groove.id === id)) continue
      if (!state.drumBound[id]) wanted.add(id)
    }
  }
  if (!wanted.size) return

  const rows = await getGrooves([...wanted])
  const next = { ...state.drumBound }
  for (const row of rows) next[row.id] = unpackGroove(row)
  state.drumBound = next
}

/** The rows the drum book shows: every section, plus anything left over. */
export function drumRows() {
  return reconcileBindings(state.drumBindings, state.score.sections || [])
}

/** What plays over a stretch of chart, and what leads out of it. */
function grooveForSpan(span, what) {
  if (what === 'groove' && span.groove) {
    // `[d:name]` names a groove. Matched on the name rather than the id,
    // because a name is what somebody can type.
    const named = state.drums.find((groove) => groove.name === span.groove)
    if (named) return named
  }

  const row = state.drumBindings[span.sectionName ?? WHOLE_SONG]
            || state.drumBindings[WHOLE_SONG]
            || {}
  return grooveById(what === 'fill' ? row.fill : row.groove)
}

export function setGrooveFor(name, grooveId, what = 'groove') {
  state.drumBindings = bindGroove(state.drumBindings, name, grooveId, what)
  saveDrumBindings(state.drumBindings)
  // An imported groove is bound by id and lives in the database, so it has to
  // be fetched before anything can play it.
  rememberBoundGrooves().then(refreshDrums)
  refreshDrums()
}

export function forgetDrumBinding(name) {
  const next = forgetBinding(state.drumBindings, name, state.score.sections || [])
  if (next === state.drumBindings) {
    toast('That part is still in the chart')
    return
  }
  state.drumBindings = next
  saveDrumBindings(state.drumBindings)
  refreshDrums()
}

/** The player is told again, and the plugin recompiled. */
function refreshDrums() {
  player.getGroove = (span) => grooveForSpan(span, 'groove')
  player.getFill = (span) => grooveForSpan(span, 'fill')
  player.getKitMap = () => kitMapFor()
  player.getInboundMap = (groove) => inboundMapFor(groove)
  player.rebuildDrums()
  // pushToHost is the compile: it debounces and sends the whole request, which
  // now carries the grooves this chart uses.
  pushToHost()
}

/** Only the grooves this chart actually uses, resolved for the compiler --
    two and a half thousand would not fit through the bridge and none of the
    rest is wanted. */
function groovesInUse() {
  const out = {}
  if (!state.settings.drums.enabled) return out

  const take = (groove) => { if (groove) out[groove.id] = groove }
  for (const span of buildDrumSpansForRequest()) {
    take(grooveForSpan(span, 'groove'))
    take(grooveForSpan(span, 'fill'))
  }
  return out
}

/**
 * The same, with the notes actually in them.
 *
 * A row from a library the plugin points at is an index entry: it knows what it
 * is and where it lives and has no notes at all. The compiler needs the notes,
 * so the handful a chart actually binds are read off disk first -- one per
 * section, and a chart has a few sections.
 */
async function resolvedGroovesInUse() {
  const found = groovesInUse()
  const out = {}
  for (const [id, groove] of Object.entries(found)) {
    out[id] = groove.byReference ? await notesFor(groove) : groove
  }
  return out
}

/** The spans the compiler will see, so the same grooves are sent. */
function buildDrumSpansForRequest() {
  const spans = []
  let open = null
  for (const event of state.score.events || []) {
    const key = `${event.section}|${event.drums || ''}`
    if (!open || open.key !== key) {
      open = { key, section: event.section, sectionName: event.sectionName, groove: event.drums }
      spans.push(open)
    }
  }
  return spans
}

/* ------------------------------------------------------------------ *
 * Somebody's own drum library
 *
 * Imported rather than shipped, and never redistributed: it is read from where
 * it already is, kept in this browser, and never leaves. The bundled corpus is
 * the only one that can legally travel with the program.
 * @see README.md "On bundling other people's collections"
 * ------------------------------------------------------------------ */

export async function refreshDrumSets() {
  state.drumSets = await listSets()
  return state.drumSets
}

/**
 * Libraries the plugin points at rather than swallows.
 *
 * Inside a plugin the filesystem is right there and the page has no business
 * copying half a gigabyte of somebody else's MIDI into a browser database to
 * play it. So the tree is walked natively -- a rung at a time, because a whole
 * tree in one answer is a megabyte and a half of JavaScript source for a single
 * call and fails as silence (@see walkLibrary) -- each file is read once to work
 * out what it is, and only the *index* is kept: what it is called, how long it
 * is, what shelf it sits on, what the file said about itself. The notes stay in
 * the file and are read at the moment something needs to play them.
 *
 * **One click, many libraries.** What somebody actually points at is usually a
 * collection of collections: fifty vendors' packs side by side, two of them
 * holding most of the files. Each becomes its own library, because that is the
 * level a vendor's name is at and a note map belongs to a vendor. @see planPacks
 *
 * It is a batch job and it is meant to be interrupted. Stopping leaves the packs
 * that finished alone and marks the one it was in; starting again skips what is
 * whole and finishes what is not.
 *
 * The browser build cannot do any of this. A web page has no path to point at,
 * so there it keeps the notes and this is never reached.
 */
export async function importDrumFolderByReference() {
  const progress = state.drumImport
  Object.assign(progress, {
    running: false, read: 0, skipped: 0, total: 0, cancel: false,
    readBase: 0, skippedBase: 0, name: '', trouble: '',
    packs: 0, packsDone: 0, packsKept: 0, packsMade: 0, pack: '',
    shelves: 0, shelvesDone: 0,
  })

  try {
    return await runImport(progress)
  } catch (error) {
    // Every failure in here used to become an empty list and a silent return,
    // which looked exactly like a folder with no drums in it. Whatever went
    // wrong, it says so.
    progress.running = false
    progress.pack = ''
    progress.trouble = String((error && error.message) || error)
    toast(progress.trouble)
    return null
  }
}

async function runImport(progress) {
  // The dialog waits on a person and the disk walk waits on a disk. Neither
  // belongs under the fifteen seconds that suits a question answered from
  // memory. @see callHostSlowly
  const chosen = await callHostSlowly('jaminChooseFolder')
  if (!chosen || !chosen.path) return null

  progress.name = chosen.name || 'library'
  progress.running = true

  // One rung of the tree, which is all the pack plan needs: the folders
  // directly inside the chosen one are the libraries. Everything below each is
  // walked while it is being read, so no single answer is ever large.
  const top = (await callHostSlowly('jaminListFolders', chosen.path)) || []
  const packs = planPacks(chosen, top.map(slashes))

  progress.packs = packs.length

  // What is already here and whole. A pack that was stopped part way is not:
  // skipping it would mean an interrupted job could never be finished, only
  // restarted from nothing.
  const already = new Set(state.drumSets.filter((set) => !set.partial).map((set) => set.id))
  const unfinished = new Set(state.drumSets.filter((set) => set.partial).map((set) => set.id))

  for (const pack of packs) {
    if (progress.cancel) break

    if (already.has(pack.id)) {
      progress.packsDone++
      progress.packsKept++
      continue
    }

    progress.pack = pack.name
    // The rows a stopped run left behind, cleared before the second attempt:
    // they are numbered from the start of the pack, and a shorter second pass
    // would leave the tail of the first one orphaned.
    if (unfinished.has(pack.id)) await deleteSet(pack.id)

    const ok = await importOnePack(pack, progress)
    progress.packsDone++
    if (!ok) break
  }

  progress.running = false
  progress.pack = ''
  await refreshDrumSets()
  await rememberBoundGrooves()

  // Show what just arrived. Importing fifty libraries and being left looking at
  // the built-in corpus reads as nothing having happened, which is exactly what
  // it looked like.
  const arrived = state.drumSets
    .filter((set) => !already.has(set.id))
    .sort((a, b) => (b.count || 0) - (a.count || 0))[0]
  if (arrived) {
    state.drumFilters.set = arrived.id
    state.drumFilters.folder = ''
  }
  await searchDrums()

  const made = progress.packsMade
  if (progress.trouble) toast(progress.trouble)
  else if (!made) toast(`Nothing readable in ${progress.name} — ${progress.skipped.toLocaleString()} files skipped`)
  else toast(`${progress.read.toLocaleString()} patterns from ${made.toLocaleString()} library${made === 1 ? '' : 'ies'}`)

  return packs.length
}

/**
 * What the walk reads through: the plugin's filesystem.
 *
 * Three calls, patient ones. The dialog waits on a person and the disk waits on
 * a disk; neither belongs under the fifteen seconds that suits a question the
 * plugin answers out of its own memory. @see callHostSlowly
 */
/** How many failures in a row mean the fault is here rather than in the files.
    A scraped collection genuinely holds broken files; it does not hold five
    hundred of them before the first good one. */
const NOTHING_WORKS = 500

const hostReader = {
  listFolders: (where) => callHostSlowly('jaminListFolders', where),
  scanFiles: (where) => callHostSlowly('jaminScanFolder', where, 200000, false),
  readFiles: (where, names) => callHostSlowly('jaminReadFiles', where, names),
}

/**
 * One library, folder by folder.
 *
 * Returns false if the whole job should stop -- which means the database
 * refused a write, the one failure that must not be shrugged off. Everything
 * else that can go wrong with a scraped collection is one bad file, and one bad
 * file is skipped.
 */
async function importOnePack(pack, progress, reader = hostReader) {
  const perFolder = new Map()
  // Spread over the whole library rather than the first shelf of it. @see
  // reservoir, and the same mistake caught once before in spread().
  const samples = reservoir(120, hashOf(pack.id))
  const pitches = new Set()
  let index = 0
  let batch = []
  let kept = 0
  let skipped = 0

  for await (const step of walkLibrary(pack, reader)) {
    if (progress.cancel) break
    if (step.opensShelf) progress.shelvesDone++

    for (let i = 0; i < step.names.length; i++) {
      const encoded = step.blobs[i]
      if (typeof encoded !== 'string' || !encoded) { skipped++; continue }

      // Relative to the library, not to the shelf: it is what the library is
      // rooted at, so it is what the file is found by later. @see notesFor
      const path = step.shelf ? `${step.shelf}/${step.names[i]}` : step.names[i]

      let groove = null
      try {
        groove = readGrooveFile(base64Bytes(encoded), path)
      } catch {
        groove = null
      }
      if (!groove) { skipped++; continue }

      kept++
      samples.offer(groove)

      let hist = perFolder.get(groove.folder)
      if (!hist) { hist = {}; perFolder.set(groove.folder, hist) }
      for (const note of groove.notes) {
        hist[note.note] = (hist[note.note] || 0) + 1
        pitches.add(note.note)
      }

      // Without the notes: this row is a pointer, not a copy.
      batch.push(packGroove(groove, pack.id, index++, { byReference: true }))
    }

    // Running totals for the whole job: what earlier libraries got, plus this
    // one so far.
    progress.read = progress.readBase + kept
    progress.skipped = progress.skippedBase + skipped

    // Everything skipped and nothing kept is not a folder of bad files, it is
    // something wrong on this side -- as it was when the bytes arrived in an
    // encoding the page could not decode, and 774,000 files were read
    // successfully and thrown away one at a time. Say so now rather than
    // twenty minutes from now.
    if (!progress.read && progress.skipped >= NOTHING_WORKS) {
      progress.trouble = `${progress.skipped.toLocaleString()} files read and none of them `
        + 'parsed as MIDI — stopping, because that is a fault rather than a folder of bad files'
      return false
    }

    if (batch.length >= 500) {
      const trouble = await putGrooves(batch)
      if (trouble) { progress.trouble = storeTrouble(trouble); return false }
      batch = []
      await new Promise((resume) => setTimeout(resume, 0))
    }
  }

  if (batch.length) {
    const trouble = await putGrooves(batch)
    if (trouble) { progress.trouble = storeTrouble(trouble); return false }
  }

  progress.readBase += kept
  progress.skippedBase += skipped

  // An empty folder is not a library. Writing a row for one would put fifty
  // names in a list that plays nothing.
  if (!kept) return true

  progress.packsMade++
  const { folderKits, setKit, reason } = classifyFolders(perFolder)
  const drawn = samples.take()

  await putSet({
    id: pack.id,
    name: pack.name,
    // Where it lives, which is the whole point: the rows are pointers into it.
    root: pack.root,
    byReference: true,
    // Stopped part way through. The rows that were read are good and play; the
    // row says so rather than claiming the whole folder is in.
    partial: progress.cancel,
    kit: setKit,
    customMap: {},
    folderKits,
    folders: perFolder.size,
    // Why, when the answer was nothing. A pack of chromatic runs -- one
    // ascending note per beat, which is how a sample library indexes itself --
    // is not a kit and cannot be classified as one, and saying so is more use
    // than an empty box.
    kitReason: setKit ? '' : reason,
    facts: drawn.length ? describeSet(drawn, { pitches: [...pitches].sort((a, b) => a - b) }) : {},
    count: kept,
    addedAt: Date.now(),
  })

  return true
}

/**
 * How much room the catalogue is taking, and how much there is.
 *
 * An index of eight hundred thousand patterns is a few hundred megabytes, which
 * is within what a browser will store and not obviously so. A number somebody
 * can see beats a job that stops at four hundred thousand for reasons nobody
 * can name -- and the job does stop cleanly, @see importOnePack.
 */
export async function measureStorage() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    state.drumStorage = { usage, quota }
  } catch {
    /* a browser that will not say is not a problem to report */
  }
}

/**
 * What to say when the database refuses a batch.
 *
 * Everything written before it stays and plays, and the packs that finished are
 * whole -- so this is where a job stops, not where it is lost. Which is worth
 * saying, because twenty minutes in it looks like the latter.
 */
function storeTrouble(name) {
  if (name === 'QuotaExceededError') {
    return 'No more room on this machine — everything read so far is kept and plays'
  }
  return `The catalogue would not take more (${name}) — everything read so far is kept`
}

/** A number from a string, to seed the sampling. */
function hashOf(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return hash >>> 0
}

async function readByReference(root, path) {
  const encoded = await callHost('jaminReadFile', root, path).catch(() => null)
  if (typeof encoded !== 'string' || !encoded) return null
  try {
    return readGrooveFile(base64Bytes(encoded), path)
  } catch {
    return null
  }
}

/** Base64 to bytes. The bridge carries strings, and a JSON array of forty
    thousand numbers costs more to build and parse than the file does to read. */
function base64Bytes(encoded) {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The notes behind an index row, fetched when something is about to play it.
 *
 * Cached, because a chart binds a handful of grooves and then compiles on every
 * keystroke; reading the same four files off disk a hundred times a minute would
 * be silly. Small, because a handful is all it ever holds.
 */
const referenced = new Map()

export async function notesFor(groove) {
  if (!groove || !groove.byReference) return groove

  const cached = referenced.get(groove.id)
  if (cached) return cached

  const set = state.drumSets.find((row) => row.id === groove.setId)
  if (!set || !set.root) return groove

  const read = await readByReference(set.root, groove.path)
  if (!read) return groove

  const whole = { ...groove, notes: read.notes, byReference: false }
  if (referenced.size > 64) referenced.clear()
  referenced.set(groove.id, whole)
  return whole
}

/** The commonest verdict per shelf, and the library's own. @see classifyKit */
function classifyFolders(perFolder) {
  const folderKits = {}
  const tally = new Map()
  const reasons = []
  for (const [shelf, hist] of perFolder) {
    const verdict = classifyKit(hist)
    folderKits[shelf] = verdict.kit
    tally.set(verdict.kit, (tally.get(verdict.kit) || 0) + 1)
    if (!verdict.kit && verdict.reason && !reasons.includes(verdict.reason)) {
      reasons.push(verdict.reason)
    }
  }

  const known = [...tally.entries()].filter(([kit]) => kit)
  const majority = known.sort((a, b) => b[1] - a[1])[0]
  const setKit = majority ? majority[0] : ''

  for (const shelf of Object.keys(folderKits)) {
    if (!folderKits[shelf] || folderKits[shelf] === setKit) delete folderKits[shelf]
  }

  return { folderKits, setKit, reason: setKit ? '' : reasons[0] || '' }
}

/** A library, read. `files` is whatever a directory picker handed over. */
export async function importDrumFolder(files, name) {
  const list = [...files].filter((file) => /\.midi?$/i.test(file.name))
  if (!list.length) {
    toast('No MIDI files in there')
    return null
  }

  const progress = state.drumImport
  Object.assign(progress, {
    running: true, read: 0, skipped: 0, total: list.length,
    name: name || 'library', cancel: false, trouble: '',
    packs: 0, packsDone: 0, packsKept: 0, packsMade: 0, pack: '', shelves: 0, shelvesDone: 0,
  })

  const setId = `s${Date.now().toString(36)}`
  const relative = (file) => file.webkitRelativePath || file.name

  // What the library is, before reading all of it: a hundred files spread
  // across the tree say as much as the whole thing about which pack this is,
  // and it means the set has something to show while the rest arrives.
  const samples = []
  for (const file of spread(list, Math.min(120, list.length))) {
    const groove = await readOne(file, relative(file))
    if (groove) samples.push(groove)
  }

  const facts = samples.length ? describeSet(samples) : {}
  await putSet({
    id: setId,
    name: name || 'library',
    // A library is written for one instrument, and the next one is not written
    // for the same one -- so the kit belongs to the set. Empty means "whatever
    // the global setting says".
    kit: '',
    customMap: {},
    facts,
    count: 0,
    addedAt: Date.now(),
  })
  await refreshDrumSets()

  let index = 0
  let batch = []
  // A histogram per folder, accumulated as the files go past. It costs nothing
  // -- every file is being read anyway -- and it is what lets each shelf be
  // given its own note map rather than the whole import sharing one guess.
  // Measured across this collection, packs genuinely disagree with themselves:
  // one folder is General MIDI and the next is a pad layout.
  const perFolder = new Map()
  // Every pitch the library uses, not every pitch the sample uses. It is what
  // says how much of a library the chosen kit has no drum for, and a sample
  // would understate it. @see describeSet
  const pitches = new Set()

  for (const file of list) {
    if (progress.cancel) break

    const groove = await readOne(file, relative(file))
    if (groove) {
      batch.push(packGroove(groove, setId, index++))
      progress.read++

      const shelf = groove.folder
      let hist = perFolder.get(shelf)
      if (!hist) { hist = {}; perFolder.set(shelf, hist) }
      for (const note of groove.notes) {
        hist[note.note] = (hist[note.note] || 0) + 1
        pitches.add(note.note)
      }
    } else {
      progress.skipped++
    }

    // Written in batches so a library of several hundred thousand can be
    // interrupted, and so the page is not held for a minute at a time.
    if (batch.length >= 400) {
      // A browser keeps the notes rather than pointing at them, so this is the
      // build that fills a database up. Stopping and saying so beats reading
      // another hour of files into nowhere.
      const trouble = await putGrooves(batch)
      if (trouble) { progress.trouble = storeTrouble(trouble); break }
      batch = []
      await new Promise((resume) => setTimeout(resume, 0))
    }
  }

  if (batch.length && !progress.trouble) {
    const trouble = await putGrooves(batch)
    if (trouble) progress.trouble = storeTrouble(trouble)
  }

  // Each shelf gets the map its own notes say it was written for.
  const { folderKits, setKit, reason } = classifyFolders(perFolder)

  const count = await countGrooves(setId)
  await putSet({
    id: setId, name: name || 'library', kit: setKit, customMap: {},
    folderKits, folders: perFolder.size,
    kitReason: setKit ? '' : reason,
    partial: Boolean(progress.cancel || progress.trouble),
    // Now with every pitch rather than the sample's, which is only knowable
    // once the whole library has gone past.
    facts: samples.length
      ? describeSet(samples, { pitches: [...pitches].sort((a, b) => a - b) })
      : facts,
    count, addedAt: Date.now(),
  })
  await refreshDrumSets()

  progress.running = false
  toast(progress.trouble
    ? progress.trouble
    : progress.cancel
      ? `Stopped — ${count.toLocaleString()} kept`
      : `${count.toLocaleString()} patterns from ${name || 'the folder'}`)

  await searchDrums()
  return setId
}

async function readOne(file, path) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return readGrooveFile(bytes, path)
  } catch {
    return null
  }
}

export function cancelDrumImport() {
  state.drumImport.cancel = true
}

export async function forgetDrumSet(id) {
  await deleteSet(id)
  await refreshDrumSets()
  await searchDrums()
  toast('Library removed')
}

/** The kit a library's notes were written for. */
export async function setDrumSetKit(id, kit, customMap = null) {
  const set = state.drumSets.find((row) => row.id === id)
  if (!set) return
  const next = { ...set, kit: kit || '', customMap: customMap || set.customMap || {} }
  await putSet(next)
  await refreshDrumSets()
  refreshDrums()
}

/**
 * The catalogue, read when somebody actually looks at it.
 *
 * Opening the editor used to search the imported catalogue and ask the browser
 * how much room it was taking, every time. With a few hundred patterns that
 * cost nothing and nobody noticed. With three quarters of a million it took
 * about thirty seconds a window -- measured: four editor open/close cycles went
 * from 38 seconds to two and a half minutes on this machine, all of it real CPU
 * rather than waiting, once a large library had been imported.
 *
 * So none of it happens at startup any more. The chart, the phrases and the
 * drums a chart binds are what opening a window needs; the catalogue is what
 * opening the *book* needs, and it is only ever a click away from being asked
 * for.
 */
export async function openDrumBook() {
  state.ui.drums = true
  await refreshDrumSets()
  if (!state.drumSets.length) return
  // A library that has since been removed is not one to search for.
  if (!state.drumSets.some((set) => set.id === state.drumFilters.set)) state.drumFilters.set = ''
  if (state.drumFilters.set) await searchDrums()
  measureStorage()
}

/**
 * Does this chart bind anything that lives in the imported catalogue?
 *
 * An imported groove's id names its library and its place in it -- `p2f4k9:1841`
 * -- where a bundled one is `g1841`. So this is a question about strings, and
 * answering it costs nothing, which is the point: the database is not opened to
 * find out whether the database is needed.
 */
function boundToImported(bindings) {
  for (const row of Object.values(bindings || {})) {
    for (const id of [row.groove, row.fill]) {
      if (typeof id === 'string' && id.includes(':')) return true
    }
  }
  return false
}

/** What the filters are showing, out of the imported catalogue. */
export async function searchDrums(filters = null) {
  if (filters) state.drumFilters = { ...state.drumFilters, ...filters }
  // Which library, remembered. Opening the plugin to the built-in corpus after
  // importing a collection reads as the collection having vanished.
  try {
    if (state.drumFilters.set) localStorage.setItem(DRUM_LIBRARY_KEY, state.drumFilters.set)
    else localStorage.removeItem(DRUM_LIBRARY_KEY)
  } catch {
    /* ignore */
  }
  const found = await searchGrooves(state.drumFilters)
  state.drumHits = found.rows.map(unpackGroove)
  state.drumSearch = { scanned: found.scanned, partial: found.partial }
  return state.drumHits
}

export async function drumFacetsFor(setId) {
  return grooveFacets(setId || null)
}

/**
 * The map a groove is played *out* through: the drum instrument on this track.
 *
 * This is the global Kit setting and nothing else, because there is one drum
 * instrument on the track and every groove goes through it. Which library a
 * groove came from has no bearing on it.
 *
 * It used to return the *library's* kit when the library had one, which made
 * choosing Addictive Drums on the Kit tab do nothing at all to an imported
 * library -- it would be read as General MIDI and written straight back out as
 * General MIDI, silently ignoring the instrument actually loaded. The library's
 * kit answers a different question, and answers it in @see inboundMapFor.
 */
export function kitMapFor() {
  const drums = state.settings.drums
  return { ...kitById(drums.kit).map, ...cleanKitMap(drums.customMap) }
}

/**
 * The map that reads a groove's notes *in*: what numbering the file is written
 * in.
 *
 * This is where a library's own kit belongs, and why the kit lives on the set.
 * One folder is General MIDI and the next uses pitches General MIDI has no name
 * for; nothing global can be right for both, because it is a fact about the
 * file rather than a preference. Detected at import from the notes themselves,
 * overridable per library, and the shelf beats the library when a pack
 * disagrees with itself -- which packs do, often.
 *
 * Null for the shipped corpus, which is read through its own Roland map.
 * @see GENERAL_MIDI_IN, classifyKit
 */
export function inboundMapFor(groove) {
  if (!groove || !groove.setId) return null
  const set = state.drumSets.find((row) => row.id === groove.setId)
  if (!set) return null
  const shelf = (set.folderKits || {})[groove.folder]
  return kitById(shelf || set.kit || 'gm').in || null
}

/** What a library's notes are being read as, for the interface to say so. */
export function inboundKitFor(groove) {
  if (!groove || !groove.setId) return ''
  const set = state.drumSets.find((row) => row.id === groove.setId)
  if (!set) return ''
  const shelf = (set.folderKits || {})[groove.folder]
  return shelf || set.kit || ''
}

/**
 * Hit one drum, now.
 *
 * "What does this kit actually have on 42" has one honest answer, which is to
 * hit it -- and a table of numbers is exactly the thing that cannot answer it.
 *
 * Two routes, because a plugin's page has no MIDI output of its own: in a
 * browser it goes straight out of the engine, and inside the plugin it is
 * handed to the processor, which puts it in the next block the host collects.
 */
export function tapDrum(note, velocity = 100) {
  if (!Number.isInteger(note) || note < 0 || note > 127) return

  const midi = state.settings.midi
  const channel = midi.drumChannel ?? 9

  if (hosted()) {
    callHost('jaminTapDrum', note, channel, velocity).catch(() => {})
    return
  }

  const outputId = midi.drumOutputId || midi.chordOutputId
  if (!engine.noteOn(outputId, channel, note, velocity)) {
    toast('No drum output bound yet')
    return
  }
  // Struck, not held.
  setTimeout(() => engine.noteOff(outputId, channel, note), 120)
}

/**
 * The lengths the chart actually has, in bars.
 *
 * What "fits" means: a pattern fits if it goes a whole number of times into one
 * of the song's parts. A two-bar groove fits an eight-bar verse four times and
 * a three-bar one does not fit at all -- it would be cut off mid-phrase every
 * time round, which is what makes a loop sound like a mistake rather than a
 * part.
 */
export function sectionBars() {
  const perBar = state.score.pulsesPerBar || 96
  const sections = state.score.sections || []

  if (!sections.length) {
    const whole = Math.round((state.score.totalPulses || 0) / perBar)
    return whole > 0 ? [{ name: WHOLE_SONG, bars: whole }] : []
  }

  return sections
    .map((section) => ({
      name: section.name,
      bars: Math.round((section.endPulse - section.startPulse) / perBar),
    }))
    .filter((section) => section.bars > 0)
}

/** Which of the song's parts this pattern would sit in cleanly, if any. */
export function partsItFits(groove) {
  return sectionBars().filter((section) => fitsBars(groove, section.bars))
}

/**
 * Which slot a groove is in for a part: its groove, its fill, or neither.
 *
 * Any pattern can be either. What a library *calls* a pattern is a guess made
 * from its file name and its length -- "1 Bar Fills" in the path, eight bars or
 * fewer -- and a guess is not a rule. A two-bar pattern nobody labelled is a
 * perfectly good fill, and refusing it because of what a vendor typed in a
 * folder name is the interface arguing with somebody about their own library.
 */
export function slotFor(name, groove) {
  if (!name || !groove) return ''
  return slotOf(state.drumBindings, name, groove.id)
}

/** Still true/false, for anything that only wants to know whether it plays. */
export function boundTo(name, groove) {
  return Boolean(slotFor(name, groove))
}

/**
 * Round the three states: nothing, the part's groove, the part's fill.
 *
 * One control instead of two buttons and a rule about which one is allowed.
 * What the pattern is labelled decides only which slot the *first* click
 * reaches -- a fill offers itself as a fill first, because a fill played for
 * eight bars is a bad first result -- and both slots are always reachable.
 *
 * Returns the slot it landed in, so the caller can say what happened.
 */
export function cycleGrooveOn(name, groove) {
  if (!name || !groove) return ''

  const { bindings, slot } = cycleBinding(state.drumBindings, name, groove.id, groove.kind)

  state.drumBindings = bindings
  saveDrumBindings(bindings)
  rememberBoundGrooves().then(refreshDrums)
  refreshDrums()
  return slot
}

/** Put a groove in a named slot, or take it out. */
export function toggleGrooveOn(name, groove) {
  return cycleGrooveOn(name, groove)
}

/**
 * One groove, every part.
 *
 * What auto-select does on a click: a beat becomes every section's groove, a
 * fill becomes every section's fill. It is the common case by a distance --
 * most songs have one feel -- and doing it a section at a time is five clicks
 * to say one thing.
 */
export function assignEverywhere(groove) {
  if (!groove) return 0
  const what = groove.kind === 'fill' ? 'fill' : 'groove'

  let next = state.drumBindings
  const rows = drumRows().filter((row) => !row.stale)
  for (const row of rows) next = bindGroove(next, row.name, groove.id, what)

  state.drumBindings = next
  saveDrumBindings(next)
  refreshDrums()
  toast(`${groove.name} → ${rows.length} part${rows.length === 1 ? '' : 's'}`)
  return rows.length
}

/**
 * Fill in the rest of the song around one beat.
 *
 * Every part with no groove gets this one, and every part gets a fill chosen to
 * suit it -- same genre, same time signature, nearest tempo. Parts that have
 * already been decided are left alone: this is for getting from nothing to
 * something, not for overwriting a set of choices somebody made.
 *
 * The fill is chosen per part rather than once, so a song does not lead out of
 * every section with the same flurry. @see matchingFill
 */
export function autoFillFrom(groove) {
  if (!groove) {
    toast('Pick a pattern first')
    return 0
  }

  const rows = drumRows().filter((row) => !row.stale)
  if (!rows.length) return 0

  let next = state.drumBindings
  let placed = 0

  for (const row of rows) {
    if (!row.groove) {
      next = bindGroove(next, row.name, groove.id, 'groove')
      placed++
    }
    if (!row.fill) {
      const fill = matchingFill(groove, state.drums, { prefer: 'random' })
      if (fill) {
        next = bindGroove(next, row.name, fill.id, 'fill')
        placed++
      }
    }
  }

  state.drumBindings = next
  saveDrumBindings(next)
  refreshDrums()
  toast(placed ? `Filled in ${placed} slot${placed === 1 ? '' : 's'}` : 'Everything was already chosen')
  return placed
}

/**
 * The drum accent: one groove, fired by hand or by a control.
 *
 * The phrase book's accent replaces the phrase on the next chord; this replaces
 * the groove on the next *section*, because that is the unit a drummer thinks
 * in. A fill fired this way lands where a fill lands -- at the end of the
 * section it is leading out of -- rather than starting under the next downbeat.
 */
export function setDrumAccent(groove) {
  state.drumAccent = groove ? groove.id : null
  try {
    if (state.drumAccent) localStorage.setItem(DRUM_ACCENT_KEY, state.drumAccent)
    else localStorage.removeItem(DRUM_ACCENT_KEY)
  } catch {
    /* ignore */
  }
  toast(groove ? `${groove.name} is the drum accent` : 'Drum accent cleared')
}

export function triggerDrumAccent() {
  const groove = grooveById(state.drumAccent)
  if (!groove) {
    toast('No drum accent chosen')
    return
  }
  state.ui.drumAccentArmed = !state.ui.drumAccentArmed
  player.armDrumAccent(state.ui.drumAccentArmed ? groove : null)
}

/** Tell the others about an edit made here. */
function publishEdit(text) {
  if (!session || applyingRemote) return
  const update = session.change(text)
  if (update) publishShared()
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
  // Settled here as well as on the clock, so a chord names itself on screen
  // whether or not the transport is rolling. It can only be *articulated* while
  // it is -- a phrase is a rhythm, and a stopped transport has no time to lay
  // one on. @see Player.hearTick
  player.hearTick()
  syncDrumsPlaying()
}

/**
 * What the drums are doing this instant, for the book to light up.
 *
 * Worked out from the part and the playhead rather than reported by anything.
 * It has to be: inside the plugin the notes are played by native code from a
 * compiled sequence, and the page never hears them -- so a callback from the
 * player would light up in a browser tab and stay dark where it matters.
 *
 * Everything struck *since the last look* rather than everything at this exact
 * pulse. This runs about eight times a second and a sixteenth at 120bpm is
 * closer to eight; sampling an instant would show perhaps one hit in three and
 * make a busy groove look sparse.
 */
let lastDrumPulse = -1

function syncDrumsPlaying() {
  const playing = state.playing

  if (!live.running) {
    if (playing.section || playing.voices.length) {
      playing.section = null
      playing.voices = []
    }
    lastDrumPulse = -1
    return
  }

  // Which part of the song we are in. The event carries it, having been given
  // it by the parser. @see core/score.js
  const event = state.score.events[live.eventIndex]
  const section = event ? (event.sectionName ?? WHOLE_SONG) : null
  if (playing.section !== section) playing.section = section

  const track = player.drumTrack
  if (!track || !track.length) {
    if (playing.voices.length) playing.voices = []
    return
  }

  const now = live.position
  // A jump backwards -- a loop, or somebody moving the playhead -- is a fresh
  // start rather than a window running the length of the song.
  const from = lastDrumPulse >= 0 && lastDrumPulse <= now ? lastDrumPulse : now - 1
  lastDrumPulse = now

  const struck = new Set()
  for (const hit of track) {
    if (hit.at <= from) continue
    if (hit.at > now) break                 // the track is sorted by pulse
    if (hit.voice) struck.add(hit.voice)
  }

  const next = [...struck]
  if (next.length !== playing.voices.length || next.some((v, i) => v !== playing.voices[i])) {
    playing.voices = next
  }
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

// And everybody else holding this chart hears about it.
watch(() => state.text, (text) => publishEdit(text))

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
  // So the other windows' tabs say what this instance is playing.
  describeInstance()
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

  // Aimed at whichever instance's tab is open. Ours takes the ordinary path --
  // it may be a per-chord binding rather than the whole song -- and anybody
  // else's is a request, because only that instance can look the name up.
  const target = state.ui.targetInstance
  if (hosted() && target && target !== state.roster.me) {
    setInstancePhrase(target, entry.id || entry.name)
    toast(`${entry.name} → ${instanceLabel(target)}`)
    return
  }

  bindPhrase(entry.id || entry.name)
}

/** What to call an instance in a message: its track, or its place. */
export function instanceLabel(id) {
  const at = state.roster.instances.findIndex((i) => i.id === id)
  if (at < 0) return 'that track'
  return state.roster.instances[at].name || `track ${at + 1}`
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
    // Same length as the song, or going into it evenly. The built-in
    // progressions have no stored bar count, so it is read from the text.
    if (filters.fits) {
      const bars = Math.round(parseScore(item.text, {
        beatsPerBar: state.settings.transport.beatsPerBar,
      }).bars)
      if (!bars || filters.fits % bars !== 0) return false
    }
    return true
  })

  const narrowed = Boolean(filters.genre || filters.decade || filters.fits)

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
