# The drums

A drum part in jamin is not generated. It is drawn from 2,399 grooves cut out of
human performances, bound to the sections of your chart, and played literally.

## Why drums are not phrases

A phrase is stored as degrees and re-pointed at whatever chord it lands on. That
is the whole idea of the phrase book, and it is exactly wrong for drums: **a
drum note is an instrument, not a pitch.** Transposing one turns a snare into a
tom. So the drum stream never goes near the voice leading — it is the one part
of jamin that plays exactly what it was given.

What it does need is translating, which is a different problem.

## The kit problem, which is the one that bites first

The corpus was played on a Roland TD-11. General MIDI put the same drums in
different places, and every sampler since has had its own opinion. The
collisions are the dangerous kind:

| TD-11 pitch | is | but in General MIDI that is |
| --- | --- | --- |
| 48 | Tom 1 | Hi-Mid Tom |
| 58 | Tom 3 rim | **Vibraslap** |
| 55 | Crash 1 edge | **Splash** |
| 52 | Crash 2 edge | **Chinese cymbal** |

Play the corpus raw at a GM kit and you get vibraslaps where the toms should be.
It does not sound transposed, it sounds like somebody hitting the wrong drums —
which reads as a broken feature rather than a wrong setting.

So nothing is mapped pitch to pitch. Every groove is read into a vocabulary of
fourteen voices and written back out to the kit in use. Two small tables instead
of one large one per pair, and the half that comes from the corpus is published
by the people who recorded it.

**What to set at the other end.** For four of the five kits in the dropdown, the
accurate answer is that jamin sends General MIDI and the instrument's own mapper
does the last step — which is right today and stays right when you change your
kit, because the mapper is where you would change it.

| | |
| --- | --- |
| **Addictive Drums 2** | Set the Map Preset to "General MIDI (GM)" in its MIDI Mapping window. XLN's own advice for a kit not in its list of sixty is to use it. |
| **Abbey Road Drummer** | Use the MIDI mapping page in the instrument to select a General MIDI layout. |
| **Ableton Drum Rack** | Live names every pad with its GM equivalent, so a GM-laid-out kit lands correctly. A hand-built rack may not — the table in the Kit tab is where to fix it. |
| **Roland TR-8S** | Factory note numbers *are* the GM ones. Changed under UTILITY ▸ MIDI ▸ Inst Note. |
| **Roland V-Drums (TD-11)** | The kit the corpus was played on, so nothing is translated at all. |

Any voice can be overridden per-kit in the Kit tab, which is where a hand-built
Drum Rack gets sorted out.

## Sections, and where the fill goes

`[Intro]`, `[Verse 1]`, `[Chorus]` mark the parts. A section runs from its label
to the next one — a span, not a caption.

**A fill goes in the bar before every section change.** The fill belongs to the
boundary, not to the section: "the end of the verse" is really "the fill into
the chorus", which is why one groove per section and one fill per boundary is
enough and three things per section is one too many. This is the rule
Band-in-a-Box has used for thirty years and the one a drum chart has always
meant.

The groove stops where the fill starts, because both at once is two drummers.

`[d:nofill]` stops the fill out of the section it is written in. The switch in
Settings stops all of them.

## The keyboard

Two and a half thousand grooves is a list nobody wants to mouse through, and
binding one to each part of a song is a lot of small clicks in a small window.
So the list takes the keys:

| | |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> | move through the grooves, turning the page as it goes |
| <kbd>←</kbd> <kbd>→</kbd> | the page |
| <kbd>1</kbd>…<kbd>9</kbd> <kbd>0</kbd> | put this groove on that part, or take it off again |
| <kbd>space</kbd> | put it on every part |

The number is printed on the pill, because telling somebody the number keys
choose a part is useless if finding out which number means hovering over each
one in turn.

Arrowing browses and never binds, even with auto-select on. Auto-select is about
clicking; an arrow key that rewrote every binding as it passed would make the
list unusable to look through. <kbd>space</kbd> is the keyboard's way of saying
the same thing deliberately.

## Bindings outlive their sections

