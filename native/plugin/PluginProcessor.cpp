#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "PluginPaths.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <cmath>

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

            auto compiled = compiler.compile (job);

            const juce::ScopedLock guard (lock);
            result = std::move (compiled);
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
    // A DAW automates the track it is on, so these belong to this instance and
    // not to the roster. Booleans rather than a stepped value because what a
    // control surface offers is a button, and because "the next articulation"
    // is a nudge rather than a position -- there are thousands of phrases and
    // no useful way to point at one with a knob.
    addParameter (muteParam = new juce::AudioParameterBool ({ "mute", 1 }, "Mute", false));
    addParameter (soloParam = new juce::AudioParameterBool ({ "solo", 1 }, "Solo", false));
    addParameter (nextPhraseParam = new juce::AudioParameterBool ({ "next", 1 }, "Next articulation", false));
    addParameter (prevPhraseParam = new juce::AudioParameterBool ({ "prev", 1 }, "Previous articulation", false));
    addParameter (randomPhraseParam = new juce::AudioParameterBool ({ "random", 1 }, "Random articulation", false));
    addParameter (randomDrumsParam = new juce::AudioParameterBool ({ "randomdrums", 1 }, "Random drum pattern", false));
    addParameter (randomProgressionParam = new juce::AudioParameterBool ({ "randomprog", 1 }, "Random progression", false));
    addParameter (randomSongParam = new juce::AudioParameterBool ({ "randomsong", 1 }, "Random song", false));

    /*
        One switch per drum, so a hi-hat can be automated out of a chorus.

        Named in the order the vocabulary is written in, which is the order the
        piano roll shows -- @see src/core/drumKits.js DRUM_VOICES. The two lists
        have to agree and there is nothing but this comment to make them, so a
        voice added there is a parameter added here; a DAW remembers automation
        by parameter index, so they are only ever appended.
    */
    static const char* const voiceNames[numVoices] = {
        "Kick", "Snare", "Snare rimshot", "Side stick",
        "High tom", "Mid tom", "Floor tom",
        "Closed hi-hat", "Open hi-hat", "Pedal hi-hat",
        "Crash 1", "Crash 2", "Ride", "Ride bell",
    };
    for (int at = 0; at < numVoices; ++at)
        addParameter (voices[at].param = new juce::AudioParameterBool (
            { "drum" + juce::String (at), 1 }, juce::String (voiceNames[at]) + " plays", true));

    seat = jamin::Roster::instance().join (instanceId.toStdString());

    startTimerHz (20);
}

JaminProcessor::~JaminProcessor()
{
    // Order, explicitly, rather than by where the members happen to be declared:
    // the timer stops collecting, the compile thread stops producing, and only
    // then does anything the audio thread reads go away.
    stopTimer();
    network.onRemoteOps = nullptr;
    network.stop();
    compiler.reset();
    sequence.swap (nullptr);

    // Last, and after the timer: the audio thread holds its own reference to the
    // seat, so leaving the roster cannot pull it out from under a block that is
    // still running.
    jamin::Roster::instance().leave (seat);
    seat.reset();
}

void JaminProcessor::updateTrackProperties (const TrackProperties& properties)
{
    if (seat == nullptr)
        return;

    const auto name = properties.name.value_or (juce::String());
    jamin::Roster::instance().describe (seat, name.toStdString(), seat->phrase, seat->mode);
}

/*
    Taking one drum out, and putting it back.

    Written to mirror jamin::Roster's mute exactly, because it is the same
    musical act at a different scale: the part stops where a musician would stop
    it rather than wherever the mouse was, so the change is held until a bar
    line and the audio thread reads a decision rather than a reason.
*/
void JaminProcessor::setVoiceSounding (int voice, bool sounding, double atPpq)
{
    if (voice < 0 || voice >= numVoices)
        return;

    auto& one = voices[voice];

    // Not playing, or asked for now: there is no later to wait for.
    if (atPpq < 0.0 || ! view.playing.load (std::memory_order_relaxed))
    {
        one.soundingBefore.store (sounding, std::memory_order_relaxed);
        one.soundingAfter.store (sounding, std::memory_order_relaxed);
        one.changeAtPpq.store (-1.0, std::memory_order_relaxed);
    }
    else
    {
        // Whatever it is doing now goes on until the moment, and the new answer
        // starts there.
        one.soundingBefore.store (one.soundingAfter.load (std::memory_order_relaxed),
                                  std::memory_order_relaxed);
        one.soundingAfter.store (sounding, std::memory_order_relaxed);
        one.changeAtPpq.store (atPpq, std::memory_order_relaxed);
    }

    // The parameter is what a DAW reads back and what it saves, so a switch
    // thrown in the window has to move it too.
    if (one.param != nullptr && one.param->get() != sounding)
    {
        one.param->beginChangeGesture();
        *one.param = sounding;
        one.param->endChangeGesture();
    }
}

