#pragma once

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace jamin
{

/**
    Every instance of jamin in this host, and which of them may be heard.
    
    A DAW has no idea that two instances of a plugin are related. The chart they
    share travels through memory (@see SongBus); this is the other half of that
    -- who is here, what each one is playing, and whether it is muted or soloed.
    It is what lets one window control every track's articulation without hunting
    through the session for the right device.

    **Muting here is not the DAW's mute.** A DAW mutes audio, after the notes
    have been played. This decides whether the notes happen at all, which is a
    different musical act: the part stops, the others keep going, and bringing it
    back in lands on a bar line rather than wherever the mouse was. That is why
    it is quantised by default and why it cannot be done from the mixer.

    **The audio thread reads this.** So the part it reads is atomics and nothing
    else -- no lock, no allocation, no string. Everything else happens on the
    message thread under the lock, and the two meet at `Slot`, which holds the
    decision rather than the reasoning behind it.

    Process-local, deliberately. Every instance in one DAW is in one process,
    which is the case this is for. Instances in *another* process are somebody
    else's session and have no business muting these.
*/
class Roster
{
public:
    static Roster& instance();

    /**
        What one instance publishes, and what its audio thread reads back.

        Held by shared_ptr so the audio thread can go on reading it for as long
        as it holds its own reference, even if the instance is removed from the
        roster on the message thread at that moment.
    */
    struct Slot
    {
        /* ---- read by the audio thread, and by nothing else that blocks ---- */

        /// Audible before `changeAtPpq`, and after it if there is no change
        /// pending. Plain atomics: one relaxed load each, per block.
        std::atomic<bool> audibleBefore { true };
        std::atomic<bool> audibleAfter { true };

        /// The quarter-note position the change lands on, or -1 for "no change
        /// pending". A mute asked for in the middle of a bar takes effect on the
        /// next bar line, so the part stops where a musician would stop it.
        std::atomic<double> changeAtPpq { -1.0 };

        /* ---- the message thread's, under the roster's lock ---- */
        std::string id;
        std::string name;        ///< the DAW's track name, when the host says
        std::string phrase;      ///< the articulation this instance is playing

        /// What this instance plays: "drums" or "phrases".
        ///
        /// A fact about the track rather than about the person, which is why it
        /// is here and not in anybody's settings. It is what lets one window
        /// show the right catalogue for a track it is not: clicking a drum
        /// track's tab has to offer grooves, and the window doing the offering
        /// has no other way to know that is what the track is.
        std::string mode { "phrases" };
        bool wantMuted { false };
        bool wantSoloed { false };
        int order { 0 };         ///< registration order, so the tabs do not jump

        /// What this track's drums are bound to, as the page writes it.
        ///
        /// Published so another window can *show* it. Which groove plays in
        /// which section is a fact about this track -- one instance on a kit and
        /// one on a piano is the ordinary arrangement -- and it used to live in
        /// one browser-wide drawer that every instance scribbled in, so two
        /// tracks could not hold different drum parts at all.
        std::string drums { "{}" };

        /// What somebody else's window has asked this instance to play, and a
        /// counter so the same request twice is two requests. Only the instance
        /// that owns the slot acts on it -- a page cannot reach into another
        /// page, and this is the message between them.
        std::string wantPhrase;
        uint64_t wantPhraseRevision { 0 };

        /// The same, for the drums. Whole bindings rather than one change: the
        /// page that owns the track is the only one that can compile them, and
        /// handing it the finished answer means there is no order to get wrong
        /// when two requests arrive close together.
        std::string wantDrums;
        uint64_t wantDrumsRevision { 0 };

        /// And which drums another window has asked this one to silence, as a
        /// bit per voice. A mute is a thing somebody does to a *track*, and the
        /// window they do it from is whichever one happens to be open.
        uint32_t wantMutes { 0 };
        uint64_t wantMutesRevision { 0 };
    };

    using Handle = std::shared_ptr<Slot>;

    /** Join. The handle is the membership: drop it and the instance leaves. */
    Handle join (const std::string& id);
    void leave (const Handle& slot);

    /** What to show a person. Ordered by registration, oldest first. */
    struct Entry
    {
        std::string id, name, phrase, mode, drums;
        bool muted { false }, soloed { false }, audible { true };
        int order { 0 };
    };
    std::vector<Entry> entries() const;

    /** Everything, as the JSON the page reads. Nothing here parses it back. */
    std::string json() const;

    /** Which instance is playing what. Called by the instance itself. */
    void describe (const Handle& slot, const std::string& name, const std::string& phrase,
                   const std::string& mode);

    /** What this track's drums are bound to, so other windows can show it.
        Called by the instance itself, whose page is the one that knows. */
    void publishDrums (const Handle& slot, const std::string& json);

    /**
        Mute or solo an instance -- any instance, from any instance's window.

        `atPpq` is where the change lands: a bar line, usually, worked out by the
        caller because only it knows the time signature. Negative means now.
    */
    void setMuted (const std::string& id, bool muted, double atPpq);
    void setSoloed (const std::string& id, bool soloed, double atPpq);

    /** Ask an instance to play a different articulation. It is a request rather
        than a setting: the instance that owns the slot is the one that can act
        on it, because the catalogue it would look the name up in lives in that
        instance's page. */
    void requestPhrase (const std::string& id, const std::string& phrase);

    /** What this instance has been asked to play since it last looked, or empty.
        Called by the owner. */
    bool takePhraseRequest (const Handle& slot, std::string& phrase, uint64_t& seen) const;

    /** Ask an instance to bind its drums differently. A request for the same
        reason the phrase one is: only that instance's page holds the grooves
        and can compile them.

        A request made while that track's window is shut is not lost -- it waits
        in the slot and is picked up when the window opens, which is the only
        moment anything could have acted on it anyway. */
    void requestDrums (const std::string& id, const std::string& json);

    /** What this instance has been asked to bind since it last looked. */
    bool takeDrumsRequest (const Handle& slot, std::string& json, uint64_t& seen) const;

    /** Ask an instance to silence some of its drums. A bit per voice, in the
        order the vocabulary is written in.

        Unlike a binding this needs nothing from the owner's catalogue -- it is
        fourteen booleans -- but it still has to be a request, because a page
        cannot reach into another page and the processor that plays the notes is
        the one that has to stop playing them. */
    void requestVoiceMutes (const std::string& id, uint32_t mask);

    /** What this instance has been asked to silence since it last looked. */
    bool takeVoiceMutesRequest (const Handle& slot, uint32_t& mask, uint64_t& seen) const;

    /** Solo is a question about everybody, so it has to be asked of everybody. */
    bool anySoloed() const;

    /** Promote a change whose moment has passed, so the next one has somewhere
        to go. Called from a timer; cheap and idempotent. */
    void settle (double ppq);

    /** Bumped whenever anything a person would see changes, so a window can
        redraw only when there is something to redraw. */
    uint64_t revision() const { return version.load (std::memory_order_acquire); }

private:
    Roster() = default;

    /// Recompute who is audible. The lock is held.
    void recompute (double atPpq);

    mutable std::mutex lock;
    std::vector<Handle> slots;
    std::atomic<uint64_t> version { 0 };
    int nextOrder { 0 };
};

} // namespace jamin
