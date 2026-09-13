#pragma once

#include "Compiler.h"

#include <jamin/Sequence.h>
#include <jamin/SongBus.h>
#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <memory>
#include <vector>

/**
    jamin, in whichever shape the host will take.

    It makes no sound. It reads the host's playhead, performs the sequence the
    page compiled, and emits the notes into whatever is downstream. That is the
    shape the whole idea needs: one track, one articulation, one instance, and
    every instance reading the same chart.

    The same class is built twice, because hosts disagree about what a plugin
    that emits MIDI and no audio is:

    - As a **MIDI effect** (`aumi`), which is what it really is. Logic puts it in
      the MIDI FX slot, directly above the instrument it plays, and nothing has
      to be routed by hand.
    - As an **instrument** (`aumu` / VST3), because Ableton Live does not host
      AU MIDI processors at all -- not this one, any of them -- and neither do
      several others. As an instrument it appears where every host looks, makes
      silence on its own track, and has its MIDI taken from it by the track
      that wants it.

    Only the bus layout differs, so there is one implementation and two
    declarations of it.

    Deliberately, no harmony is worked out here. @see jamin::Sequence
*/
class JaminProcessor final : public juce::AudioProcessor,
                             private juce::Timer
{
public:
    JaminProcessor();
    ~JaminProcessor() override;

    void prepareToPlay (double sampleRate, int maximumExpectedSamplesPerBlock) override;
    void releaseResources() override {}
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return JucePlugin_IsMidiEffect != 0; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;

    // ------------------------------------------------------------------ the bridge

    /** Hand over a freshly compiled song. Safe to call from the message thread
        while audio is running. */
    void setSequence (std::unique_ptr<jamin::Sequence> next);

    /**
        Compile a chart into a sequence and start playing it.

        The argument is everything this instance needs to make its own noise --
        the chart, the settings, and the phrases already resolved, because the
        catalogue is a browser thing. It is kept as the instance's saved state
        too, so reopening a session brings the music back without anybody having
        to open the editor.

        Returns immediately; the work happens on a background thread and the
        answer is picked up by the timer. A chart edit therefore takes a frame
        or two to be heard, which is imperceptible, and never a millisecond of
        the audio thread, which matters.
    */
    void requestCompile (const juce::String& requestJson);

    /** What the last compile did, for the editor to report. `events` is -1
        before anything has been compiled at all. */
    std::atomic<int> compiledEvents { -1 };
    std::atomic<int> compiledChords { 0 };
    juce::String compileError;

    /** What the editor draws its playhead from. Written by the audio thread and
        read by the message thread, so every field is its own atomic -- a torn
        read here is a highlight one frame out of date, and locking the audio
        thread to prevent that would be the far worse trade. */
    struct TransportView
    {
        std::atomic<double> ppqPosition { 0.0 };
        std::atomic<double> bpm { 120.0 };
        std::atomic<int> timeSigNumerator { 4 };
        std::atomic<int> timeSigDenominator { 4 };
        std::atomic<bool> playing { false };
        std::atomic<bool> hasPlayhead { false };
    };
    const TransportView& transport() const { return view; }

    /** Everything the page keeps that belongs to this instance alone -- its
        phrase, its channel, its octave. The chart is not in here; that is
        shared. @see jamin::SongBus */
    juce::String instanceState;

    /** Distinct per instance, stable for its lifetime: what the page labels
        itself with, and what tells two windows apart. */
    const juce::String instanceId;

    /** Incoming MIDI, forwarded to the editor for phrase capture and MIDI learn.
        Written by the audio thread, drained by the message thread. */
    juce::AbstractFifo captureFifo { 512 };
    std::vector<juce::MidiMessage> captureRing { 512 };

private:
    class CompileThread;
    std::unique_ptr<CompileThread> compiler;

    void timerCallback() override;
    void allNotesOff (juce::MidiBuffer& out, int sampleOffset);

    TransportView view;

    // Sequence hand-over, without a lock on the audio thread. The message thread
    // publishes a pointer and retires the old one; a retired sequence is not
    // freed until the audio thread has been round at least twice since the swap,
    // which is what makes the free safe without either side waiting.
    std::atomic<const jamin::Sequence*> live { nullptr };
    std::atomic<uint64_t> blocksProcessed { 0 };
    struct Retired { std::unique_ptr<jamin::Sequence> seq; uint64_t atBlock; };
    std::vector<Retired> retired;
    std::vector<std::unique_ptr<jamin::Sequence>> alive;

    std::vector<jamin::SequencePlayer::Emitted> scratch;
    double currentSampleRate { 44100.0 };

    // Which notes this instance started, so they can be stopped on a locate, a
    // stop, or a swap. Nothing else in the chain knows they are ours.
    bool sounding[16][128] {};
    bool wasPlaying { false };
    double lastPpq { 0.0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (JaminProcessor)
};
