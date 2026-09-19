#include "jamin/Sequence.h"

#include <algorithm>
#include <cmath>

namespace jamin
{

void SequencePlayer::collect (const Sequence& seq,
                              double ppqStart,
                              double ppqPerSample,
                              int numSamples,
                              std::vector<Emitted>& out)
{
    if (seq.events.empty() || numSamples <= 0 || ! (ppqPerSample > 0.0))
        return;

    // The contract is that this never reallocates: the audio thread's vector is
    // reserved once in prepareToPlay and only appended to from then on. A caller
    // that has not reserved gets one allocation here rather than silently
    // getting nothing, which is a trap -- an untouched vector would come back
    // empty and look exactly like a sequence with no events in it.
    if (out.capacity() == 0)
        out.reserve (256);

    const double pulsesPerSample = ppqPerSample * Sequence::pulsesPerQuarter;
    const double blockStart = ppqStart * Sequence::pulsesPerQuarter;
    double remaining = pulsesPerSample * numSamples;
    double consumed = 0.0;

    const auto length = static_cast<double> (seq.lengthPulses);
    const bool wraps = seq.lengthPulses > 0;

    // A block can straddle the loop point, and when the song is short enough it
    // can straddle it more than once, so this walks the block in segments that
    // each stay within one pass rather than assuming a single wrap.
    while (remaining > 0.0)
    {
        double from = blockStart + consumed;

        if (wraps)
        {
            from = std::fmod (from, length);
            if (from < 0.0)
                from += length;   // fmod keeps the sign of the numerator
        }

        const double segment = wraps ? std::min (remaining, length - from) : remaining;
        if (! (segment > 0.0))
            break;               // a zero-length song, or arithmetic gone wrong

        const auto first = std::lower_bound (seq.events.begin(), seq.events.end(), from,
                                             [] (const Sequence::Event& e, double p)
                                             { return static_cast<double> (e.pulse) < p; });

        for (auto it = first; it != seq.events.end(); ++it)
        {
            const auto pulse = static_cast<double> (it->pulse);
            if (pulse >= from + segment)
                break;

            // Never grow: the caller reserves, and this is running on an audio
            // thread where an allocation is a worse outcome than a lost note.
            if (out.size() >= out.capacity())
                return;

            const double offset = (consumed + (pulse - from)) / pulsesPerSample;
            const int sample = std::clamp (static_cast<int> (offset), 0, numSamples - 1);
            out.push_back ({ sample, it->status, it->data1, it->data2 });
        }

        consumed += segment;
        remaining -= segment;
    }
}

void SequencePlayer::orphans (const Sequence& next,
                              double ppqNow,
                              const Ringing& held,
                              Ringing& release) noexcept
{
    release = {};

    // Nothing is sounding, so nothing can be stranded. The commonest case by
    // far -- a swap while the transport is stopped -- and it costs one pass
    // over a small array rather than a walk of the sequence.
    int waiting = 0;
    for (int channel = 0; channel < 16; ++channel)
    {
        if (held.pedal[channel])
            ++waiting;
        for (int note = 0; note < 128; ++note)
            if (held.note[channel][note])
                ++waiting;
    }
    if (waiting == 0)
        return;

    // Everything is stranded until the new sequence is seen to answer for it.
    // Starting from that assumption is what makes an early exit safe: whatever
    // the walk has not reached is released, which is the harmless direction.
    release = held;

    // Where the playhead is within the current pass, worked out exactly as
    // collect() does it -- the two have to agree about where "now" is or the
    // walk starts on the wrong side of an event.
    double from = ppqNow * Sequence::pulsesPerQuarter;
    if (next.lengthPulses > 0)
    {
        const auto length = static_cast<double> (next.lengthPulses);
        from = std::fmod (from, length);
        if (from < 0.0)
            from += length;      // fmod keeps the sign of the numerator
    }

    // Only to the end of this pass. A note-off that comes round again on the
    // next time through the loop is a note held for a whole song, which is a
    // hung note with a timer on it rather than a note that gets released.
    const auto first = std::lower_bound (next.events.begin(), next.events.end(), from,
                                         [] (const Sequence::Event& e, double p)
                                         { return static_cast<double> (e.pulse) < p; });

    Ringing settled;             // decided one way or the other; stop looking
    int read = 0;

    for (auto it = first; it != next.events.end() && waiting > 0; ++it)
    {
        if (++read > scanLimit)
            break;

        const int channel = it->status & 0x0f;
        const int kind = it->status & 0xf0;

        if (kind == 0x90 || kind == 0x80)
        {
            const int note = it->data1 & 0x7f;
            if (! held.note[channel][note] || settled.note[channel][note])
                continue;

            // A note-off first: the new sequence answers for this one, so it
            // is left alone and will stop where the new sequence says. A
            // note-on first: the note in the air was never answered for, and
            // letting it stand would leave two note-ons and one note-off.
            const bool off = kind == 0x80 || it->data2 == 0;
            if (off)
                release.note[channel][note] = false;

            settled.note[channel][note] = true;
            --waiting;
        }
        else if (kind == 0xb0 && (it->data1 & 0x7f) == 64)
        {
            if (! held.pedal[channel] || settled.pedal[channel])
                continue;

            if (it->data2 == 0)
                release.pedal[channel] = false;

            settled.pedal[channel] = true;
            --waiting;
        }
    }
}

std::unique_ptr<Sequence> SequenceHolder::swap (std::unique_ptr<Sequence> next)
{
    while (busy.test_and_set (std::memory_order_acquire))
    {
        // The reader holds this for the length of one block's arithmetic over a
        // sorted array. Spinning is the right thing here and the wait is over in
        // microseconds; this is not the audio thread.
    }

    auto previous = std::move (current);
    current = std::move (next);
    busy.clear (std::memory_order_release);

    // Destroyed by the caller, after the lock is released: no reader can reach
    // it any more, and freeing under the lock would make the audio thread skip
    // a block for the length of a deallocation.
    return previous;
}

SequenceHolder::Read::Read (SequenceHolder& holder) noexcept : owner (holder)
{
    // Never waits. A swap in flight means this block plays nothing, which is a
    // few milliseconds of silence rather than a use-after-free.
    if (! owner.busy.test_and_set (std::memory_order_acquire))
    {
        locked = true;
        sequence = owner.current.get();
    }
}

SequenceHolder::Read::~Read() noexcept
{
    if (locked)
        owner.busy.clear (std::memory_order_release);
}

} // namespace jamin
