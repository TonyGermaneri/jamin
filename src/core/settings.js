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
 *   4 -- there were two bass settings doing much the same thing. The one in the
 *        phrase book won, since it holds a root under a phrase and under a plain
 *        chord alike; `chords.bassNote` and `accompany.keepBass` are gone, and
 *        anyone who had the chord one on gets the remaining one on.
 */
export const SETTINGS_VERSION = 5
export const TEXT_KEY = 'jamin.chart.v1'
export const PHRASE_KEY = 'jamin.phrases.v1'
export const SONG_PHRASE_KEY = 'jamin.songPhrase.v1'
export const ACCENT_KEY = 'jamin.accent.v1'
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
      velocity: 90,
      // A control change that fires the accent, from any input. null until bound.
      accentCc: null,
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
      fitLines: true,
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
      bassOctaves: 1,
      doubleBass: false,
      // Wider than the chord voicing range: a two-handed phrase spans more.
      rangeLow: 28,
      rangeHigh: 100,
      quantize: 0, // pulses; 6 = 16th notes
      captureMode: 'once', // once | continuous
      // Off by default: one phrase plays for the whole song. Turn it on to bind
      // a different phrase to individual chords, marked with a dot.
      perChordPhrases: false,
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
