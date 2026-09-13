# jamin as an AU

A plan to run jamin inside a DAW, on several tracks at once, all reading one chord chart.

The requirement that decides everything below is the one that is hard: **several instances, each
playing a different phrase, all following the same progression, all updated together.** One
instance in a plugin is a packaging exercise. Several instances that agree with each other is a
design problem, and nothing in any plugin API helps with it — a host has no idea that two
instances of a plugin are related, and no intention of telling them.

---

## What was verified before writing this

Five claims carry the plan. All five were measured on this machine (macOS 26.6, Apple silicon,
Xcode 16.4, CMake 3.31.6, JUCE 8.0.15) rather than assumed, and the probes are in the repository
rather than in a paragraph.

**The `juce://` origin is a secure context.** This is the one that decides the whole approach.
JUCE 8's `ResourceProvider` serves the page from a custom URL scheme, and WKWebView has
historically refused storage to custom schemes. jamin keeps its settings in `localStorage` and
its progression library in IndexedDB, so if that were still true the page could not run in a
plugin without a native replacement for both.

```
origin=juce://juce.backend
isSecureContext=true
localStorage=v
indexedDB=wrote and read back: hello
webgl=WebGL 2.0 | WebKit WebGL
webmidi=undefined
```

**ES modules and `fetch` cross the custom scheme.** Vite's output is `<script type="module">`,
and the catalogues are `fetch`ed rather than bundled. Both work: `import('./mod.js')` resolves
and a same-origin `fetch` returns. Without this the build would have needed a separate,
untested output format for the plugin.

**Two web views in one process share storage.** A second `WKWebView` sees what the first wrote,
to both `localStorage` and IndexedDB, through the default website data store. So the 680,000-row
progression database is imported **once** and every instance in that host has it — not imported
per instance, and not per session.

**The real page boots in the real web view with no errors.** Not a mock: the bundled
`Resources/web` from the AU, over `juce://`, in a `WKWebView`. It reports both canvases, the
text area, the Vuetify shell, and `errors=0` — no console errors, no unhandled rejections. This
is `jamin-boot`, and it runs under `ctest` on every build.