void JaminProcessor::setVoiceNotes (const juce::Array<juce::var>& notes, int channel)
{
    drumChannel.store (juce::jlimit (0, 15, channel), std::memory_order_relaxed);
    for (int at = 0; at < numVoices; ++at)
    {
        const int note = at < notes.size() ? (int) notes[at] : -1;
        voices[at].note.store (note >= 0 && note <= 127 ? note : -1, std::memory_order_relaxed);
    }
}

bool JaminProcessor::voiceSilenced (int note, int channel, double ppq) const
{
    if (channel != drumChannel.load (std::memory_order_relaxed))
        return false;

    for (const auto& one : voices)
    {
        if (one.note.load (std::memory_order_relaxed) != note)
            continue;

        const auto at = one.changeAtPpq.load (std::memory_order_relaxed);
        const bool sounding = (at >= 0.0 && ppq < at)
            ? one.soundingBefore.load (std::memory_order_relaxed)
            : one.soundingAfter.load (std::memory_order_relaxed);
        return ! sounding;
    }
    return false;
}

void JaminProcessor::settleVoices (double ppq)
{
    for (auto& one : voices)
    {
        const auto at = one.changeAtPpq.load (std::memory_order_relaxed);
        if (at >= 0.0 && ppq >= at)
        {
            one.soundingBefore.store (one.soundingAfter.load (std::memory_order_relaxed),
                                      std::memory_order_relaxed);
            one.changeAtPpq.store (-1.0, std::memory_order_relaxed);
        }
    }
}

double JaminProcessor::nextBoundaryPpq() const
{
    if (quantizeMode == "instant")
        return -1.0;

    if (! view.hasPlayhead.load (std::memory_order_relaxed)
        || ! view.playing.load (std::memory_order_relaxed))
        return -1.0;     // nothing is moving; waiting for a bar line is waiting for ever

    const double ppq = view.ppqPosition.load (std::memory_order_relaxed);

    // A quarter note is the unit the playhead is in, so a bar is however many
    // quarters the time signature says -- 6/8 is three quarters, not six.
    const int numerator = std::max (1, view.timeSigNumerator.load (std::memory_order_relaxed));
    const int denominator = std::max (1, view.timeSigDenominator.load (std::memory_order_relaxed));
    const double step = quantizeMode == "beat" ? 4.0 / denominator
                                               : numerator * 4.0 / denominator;

    // Strictly after now: landing on the boundary the playhead is sitting on
    // would be indistinguishable from "instantly", and a quarter of a beat of
    // slack keeps a click a fraction early from waiting out a whole bar.
    const double slack = step * 0.02;
    return std::floor ((ppq + slack) / step + 1.0) * step;
}

/**
 * Notes heard since the last look.
 *
 * A note-on with no velocity is a note-off -- half the keyboards in the world
 * say it that way -- and the page should not have to know that.
 */
int JaminProcessor::takeHeardNotes (juce::Array<juce::var>& into)
{
    const auto ready = heardFifo.getNumReady();
    if (ready <= 0)
        return 0;

    const auto scope = heardFifo.read (ready);
    const auto gather = [&] (int start, int size)
    {
        for (int i = 0; i < size; ++i)
        {
            const auto& slot = heardRing[(size_t) (start + i)];
            const bool isOn = (slot.bytes[0] & 0xf0) == 0x90 && slot.bytes[2] > 0;

            auto* object = new juce::DynamicObject();
            object->setProperty ("note", (int) slot.bytes[1]);
            object->setProperty ("on", isOn);
            object->setProperty ("velocity", (int) slot.bytes[2]);
            into.add (juce::var (object));
        }
    };
    gather (scope.startIndex1, scope.blockSize1);
    gather (scope.startIndex2, scope.blockSize2);

    return into.size();
}

void JaminProcessor::tapNote (int note, int velocity, int channel)
{
    if (note < 0 || note > 127 || tapFifo.getFreeSpace() <= 0)
        return;

    const auto scope = tapFifo.write (1);
    if (scope.blockSize1 <= 0)
        return;

    auto& slot = tapRing[(size_t) scope.startIndex1];
    slot.length = 3;
    slot.bytes[0] = (uint8_t) (0x90 | (channel & 0x0f));
    slot.bytes[1] = (uint8_t) note;
    slot.bytes[2] = (uint8_t) juce::jlimit (1, 127, velocity);
}

