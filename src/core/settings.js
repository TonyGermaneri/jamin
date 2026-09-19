/**
 * Settings: defaults, persistence, migration.
 *
 * The promise of this program is that you bind two MIDI ports and type. Every
 * value here has a default that works without being touched.
 */

import { THEMES, SHADER_DEFAULTS } from './themes.js'

export const STORAGE_KEY = 'jamin.settings.v1'

/**
 * Bumped when a stored setting needs correcting on the way in.
 *
 *   2 -- `accompany.fit` used to mean stretch/repeat/truncate, and stretching to
 *        fit was the default. Stretching is a tempo change: a bar of phrase in
 *        half a bar of chord plays twice as fast. Anyone upgrading still had
 *        `stretch` saved and would keep hearing that, having never chosen it.
 *   5 -- snapping notes that are not in the chord onto the nearest one that is
 *        became the default, and became a setting you can see. Nobody can have
 *        chosen the old value, because there was nothing to choose it with.
 *  10 -- `display.autoScroll` arrived. Defaults to off, so a settings object
 *        saved before it reads as off, which is what it would have been.
 *   9 -- `drums` arrived, with `midi.drumOutputId` and `midi.drumChannel`. New
 *        blocks with defaults, so a settings object saved before them reads as
 *        the defaults.
 *   8 -- `instances.quantize` arrived with mute and solo across instances. New
 *        block, default `bar`, so a saved settings object without it reads as
 *        the default anyway.
 *   7 -- `accompany.pedal` arrived. It defaults to off, and a saved settings
 *        object without it reads as off anyway, so this bump is bookkeeping
 *        rather than a migration -- but a version that does not move when the
 *        shape does is a version nobody can trust.
 *   4 -- there were two bass settings doing much the same thing. The one in the
 *        phrase book won, since it holds a root under a phrase and under a plain
 *        chord alike; `chords.bassNote` and `accompany.keepBass` are gone, and
 *        anyone who had the chord one on gets the remaining one on.
 */
export const SETTINGS_VERSION = 12
export const TEXT_KEY = 'jamin.chart.v1'
export const PHRASE_KEY = 'jamin.phrases.v1'
export const SONG_PHRASE_KEY = 'jamin.songPhrase.v1'
export const ACCENT_KEY = 'jamin.accent.v1'
export const DRUM_ACCENT_KEY = 'jamin.drumAccent.v1'
/** Which imported library the drum book was last showing. Kept because opening
    the plugin to the built-in corpus after importing a collection reads as the
    collection having vanished. */
export const DRUM_LIBRARY_KEY = 'jamin.drumLibrary.v1'
export const FAVOURITES_KEY = 'jamin.favourites.v1'

