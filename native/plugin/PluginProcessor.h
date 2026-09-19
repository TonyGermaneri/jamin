#pragma once

#include "Compiler.h"

#include <jamin/Node.h>
#include <jamin/Sequence.h>
#include <jamin/Roster.h>
#include <jamin/SongBus.h>
#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <array>
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

    /** The DAW's own name for this track, when the host offers one. It is what
        the tabs are labelled with, so a person can tell which is which. */
    void updateTrackProperties (const TrackProperties& properties) override;

    // ------------------------------------------------------------------ the roster

    /**
        This instance's place among the others in this host. @see jamin::Roster

        The audio thread reads `audible` off it and nothing else; everything a
        person changes happens on the message thread.
    */
    jamin::Roster::Handle seat;

    /** Where a quantised change would land, given where the playhead is now.
        Negative when the answer is "now". */
    double nextBoundaryPpq() const;

    /** Play one note, now, from the editor.

        For auditioning a drum: "what does this kit actually have on 42" is a
        question with one honest answer, which is to hit it. Safe from the
        message thread; the note reaches the next block. */
    void tapNote (int note, int velocity, int channel);

    /**
     * Notes that came in since the last look, for the editor to make a chord of.
     *
     * Mr. Accompany Me hears what is played; the hearing happens in the page, so
     * the notes have to get there. Drained on a timer rather than pushed from
     * the audio thread, which must not go near a web view.
     *
     * Filled with `{ note, on, velocity }` -- what the page needs and nothing
     * else, so the ring's own shape stays private to the processor.
     */
    int takeHeardNotes (juce::Array<juce::var>& into);

    /**
        A note the page wants sounded now, and left sounding.

        `tapNote` is a drum audition: struck and released inside the same
        block. This is for Mr. Accompany Me, which answers a chord somebody is
        playing on the keys -- that cannot be compiled in advance, because it
        has not been played yet, so it is the one part of jamin that has to
        leave the page in real time. The page releases it. Anything still
        sounding is released with everything else on a stop, a locate or a
        mute, so the page losing interest cannot strand it.
    */
    void sendNote (int note, int velocity, int channel, bool on);

    /** Mute or solo any instance in this host, quantised as the settings say. */
    void setInstanceMuted (const juce::String& id, bool muted);
    void setInstanceSoloed (const juce::String& id, bool soloed);

    /** bar | beat | instant. Parsed out of the saved state with everything else. */
    juce::String quantizeMode { "bar" };

    /** The parameters a DAW can automate. One instance's own, which is exactly
        right: each track automates the track it is on. */
    juce::AudioParameterBool* muteParam { nullptr };
    juce::AudioParameterBool* soloParam { nullptr };
    juce::AudioParameterBool* nextPhraseParam { nullptr };
    juce::AudioParameterBool* prevPhraseParam { nullptr };
    juce::AudioParameterBool* randomPhraseParam { nullptr };
    juce::AudioParameterBool* randomDrumsParam { nullptr };
    juce::AudioParameterBool* randomProgressionParam { nullptr };
    juce::AudioParameterBool* randomSongParam { nullptr };

    /** Raised when a step parameter is nudged, for the editor to act on -- the
        catalogue is a browser thing and the parameter is not. */
    std::atomic<int> phraseStep { 0 };
    std::atomic<int> phraseRandom { 0 };
    std::atomic<int> drumsRandom { 0 };
    std::atomic<int> progressionRandom { 0 };
    std::atomic<int> songRandom { 0 };

    // ------------------------------------------------------ silencing a drum

    /**
        One drum, on or off, for the whole song.

        The same musical act as the roster's mute and for the same reason it is
        not the DAW's: a mixer takes the hi-hat out after it has been played,
        where this decides whether it happens at all -- and it lands on a bar
        line, so the hat drops out where a drummer would drop it rather than
        wherever the mouse was.

        Read by the audio thread, so it is atomics and nothing else. `before`
        and `after` with a moment between them is the same shape as
        jamin::Roster::Slot, which is the pattern this follows exactly.
    */
    struct Voice
    {
        std::atomic<bool> soundingBefore { true };
        std::atomic<bool> soundingAfter { true };
        std::atomic<double> changeAtPpq { -1.0 };
        /// Which note this voice comes out on, as the page's kit map says.
        /// -1 until a compile says otherwise, which matches nothing.
        std::atomic<int> note { -1 };
        juce::AudioParameterBool* param { nullptr };
    };

    /*
        One per voice in the vocabulary, and they only ever grow at the end:
        a DAW remembers automation by parameter index.
        @see src/core/drumKits.js DRUM_VOICES
    */
    static constexpr int numVoices = 40;
    Voice voices[numVoices];

    /// The channel the drums are on, zero-based, from the last compile.
    std::atomic<int> drumChannel { 9 };

    /** Silence or restore one drum. `atPpq` is where it lands; negative is now. */
    void setVoiceSounding (int voice, bool sounding, double atPpq);

    /** What the page's kit map says each voice plays, so a note can be told
        which drum it is. */
    void setVoiceNotes (const juce::Array<juce::var>& notes, int channel);

    /** Whether this note is one somebody has taken out, at this moment. */
    bool voiceSilenced (int note, int channel, double ppq) const;

    /** A pending change whose bar line has gone past is simply the state now. */
    void settleVoices (double ppq);

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

    /**
        This machine's share of a networked jamin.

        The plugin is a node like any other: it announces itself, finds the
        others and relays edits. Its own editor cannot reach it over HTTP -- that
        page is served from a juce:// origin -- so edits go through the native
        bridge instead, which is the same traffic by a shorter route.

        Off until switched on, because opening a port is not something to do
        because a feature happened to compile. @see docs/network.md
    */
    jamin::Node network;

    /** What the page last told us. Kept so a changed word restarts the node
        rather than leaving the old one running. Never logged. */
    juce::String networkSecret;

    /** Join the network using the word in this instance's saved state.

        The node used to be started by the editor, which meant an instance whose
        window nobody had opened was not on the network at all -- and in a DAW
        that is most of them, most of the time. It heard nothing, and when its
        window was finally opened it arrived with an empty log and a chart from
        the saved project. @see setStateInformation */
    void startNetworkingFromSavedState();

    /** Start or stop networking. Returns whether it is running afterwards; a
        blank word is a refusal rather than an invitation. */
    bool setNetworking (bool shouldRun, const juce::String& secret);
    bool isNetworking() const { return network.isRunning(); }

    /** An edit that arrived from another machine, waiting for the editor. */
    std::function<void (const juce::String&)> onNetworkOps;

    /**
        Incoming MIDI, kept for the editor's phrase capture and MIDI learn.

        Three bytes and a length, not a juce::MidiMessage: assigning a
        MidiMessage destroys the one it replaces and can allocate for the one it
        copies, and neither belongs on an audio thread. Anything longer than
        three bytes is a system message this has no use for, so it is dropped
        rather than stored.
    */
    struct RawMidi
    {
        uint8_t bytes[3] {};
        uint8_t length {};
        /** Struck and released inside the block (auditioning a drum), or sent
            exactly as written and left to the page to release (a chord
            somebody is playing right now). @see tapNote, sendNote */
        bool held {};
    };

    juce::AbstractFifo heardFifo { 512 };
    std::array<RawMidi, 512> heardRing {};

    /** Notes the editor has asked to hear, on their way to the next block.
        Auditioning a drum from a plugin window has nowhere else to go: the page
        has no MIDI output of its own, and the only way out of this process is
        the buffer the host is about to collect. @see tapNote */
    juce::AbstractFifo tapFifo { 64 };
    std::array<RawMidi, 64> tapRing {};