void JaminProcessor::setInstanceMuted (const juce::String& id, bool muted)
{
    jamin::Roster::instance().setMuted (id.toStdString(), muted, nextBoundaryPpq());
}

void JaminProcessor::setInstanceSoloed (const juce::String& id, bool soloed)
{
    jamin::Roster::instance().setSoloed (id.toStdString(), soloed, nextBoundaryPpq());
}

void JaminProcessor::prepareToPlay (double sampleRate, int)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    std::memset (sounding, 0, sizeof (sounding));
    std::memset (pedalHeld, 0, sizeof (pedalHeld));
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
    {
        // The pedal first. A note-off under a held sustain pedal is not a note
        // that stops -- the instrument goes on sounding it -- so releasing the
        // notes without releasing the pedal leaves the last chord ringing over
        // a stopped transport, with nothing left running to lift it.
        if (pedalHeld[channel])
        {
            out.addEvent (juce::MidiMessage::controllerEvent (channel + 1, 64, 0), sampleOffset);
            pedalHeld[channel] = false;
        }

        for (int note = 0; note < 128; ++note)
            if (sounding[channel][note])
            {
                out.addEvent (juce::MidiMessage::noteOff (channel + 1, note), sampleOffset);
                sounding[channel][note] = false;
            }
    }
}

void JaminProcessor::processBlock (juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    audio.clear();

    // Anything arriving stays in the stream -- a chord generator that swallowed
    // the keys under it would make the track unplayable -- and the notes are
    // copied out on the way past so the editor can hear what is being played.
    //
    // Notes only. This is for working out a chord, and a pitch bend is not part
    // of one; letting everything through filled the ring with clock and
    // aftertouch and pushed the notes out of it.
    for (const auto metadata : midi)
    {
        if (metadata.numBytes != 3 || heardFifo.getFreeSpace() <= 0)
            continue;

        const auto status = (uint8_t) (metadata.data[0] & 0xf0);
        if (status != 0x90 && status != 0x80)
            continue;

        const auto scope = heardFifo.write (1);
        if (scope.blockSize1 <= 0)
            continue;

        auto& slot = heardRing[(size_t) scope.startIndex1];
        slot.length = (uint8_t) metadata.numBytes;
        for (int i = 0; i < metadata.numBytes; ++i)
            slot.bytes[i] = metadata.data[i];
    }

    // Anything the editor asked to hear, before any of the early returns below:
    // auditioning a drum has to work with the transport stopped, which is when
    // somebody is most likely to be doing it.
    if (const auto ready = tapFifo.getNumReady(); ready > 0)
    {
        const auto scope = tapFifo.read (ready);
        const auto emit = [&] (int start, int size)
        {
            for (int i = 0; i < size; ++i)
            {
                const auto& slot = tapRing[(size_t) (start + i)];
                const int channel = (slot.bytes[0] & 0x0f) + 1;
                midi.addEvent (juce::MidiMessage::noteOn (channel, slot.bytes[1],
                                                          (juce::uint8) slot.bytes[2]), 0);
                // Struck, not held: the note-off goes at the end of the same
                // block so nothing is left sounding if the editor closes.
                midi.addEvent (juce::MidiMessage::noteOff (channel, slot.bytes[1]),
                               juce::jmax (1, getBlockSize() - 1));
            }
        };
        emit (scope.startIndex1, scope.blockSize1);
        emit (scope.startIndex2, scope.blockSize2);
    }

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

    // Muted, or somebody else is soloed.
    //
    // Two atomic loads and a comparison: no lock, no allocation, nothing that
    // can block. The seat is held by shared_ptr, so it stays alive for this
    // block even if the instance is leaving the roster on the message thread
    // right now.
    //
    // The moment is a position rather than a time, so every instance in the host
    // stops on the same beat -- and a solo that silences three tracks silences
    // them together instead of over three blocks.
    bool audible = true;
    if (seat != nullptr)
    {
        const double at = seat->changeAtPpq.load (std::memory_order_acquire);
        audible = (at < 0.0 || ppq >= at)
                    ? seat->audibleAfter.load (std::memory_order_relaxed)
                    : seat->audibleBefore.load (std::memory_order_relaxed);
    }

    if (! audible)
    {
        // Going quiet has to release what was already sounding, or the last
        // chord hangs for as long as the mute lasts.
        if (wasAudible)
            allNotesOff (midi, 0);
        wasAudible = false;
        return;
    }
    wasAudible = true;

    // Borrowed for the rest of the block. Null means either no song or a swap in
    // flight, and there is nothing to do in either case.
    const jamin::SequenceHolder::Read song { sequence };
    if (! song || song.get()->empty())
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
    jamin::SequencePlayer::collect (*song.get(), ppq, ppqPerSample, numSamples, scratch);

    for (const auto& event : scratch)
    {
        const int channel = (event.status & 0x0f) + 1;

        // Switch on the status rather than asking "is this a note-on?" and
        // treating everything else as a note-off. That held while a sequence
        // contained nothing but notes; the sustain pedal is a control change,
        // and under the old reading it arrived as a note-off for note 64.
        switch (event.status & 0xf0)
        {
            case 0x90:
                if (event.data2 > 0)
                {
                    // A drum somebody has taken out. Dropped rather than sent at
                    // zero: a note-on at velocity nought is a note-off, and a
                    // stream of those to a sampler is not silence, it is a
                    // stream of note-offs for a note that never started.
                    if (voiceSilenced (event.data1, channel - 1, ppq))
                        break;

                    midi.addEvent (juce::MidiMessage::noteOn (channel, event.data1,
                                                              (juce::uint8) event.data2),
                                   event.sampleOffset);
                    sounding[channel - 1][event.data1] = true;
                    break;
                }
                [[fallthrough]];   // a note-on at velocity 0 is a note-off, and always was

            case 0x80:
                midi.addEvent (juce::MidiMessage::noteOff (channel, event.data1), event.sampleOffset);
                sounding[channel - 1][event.data1] = false;
                break;

            case 0xb0:
                midi.addEvent (juce::MidiMessage::controllerEvent (channel, event.data1,
                                                                   (juce::uint8) event.data2),
                               event.sampleOffset);
                // Tracked so a stop can lift it. 64 is the threshold the MIDI
                // spec gives for a switch controller: below it is off.
                if (event.data1 == 64)
                    pedalHeld[channel - 1] = event.data2 >= 64;
                break;

            default:
                break;     // nothing else is compiled into a sequence yet
        }
    }
}