export function defaultSettings() {
  const theme = THEMES[0]
  return {
    version: SETTINGS_VERSION,
    midi: {
      clockInputId: '',
      chordOutputId: '',
      chordChannel: 0,
      bassOutputId: '',
      bassChannel: 0,
      accompInputId: '',
      accompOutputId: '',
      accompChannel: 1,
      drumOutputId: '',
      // Channel 10, counted from zero. Every drum machine and every sampler
      // since 1991 listens there; a drum part sent anywhere else is a drum part
      // nobody hears.
      drumChannel: 9,
      velocity: 90,
      // A control change that fires the accent, from any input. null until bound.
      accentCc: null,
      /**
       * The controller that latches a heard chord, so the hands can come off it.
       *
       * 64 is the sustain pedal, which is the pedal already under somebody's
       * foot and does nothing else here -- jamin's own pedal output follows the
       * chart rather than the player. Rebindable, because not every controller
       * has a spare pedal socket. @see store.controlIn
       */
      holdCc: 64,
    },
    transport: {
      beatsPerBar: 4,
      loop: true,
      latencyPulses: 0,
      internalTempo: 120,
      autoStartOnClock: true,
      autoDetectClock: true,
    },
    chords: {
      octave: 4,
      rangeLow: 48,
      rangeHigh: 88,
      maxVoices: 5,
      smartVoicing: true,
      mergeRepeats: true,
      omitThirdOnDominant11: true,
      omitElevenOnThirteen: true,
    },
    display: {
      font: theme.font,
      minFontSize: 18,
      maxFontSize: 190,
      lineHeight: 1.22,
      padding: 28,
      // Every line at the size the longest one needs, so the chart reads as a
      // column of even text. Turn this on and each line is scaled on its own to
      // fill the width instead -- a bar of four chords small, a single chord
      // huge. @see canvas/layout.js
      dynamicLineSize: false,
      // Follow the song, keeping the chord being played near the middle. Off by
      // default: a chart that moves on its own is a surprise the first time.
      autoScroll: false,
      showReadout: true,
      showPlayhead: true,
      dimInactive: 0.55,
    },
    theme: {
      id: theme.id,
      bg: theme.bg,
      fg: theme.fg,
      dim: theme.dim,
      accent: theme.accent,
      accentAlt: theme.accentAlt,
      error: theme.error,
    },
    shader: { ...SHADER_DEFAULTS },
    accompany: {
      enabled: true,
      mode: 'replace', // replace | layer
      // follow: natural rhythm, pattern runs with the chart, chords only change
      // the harmony. restart: natural rhythm, pattern begins again each chord.
      // stretch: squeezed to fit the chord exactly, which changes the tempo.
      fit: 'follow',
      keepRegister: true,
      snapNonChordTones: true,
      monitor: true,
      // How fast a phrase plays over the chords: 1 is as it was played.
      speed: 1,
      // The register phrases sit in, when they are not following the chord before.
      octave: 4,
      // A held root under everything. Off unless asked for.
      bass: false,
      // The sustain pedal, held for the length of each chord and lifted on the
      // change. Off unless asked for, and `[p]` / `[np]` in the chart override
      // it from wherever they appear. @see pedalMark in core/score.js
      pedal: false,
      bassOctaves: 1,
      doubleBass: false,
      // Wider than the chord voicing range: a two-handed phrase spans more.
      rangeLow: 28,
      rangeHigh: 100,
      /**
       * Mr. Accompany Me, listening.
       *
       * It hears what is played, names the chord, and articulates it -- so this
       * is on only when asked for. A plugin that started turning incoming notes
       * into accompaniment the moment it was loaded would be a surprise.
       */
      listen: false,
      // merge: the chart plays its chords and the hands play over the top, which
      // is what a second player in the room is. override: while anything is held
      // the chart's harmony gives way. The drums and the pedal follow the song
      // either way -- they follow the song, not the hands.
      liveMode: 'merge',
      // How long a heard chord's phrase runs before coming round again. A held
      // chord lasts until the hands move, so it has to be given a length, and a
      // phrase is written to fill a bar.
      liveBars: 1,
      // How still the notes have to be before the chord is called. Four fingers
      // do not land in the same millisecond and every note on the way down is
      // briefly a different chord. @see core/chordDetect.js
      settleMs: 60,
      captureMode: 'once', // once | continuous
      // Off by default: one phrase plays for the whole song. Turn it on to bind
      // a different phrase to individual chords, marked with a dot.
      perChordPhrases: false,
    },
    drums: {
      // A drum part is an articulation like any other -- it is just that its
      // notes are instruments rather than pitches, so nothing about it is
      // transposed. @see core/drums.js
      enabled: true,
      // Which kit the grooves are translated to on the way out. @see drumKits.js
      kit: 'gm',
      // Voice -> note, overriding the chosen kit. Where a hand-built Drum Rack
      // gets fixed.
      customMap: {},
      // A fill in the bar before every section change, which is what a drum
      // chart has meant since long before there were corpora to draw on.
      fillOnEveryBoundary: true,
      /**
       * When taking a drum out takes effect: 'bar', 'beat' or 'instant'.
       *
       * A bar, because that is where a drummer drops the hat -- not wherever
       * the mouse happened to be. The same reasoning as muting a track, and the
       * same default. @see instances.quantize
       */
      muteQuantize: 'bar',
    },
    /**
     * What the dice draw on.
     *
     * Kept rather than hard-coded because the right answer depends on the
     * collection: somebody with one drum library wants the die to use it,
     * somebody with fifty wants it to stay in a genre. @see store.rollSong
     */
    /**
     * Which catalogues are browsed as a graph rather than as a list.
     *
     * Per catalogue, because they are not the same problem: ten thousand
     * phrases make a map worth looking at where a list is a scroll, and a
     * progression is often a thing you already know the name of. A list is
     * simply the right answer sometimes, so it stays.
     */
    graph: {
      phrases: false,
      drums: false,
      progressions: false,

      /** The names drawn over the dots. Without them it is a picture of a
          catalogue that says nothing about the catalogue. */
      labels: true,
      /** How many at once, counted in labels actually drawn -- they are placed
          in order of what is under them and one that would land on another is
          skipped, so this is a ceiling rather than a quota. */
      mostLabels: 140,

      /**
       * The simulation's own dials, named as cosmos.gl names them.
       *
       * What makes a tree of nine nodes readable is not what makes one of eight
       * hundred thousand readable, and no single set of numbers is right for
       * both -- so they are here rather than buried in the component.
       *
       * The defaults are tuned for a hierarchy rather than a cloud: strong
       * springs, weak repulsion. Every node is held by exactly one parent, so
       * the springs *are* the structure, and letting repulsion win turns a tidy
       * tree back into the hairball this replaced.
       */
      physics: {
        /** How quickly movement dies away. Higher settles sooner and stiffer. */
        friction: 0.88,
        /** Pull towards the middle. Near nothing, so branches spread. */
        gravity: 0.02,
        /** How hard nodes push each other apart. */
        repulsion: 0.35,
        /** How hard an edge pulls parent and child together. */
        spring: 1.6,
        /** How far apart an edge would like them. */
        linkDistance: 8,
        /** How fast the whole simulation cools. */
        decay: 1000,
        /** How heavy the lines are drawn. */
        linkWidth: 0.7,
      },
    },

    random: {
      /** How many grooves a genre needs before the die will pick it. One
          groove in a genre makes a song where every section is the same bar. */
      leastPerGenre: 4,
      /** Keep every section in the era of the first groove drawn, where there
          are enough of them to do it. */
      matchEra: true,
      /** Draw the progression from the same genre as the drums, falling back to
          any when nothing is tagged -- which most progressions are not. */
      matchGenre: true,
      /** Give every section its own articulation. Off makes one song-long
          feel, which is what a lot of records actually do. */
      phrasePerSection: true,
      /** How many sections a rolled song has, at most. */
      mostSections: 5,
    },
    instances: {
      // Muting a part is a musical act, not a mixer move: it lands on a bar line
      // so the part stops where a musician would stop it. `beat` is quicker and
      // `instant` is for when you are not playing to anything.
      quantize: 'bar',   // bar | beat | instant
    },
    network: {
      // Several machines holding one chart, found automatically.
      //
      // On by default, because a feature that has to be switched on before it
      // can find anything is a feature nobody discovers -- and finding each
      // other with nothing configured is the entire point. It opens a port and
      // anyone who can reach it can edit the chart, which the settings say
      // plainly rather than leaving to be found out.
      enabled: true,
      // Blank means not yet configured, not "anybody may join": nothing is
      // shared until somebody chooses a word. A chart every machine on the
      // network can edit by default is not a decision to make for people.
      secret: '',
    },
  }
}

