/*
    jamin-compile — the plugin's own compiler, run without a DAW.

    It loads the built bundle into JavaScriptCore exactly as the plugin does,
    compiles a chart, and prints what came back. This is the claim the whole of
    phase 2 rests on made executable: that jamin's music code runs headless in
    the plugin and produces the same notes as the page.

    Exit status is the gate, so ctest can hold the build to it.

      jamin-compile <path to jamin-compile.js> [chart]
*/
#include "../plugin/Compiler.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <chrono>

namespace
{
int failures = 0;

void check (const char* label, bool condition, const juce::String& detail = {})
{
    if (condition)
        return;
    ++failures;
    std::printf ("FAIL %s%s\n", label, detail.isEmpty() ? "" : (" — " + detail).toRawUTF8());
}

/** The settings the compiler needs, written out rather than loaded: this tool
    has no browser to read them from, and pinning them keeps the assertions
    below meaningful when a default changes. */
juce::String settingsJson()
{
    return R"({
        "version": 5,
        "midi": { "chordOutputId": "x", "chordChannel": 0, "accompChannel": 1,
                  "bassChannel": 0, "accompOutputId": "", "bassOutputId": "", "velocity": 90 },
        "transport": { "beatsPerBar": 4, "loop": true, "latencyPulses": 0 },
        "chords": { "octave": 4, "rangeLow": 48, "rangeHigh": 84, "smartVoicing": true,
                    "maxVoices": 5, "mergeRepeats": true,
                    "omitThirdOnDominant11": true, "omitElevenOnThirteen": true },
        "accompany": { "enabled": true, "mode": "layer", "perChordPhrases": false,
                       "bass": false, "bassOctaves": 1, "doubleBass": false,
                       "octave": 4, "speed": 1, "fit": "follow", "snapToChord": true }
    })";
}
} // namespace

int main (int argc, char** argv)
{
    if (argc < 2)
    {
        std::printf ("usage: jamin-compile <jamin-compile.js> [chart]\n");
        return 1;
    }

    const juce::File bundle { juce::String (argv[1]) };
    // The checks below that count bars and chords are about *this* chart. Pass
    // your own and they are skipped rather than failed: the usage line invites
    // one, and a tool that reports two failures for doing as it was asked is a
    // tool people stop believing.
    const juce::String defaultChart = "| Cmaj7 | A-7 | D-7 | G7 |";
    const juce::String chart = argc > 2 ? juce::String (argv[2]) : defaultChart;
    const bool ownChart = chart != defaultChart;

    jamin::Compiler compiler;
    if (! compiler.load (bundle))
    {
        std::printf ("FAIL could not load the bundle — %s\n", compiler.lastError.toRawUTF8());
        return 1;
    }

    std::printf ("jamin-compile\n  bundle   %s (%lld bytes)\n",
                 bundle.getFullPathName().toRawUTF8(), (long long) bundle.getSize());

    const auto request = "{\"text\":" + juce::JSON::toString (juce::var (chart))
                       + ",\"generation\":42,\"settings\":" + settingsJson() + "}";

    const auto started = std::chrono::steady_clock::now();
    const auto sequence = compiler.compile (request);
    const auto took = std::chrono::duration<double, std::milli> (
                          std::chrono::steady_clock::now() - started).count();

    check ("it compiled at all", sequence != nullptr, compiler.lastError);
    if (sequence == nullptr)
        return 1;

    // Repeated, because the first compile through an interpreter pays for
    // parsing the bundle and the ones after it do not -- and it is the ones
    // after it that somebody typing will feel.
    double fastest = took;
    for (int i = 0; i < 5; ++i)
    {
        const auto again = std::chrono::steady_clock::now();
        compiler.compile (request);
        fastest = std::min (fastest, std::chrono::duration<double, std::milli> (
                                         std::chrono::steady_clock::now() - again).count());
    }
    std::printf ("  time     %.1f ms first, %.1f ms best of five after\n", took, fastest);

    std::printf ("  chart    %s\n  notes    %zu events over %d pulses (%d chords)\n",
                 chart.toRawUTF8(), sequence->events.size(),
                 sequence->lengthPulses, compiler.lastChordCount);

    if (! ownChart)
    {
        check ("four bars of four is 384 pulses", sequence->lengthPulses == 384,
               juce::String (sequence->lengthPulses));
        check ("it found four chords", compiler.lastChordCount == 4);
    }
    check ("it produced notes", ! sequence->events.empty());
    check ("the generation came back", sequence->generation == 42);

    // Sorted, in range, and balanced: every note that is started is stopped.
    bool sorted = true, inRange = true;
    std::map<int, int> held;
    for (size_t i = 0; i < sequence->events.size(); ++i)
    {
        const auto& e = sequence->events[i];
        if (i > 0 && e.pulse < sequence->events[i - 1].pulse)
            sorted = false;
        if (e.data1 > 127 || e.data2 > 127 || e.pulse < 0)
            inRange = false;

        // Notes only. A control change shares the shape of a note event and
        // would otherwise be counted as a note-off -- for note 64, which is the
        // sustain pedal's controller number and a real E4 besides.
        const int kind = e.status & 0xf0;
        if (kind != 0x90 && kind != 0x80)
            continue;

        const int key = ((e.status & 0x0f) << 8) | e.data1;
        held[key] += kind == 0x90 && e.data2 > 0 ? 1 : -1;
    }
    check ("events are sorted by pulse", sorted);
    check ("notes and velocities are in range", inRange);

    int hanging = 0;
    for (const auto& [key, count] : held)
        if (count != 0)
            ++hanging;
    check ("nothing is left sounding at the end of a pass", hanging == 0, juce::String (hanging));

    // The sustain pedal, through this engine rather than through the browser's.
    // `[p]` is in the chart rather than the settings deliberately: it proves the
    // notation is read by the same parser the plugin compiles with.
    const auto pedalled = compiler.compile (
        R"({"text":"[p] | C | F |","settings":)" + settingsJson() + "}");
    check ("a pedalled chart compiles", pedalled != nullptr, compiler.lastError);
    if (pedalled != nullptr)
    {
        int downs = 0, ups = 0, wrongController = 0;
        for (const auto& e : pedalled->events)
        {
            if ((e.status & 0xf0) != 0xb0)
                continue;
            if (e.data1 != 64) { ++wrongController; continue; }
            (e.data2 >= 64 ? downs : ups)++;
        }
        check ("the pedal reached the sequence", downs > 0, juce::String (downs));
        check ("and is lifted as often as it is pressed", downs == ups,
               juce::String (downs) + " down, " + juce::String (ups) + " up");
        check ("nothing else sends a control change", wrongController == 0);
    }

    // A chart with nothing in it is not an error; it is a chart with nothing in it.
    const auto empty = compiler.compile (R"({"text":"","settings":)" + settingsJson() + "}");
    check ("an empty chart compiles", empty != nullptr, compiler.lastError);
    if (empty != nullptr)
        check ("and produces nothing", empty->events.empty());

    // Nonsense in the request must come back as an explanation, not a crash.
    const auto broken = compiler.compile ("{not json");
    check ("bad json is refused rather than fatal", broken == nullptr);
    check ("and says why", compiler.lastError.isNotEmpty());

    std::printf (failures == 0 ? "  ok       all checks passed\n" : "  %d FAILED\n", failures);
    return failures == 0 ? 0 : 1;
}
