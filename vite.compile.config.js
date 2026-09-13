/*
 * The compiler, built for JavaScriptCore rather than for a browser.
 *
 * The plugin evaluates this file inside a JSContext to turn a chart into a
 * sequence, with no window, no DOM and no module loader -- so it is built as a
 * plain script that defines one global, not as an ES module.
 *
 * It lands in dist/ alongside the page, which is what the plugin bundles, so
 * there is one directory to copy and one thing to keep in step. emptyOutDir is
 * off because the page is built first and this must not sweep it away.
 */
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    // JavaScriptCore on macOS 11 and later is a current engine; there is no
    // need to transpile down for it, and doing so only makes a crash harder to
    // read in a stack trace that has no source map.
    target: 'es2020',
    minify: false,
    lib: {
      entry: 'src/core/compile.js',
      formats: ['iife'],
      name: 'jamin',
      fileName: () => 'jamin-compile.js',
    },
  },
})