/** Deep-merge stored values over the defaults so new settings appear on upgrade. */
export function mergeSettings(base, stored) {
  if (!stored || typeof stored !== 'object') return base
  const out = Array.isArray(base) ? base.slice() : { ...base }
  for (const key of Object.keys(stored)) {
    const value = stored[key]
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      out[key] = mergeSettings(base[key], value)
    } else if (value !== undefined && key in base) {
      out[key] = value
    }
  }
  return out
}

/**
 * Correct settings saved by an older version.
 *
 * A stored value always beats a new default -- that is the point of storing it --
 * so changing a default is not enough to reach anyone who has run the app
 * before. This is how a default actually gets changed.
 */
export function migrateSettings(stored) {
  if (!stored || typeof stored !== 'object') return stored
  const version = Number(stored.version) || 1
  if (version >= SETTINGS_VERSION) return stored

  const next = { ...stored, accompany: { ...(stored.accompany || {}) } }

  if (version < 2) {
    // The old vocabulary, and the old default among it.
    if (['stretch', 'repeat', 'truncate'].includes(next.accompany.fit)) {
      next.accompany.fit = 'follow'
    }
  }

  if (version < 3) {
    // The catalogue stopped filtering by chord, so the switch that did it goes.
    delete next.accompany.matchChord
  }

  if (version < 4) {
    // One bass setting instead of two. Carry the old answer over rather than
    // silently turning something off that was on.
    const chords = next.chords || {}
    if (chords.bassNote && next.accompany.bass === undefined) {
      next.accompany.bass = true
      if (next.accompany.bassOctaves === undefined) next.accompany.bassOctaves = 1
    }
    next.chords = { ...chords }
    delete next.chords.bassNote
    delete next.chords.bassOctave
    delete next.accompany.keepBass
  }

  if (version < 5) {
    next.accompany.snapNonChordTones = true
  }

  if (version < 6) {
    // Networking arrived on. It is the whole point of it -- a machine that has
    // to be switched on before it can be found is a machine somebody has to
    // walk over to.
    next.network = { enabled: true, ...(next.network || {}) }
  }

  if (version < 11) {
    // Lines used to be scaled one at a time; now they share a size by default.
    // Everybody lands on the new default, including whoever had the old
    // per-line fitting switched on -- that is what making it the default means,
    // and the switch is right there to go back.
    next.display = { ...(next.display || {}) }
    delete next.display.fitLines
  }

  if (version < 12) {
    // Mr. Accompany Me stopped recording and started listening. The capture
    // quantiser has nothing left to quantise.
    delete next.accompany.quantize
  }

  next.version = SETTINGS_VERSION
  return next
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return mergeSettings(defaultSettings(), migrateSettings(raw ? JSON.parse(raw) : null))
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* private browsing, quota, whatever -- not worth interrupting a rehearsal */
  }
}

export const SAMPLE_CHART = `| Cmaj7 | A-7 | D-7 | G7 |
| Cmaj7 | %   | F-7 | Bb7 |
| E-7   | A7b9 | D-7 | G7 |
| C6/9  | %   | Ab7 | G7alt |`
