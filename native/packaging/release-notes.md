A chord chart that plays along with your DAW, and that several machines can share.

**macOS** — universal. Drag into place:

| | |
| --- | --- |
| `Jamin.vst3` | `/Library/Audio/Plug-Ins/VST3` — **use this one in Ableton Live** |
| `Jamin.component` | `/Library/Audio/Plug-Ins/Components` — the instrument, for Logic and Reaper |
| `Jamin MIDI FX.component` | `/Library/Audio/Plug-Ins/Components` — Logic's MIDI FX slot |
| `Jamin.app` | anywhere. No DAW needed. |

**Windows** — `Jamin.vst3` into `C:\Program Files\Common Files\VST3`, and a Standalone beside it.
Sharing a chart between machines is macOS-only for now; everything else works.

The AU standard has no MIDI output, so **in Live it has to be the VST3**. In Logic, the MIDI FX
version needs no routing at all.
