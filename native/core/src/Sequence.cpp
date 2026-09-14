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

} // namespace jamin