void JaminProcessor::setSequence (std::unique_ptr<jamin::Sequence> next)
{
    JUCE_ASSERT_MESSAGE_THREAD

    // The old sequence is destroyed here, on the message thread, once swap() has
    // made it unreachable -- never on the audio thread and never while a reader
    // could still be inside it.
    const auto previous = sequence.swap (std::move (next));
    juce::ignoreUnused (previous);
}

bool JaminProcessor::setNetworking (bool shouldRun, const juce::String& secret)
{
    JUCE_ASSERT_MESSAGE_THREAD

    if (! shouldRun || secret.isEmpty())
    {
        network.stop();
        return false;
    }

    if (network.isRunning() && networkSecret == secret)
        return true;

    // A changed word is a different network: everything that trusted the old
    // one has to be let go of.
    if (network.isRunning())
        network.stop();

    networkSecret = secret;

    jamin::Node::Options options;
    // The instance id is a UUID, which is unique but says nothing. The computer
    // name is what a person recognises in a list.
    options.id = instanceId.toStdString();
    options.name = (juce::SystemStats::getComputerName() + " — " + JucePlugin_Name).toStdString();
    options.files = jamin::webRoot().getFullPathName().toStdString();
    options.onNetwork = true;
    options.secret = secret.toStdString();

    network.onRemoteOps = [this] (const std::string& envelope)
    {
        // Off the network's own thread and onto the message thread, where the
        // editor lives and where a web view may be spoken to.
        const juce::String copy (envelope);
        juce::MessageManager::callAsync ([this, copy]
        {
            if (onNetworkOps)
                onNetworkOps (copy);
        });
    };

    if (! network.start (options))
    {
        juce::Logger::writeToLog ("jamin: networking would not start: " + network.lastError);
        return false;
    }

    juce::Logger::writeToLog ("jamin: sharing this chart on http://"
                              + juce::SystemStats::getComputerName() + ".local:"
                              + juce::String (network.port()) + "/");
    return true;
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
    // A parameter can be moved from any thread the host likes, and the roster's
    // lock belongs to the message thread -- so the parameters are *read* here
    // rather than acted on where they are written. Edge-triggered: a button on a
    // control surface sends 1 and then 0, and both are the same press.
    if (seat != nullptr)
    {
        const bool mute = muteParam->get();
        if (mute != lastMuteParam)
        {
            lastMuteParam = mute;
            setInstanceMuted (instanceId, mute);
        }

        const bool solo = soloParam->get();
        if (solo != lastSoloParam)
        {
            lastSoloParam = solo;
            setInstanceSoloed (instanceId, solo);
        }

        /*
            The step parameters are nudges, not positions.

            Which means they have to let go by themselves. A DAW has no
            momentary control -- every automation parameter is a value that
            stays where it was put -- so "next articulation" left on would be
            pressed once and then stuck down, and pressing it again would mean
            first putting it back. So the rising edge does the work and the
            parameter is released immediately afterwards, which is what makes it
            behave like a button: press, it fires, it pops back out.

            Safe here because this is the message thread. It would not be in
            processBlock, which is why the parameters are read on a timer.

            The switches are not like this. Mute, solo and the fourteen drums
            are states rather than acts, and a state that let go of itself would
            be a mute that unmuted.
        */
        const auto press = [] (juce::AudioParameterBool* param, bool& was) {
            const bool now = param->get();
            const bool fired = now && ! was;
            was = now;
            if (now)
            {
                param->beginChangeGesture();
                *param = false;
                param->endChangeGesture();
                was = false;
            }
            return fired;
        };

        // The editor does the stepping, because which articulation comes next
        // is a question about a catalogue that lives in a browser.
        if (press (nextPhraseParam, lastNext))
            phraseStep.fetch_add (1, std::memory_order_relaxed);

        if (press (prevPhraseParam, lastPrev))
            phraseStep.fetch_sub (1, std::memory_order_relaxed);

        if (press (randomPhraseParam, lastRandom))
            phraseRandom.fetch_add (1, std::memory_order_relaxed);

        if (press (randomDrumsParam, lastRandomDrums))
            drumsRandom.fetch_add (1, std::memory_order_relaxed);

        if (press (randomProgressionParam, lastRandomProgression))
            progressionRandom.fetch_add (1, std::memory_order_relaxed);

        if (press (randomSongParam, lastRandomSong))
            songRandom.fetch_add (1, std::memory_order_relaxed);

        /*
            A drum switched from the DAW rather than from the window.

            The parameter is the state and the moment it lands is worked out the
            same way a mute is, so automating the hat out at bar 33 takes it out
            at bar 33 rather than between two sixteenths.
        */
        for (int at = 0; at < numVoices; ++at)
        {
            const bool wanted = voices[at].param->get();
            if (wanted != voices[at].soundingAfter.load (std::memory_order_relaxed))
                setVoiceSounding (at, wanted, nextBoundaryPpq());
        }

        // A pending mute whose bar line has gone past is simply the state now.
        if (view.playing.load (std::memory_order_relaxed))
        {
            const auto now = view.ppqPosition.load (std::memory_order_relaxed);
            jamin::Roster::instance().settle (now);
            settleVoices (now);
        }
    }

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

    // And for exactly the same reason, it joins the network straight away.
    startNetworkingFromSavedState();
}

