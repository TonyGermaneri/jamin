# jamin — native

jamin as an AU MIDI effect. The web app in `../src` keeps shipping unchanged, and the plugin
does not contain a second copy of it.

```
cmake -B build -G Ninja -S .
cmake --build build
ctest --test-dir build --output-on-failure
```

**Universal by default** — `arm64` and `x86_64`. A host launched under Rosetta does not refuse
an `arm64`-only plugin, it never lists it, with nothing in any log to say so. Pass
`-DCMAKE_OSX_ARCHITECTURES=arm64` while iterating if the build time matters.

`ctest -L installed` additionally runs `jamin-auhost` against the plugin as installed on the
system, which the default run cannot do.

JUCE is fetched by the build. CMake 3.22+, a C++20 compiler, and a `dist/` in the repository
root (`npm run build`, or `cmake --build build --target web`) are the whole list.

[The plan](../docs/plugin.md), through phase 2.

---

## The one rule

**The plugin contains no music theory.** Not a chord parser, not a voicing rule, not an interval.

The page compiles the chart into `jamin::Sequence` — a flat list of notes against pulses — and
the plugin performs it. That is what keeps one implementation of the harmony rather than two that
agree until they do not, and it is why the editor window can be closed without the music
stopping: the sequence outlives the web view that produced it.

If the plugin ever needs to know what `Abmaj7/C` means, the design has failed.

The compiler is how that holds. `Compiler.cpp` evaluates `jamin-compile.js` — the page's own
music code, built as a plain script — in a `JSContext`, and asks it for the sequence.
JavaScriptCore is on every Mac and is the engine the test suite has always used, so this is not
a new dependency so much as an existing one being admitted to. And because the compiler is not in
the editor, the editor window can be shut without the music stopping or a chart edit going
uncompiled.

---

## What is here

| | |
| --- | --- |
| `core/` | No JUCE, no plugin API. `Sequence` and `SequencePlayer` — the audio-thread reader, allocation-free and lock-free — and `SongBus`, the chart every instance shares. |
| `plugin/` | The plugin targets, built twice from one set of sources. `processBlock` reads the playhead and emits; the editor is a `WebBrowserComponent` and nothing else. |
| `tools/` | `jamin-boot` — loads the real bundled page in a real `WKWebView` and fails if the application reports so much as a console error. With `--host` it stands in for the plugin, drives a playhead, and checks the chart followed. `jamin-compile` — the plugin's own compiler without a plugin. |
| `tests/` | The sequence reader against a loop point, and the bus between two instances. `jamin-auhost` opens the editor and throws it away, which `auval` never does. The page's own half of the bridge is `tests/host.test.js`, in the JavaScript suite. |
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
rebuild, no host restart. `open` hands an app to LaunchServices, which does not inherit the
shell's environment, so a plain `VAR=... open` sets nothing; use `open --env VAR=...` or run the
executable inside the bundle directly.

Either way the editor says where it settled, once per process:

```
jamin: serving the page from /Users/you/gh/jamin/dist
```

A blank editor is almost always a page that is not where the plugin looked, and that line is the
one that answers it. Naming a directory with no `index.html` in it says so and falls back to the
bundle, rather than falling back in silence while you edit a copy nothing is reading.

**The bundle is re-sealed after the page goes in.** Adding files to a bundle breaks its code
signature, and a broken signature is not a warning: Ableton's scanner refuses the plugin outright
and writes *"Failed to load plugin: a sealed resource is missing or invalid"* into
`PluginScanner.txt`, which reads like a corrupt download rather than a build step in the wrong
order. `codesign --verify --strict` names the culprits exactly — `file added:
Contents/Resources/web/index.html` and so on. There is a test per artefact so it cannot come
back, and `JAMIN_CODESIGN_IDENTITY` takes a Developer ID when there is one to use.

The `.eot`, `.ttf` and `.woff` faces are skipped. A `@font-face` src list is tried in order and
`woff2` is first, so WKWebView never asks for the other three; they are 3.2 MB of bundle for a
browser that will not request them.

---

## Two shapes, one plugin

What jamin actually is, is a **MIDI effect**: it makes no sound, it emits notes, and it wants to
sit above the instrument it is playing. Logic has a slot for exactly that, and nothing needs
routing.

Two separate facts about Ableton Live decide the rest, and they were found in that order:

**Live does not host AU MIDI processors.** `aumi` is a category Live has no slot for, so an
otherwise perfect plugin is invisible in it. That is what the instrument build was added for.

