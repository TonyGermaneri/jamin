#pragma once

#include <cstdint>
#include <vector>

namespace jamin
{

/**
    The song, compiled.

    jamin's music theory -- the chord parser, the voice leading, the phrase
    realisation -- lives in JavaScript and stays there. The page compiles the
    chart and its phrase settings into this: a flat, sorted list of what to
    play and when, in pulses from the start of the song. The plugin never
    reasons about harmony; it performs a sequence somebody else worked out.

    That is what keeps a single implementation of the theory. It is also what
    lets the music carry on when the editor window is closed, because the
    sequence outlives the web view that produced it.

    @see docs/plugin.md
*/
struct Sequence
{
    /** 24 pulses to the quarter note, as the MIDI clock counts them and as
        score.js already does. */
    static constexpr int pulsesPerQuarter = 24;

    struct Event
    {
        int32_t pulse {};     ///< from the start of the song
        uint8_t status {};    ///< 0x90 or 0x80, channel in the low nibble
        uint8_t data1 {};     ///< note number
        uint8_t data2 {};     ///< velocity
    };

    std::vector<Event> events;   ///< sorted by pulse, stably
    int32_t lengthPulses { 0 };  ///< the song wraps here; 0 means it does not
    uint64_t generation { 0 };   ///< bumped by whoever compiled it

    bool empty() const { return events.empty(); }
};

/**
    Reads a Sequence against the host's playhead.

    Real-time safe: no allocation, no locks, no system calls. Given the quarter-
    note position at the start of a block and its length, it reports the events
    that fall inside it with the sample offset each one lands on.

    Wrapping is handled here rather than by the caller because a song that loops
    has to emit the events at the end of the pass and the events at the start of
    the next one in the same block, and getting that wrong is a dropped chord
    once per cycle -- the kind of fault that only shows up in a long take.
*/
class SequencePlayer
{
public:
    struct Emitted
    {
        int sampleOffset {};
        uint8_t status {}, data1 {}, data2 {};
    };

    /** Where the next block starts, in quarter notes. Call after a locate. */
    void locate (double ppqPosition) noexcept { cursor = ppqPosition; located = true; }

    /** True once locate() has been called since construction or reset(). */
    bool isLocated() const noexcept { return located; }

    void reset() noexcept { cursor = 0.0; located = false; }

    /**
        Collect everything the sequence says to play over one block.

        @param seq           the compiled song
        @param ppqStart      the block's start, in quarter notes from song start
        @param ppqPerSample  tempo and rate together: bpm / (60 * sampleRate)
        @param numSamples    the block length
        @param out           appended to; caller owns the storage
    */
    static void collect (const Sequence& seq,
                         double ppqStart,
                         double ppqPerSample,
                         int numSamples,
                         std::vector<Emitted>& out);

private:
    double cursor { 0.0 };
    bool located { false };
};

} // namespace jamin
