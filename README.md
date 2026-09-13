# jamin

A chord chart that plays along with your DAW.

You type shorthand chords into one enormous text field. The DAW's MIDI clock
drives everything else — tempo, transport, song position — and jamin highlights
the chord that is sounding and sends it out as MIDI, so a room full of people
can see and hear where the tune is right now.

It is not an arpeggiator and it is not a sequencer. It plays the chord. That's
the point: everyone keeps track of what the hell is going on.

The whole setup is two things: bind your MIDI ports, and type. If it ever asks
for more than that, it has failed.

## Running it

Needs Node 20.19+ or 22.12+ (Vite 7's floor).

```sh
npm install
npm run dev
```

With no Node yet, `npm run serve` starts a static server that runs the app
without a build step (see below) and prints an address to open.

Note that `index.html` is the *build* entry: it imports `vue` by name, which no
browser can resolve on its own, so opening it without a bundler gets you a blank
page and a module-resolution error in the console. It now says so on the page
instead, and the no-build server serves the working entry at its root.

Open the printed URL in Chrome, Edge or Opera — Web MIDI is not available in
Safari or Firefox. Grant the MIDI prompt and the ports bind themselves; the gear
icon is there if you want different ones.

```sh
npm run build     # production bundle in dist/
npm test          # pure-logic test suites
npm run chords    # regenerate the chord dictionary data
```

## Running it as a plugin

The same application, inside your DAW, reading the host's own playhead instead
of a MIDI clock. The editor *is* this web app — there is no second
implementation of anything, and no music theory in the C++ at all.

Building it needs **CMake 3.22+**, **Ninja**, and **Xcode**. JUCE is fetched by
the build; nothing else to install. With no Homebrew on the machine, all three
of Node, CMake and Ninja install into `~/.local` without admin rights:

```sh
curl -fsSL https://nodejs.org/dist/v22.20.0/node-v22.20.0-darwin-arm64.tar.xz | tar xJ -C ~/.local/opt
curl -fsSL https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-macos-universal.tar.gz | tar xz -C ~/.local/opt
curl -fsSLo /tmp/ninja.zip https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-mac.zip && unzip -o /tmp/ninja.zip -d ~/.local/bin
```

Then, from the repository root:

```sh
npm install && npm run build                 # the page the plugin will show
cmake -B native/build -G Ninja -S native -DCMAKE_OSX_ARCHITECTURES=arm64
cmake --build native/build
ctest --test-dir native/build --output-on-failure
```

**The web build comes first.** The page is copied into each bundle at build
time, so there has to be a `dist/` for it to read; CMake says so plainly if
there is not. `cmake --build native/build --target web` runs Vite for you.

### Running the binary

The standalone is the quickest way to see it, and the only one that needs no
DAW at all:

```sh
STANDALONE=native/build/plugin/JaminInstrument_artefacts/RelWithDebInfo/Standalone/Jamin.app
open "$STANDALONE"
```

It opens the full application in its own window, with the host's transport
replaced by the standalone's own. Audio and MIDI devices are chosen from its
own options; **no MIDI output is selected by default**, which is deliberate —
a development build should not start playing into whatever hardware happens to
be switched on.

While iterating on the page, there is no need to rebuild the plugin at all.
`JAMIN_WEB_DIR` makes it serve the repository's `dist/` instead of its own copy,
so `npm run build` and reopening the window is the whole loop:

```sh
open --env JAMIN_WEB_DIR="$PWD/dist" "$STANDALONE"
```

`--env` is needed because `open` hands the app to LaunchServices, which does not
inherit the shell's environment — a plain `VAR=... open` sets nothing. Running
the executable inside the bundle directly works too, and keeps its output in the
terminal, which is where you want it when something has gone wrong:

```sh
JAMIN_WEB_DIR="$PWD/dist" "$STANDALONE/Contents/MacOS/Jamin"
```

### Installing it

```sh
cp -R  native/build/plugin/JaminInstrument_artefacts/RelWithDebInfo/AU/Jamin.component       ~/Library/Audio/Plug-Ins/Components/
cp -R "native/build/plugin/JaminMidiFx_artefacts/RelWithDebInfo/AU/Jamin MIDI FX.component"  ~/Library/Audio/Plug-Ins/Components/
cp -R  native/build/plugin/JaminInstrument_artefacts/RelWithDebInfo/VST3/Jamin.vst3          ~/Library/Audio/Plug-Ins/VST3/

killall -9 AudioComponentRegistrar   # macOS caches the component registry
auval -v aumu Jam1 Jmin              # the instrument
auval -v aumi JamF Jmin              # the MIDI effect
```

That `killall` is not optional the first time a plugin code changes. Until the
registry is rebuilt, `auval` reports `didn't find the component` for a plugin
that is installed and entirely correct, which reads exactly like a build
failure and is not one.

### Two shapes, and which one you want

What jamin is, is a MIDI effect: it makes no sound, it emits notes, and it
belongs above the instrument it is playing. **Ableton Live does not host AU
MIDI processors** — not this one, the whole `aumi` category — so it is built
as an instrument as well.

| | Type | Where it appears |
| --- | --- | --- |
| **Jamin** | `aumu`, VST3 | Everywhere. Live, Bitwig, Cubase, Reaper. |
| **Jamin MIDI FX** | `aumi` | Logic's **MIDI FX** slot, with nothing to route. |

**In Logic:** *Jamin MIDI FX* in the MIDI FX slot above your instrument. Done.

**In Live:** put *Jamin* on a MIDI track — that track now makes silence. On the
track holding the sound you want, set **MIDI From** to the Jamin track, pick
**Jamin** in the chooser below it, and set **Monitor** to **In**. Repeat per
track: one chart, one instance per track, a different phrase on each.

[The plan and what it rests on](docs/plugin.md) · [the native build](native/README.md)

## Notation

There are two ways to write a chart, and which you get depends on whether you
use bar lines.

**With bar lines** it reads the way every fake book, lead sheet and iReal Pro
chart reads, so a chart pasted from anywhere behaves as expected.

| You type | It means |
| --- | --- |
| `\| Dm7 G7 \| Cmaj7 \|` | two chords splitting a bar, then a bar of Cmaj7 |
| `\| C / Am / \|` | each symbol is a beat, so two beats each |
| `\| C \| % \|` | `%` repeats the bar before it |
| `\| C \| F \| x \|` | `x` repeats the two bars before it |
| `\|: Am7 \| Bbmaj7 :\|16` | sixteen times through |

**Without bar lines** you get a shorthand that is quicker to type, where a space
is a bar.

| You type | It means |
| --- | --- |
| `C F G` | three bars |
| `C C F` | one chord lasting two bars, then F — not two attacks |
| `F,F- C` | half a bar of F, half of F minor, then a bar of C |
| `C / F` | `/` holds C for another bar |
| `:Am7 Am7 Bbmaj7 Bbmaj7:16` | sixteen times through |

The whole chart reads one way or the other rather than flipping halfway down:
a bar line anywhere switches it. `[Verse 1]` is a label for the reader either
way, and takes no time.

**Quality.** `A- Am Ami Amin Aminor` are all the same chord, and so are
`A AM Ama Amaj Amajor`. Also `dim` `°` `o`, `ø` `halfdim`, `aug` `+`, `alt`,
`mmaj` `minmaj` `-maj`. Suspensions say what they mean: `sus` is sus4, `sus2` is
sus2, `sus4` is sus4.

**Accidentals.** Sharps may be written `#`, `♯` or `s`; flats `b` or `♭`. So
`Fs7` is F♯7, `A/Cs` is A/C♯, and `As5` is A♯ with no third. The only place `s`
could be misread is `sus`, so an `s` is a sharp *unless* `sus` starts there:
`Fsus4` is F suspended, and F♯sus4 is `F#sus4` or `Fssus4`.

**Harte notation** works too, for importing corpora: `C:maj7`, `C:min7`,
`C:hdim7`, `C:minmaj7`, `C:1`, `C:sus4(b7)`, and degree basses like `C:maj/5`.
Inside Harte form parentheses *add* a degree, so `C:maj(9)` is a triad plus a
ninth rather than a major ninth — while a plain `C(9)` keeps meaning what it
always did here.

**Nothing at all.** `N`, `NC` or `N.C.` is a bar with no chord in it. It still
takes up its time.

### The three places this notation could be ambiguous

Each is decided, and each has a test pinning it down.

- An accidental always belongs to the root, so `Bb5` is a B-flat power chord.
  Write `B(b5)` for B with a flattened fifth.
- `s` is a sharp unless `sus` starts there, so `Fsus4` is never F♯ followed by
  nonsense. Nothing in any corpus examined spells a sharp suspension without the
  guard being decidable.
- Degree basses (`/5`, `/b7`) are read only in Harte form, because outside it
  `C6/9` is the six-nine chord and not C6 over a ninth.

One wart remains: `Cmi` is C minor, not C major in first inversion. Write `C-i`
or `Cmini` for the inversion.

**Numbers.** `C5` is the triad without the 3rd; `C3` is the triad without the
5th. Anything above 5 stacks diatonically: `C7 C9 C11 C13`. Colour tones work
the way you'd expect: `C7b9 C7#9 C7#11 C7b13 C6/9 Cadd9 Cmaj7 C7alt`.

**Inversions.** A roman-numeral suffix: `Di` first, `Dii` second, `C7iii` third.
The one ambiguity is `Cmi`, which stays C minor — write `C-i` or `Cmini` if you
want C minor in first inversion.

**Slash bass.** `C/E`. An accidental glued to the root always belongs to the
root, so `Bb5` is a B-flat power chord; write `B(b5)` for a flattened fifth.

**Phrases.** A leading dot marks a phrase change: `.C7{walkup}`. See below.

### Time signature

MIDI clock carries tempo, start/stop and song position, but there is no standard
MIDI message for time signature — no DAW can send it. Set *beats per bar* once
in the Transport tab and forget about it.

## The progression library

The bookshelf icon. A progression is just a snippet of chart text with a name --
the same notation you type -- so anything in the library drops straight into a
chart and any part of a chart can be saved back. Fifteen starters ship with it:
ii–V–I, both blues, rhythm changes, Giant Steps, the Andalusian cadence, and so
on.

The one thing done to a progression on the way in is transposition. Pick a key
and it moves, spelled the way that key is normally written -- `D-7 G7 Cmaj7` into
F gives `F-7 Bb7 Ebmaj7`, not `F-7 A#7 D#maj7`. Only roots and slash basses are
rewritten; suffixes, inversions, commas, bar lines, phrase dots and bindings stay
exactly where they were. Insert at the cursor, on a new line, or over the whole
chart.

Import and export are JSON. The importer is deliberately forgiving about shape --
our own export, a bare array, `{progressions: [...]}`, entries using
`title`/`chords` instead of `name`/`text`, and Hugging Face's `{rows: [...]}`
envelope -- so a collection found elsewhere usually just goes in.

**Chordonomicon** is 679,807 progressions in a 252MB CSV. That is too much to
ask a server for on your behalf, and far too much for a browser's ordinary
storage, so the library links to the file and you hand it back: it is read as a
**stream**, decoded and written to IndexedDB a few thousand rows at a time, and
never held in memory. Rows are kept in the dialect they arrive in and converted
only when one is looked at -- converting all of them on the way in would mean
running the chord converter over seventy million words to produce something
nobody has asked to see.

The library is paged for the same reason. The list shows a name and a length;
whatever is selected is shown in full beside it. Searching the imported set is a
scan, so it stops at the first few hundred matches and says so rather than
freezing. Its dialect differs from ours in exactly three ways, each confirmed
against the data rather than assumed: sharps are written `s` (`Fs7` is F#7);
except when that `s` begins `sus` (`Fsus4` is F sus4, and nothing in the corpus
contains `ss`, so F#sus4 never arises); and `no3d` means "no 3rd". Section tags
become `[verse 1]` labels on their own lines. Every chord symbol observed in the
corpus is covered by the parser, bar one that is corrupt at source -- that one
stays visibly unreadable in the chart rather than being quietly invented.

The data is CC-BY-NC-4.0, so jamin ships the converter and not the collection.
The import tab has the URL for a ready-made slice.

## Mr. Accompany Me

Pick your keyboard as the accompaniment input, arm the red button, and play for
exactly one chord while the DAW runs. The phrase lands in the phrase book
(the book icon) with the chord it was played over.

Bind it to a chord and it follows the chart.

### Phrases are not key dependent

A phrase is stored **rooted on C** -- that is, as degrees measured from the chord
it was played over, not as the notes you happened to play. Capture something over
Fm7 and it is filed as root, ♭3, 5, ♭7; play it back over Dm7 and you get D, F,
A, C. The key it was born in is remembered but never used at playback. Phrases
saved before this are migrated on load.

Getting it over a chord happens in that order, and the order matters:

1. **Root first.** Transpose so the phrase's root lands on the new chord's root.
   That is what keeps the degrees intact.
2. **Shape second.** Only if the new chord is a *different shape* does the
   minimal-movement map get involved -- and by then both chords share a root, so
   the root stays the root. Over Dmaj7 the ♭3 becomes a 3 and the ♭7 a 7; over
   Ddim7 the 5 becomes a ♭5. Notes that were never chord tones move with whichever
   chord tone they were leaning on, so approach notes stay approach notes.

   **Snap to chord notes** then moves anything still outside the chord onto the
   nearest note that is in it. On by default: it guarantees every note fits.
   Turn it off and a passing tone stays where the harmony put it, which is more
   faithful to the phrase and less certain to fit under it.
3. **Register last.** The octave is chosen to sit closest to where the phrase was
   in the previous chord, so a figure repeating through a progression walks
   rather than leaps.

The phrase's *rhythm* is never touched. It runs at the rate it was played and
keeps time with the chart, and a chord simply decides the harmony for the stretch
of time it occupies. Under `| Fm7 Gm7 |` a one-bar pattern does not get rushed
through twice; the first half of it is heard as F minor and the second half as G
minor. A chord longer than the phrase hears the phrase more than once, still at
its own speed.

There are two other settings for this if you want them -- restarting the pattern
on every chord, or stretching it to fill the chord exactly. Stretching is a tempo
change by definition, which is why it is not the default, and why settings saved
before it stopped being the default are corrected on load: a stored value beats a
new default, so changing a default is not on its own enough to reach anyone who
has run the app before.

Doing step 2 before step 1 -- which is what "minimal movement" means if you
forget about the root -- silently rotates the degrees. From Fm7 to Dm7 the
cheapest mapping leaves F where it is, and a lick that outlined the root comes
out outlining the third. There is a test for exactly that.

A phrase applies from the chord it is bound to until the next chord wearing a
dot. Bindings live in the chart text — the dot you see above a chord is literally
the `.` you typed — so they survive copy, paste and reload.

## How it is put together

```
src/core/chordParser.js   shorthand -> root + interval stack
src/core/score.js         text -> timeline of events, with source character ranges
src/core/voiceLeading.js  minimal-movement chord mapping and phrase re-pointing
src/core/voicing.js       interval stack -> actual MIDI notes
src/core/progressions.js  the progression library, and transposition
src/core/vocParser.js     reads Impro-Visor vocabulary files in the browser
src/core/licks.js         the lick catalogue, built at run time
src/core/parts.js         the two-handed parts catalogue
src/core/midiFile.js      a small Standard MIDI File reader
src/core/midiPhrases.js   cuts a performance into one-chord phrases
src/core/csvImport.js     streams Chordonomicon's CSV in without loading it
src/core/progressionStore.js  IndexedDB, so the whole collection fits
src/core/key.js           key detection, Krumhansl-Schmuckler
src/core/midi.js          Web MIDI: ports, clock, note IO
src/core/player.js        clock in, chords and phrases out
src/canvas/layout.js      per-line text fitting, caret and hit testing
src/canvas/textRenderer.js  the 2D text layer
src/canvas/glRenderer.js  the WebGL effects layer
```

**Why a canvas.** Each line scales independently to fill the width, and the
highlight has to land on the exact word the user typed rather than on a
re-rendered copy of it. No DOM text control does either. So the chart is drawn
on canvas, with a fully transparent `<textarea>` on top: invisible, but a real
text control, so typing, IME, clipboard and the browser's own undo stack all
still work. Hit testing and vertical caret movement are ours, because the
browser's would use its own uniform layout instead of what's on screen.

**The effects layer** is one fragment shader behind the text. It is told where
the interesting words are — playing, next, just finished — as rectangles, and
lights them: a halo that breathes on the beat and a sweep tracking the bar, a
charge building under the next chord, embers off the last one. Nothing paints
opaquely over a glyph, and every term has a slider that goes to zero. Eight
themes ship with matching shader presets.

**Timing** is in MIDI pulses (24 per quarter note) end to end, so nothing below
the MIDI layer has to know about tempo.

### A note on Vuetify

Pinned to Vuetify 3 rather than 4 on purpose: the UI was written and reviewed
against the 3.x component API, and there was no way to run a build here to check
a major-version jump. `npm install` will pick up the latest 3.x.

## Chord dictionary

The chord readout names what it thinks you typed using
[ChordDictionary/SetTheory](https://github.com/ChordDictionary/SetTheory) —
roughly 2000 pitch-class sets generated from Pascal's triangle and named by hand.
The parser itself is rule-based; the dictionary is for naming and for searching
(Settings → Notation). Regenerate `src/data/chordSets.json` with `npm run chords`.

## Licence

GPL-3.0-or-later. See `LICENSE`.

Version 3 specifically, rather than 2: Impro-Visor's lick vocabulary is
"GPL v2 or later", so v3 is open to us, and our `@mdi/font` dependency is
Apache-2.0 — which is compatible with GPLv3 but not with GPLv2. Vue and Vuetify
are MIT, which is fine either way.

### On bundling other people's collections

Licence before download, every time.

- **Impro-Visor** (`vocab/My.voc`, ~530KB of licks, cells and idioms) is
  GPL-2.0-or-later, so it is bundled here verbatim as `src/data/My.voc`, with
  attribution. It is the closest thing to a sibling project: its vocabulary
  auto-transposes to the chord of the moment, which is what Mr. Accompany Me
  does. Shipping it unmodified also keeps the licence question simple -- there is
  no derived artifact to account for, because `src/core/vocParser.js` reads the
  original at run time.
- **Chordonomicon** is **CC-BY-NC-4.0** on Hugging Face — non-commercial, which
  is an added restriction the GPL does not permit, so it *cannot* be bundled or
  redistributed here. (The GitHub repo's Apache-2.0 covers the code, not the
  data.) jamin therefore ships the *converter*, not the data: download it
  yourself and paste it into the importer. Your own use stays within CC-BY-NC.
- Several jazz corpora that fit the notation almost perfectly state **no licence
  at all** and are transcriptions of copyrighted songs. Import-only, never
  bundled.

The built-in progressions are generic idioms written by hand for this project,
and carry no third-party claim.

## Tests

The pure-logic suites run through macOS JavaScriptCore (`scripts/jsrun.py`)
rather than Node. They started that way because there was no Node on the
machine this was written on, and they have stayed that way for a better reason:
running them outside a browser *and* outside Node is a standing proof that the
chord parser, the timeline and the voice leading have nothing browser-shaped in
them — which is exactly what the plugin depends on. They cover the chord parser,
the timeline, voice leading, voicings, playback, the host bridge and text
layout; everything except the DOM, Web MIDI and WebGL, which need a browser.
