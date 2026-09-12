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

Needs Node 20.19+ or 22.12+ (Vite 7's floor). Not installed on this machine.

```sh
npm install
npm run dev
```

Open the printed URL in Chrome, Edge or Opera — Web MIDI is not available in
Safari or Firefox. Grant the MIDI prompt and the ports bind themselves; the gear
icon is there if you want different ones.

```sh
npm run build     # production bundle in dist/
npm test          # pure-logic test suites
npm run chords    # regenerate the chord dictionary data
```

## Notation

Everything is separated by spaces, the way you'd write it on a napkin.

| You type | It means |
| --- | --- |
| `C F G` | three bars |
| `C C F` | one chord lasting two bars, then F — not two attacks |
| `F,F- C` | half a bar of F, half of F minor, then a bar of C |
| `\| C F \|` | bar lines are decoration and are ignored |
| `C % F` | `%` repeats the previous bar |

**Quality.** `A- Am Ami Amin Aminor` are all the same chord, and so are
`A AM Ama Amaj Amajor`. Also `dim` `°` `o`, `ø` `halfdim`, `aug` `+`,
`sus` `sus2` `sus4`, `alt`, `mmaj` `minmaj` `-maj`.

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

## Mr. Accompany Me

Pick your keyboard as the accompaniment input, arm the red button, and play for
exactly one chord while the DAW runs. The phrase lands in the phrase book
(the book icon) with the chord it was played over.

Bind it to a chord and it follows the chart. When the harmony changes, the
phrase is **re-pointed, not transposed**: each pitch class of the original chord
is matched to the cheapest corresponding pitch class of the new one, so common
tones stay put and everything else takes the shortest step available. Notes that
weren't chord tones move with whichever chord tone they were leaning on, so
approach notes stay approach notes. The result is octave-corrected back into the
register you actually played in.

A phrase applies from the chord it is bound to until the next chord wearing a
dot. Bindings live in the chart text — the dot you see above a chord is literally
the `.` you typed — so they survive copy, paste and reload.

## How it is put together

```
src/core/chordParser.js   shorthand -> root + interval stack
src/core/score.js         text -> timeline of events, with source character ranges
src/core/voiceLeading.js  minimal-movement chord mapping and phrase re-pointing
src/core/voicing.js       interval stack -> actual MIDI notes
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

## Tests

There is no Node on the development machine this was written on, so the
pure-logic suites run through macOS JavaScriptCore instead
(`scripts/jsrun.py`). They cover the chord parser, the timeline, voice leading,
voicings, playback and text layout — everything except the DOM, Web MIDI and
WebGL, which need a browser.