**And the AU standard has no MIDI output either**, which the instrument build did not fix.
Ableton's own words: *"The Audio Unit (AU) plug-in standard does not support a direct MIDI out.
To route MIDI from a plug-in, you should use the VST version."* So in Live the format is not a
preference — **VST3 is the only one that can do the job at all.** Live has taken note output
from VST3 since Live 10 and every CC since Live 11, for plugins built against VST SDK 3.6.12 or
later, which JUCE 8 is.

| Target | Formats | Type | Where it belongs |
| --- | --- | --- | --- |
| `JaminInstrument` | **VST3**, AU, Standalone | `aumu` | **Live: the VST3, and only the VST3.** Bitwig, Cubase, Reaper: either. |
| `JaminMidiFx` | AU | `aumi` | Logic's **MIDI FX** slot, where nothing has to be routed by hand. |

Only the bus layout differs — an instrument must declare an output even though it never writes
to it — so there is one implementation and two declarations of it.

**In Live:** put **Jamin (VST3)** on a MIDI track. That track now makes silence. On the track
holding the sound you want, set **MIDI From** to the Jamin track, pick **Jamin** in the chooser
below it, and set **Monitor** to **In**. Repeat per track: that is the arrangement the whole idea
is for — one chart, one instance per track, a different phrase on each.

**In Logic:** use **Jamin MIDI FX** in the MIDI FX slot above the instrument. No routing.

## What a plugin window cannot do

A `WKWebView` inside a plugin is not a browser tab. Two differences matter, and both were
measured rather than assumed:

**No downloads.** JUCE wires up `runOpenPanelForFileButtonWithResultListener` but nothing for
`WKDownload`, so a link that saves a file does nothing at all, silently. `jaminOpenUrl` hands the
URL to the system browser instead — restricted to `http` and `https`, because a native function
that will launch anything is a native function that will launch anything.

**Choosing a file works.** The open panel is wired, so the Chordonomicon import works as it does
in a tab once the download has happened somewhere that can download. The website data store is
shared across instances in a process, so importing it is once per machine, not once per track.

---

## Identity

WaveContour makes jamin, as it makes Waveshape. The company name is what a host lists a plugin
under and the manufacturer code is what it groups by, so both match Waveshape's exactly — with
different plugin codes, which is the whole of what keeps the products apart:

```
$ auval -a | grep WvCt
aufx Wvs1 WvCt  -  WaveContour: Waveshape
aumf PrPl WvCt  -  WaveContour: Prophet Panel
aumf Wvr1 WvCt  -  WaveContour: Waveroll
aumu Jam1 WvCt  -  WaveContour: Jamin
aumi JamF WvCt  -  WaveContour: Jamin MIDI FX
```

The four-character codes are the part that cannot be revised later: a host remembers a plugin by
its manufacturer and plugin codes and by nothing else, so changing them after a release orphans
every saved session that used the old pair. AU also wants at least one capital in the
manufacturer code, which is why `WvCt` is mixed case.

Under a shared manufacturer the plugin code is the entire identity, so a collision means two
plugins claiming to be the same one — and a host settles that silently, by loading whichever it
saw first. `CMakeLists.txt` refuses to configure against any code already taken under `WvCt`,
and refuses to let the two jamin targets share one.

**None of these are cache variables**, deliberately. A plugin's identity is a property of the
product rather than a per-build option, and a cached one goes stale: editing the values and
rebuilding an existing tree would keep the old identity without saying so, which ships a plugin
under the wrong name. `CMakeLists.txt` is the only answer, and it clears any stale entry left by
an earlier arrangement.

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
cp -R build/plugin/JaminInstrument_artefacts/RelWithDebInfo/AU/Jamin.component            ~/Library/Audio/Plug-Ins/Components/
cp -R "build/plugin/JaminMidiFx_artefacts/RelWithDebInfo/AU/Jamin MIDI FX.component"      ~/Library/Audio/Plug-Ins/Components/
cp -R build/plugin/JaminInstrument_artefacts/RelWithDebInfo/VST3/Jamin.vst3               ~/Library/Audio/Plug-Ins/VST3/

killall -9 AudioComponentRegistrar     # or the new codes are not found
auval -v aumu Jam1 WvCt                # the instrument
auval -v aumi JamF WvCt                # the MIDI effect
```

`killall` is not optional the first time a code changes. macOS caches the component registry,
and `auval` reports `didn't find the component` for a plugin that is installed and correct --
which reads exactly like a build problem and is not one.