**jamin's core already runs outside a browser.** The sixteen JavaScript suites have been running
in JavaScriptCore since the beginning, through `scripts/jsrun.py`. That is not a coincidence
that happens to be convenient; it is a standing proof that the chord parser, the score reader,
the voice leading and the phrase realisation have no DOM in them, which is what makes
[the compiler](#where-the-music-actually-happens) possible.

---

## Where this departs from waveshape, and why

Waveshape's port plan considered embedding a WebView and rejected it, in terms worth quoting:
there is no way to hand native memory to a page's `SharedArrayBuffer`, so every audio block has
to be marshalled across the JavaScript boundary; each instance is a whole browser engine; eight
analysers in one session is not a configuration that exists.

Every one of those objections is about **audio samples crossing the boundary at block rate**.
None of them applies here, because jamin is not an analyser. What crosses the boundary is a
chord chart when you type one, and a playhead position for the highlight. There is no audio.
The thing that made a WebView wrong there is absent here, and the thing that makes it right —
that jamin *is* a web application, with a canvas text editor, a WebGL shader chain, a Vuetify
control surface and a 680,000-row library, all of which would otherwise be rewritten — is
overwhelming.

The methodology is the same. The conclusion is different because the measurement is different.

What does carry over unchanged is waveshape's one rule. There, it was that the shaders are read
from the web tree and never copied. Here it is stronger:

> **The plugin contains no music theory.** Not a chord parser, not a voicing rule, not an
> interval. If the plugin ever needs to know what `Abmaj7/C` means, the design has failed.

---

## Where the music actually happens

The obvious arrangement is wrong, and it is worth saying why before describing the right one.

The obvious arrangement puts the sequencer in the page: the web view gets the playhead, works out
what should sound, and calls a native function to send it. It fails on the first thing anybody
will do, which is close the plugin window. The web view goes with it and the music stops. It
also puts every note through the UI thread of a browser engine, which is not where notes belong.

So the page is the editor, and something else performs. But that something else must not be a
second implementation of the harmony, or the two will drift, and the drift will be in the part of
the program that is hardest to test and most audible when wrong.

The resolution is that **jamin's output is a finite, deterministic sequence**. A chart plus a
phrase plus the settings is a fixed list of notes at fixed pulses — it does not depend on
anything that happens at play time. So it can be compiled once, ahead of time, and performed by
something that knows nothing:

```
       the page                        the plugin
  ┌──────────────────┐           ┌────────────────────┐
  │ chart, phrases,  │  compile  │  Sequence          │   pulse → note
  │ voice leading,   │ ────────► │  (a flat list)     │   and nothing else
  │ settings         │           └────────┬───────────┘
  └──────────────────┘                    │
      one implementation,         SequencePlayer, on the audio
      shared with the web app     thread: no locks, no allocation
```

`jamin::Sequence` is four numbers per event — pulse, status, note, velocity — and
`SequencePlayer::collect` is arithmetic over a sorted array. It handles the loop point, including
a block that straddles it and a song short enough for a block to wrap it twice, because a chord
dropped once per cycle is exactly the fault that only appears in a long take.

**The compiler is the JavaScript, run headless.** macOS ships `JavaScriptCore.framework`, and
jamin's core has already been proven to run in it — that is what the test suite does. So each
instance holds a `JSContext` with the same modules the browser loads, exports one function, and
calls it whenever the chart or the settings change. Not a port. The same code.

That is what makes the window disposable: the sequence outlives the web view that requested it,
and a chart edit arriving while the window is closed can still be compiled, because the compiler
was never in the window.

---

## Several instances, one chart

The point of the whole exercise. Four tracks, four articulations, one progression.

**What is shared is the document, not the clock.** This is the observation the design rests on,
and it turns a hard problem into an easy one. Every instance takes its position from its own host
playhead — the same transport, sample-accurate, already identical on every track in the session.
Nothing needs to synchronise *playback* between instances, because the host has already done it.
All that has to travel between them is the text, and it can take several milliseconds to get
there without anybody hearing anything at all.

So the channel can be simple, and it is: `jamin::SongBus`, a POSIX shared-memory segment with a
seqlock over it and a file in Application Support behind it.

| | |
| --- | --- |
| **No daemon** | The segment is created by whichever instance gets there first. |
| **No listening port** | A plugin that opens a socket is a plugin with an attack surface. |
| **No blocking** | A seqlock rather than a mutex: a writer cannot leave a lock held across a crash and wedge every other instance in the session, and a reader cannot stall a DAW's message thread. A reader may have to try twice, which is free. |
| **Outside the DAW** | Two instances in different hosts — or a plugin and the standalone — meet in the same segment. Nothing is routed through the project. |
| **Durable** | A file, replaced atomically, so the chart survives every instance closing. A virgin segment is seeded from it rather than overwriting it, which is the one ordering mistake here that would silently lose work. |

A plugin added to a session halfway through picks the chart up as it attaches, rather than
sitting blank until the next edit. Polling costs one atomic load per instance per tick.

The split between shared and private is where the feature actually lives:

| Shared, identical everywhere | Private to the instance | Shared cache |
| --- | --- | --- |
| the chart | its phrase or phrase set | the lick catalogue |
| bars per line, the key | its MIDI channel, octave, bass | POP909 parts |
| | its accent binding | the progression library |
| `SongBus` | `getStateInformation` | the website data store |

Per-instance settings go in the plugin's own state, saved with the project, precisely so one
track's saved copy can never overwrite the session's chart.

---

## Why a MIDI effect

`IS_MIDI_EFFECT`, so in Logic it appears in the **MIDI FX slot** — directly above the instrument
it is playing. That is exactly the arrangement the requirement describes: one track, one sound,
one articulation, one instance, and every instance reading the same chart. An instrument that
emitted MIDI would need the output routed to another track by hand, once per track, which is
three steps of setup between the user and the first chord.

Incoming MIDI passes through untouched. A chord generator that swallowed the keys underneath it
would make the track unplayable, and phrase capture needs to see them anyway.

---

## Phases

Each ends in something runnable.

**Phase 0 — the spike. *Done; see `native/`.*** JUCE 8.0.15 and CMake producing an AU and a
standalone; `auval` clean; the built page copied into the bundle and served over `juce://`;
`jamin-boot` proving the real application comes up in the real web view with no errors;
`SequencePlayer` and `SongBus` written and tested with no host. What it does not do yet is play
anything — nothing compiles a sequence, because that is phase 2, and the page does not yet know
it is in a plugin.

**Phase 1 — the bridge. *Done; see `src/core/host.js`.*** One module that detects
`window.__JUCE__`, wraps JUCE's `emitEvent`/`addEventListener` into `callHost`/`onHost`, and
answers harmlessly when there is no plugin, so the browser build takes no notice of it.
`HostClock` turns the host's reported position into the same two hooks `MidiEngine` offers —
`onTick` and `onTransport` — and the store routes whichever one is live through one pair of
handlers, so nothing downstream knows which it is listening to. Inside the plugin there is no
permission to grant and no port to bind, so the MIDI tab says so instead of warning somebody
inside a DAW to go and use Chrome.

The position is *reported*, not counted. That is strictly better than a clock byte stream: it
cannot drift, it survives a dropped message, and a locate is a number changing rather than
something to be inferred. It is also the reason several instances agree about the time without
anything passing between them.

*Verified:* `jamin-boot --host` installs a stand-in for `window.__JUCE__` against the real built
bundle, drives a playhead past it, and asserts the chart followed — the bar count advanced, the
chord changed, the host's tempo is the one on screen, and stopping was noticed.

**Phase 2 — the compiler.** `compile(chart, settings) → Sequence`, built by Vite as a second,
DOM-free entry point, run in a `JSContext` in the processor. *Exit:* notes come out of the MIDI
FX slot into an instrument, in time, and keep coming when the window is closed.

**Phase 3 — several instances.** The `SongBus` wired to the page both ways; per-instance state in
`getStateInformation`; a live edit on one track appearing on the others. *Exit:* four tracks,
four phrases, one chart, and typing a chord changes all four.

**Phase 4 — what only makes sense live.** The accent, which cannot be precompiled because it is
pressed; MIDI learn against the host's own input; phrase capture from the incoming stream.

**Phase 5 — shipping.** Editor size persistence, `pluginval`, signing, notarisation, CI, and the
four-character codes decided before anything leaves the machine.

---

## Risks worth naming

**The codes are placeholders.** `Jmin` / `Jam1` / `dev.jamin`. A host remembers a plugin by its
manufacturer and plugin codes and by nothing else, so changing them after a release orphans every
saved session that used the old pair. They want deciding before phase 5, not during it.

**A sandboxed host may refuse the shared segment.** `shm_open` can fail. It is handled — instances
inside that process still share through the singleton, and the file still carries the chart
between sessions — but cross-process sharing would be lost, and it needs testing in Logic
specifically rather than assumed.

**One web view per open editor.** WebKit is not free. Closing the window gives it back, and the
music does not depend on it, but a session with eight editors open at once is worth measuring
before it is worth promising.

**Windows.** VST3 has no MIDI-effect category, `JavaScriptCore.framework` is macOS-only, and the
WebView2 runtime is not guaranteed present. All three are solvable — QuickJS is embeddable and
MIT — and none of them is on the path to the thing that was asked for.
