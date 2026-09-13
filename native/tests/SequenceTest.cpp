#include "check.h"
#include <jamin/Sequence.h>

using namespace jamin;

namespace
{
Sequence twoBars()
{
    // Two bars of 4/4 at 24 ppq: a note on at every bar line, off just before
    // the next one.
    Sequence s;
    s.lengthPulses = 192;
    s.events = { { 0,   0x90, 60, 100 },
                 { 90,  0x80, 60, 0   },
                 { 96,  0x90, 65, 100 },
                 { 186, 0x80, 65, 0   } };
    return s;
}

// 120 bpm at 48 kHz: one quarter note is 24,000 samples.
constexpr double ppqPerSample = 120.0 / (60.0 * 48000.0);
}

void sequenceTests()
{
    const auto song = twoBars();
    std::vector<SequencePlayer::Emitted> out;

    // A block at the very top of the song picks up the downbeat, at sample 0.
    SequencePlayer::collect (song, 0.0, ppqPerSample, 512, out);
    check ("downbeat count", out.size(), 1u);
    check ("downbeat note", (int) out[0].data1, 60);
    check ("downbeat offset", out[0].sampleOffset, 0);

    // A block that does not contain an event emits nothing.
    out.clear();
    SequencePlayer::collect (song, 0.1, ppqPerSample, 512, out);
    check ("quiet block", out.size(), 0u);

    // The offset within a block is the event's real position, not the start.
    // Pulse 96 is ppq 4.0; a block starting at ppq 3.99 reaches it 0.01 quarter
    // notes in, which at 120 bpm and 48 kHz is 240 samples.
    out.clear();
    SequencePlayer::collect (song, 3.99, ppqPerSample, 512, out);
    check ("second bar found", out.size(), 1u);
    check ("second bar note", (int) out[0].data1, 65);
    check ("offset is proportional", out[0].sampleOffset >= 238 && out[0].sampleOffset <= 242);

    // Looping: ppq 8.0 is the top of the second pass, and must sound the
    // downbeat again rather than falling off the end.
    out.clear();
    SequencePlayer::collect (song, 8.0, ppqPerSample, 512, out);
    check ("loops back to the top", out.size(), 1u);
    check ("and it is the downbeat", (int) out[0].data1, 60);

    // A block straddling the loop point must carry the last event of the pass
    // and the first of the next, in that order. Pulse 186 is ppq 7.75.
    out.clear();
    SequencePlayer::collect (song, 7.74, ppqPerSample, 24000, out);
    check ("straddle emits both", out.size(), 2u);
    check ("tail first", (int) out[0].data1, 65);
    check ("then the new downbeat", (int) out[1].data1, 60);
    check ("in ascending sample order", out[0].sampleOffset <= out[1].sampleOffset);

    // A song shorter than the block wraps more than once rather than dropping
    // everything after the first pass. Sixteen quarter notes of block is two
    // passes over an eight-quarter song, so every event twice.
    out.clear();
    SequencePlayer::collect (song, 0.0, ppqPerSample, 24000 * 16, out);
    check ("wraps repeatedly", out.size(), song.events.size() * 2);

    // No playhead, no tempo, no song: none of these may emit or hang.
    out.clear();
    SequencePlayer::collect (song, 0.0, 0.0, 512, out);
    check ("a stopped clock emits nothing", out.size(), 0u);
    SequencePlayer::collect (song, 0.0, ppqPerSample, 0, out);
    check ("an empty block emits nothing", out.size(), 0u);
    SequencePlayer::collect ({}, 0.0, ppqPerSample, 512, out);
    check ("an empty song emits nothing", out.size(), 0u);

    // A song with no length set does not loop, and runs out.
    Sequence once = twoBars();
    once.lengthPulses = 0;
    out.clear();
    SequencePlayer::collect (once, 100.0, ppqPerSample, 512, out);
    check ("a song that does not loop ends", out.size(), 0u);

    // Negative ppq -- some hosts report it during count-in -- must not index
    // backwards off the front of the event list.
    out.clear();
    SequencePlayer::collect (song, -2.0, ppqPerSample, 512, out);
    check ("a count-in does not crash", out.size() <= 1u);

    // Every emitted offset is inside the block. This is the one that keeps a
    // host from asserting on a badly placed event.
    out.clear();
    SequencePlayer::collect (song, 0.0, ppqPerSample, 4096, out);
    bool inRange = true;
    for (const auto& e : out)
        inRange = inRange && e.sampleOffset >= 0 && e.sampleOffset < 4096;
    check ("offsets stay inside the block", inRange);
}
