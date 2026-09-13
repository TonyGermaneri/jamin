/**
 * Vuetify configuration, kept free of imports on purpose.
 *
 * Both the real plugin (which pulls in Vuetify's CSS, and is what Vite builds)
 * and the no-build `dev.html` entry read these, so the two can never drift.
 */

export const theme = {
  defaultTheme: 'jamin',
  themes: {
    jamin: {
      dark: true,
      colors: {
        background: '#0b0d14',
        surface: '#12151f',
        primary: '#7c5cff',
        secondary: '#22d3ee',
        error: '#ff5470',
      },
    },
  },
}

export const defaults = {
  VTextField: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
  VSelect: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
  VSlider: { density: 'compact', hideDetails: true, thumbSize: 14, trackSize: 3 },
  VSwitch: { density: 'compact', hideDetails: true, color: 'primary' },
  VBtn: { variant: 'tonal' },
}