Delete the `[Chorus]` marker and the chorus's groove is not thrown away. Charts
get rewritten, and losing an assignment because a label was retyped would be its
own small disaster — so the binding is marked "not in the chart" and can be
deleted by hand. One whose marker is still there cannot be: there is nothing to
delete, and it would be back before the dialog had finished redrawing.

Put the marker back and the binding comes with it.

## Your own library

Point jamin at a folder of drum MIDI — **Libraries** in the drum book — and it
reads what is in it. Nothing is cut up: a file is a pattern, because a library
of authored loops is already a whole number of bars and slicing it would only
make it worse.

**Nothing imported is ever redistributed.** It is read from where it already is,
kept in this browser's own database, and never leaves. A library you bought is
yours to use and not jamin's to ship.

What it works out for itself:

| | |
| --- | --- |
| **Kind** | from the path, which libraries label far better than the files — `Straight Fills/1 Bar Fills/03.mid` is a fill and nothing about `03` says so. Length settles the rest: longer than eight bars is a song. |
| **Songs are kept** | they are drums. Bound to a section, a long one plays through and loops. |
| **Metadata** | the words a library writes into its files — track name, copyright, instrument — sampled across the tree and kept as filterable facts. "EZ Drummer" and "GrooveMonkee" turn up this way, and they say which kit the notes were written for. |
| **Kit per library** | because a pack is written for one instrument and the next one is not. The setting on a library overrides the global one. |

**The number that matters** is on each library's row: *how many of its sounds
have nowhere to go on the kit it is set to*. A pack played through the wrong map
loses notes in silence — nothing errors, the pattern is just thinner than it
should be. If that number is high, the map is wrong.

The sampling is spread across the tree rather than taken from the top of it. A
sorted tree's first hundred files are the first hundred files of *one shelf*:
sampled that way, a pack of every genre looked like a pack of guiro patterns.

## What the corpus is, and what shipping it cost

The [Groove MIDI Dataset](https://magenta.tensorflow.org/datasets/groove) is
1,150 human performances, CC BY 4.0 — one-way compatible with GPLv3, which makes
it the only corpus here that can be bundled rather than imported.

**Nothing is cut.** Each of the 1,150 performances ships as it was played.

| | | |
| --- | --- | --- |
| song | 391 | median 43 bars, longest 639 — the takes |
| beat | 112 | eight bars or fewer, short enough to loop |
| fill | 647 | median one bar |

An earlier version sliced the takes into one, two and four bar loops. That was a
decision about somebody else's material taken without asking, and it was done
badly on top of that: cutting on the bar line puts the *anticipated* downbeat at
the end of the previous loop, because drummers play ahead of the click — that is
most of what feel is. It left **32% of the corpus flamming once a bar** and
another **28% with no downbeat at all**. It is gone.

A song bound to a section plays through and loops when it runs out. Whose take
it is travels with it, and the length filter is how you find the ones that fit.

**How much of the groove survives.** This corpus is worth having because it is
human and unquantised, and jamin counts in 24 pulses per quarter, which is
coarser than a drummer's hands. Measured across 19,752 notes: the mean deviation
from a sixteenth-note grid is 23.5ms, and rounding to jamin's pulse throws away
a mean of 6.2ms of it. About three quarters of the groove survives, and none of
it is re-quantised onto a sixteenth, which would throw away all of it.

## Only what fits

Both books have it. A pattern fits if it goes into one of the song's parts a
whole number of times: a two-bar groove fits an eight-bar verse four times over,
and a three-bar one does not fit at all — it would be cut off mid-phrase every
time round, which is what makes a loop sound like a mistake rather than a part.
Anything longer than the span never fits, because half a phrase is not the
phrase.

The drum version says which parts each surviving pattern fits. The progression
version is honest about what it can know: the harmony may still be nothing like
yours, and this is only about length, which is the part that can be checked.

A groove is **looped, never stretched**. A two-bar groove under an eight-bar
verse plays four times; it is not slowed down to last eight, because a drum
groove stretched to twice its length is not that groove played slower, it is a
different and much worse groove. One that does not divide the span is cut off at
the end, which is what a drummer does when the section changes under them.
