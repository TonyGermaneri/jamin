#include "PluginProcessor.h"
#include "PluginEditor.h"

JaminProcessor::JaminProcessor()
    : juce::AudioProcessor (BusesProperties()),
      instanceId (juce::Uuid().toDashedString())
{
    startTimerHz (20);
}

JaminProcessor::~JaminProcessor()
{
    stopTimer();
    live.store (nullptr, std::memory_order_release);
}

void JaminProcessor::prepareToPlay (double sampleRate, int)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    std::memset (sounding, 0, sizeof (sounding));
    wasPlaying = false;
}

void JaminProcessor::allNotesOff (juce::MidiBuffer& out, int sampleOffset)
{
    for (int channel = 0; channel < 16; ++channel)
        for (int note = 0; note < 128; ++note)
            if (sounding[channel][note])
            {
                out.addEvent (juce::MidiMessage::noteOff (channel + 1, note), sampleOffset);
                sounding[channel][note] = false;
            }
}

void JaminProcessor::processBlock (juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    audio.clear();

    blocksProcessed.fetch_add (1, std::memory_order_acq_rel);

    // Anything arriving stays in the stream -- a chord generator that swallowed
    // the keys under it would make the track unplayable -- and is copied out for
    // the editor's phrase capture on the way past.
    for (const auto metadata : midi)
    {
        if (captureFifo.getFreeSpace() > 0)
        {
            const auto scope = captureFifo.write (1);
            if (scope.blockSize1 > 0)
                captureRing[(size_t) scope.startIndex1] = metadata.getMessage();
        }
    }

    const auto* sequence = live.load (std::memory_order_acquire);

    auto* playHead = getPlayHead();
    const auto position = playHead != nullptr ? playHead->getPosition() : juce::nullopt;

    if (! position.hasValue())
    {
        view.hasPlayhead.store (false, std::memory_order_relaxed);
        if (wasPlaying)
        {
            allNotesOff (midi, 0);
            wasPlaying = false;
        }
        return;
    }

    const auto& pos = *position;
    const bool playing = pos.getIsPlaying();
    const double bpm = pos.getBpm().orFallback (120.0);
    const double ppq = pos.getPpqPosition().orFallback (0.0);

    view.hasPlayhead.store (true, std::memory_order_relaxed);
    view.playing.store (playing, std::memory_order_relaxed);
    view.bpm.store (bpm, std::memory_order_relaxed);
    view.ppqPosition.store (ppq, std::memory_order_relaxed);

    if (const auto signature = pos.getTimeSignature())
    {
        view.timeSigNumerator.store (signature->numerator, std::memory_order_relaxed);
        view.timeSigDenominator.store (signature->denominator, std::memory_order_relaxed);
    }

    if (! playing)
    {
        if (wasPlaying)
            allNotesOff (midi, 0);
        wasPlaying = false;
        lastPpq = ppq;
        return;
    }

    // A locate -- the playhead jumping rather than advancing -- has to release
    // whatever was held, or a chord sustained across the jump never ends. The
    // threshold is a whole beat because a block never advances that far and a
    // real jump always does.
    const double expected = ppq - lastPpq;
    if (! wasPlaying || expected < 0.0 || expected > 1.0)
        allNotesOff (midi, 0);

    wasPlaying = true;
    lastPpq = ppq;

    if (sequence == nullptr || sequence->empty())
        return;

    const int numSamples = audio.getNumSamples() > 0 ? audio.getNumSamples()
                                                     : getBlockSize();
    const double ppqPerSample = bpm / (60.0 * currentSampleRate);

    scratch.clear();
    jamin::SequencePlayer::collect (*sequence, ppq, ppqPerSample, numSamples, scratch);

    for (const auto& event : scratch)
    {
        const int channel = (event.status & 0x0f) + 1;
        const bool isOn = (event.status & 0xf0) == 0x90 && event.data2 > 0;

        if (isOn)
        {
            midi.addEvent (juce::MidiMessage::noteOn (channel, event.data1, (juce::uint8) event.data2),
                           event.sampleOffset);
            sounding[channel - 1][event.data1] = true;
        }
        else
        {
            midi.addEvent (juce::MidiMessage::noteOff (channel, event.data1), event.sampleOffset);
            sounding[channel - 1][event.data1] = false;
        }
    }
}

void JaminProcessor::setSequence (std::unique_ptr<jamin::Sequence> next)
{
    JUCE_ASSERT_MESSAGE_THREAD

    const auto* raw = next.get();
    const auto* previous = live.exchange (raw, std::memory_order_acq_rel);

    alive.push_back (std::move (next));

    if (previous != nullptr)
    {
        const auto at = blocksProcessed.load (std::memory_order_acquire);
        for (auto it = alive.begin(); it != alive.end(); ++it)
            if (it->get() == previous)
            {
                retired.push_back ({ std::move (*it), at });
                alive.erase (it);
                break;
            }
    }
}

void JaminProcessor::timerCallback()
{
    // A sequence the audio thread might still be reading cannot be freed. Two
    // whole blocks after the swap it certainly is not, because the pointer it
    // loads at the top of a block is the new one. Freeing happens here rather
    // than at the swap so nothing allocates or frees on the audio thread.
    const auto now = blocksProcessed.load (std::memory_order_acquire);
    retired.erase (std::remove_if (retired.begin(), retired.end(),
                                   [now] (const Retired& r) { return now > r.atBlock + 2; }),
                   retired.end());
}

void JaminProcessor::getStateInformation (juce::MemoryBlock& destination)
{
    // Per-instance only. The chart is shared between every instance and lives in
    // the SongBus, so writing it here as well would let one track's saved copy
    // quietly overwrite the session's.
    const auto text = instanceState.isEmpty() ? juce::String ("{}") : instanceState;
    destination.replaceAll (text.toRawUTF8(), text.getNumBytesAsUTF8());
}

void JaminProcessor::setStateInformation (const void* data, int size)
{
    if (data == nullptr || size <= 0)
        return;
    instanceState = juce::String::fromUTF8 (static_cast<const char*> (data), size);
}

juce::AudioProcessorEditor* JaminProcessor::createEditor()
{
    return new JaminEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new JaminProcessor();
}
