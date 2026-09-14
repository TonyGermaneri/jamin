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

## Bindings outlive their sections

Delete the `[Chorus]` marker and the chorus's groove is not thrown away. Charts
get rewritten, and losing an assignment because a label was retyped would be its
own small disaster — so the binding is marked "not in the chart" and can be
deleted by hand. One whose marker is still there cannot be: there is nothing to
delete, and it would be back before the dialog had finished redrawing.

Put the marker back and the binding comes with it.

## What the corpus is, and what shipping it cost

The [Groove MIDI Dataset](https://magenta.tensorflow.org/datasets/groove) is
1,150 human performances, CC BY 4.0 — one-way compatible with GPLv3, which makes
it the only corpus here that can be bundled rather than imported.

What ships is those performances cut into loops. A beat in the corpus is a
performance, not a loop: the median is 24 bars and the longest is 639. A fill
needs no cutting — the median is exactly one bar, which is the size of the thing
that goes before a section change.

| | | |
| --- | --- | --- |
| beat | 1 bar | 477 |
| beat | 2 bars | 855 |
| beat | 4 bars | 420 |
| fill | 1 bar | 509 |
| fill | 2 bars | 138 |

The first bar of each beat is skipped. Drummers were counted in and tend to
announce themselves, so bar one is an entry rather than the groove — and a loop
that starts with a crash is a loop that crashes every two bars.

**How much of the groove survives.** This corpus is worth having because it is
human and unquantised, and jamin counts in 24 pulses per quarter, which is
coarser than a drummer's hands. Measured across 19,752 notes: the mean deviation
from a sixteenth-note grid is 23.5ms, and rounding to jamin's pulse throws away
a mean of 6.2ms of it. About three quarters of the groove survives, and none of
it is re-quantised onto a sixteenth, which would throw away all of it.

A groove is **looped, never stretched**. A two-bar groove under an eight-bar
verse plays four times; it is not slowed down to last eight, because a drum
groove stretched to twice its length is not that groove played slower, it is a
different and much worse groove. One that does not divide the span is cut off at
the end, which is what a drummer does when the section changes under them.
