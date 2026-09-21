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
export const SETTINGS_VERSION = 13
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
      /**
       * The quick-edit menu that follows the pointer over a chord.
       *
       * Off. It is a good way in for somebody learning what a chord can be
       * asked to do, and a thing that keeps appearing over the text for
       * anybody who already knows -- and typing is how a chart is written
       * here, so most of the time the pointer is passing through rather
       * than aiming at anything. Right-click still opens the same menu on
       * purpose. @see components/ChartTokenTools.vue
       */
      hoverTools: false,
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
      /*
       * Your own playing, sent on as well as listened to.
       *
       * Mr. Accompany Me hears a chord and answers it; whether the keys
       * themselves are heard is a question about the rest of the rig. Most
       * of the time the keyboard is already going somewhere -- straight to
       * its own sound, or to a track the DAW is monitoring -- and passing
       * it on again is the same notes twice. So both are off, and somebody
       * whose keyboard has no other way out turns them on.
       *
       * This was `monitor`, which defaulted to on and only worked in a
       * browser: it sent through the raw engine, and the page has no MIDI
       * output of its own inside a plugin. It goes out the same way a
       * heard chord does now. @see core/player.js noteIn, passControl
       */
      passNotes: false,
      /*
       * And the pedal, which is not a note and was never passed at all.
       *
       * Only sustain -- CC 64 -- because that is the pedal a keyboard has
       * and the one this is about. Worth knowing that Hold is bound to the
       * same pedal by default, so with both on one press latches the chord
       * *and* sustains it, which is usually what a player means by it.
       */
      passPedal: false,
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
      /**
       * Maps somebody worked out and kept, by name.
       *
       * The built-in kits are a guess and cannot be anything else: jamin
       * has no way to read the layout of a plugin on the other end of a
       * MIDI cable, and four of the six send plain General MIDI because
       * that is the only layout an instrument can be assumed to take.
       *
       * The person at the keyboard *can* read it -- it is on screen in
       * front of them in their sampler's mapping window -- so once they
       * have corrected the table, this is where that answer lives instead
       * of being lost the next time the kit dropdown moves.
       * @see components/DrumKit.vue
       */
      myKits: {},
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

      /* Where each map was left is kept on its own key rather than here.
         @see GRAPH_ARRANGEMENT_KEY */

      /**
       * How the map looks and how it behaves.
       *
       * Here rather than buried in the renderer because what makes a tree of
       * nine nodes readable is not what makes one of nine hundred thousand
       * readable, and nobody can know in advance which of those they are
       * looking at. @see canvas/treeGraph.js retune
       */
      look: {
        /** How many shades the theme's accents are cut into, one per branch. */
        families: 7,
        /** Multiplies the size a node gets from how much is under it. */
        nodeSize: 1,
        edgeWidth: 0.9,
        /** How much of the last frame survives into this one: motion, as a
            smear. 0 is an ordinary clear. */
        trail: 0.35,
        /** How far a node's glow reaches past it. Additive, so a dense
            branch lights up as one mass. */
        bloom: 0.45,
        /** ring | burst | spiral -- how children leave their parent. */
        unfold: 'ring',
        /** How quickly the layout settles. 1 is d3's own pace. */
        speed: 1,
        /** Whether opening something takes the camera to it. Off, because
            you clicked it where you could see it. */
        follow: false,
        /** How hard nodes push apart, and how far an edge wants to be. */
        repel: 1,
        reach: 1,
        /** none | name | count -- what the label over a node says. */
        nodeInfo: 'count',
        /**
         * How far a filter takes down what it excludes.
         *
         * A filter is not a different catalogue, so it does not get a
         * different map: the layout stays exactly where it is and what
         * matched is what is lit. This is how far the rest goes towards
         * the background. 0 makes a filter invisible on the map.
         * @see canvas/treeGraph.js colourOf
         */
        muted: 0.82,
        /**
         * What a clip is drawn as, by what it is.
         *
         * A groove loops for a section and a fill happens once at the end of
         * one. On a map of three quarters of a million clips the only way to
         * tell which was which was to click it. @see canvas/nodeShapes.js
         * for what the names mean.
         */
        grooveShape: 'circle',
        fillShape: 'square',
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

  if (version < 13) {
    /*
     * `monitor` becomes `passNotes`, and goes off.
     *
     * Not carried over, deliberately. It defaulted to on and, in a plugin,
     * did nothing at all -- it sent through the raw MIDI engine, which
     * inside a plugin has no ports -- so "on" meant one thing in a browser
     * and nothing in a DAW. Now that it works in both, leaving it on for
     * everybody who never knowingly chose it would double every note for
     * the people whose keyboard is already monitored by the host, which is
     * most of them. Both pass-throughs start off and are one switch away.
     */
    delete next.accompany.monitor
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

/**
 * Where each catalogue's map was left.
 *
 * `{ [book]: { stamp, open, places, camera } }`: which nodes are open, where
 * each one on screen sits and whether it was put there by hand, and what the
 * camera was looking at.
 *
 * A catalogue is somewhere somebody is working rather than a picture they
 * glance at. Three folders down at the shelf they are auditioning from,
 * closing the window and losing it is the same as never having opened it --
 * and so is coming back to find the folder you dragged out of the way has
 * drifted back into the middle.
 *
 * Its own key, not part of the settings, for two reasons. It is large: a few
 * hundred nodes is a few kilobytes and the ceiling is around eighty, against
 * settings that are two. And the settings are watched -- every change to them
 * re-saves the lot and recompiles the chart for the plugin -- so keeping a
 * camera position in there would recompile the song every time somebody
 * scrolled the map. @see store.js, components/CatalogueGraph.vue
 *
 * Nodes are remembered by index, because the tree is built the same way every
 * time from the same catalogue -- `graph_check.py` asserts it. `stamp` is what
 * makes that safe: it says which tree the indexes were taken from, so a
 * filtered view or a re-imported library starts fresh rather than putting node
 * 412's position onto whatever node 412 has become.
 */
export const GRAPH_ARRANGEMENT_KEY = 'jamin.graphArrangement.v1'

export function loadArrangements() {
  try {
    const raw = localStorage.getItem(GRAPH_ARRANGEMENT_KEY)
    const held = raw ? JSON.parse(raw) : null
    return held && typeof held === 'object' ? held : {}
  } catch {
    return {}
  }
}

export function saveArrangements(all) {
  try {
    localStorage.setItem(GRAPH_ARRANGEMENT_KEY, JSON.stringify(all || {}))
  } catch {
    /* no room, private browsing -- a map that forgets is not worth a dialog */
  }
}

export const SAMPLE_CHART = `| Cmaj7 | A-7 | D-7 | G7 |
| Cmaj7 | %   | F-7 | Bb7 |
| E-7   | A7b9 | D-7 | G7 |
| C6/9  | %   | Ab7 | G7alt |`
