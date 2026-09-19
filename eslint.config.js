/**
 * One rule, and it is the one that keeps shipping bugs.
 *
 * `no-undef`. Eight times now a function has been called that nothing defined
 * or imported -- toast, resourceOk, mapDrumNotes, realizeChord, scoreOptions,
 * SAMPLE_CHART, openBook, and barsOfProgression, which is why the die did
 * nothing twice. Vite bundles all of them without a word: the name is simply
 * not bound in the file that uses it, and the page throws a ReferenceError at
 * the moment somebody clicks the thing. Inside a plugin that is a button that
 * does nothing and says nothing.
 *
 * scripts/check_sources.py has a narrower version of this check that only knows
 * about the store's own exports. That one stays -- it needs no dependency and
 * runs in the same breath as the other source invariants -- but it could only
 * ever catch the subset, and barsOfProgression was outside it.
 *
 * Deliberately not a style config. Nothing here is about how the code looks.
 */
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  ...vue.configs['flat/base'],
  {
    files: ['src/**/*.js', 'src/**/*.vue'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // The plugin puts these on the page. @see native/plugin/PluginEditor.cpp
        __JUCE__: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',

      /*
       * And the template equivalent: a branch chained to nothing.
       *
       * A `v-else` whose `v-if` has been removed does not error and does not
       * warn in a build -- it simply never renders, which is the same class of
       * fault as `no-undef`: silent in the bundle, visible only as a thing
       * that is not there.
       *
       * Worth saying what this does *not* catch, since it was added while
       * fixing something it cannot see. When the progression list lost its
       * `v-if`, the `v-else-if` beneath re-attached to the filter panel above
       * rather than being orphaned -- a perfectly valid chain that rendered
       * the list only when the filters were absent. No lint rule can know that
       * was not meant. Only a photograph of the view with a library in it can.
       * @see scripts/shots.py
       */
      'vue/valid-v-else': 'error',
      'vue/valid-v-else-if': 'error',
      'vue/valid-v-if': 'error',
    },
  },
  {
    // Test suites are concatenated by scripts/jsrun.py rather than imported, so
    // every module they exercise is a global by the time they run. Linting them
    // for undefined names would report the whole point of the harness.
    ignores: ['tests/**', 'dist/**', 'node_modules/**', 'native/**'],
  },
]
