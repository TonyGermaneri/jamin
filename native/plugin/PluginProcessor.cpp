#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "PluginPaths.h"

/**
    Compiling, off the message thread.

    A long chart is tens of thousands of pulses, and the page's own player is
    stepped through every one of them to produce the sequence. That is fast, but
    not so fast that it belongs in a DAW's message thread, so it happens here and
    the answer is collected by the processor's timer.

    Latest request wins. Typing produces a request per keystroke and only the
    last one is worth anything; compiling the intermediate ones would be work
    done to be thrown away.
*/
class JaminProcessor::CompileThread final : public juce::Thread
{
public:
    CompileThread() : juce::Thread ("jamin compile") { startThread (juce::Thread::Priority::low); }
    ~CompileThread() override { stopThread (4000); }

    void submit (juce::String request)
    {
        {
            const juce::ScopedLock guard (lock);
            pending = std::move (request);
            havePending = true;
        }
        notify();
    }

    /** Collect a finished sequence, if there is one. Message thread. */
    std::unique_ptr<jamin::Sequence> collect (juce::String& error, int& chords)
    {
        const juce::ScopedLock guard (lock);
        if (! haveResult)
            return nullptr;

        haveResult = false;
        error = resultError;
        chords = resultChords;
        return std::move (result);
    }

private:
    void run() override
    {
        while (! threadShouldExit())
        {
            juce::String job;
            {
                const juce::ScopedLock guard (lock);
                if (havePending)
                {
                    job = pending;
                    havePending = false;
                }
            }

            if (job.isEmpty())
            {
                wait (250);
                continue;
            }

            // Loaded once, on first use rather than at construction: an instance
            // that is never given a chart should not pay for a JavaScript engine,
            // and a plugin scan opens a lot of instances.
            if (! compiler.isLoaded())
                compiler.load (jamin::webRoot().getChildFile ("jamin-compile.js"));

            auto sequence = compiler.compile (job);

            const juce::ScopedLock guard (lock);
            result = std::move (sequence);
            resultError = compiler.lastError;
            resultChords = compiler.lastChordCount;
            haveResult = true;
        }
    }

    jamin::Compiler compiler;
    juce::CriticalSection lock;
    juce::String pending, resultError;
    std::unique_ptr<jamin::Sequence> result;
    int resultChords { 0 };
    bool havePending { false }, haveResult { false };
};

JaminProcessor::JaminProcessor()
    : juce::AudioProcessor (
       #if JucePlugin_IsMidiEffect
        // A MIDI processor has no audio at all, and declaring a bus it does not
        // use makes auval ask about channel layouts that mean nothing here.
        BusesProperties()
       #else
        // An instrument must have an output even when it never writes to it:
        // the hosts that will not host a MIDI effect are the same ones that
        // will not host an instrument with no bus.
        BusesProperties().withOutput ("Silence", juce::AudioChannelSet::stereo(), true)
       #endif
      ),
      instanceId (juce::Uuid().toDashedString()),
      compiler (std::make_unique<CompileThread>())
{
    startTimerHz (20);
}

JaminProcessor::~JaminProcessor()
{
    // Order, explicitly, rather than by where the members happen to be declared:
    // the timer stops collecting, the compile thread stops producing, and only
    // then does anything the audio thread reads go away.
    stopTimer();
    compiler.reset();
    live.store (nullptr, std::memory_order_release);
}

void JaminProcessor::prepareToPlay (double sampleRate, int)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    std::memset (sounding, 0, sizeof (sounding));
    wasPlaying = false;

    // Room to collect a block's worth of events without the audio thread ever
    // reaching the allocator. A block holding this many note events would be a
    // song of several thousand chords a second; collect() stops at the ceiling
    // rather than growing past it, because a dropped note is recoverable and a
    // malloc in an audio callback is not.
    scratch.reserve (4096);
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
        if (metadata.numBytes > 3 || captureFifo.getFreeSpace() <= 0)
            continue;

        const auto scope = captureFifo.write (1);
        if (scope.blockSize1 <= 0)
            continue;

        auto& slot = captureRing[(size_t) scope.startIndex1];
        slot.length = (uint8_t) metadata.numBytes;
        for (int i = 0; i < metadata.numBytes; ++i)
            slot.bytes[i] = metadata.data[i];
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

    // A MIDI effect has no audio buffer to take a length from, so the host's
    // block size stands in. If neither says anything there is no block to place
    // events in, and clamping an offset into an empty range is undefined rather
    // than merely useless.
    const int numSamples = audio.getNumSamples() > 0 ? audio.getNumSamples() : getBlockSize();
    if (numSamples <= 0)
        return;

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

void JaminProcessor::requestCompile (const juce::String& requestJson)
{
    // The request is the instance's state. Saving it here rather than in a
    // second call means a session reopens playing what it was playing, without
    // the editor ever being opened.
    instanceState = requestJson;
    compiler->submit (requestJson);
}

void JaminProcessor::timerCallback()
{
    juce::String error;
    int chords = 0;
    if (auto next = compiler->collect (error, chords))
    {
        compiledEvents.store ((int) next->events.size(), std::memory_order_relaxed);
        compiledChords.store (chords, std::memory_order_relaxed);
        compileError = error;
        setSequence (std::move (next));
    }
    else if (error.isNotEmpty())
    {
        compileError = error;
        compiledEvents.store (0, std::memory_order_relaxed);
    }

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

    // Reopening a session has to bring the music back, and the editor may never
    // be opened at all -- so the saved request is compiled straight away rather
    // than waiting for a page to ask for it.
    if (instanceState.isNotEmpty() && instanceState != "{}")
        compiler->submit (instanceState);
}

juce::AudioProcessorEditor* JaminProcessor::createEditor()
{
    return new JaminEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new JaminProcessor();
}