void JaminProcessor::startNetworkingFromSavedState()
{
    const auto settings = juce::JSON::parse (instanceState).getProperty ("settings", {});

    // Read here because this is where the saved settings are already parsed, and
    // because a mute has to know where to land before anybody presses one.
    const auto instances = settings.getProperty ("instances", {});
    const auto mode = instances.getProperty ("quantize", "").toString();
    if (mode == "bar" || mode == "beat" || mode == "instant")
        quantizeMode = mode;

    const auto shared = settings.getProperty ("network", {});   // not `network`: that is the member

    if (! (bool) shared.getProperty ("enabled", true))
        return;

    const auto secret = shared.getProperty ("secret", "").toString();
    if (secret.isEmpty())
        return;                       // not configured; nothing is shared

    // setNetworking belongs to the message thread, and a host may restore state
    // on any thread it likes. The weak reference is because this instance can be
    // destroyed between the two -- loading a project that replaces a track does
    // exactly that.
    juce::WeakReference<JaminProcessor> safe (this);
    juce::MessageManager::callAsync ([safe, secret]() mutable
    {
        if (safe == nullptr)
            return;

        // Said out loud, because "is this instance on the network at all" is the
        // first question when two tracks disagree about the chart, and until now
        // the answer depended on whether anybody had opened that window.
        if (safe->setNetworking (true, secret))
            juce::Logger::writeToLog ("jamin: joined the network on port "
                                      + juce::String (safe->network.port()));
    });
}

juce::AudioProcessorEditor* JaminProcessor::createEditor()
{
    return new JaminEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new JaminProcessor();
}
