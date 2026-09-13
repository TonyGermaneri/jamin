/**
 * Settings: defaults, persistence, migration.
 *
 * The promise of this program is that you bind two MIDI ports and type. Every
 * value here has a default that works without being touched.
 */

import { THEMES, SHADER_DEFAULTS } from './themes.js'

export const STORAGE_KEY = 'jamin.settings.v1'
export const TEXT_KEY = 'jamin.chart.v1'
export const PHRASE_KEY = 'jamin.phrases.v1'
export const SONG_PHRASE_KEY = 'jamin.songPhrase.v1'

export function defaultSettings() {
  const theme = THEMES[0]
  return {
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
      bassNote: true,
      bassOctave: 2,
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
      snapNonChordTones: false,
      keepBass: true,
      monitor: true,
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

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return mergeSettings(defaultSettings(), raw ? JSON.parse(raw) : null)
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
