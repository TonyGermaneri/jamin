# jamin — native

jamin as an AU MIDI effect. The web app in `../src` keeps shipping unchanged, and the plugin
does not contain a second copy of it.

```
cmake -B build -G Ninja -S . -DCMAKE_OSX_ARCHITECTURES=arm64
cmake --build build
ctest --test-dir build --output-on-failure
```

JUCE is fetched by the build. CMake 3.22+, a C++20 compiler, and a `dist/` in the repository
root (`npm run build`, or `cmake --build build --target web`) are the whole list.

[The plan](../docs/plugin.md), through phase 1.

---

## The one rule

**The plugin contains no music theory.** Not a chord parser, not a voicing rule, not an interval.

The page compiles the chart into `jamin::Sequence` — a flat list of notes against pulses — and
the plugin performs it. That is what keeps one implementation of the harmony rather than two that
agree until they do not, and it is why the editor window can be closed without the music
stopping: the sequence outlives the web view that produced it.

If the plugin ever needs to know what `Abmaj7/C` means, the design has failed.

---

## What is here

| | |
| --- | --- |
| `core/` | No JUCE, no plugin API. `Sequence` and `SequencePlayer` — the audio-thread reader, allocation-free and lock-free — and `SongBus`, the chart every instance shares. |
| `plugin/` | The AU and Standalone targets. `processBlock` reads the playhead and emits; the editor is a `WebBrowserComponent` and nothing else. |
| `tools/` | `jamin-boot` — loads the real bundled page in a real `WKWebView` and fails if the application reports so much as a console error. With `--host` it stands in for the plugin, drives a playhead, and checks the chart followed. |
| `tests/` | The sequence reader against a loop point, and the bus between two instances. The page's own half of the bridge is `tests/host.test.js`, in the JavaScript suite. |
| `cmake/` | Copying the built page into the bundle. |

---

## The page

Copied into `Contents/Resources/web` at build time and served to `WKWebView` through JUCE's
`ResourceProvider`, which means a `juce://` origin. That origin is a **secure context**, so
`localStorage`, IndexedDB and WebGL 2.0 all work — measured, not assumed, and the measurement is
`jamin-boot`. Two web views in one process share a data store, so the progression library is
imported once and every instance has it.

Copied rather than compiled in, because the copy is what makes the page debuggable:

```
export JAMIN_WEB_DIR=/path/to/jamin/dist
```

With that set, `npm run build` and reopening the editor is the whole iteration loop — no plugin
rebuild, no host restart.

The `.eot`, `.ttf` and `.woff` faces are skipped. A `@font-face` src list is tried in order and
`woff2` is first, so WKWebView never asks for the other three; they are 3.2 MB of bundle for a
browser that will not request them.

---

## Identity

Placeholders, and they need deciding before anything ships — a host remembers a plugin by its
four-character codes and by nothing else, so changing them later orphans every session that used
the old pair.

```
-DJAMIN_MANUFACTURER=Jmin  -DJAMIN_PLUGIN_CODE=Jam1
-DJAMIN_COMPANY="Jamin"    -DJAMIN_BUNDLE_ID=dev.jamin
```

---

## Options

| | | |
| --- | --- | --- |
| `JAMIN_BUILD_PLUGIN` | `ON` | The AU and Standalone targets. Off skips the JUCE fetch, which makes `core` builds a few seconds. |
| `JAMIN_BUILD_TOOLS` | `ON` | `jamin-boot` |
| `JAMIN_BUILD_TESTS` | `ON` | |
| `JAMIN_SANITIZE` | `OFF` | ASan + UBSan. Worth it on the sequence reader specifically. |
| `JAMIN_WEB_DIST` | `../dist` | Where the built page is read from. |

---

## Validating

```
cp -R build/plugin/JaminPlugin_artefacts/RelWithDebInfo/AU/Jamin.component ~/Library/Audio/Plug-Ins/Components/
auval -v aumi Jam1 Jmin
```

`aumi` because it is a MIDI effect: in Logic that is the **MIDI FX slot**, directly above the
instrument it plays.
