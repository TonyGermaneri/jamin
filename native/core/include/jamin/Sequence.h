#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
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

    /** What is sounding, and whether the pedal is down, per channel. */
    struct Ringing
    {
        bool note[16][128] {};
        bool pedal[16] {};
    };

    /**
        What a swap would strand, given what is already sounding.

        A compiled song is a flat list of note-ons and the note-offs that
        answer them, and the answer is only in the sequence that contained the
        question. Swap a new one in halfway through a note and the note-off it
        was owed goes with the old sequence: nothing turns that note off until
        the transport stops, which in a DAW is a note held until the track is
        disarmed. Editing the chart while it plays is the ordinary way to use
        jamin, so this is the ordinary case rather than an edge.

        It is not enough to release everything on every swap. The page
        recompiles on every keystroke, and most keystrokes are somewhere else
        in the chart -- the note-off for whatever is sounding is still there,
        at the same pulse, in the new sequence. Releasing it anyway would make
        typing chop up the part being played.

        So this asks the new sequence what it intends to do. Walking forward
        from where the playhead is, a note-off before any re-strike means the
        new sequence will release that note itself and it can be left alone; a
        re-strike first, or nothing at all, means it is stranded and has to be
        released now. Same for the pedal, which hangs a chord just as
        thoroughly and is easier to miss.

        Real-time safe: no allocation, and the walk stops after `scanLimit`
        events. Giving up early errs towards releasing, which is a re-struck
        note rather than a hung one.

        @param next      the sequence about to be played
        @param ppqNow    the playhead, in quarter notes from song start
        @param held      what this instance currently has sounding
        @param release   filled in: what must be turned off now
    */
    static void orphans (const Sequence& next,
                         double ppqNow,
                         const Ringing& held,
                         Ringing& release) noexcept;

    /** How far the orphan walk reads before it gives up and releases. */
    static constexpr int scanLimit = 8192;

private:
    double cursor { 0.0 };
    bool located { false };
};

/**
    Handing a compiled song to the audio thread.

    The obvious version of this is wrong in a way that only shows up under load:
    publish the new pointer, note which block it happened on, and free the old
    one a couple of blocks later on the assumption that nobody can still be
    reading it. An audio thread that has been preempted -- which is what a
    session full of heavy plugins does to it -- can still be inside that block
    tens of milliseconds later, reading a sequence that has just been freed. The
    result is a corrupted heap and a crash somewhere else entirely, at some
    later time, in somebody else's code.

    So the reader takes a try-lock instead. It never waits: if a swap is in
    flight it skips the block, which costs at most a few milliseconds of notes
    and cannot cost a session. The writer holds the lock only long enough to
    exchange two pointers -- the old sequence is destroyed after the lock is
    released, by which time no reader can reach it.
*/
class SequenceHolder
{
public:
    /** Replace the sequence. Returns the old one, already unreachable by any
        reader, for the caller to destroy when it likes. */
    std::unique_ptr<Sequence> swap (std::unique_ptr<Sequence> next);

    /**
        A borrowed view of the current sequence, held for as long as this lives.

        `get()` is null either because there is no sequence or because a swap was
        in flight -- the caller does nothing in both cases, so they do not need
        telling apart.
    */
    class Read
    {
    public:
        explicit Read (SequenceHolder&) noexcept;
        ~Read() noexcept;

        Read (const Read&) = delete;
        Read& operator= (const Read&) = delete;

        const Sequence* get() const noexcept { return sequence; }
        explicit operator bool() const noexcept { return sequence != nullptr; }

    private:
        SequenceHolder& owner;
        const Sequence* sequence { nullptr };
        bool locked { false };
    };

private:
    std::atomic_flag busy = ATOMIC_FLAG_INIT;
    std::unique_ptr<Sequence> current;
};

} // namespace jamin