private:
    class CompileThread;
    std::unique_ptr<CompileThread> compiler;

    void timerCallback() override;
    void allNotesOff (juce::MidiBuffer& out, int sampleOffset);

    /** Release what the sequence just swapped out was still holding.
        @see jamin::SequencePlayer::orphans */
    void releaseStranded (const jamin::Sequence& next, double ppqNow,
                          juce::MidiBuffer& out);

    TransportView view;

    // @see jamin::SequenceHolder for why this is a try-lock and not a pointer
    // swap with a grace period.
    jamin::SequenceHolder sequence;

    std::vector<jamin::SequencePlayer::Emitted> scratch;
    double currentSampleRate { 44100.0 };

    // Which notes this instance started, so they can be stopped on a locate, a
    // stop, or a swap. Nothing else in the chain knows they are ours.
    bool sounding[16][128] {};

    /// A new sequence has been swapped in and the audio thread has not yet
    /// looked at what the old one left sounding. @see releaseStranded
    std::atomic<bool> sequenceSwapped { false };

    // And whether the sustain pedal is down on each channel. Without this, a
    // stop under a held pedal sends note-offs to an instrument that is still
    // sustaining them, and the chord rings until something else happens to
    // lift it. @see allNotesOff
    bool pedalHeld[16] {};
    bool wasPlaying { false };
    double lastPpq { 0.0 };

    /// What the audio thread last decided about being heard, so the moment it
    /// stops being heard it can release what it was holding.
    bool wasAudible { true };

    /// Set by the parameters, read by the timer: a parameter may be moved from
    /// any thread, and the roster's lock belongs to the message thread.
    std::atomic<bool> muteWanted { false };
    std::atomic<bool> soloWanted { false };
    bool lastMuteParam { false }, lastSoloParam { false };
    bool lastNext { false }, lastPrev { false }, lastRandom { false };
    bool lastRandomDrums { false }, lastRandomProgression { false }, lastRandomSong { false };

    JUCE_DECLARE_WEAK_REFERENCEABLE (JaminProcessor)
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (JaminProcessor)
};
