/**
 * Theme gallery.
 *
 * A theme is colours + type + a shader preset.  The shader values are the same
 * knobs exposed in the Shaders tab, so picking a theme is just a bulk write of
 * those sliders -- tweak afterwards and you have your own.
 */

export const SHADER_DEFAULTS = {
  enabled: true,
  intensity: 0.85, // overall strength of every effect
  bloom: 0.6, // halo around the chord being played
  preRoll: 0.5, // how brightly the next chord charges up
  trail: 0.55, // afterglow on the chord that just finished
  warp: 0.35, // heat-shimmer displacement
  chroma: 0.25, // rgb split on the active chord
  scan: 0.15, // scanlines
  grain: 0.12, // film grain
  speed: 1.0, // animation rate multiplier
  pulse: 0.7, // how hard the background breathes on the beat
  hue: 0.0, // hue rotation of the accents, in turns
}

export const THEMES = [
  {
    id: 'nocturne',
    name: 'Nocturne',
    bg: '#07080c',
    fg: '#eef2ff',
    dim: '#5b6480',
    accent: '#7c5cff',
    accentAlt: '#22d3ee',
    error: '#ff5470',
    font: '"IBM Plex Mono", "SF Mono", ui-monospace, monospace',
    shader: { ...SHADER_DEFAULTS },
  },
  {
    id: 'neon-sign',
    name: 'Neon Sign',
    bg: '#0a0212',
    fg: '#ffe9fb',
    dim: '#7a4b86',
    accent: '#ff2e97',
    accentAlt: '#00e5ff',
    error: '#ffd166',
    font: '"IBM Plex Mono", "SF Mono", ui-monospace, monospace',
    shader: { ...SHADER_DEFAULTS, bloom: 0.95, chroma: 0.45, intensity: 1.0, warp: 0.5, trail: 0.7 },
  },
  {
    id: 'amber-crt',
    name: 'Amber CRT',
    bg: '#120b02',
    fg: '#ffc357',
    dim: '#7a5518',
    accent: '#ff9e2c',
    accentAlt: '#ffe6b0',
    error: '#ff5f45',
    font: '"IBM Plex Mono", "SF Mono", ui-monospace, monospace',
    shader: { ...SHADER_DEFAULTS, scan: 0.55, grain: 0.28, bloom: 0.5, chroma: 0.1, warp: 0.2 },
  },
  {
    id: 'paper-chart',
    name: 'Paper Chart',
    bg: '#f6f2e8',
    fg: '#1b1a17',
    dim: '#9b9384',
    accent: '#c2410c',
    accentAlt: '#0e7490',
    error: '#b91c1c',
    font: '"Iowan Old Style", Georgia, "Times New Roman", serif',
    shader: { ...SHADER_DEFAULTS, intensity: 0.35, bloom: 0.2, scan: 0, grain: 0.06, warp: 0.05, chroma: 0, trail: 0.3, pulse: 0.25 },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    bg: '#06243f',
    fg: '#dbeafe',
    dim: '#4b7aa8',
    accent: '#67e8f9',
    accentAlt: '#a5b4fc',
    error: '#fb7185',
    font: '"IBM Plex Mono", "SF Mono", ui-monospace, monospace',
    shader: { ...SHADER_DEFAULTS, warp: 0.15, scan: 0.3, bloom: 0.45, pulse: 0.5 },
  },
  {
    id: 'sunset-tape',
    name: 'Sunset Tape',
    bg: '#1a0f1f',
    fg: '#ffeede',
    dim: '#8a5f6b',
    accent: '#ff7849',
    accentAlt: '#ffc857',
    error: '#f43f5e',
    font: '"IBM Plex Mono", "SF Mono", ui-monospace, monospace',
    shader: { ...SHADER_DEFAULTS, grain: 0.3, warp: 0.45, bloom: 0.7, chroma: 0.3, speed: 0.8 },
  },
  {
    id: 'forest-floor',
    name: 'Forest Floor',
    bg: '#08130f',
    fg: '#dcfce7',
    dim: '#4b7a63',
    accent: '#34d399',
    accentAlt: '#a3e635',
    error: '#fb923c',
    font: '"IBM Plex Mono", "SF Mono", ui-monospace, monospace',
    shader: { ...SHADER_DEFAULTS, bloom: 0.55, warp: 0.4, speed: 0.7, pulse: 0.55, chroma: 0.12 },
  },
  {
    id: 'ink',
    name: 'Ink',
    bg: '#0b0b0b',
    fg: '#f5f5f5',
    dim: '#555555',
    accent: '#ffffff',
    accentAlt: '#9ca3af',
    error: '#ef4444',
    font: '"Helvetica Neue", Inter, system-ui, sans-serif',
    shader: { ...SHADER_DEFAULTS, intensity: 0.5, bloom: 0.35, chroma: 0, scan: 0, grain: 0.08, warp: 0.1, pulse: 0.3 },
  },
]

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0]
}

/** #rrggbb -> [r, g, b] in 0..1, for handing to the shader. */
export function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = parseInt(full || '000000', 16)
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}
