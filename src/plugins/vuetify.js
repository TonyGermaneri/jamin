import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export default createVuetify({
  components,
  directives,
  theme: {
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
  },
  defaults: {
    VTextField: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
    VSlider: { density: 'compact', hideDetails: true, thumbSize: 14, trackSize: 3 },
    VSwitch: { density: 'compact', hideDetails: true, color: 'primary' },
    VBtn: { variant: 'tonal' },
  },
})
