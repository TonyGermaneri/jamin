#include "check.h"
#include <jamin/Roster.h>

using namespace jamin;

/** What the audio thread would decide, given where the playhead is. */
static bool audible (const Roster::Handle& slot, double ppq)
{
    const double at = slot->changeAtPpq.load (std::memory_order_acquire);
    if (at < 0.0 || ppq >= at)
        return slot->audibleAfter.load (std::memory_order_relaxed);
    return slot->audibleBefore.load (std::memory_order_relaxed);
}

void rosterTests()
{
    auto& roster = Roster::instance();

    auto one = roster.join ("inst-1");
    auto two = roster.join ("inst-2");
    auto three = roster.join ("inst-3");

    check ("everybody is here", roster.entries().size(), (size_t) 3);
    check ("and in the order they arrived", roster.entries()[0].id, std::string ("inst-1"));
    check ("rejoining under one id is not a second instance",
           roster.join ("inst-2") == two);
    check ("still three", roster.entries().size(), (size_t) 3);

    check ("everything is audible to begin with",
           audible (one, 0) && audible (two, 0) && audible (three, 0));

    /* ---------------- muting, on a bar line ---------------- */
    // Asked for in the middle of bar two, landing on bar three.
    roster.setMuted ("inst-2", true, 8.0);

    check ("the muted part plays until the bar line", audible (two, 7.99));
    check ("and stops on it", ! audible (two, 8.0));
    check ("the others are untouched", audible (one, 8.0) && audible (three, 8.0));

    // Until the moment passes, the pending change is still pending: asking
    // again must not lose it.
    roster.settle (4.0);
    check ("settling early changes nothing", ! audible (two, 8.0) && audible (two, 7.0));
    roster.settle (8.0);
    check ("once the moment passes it is simply the state", ! audible (two, 0.0));

    /* ---------------- solo silences the others ---------------- */
    roster.setSoloed ("inst-3", true, -1.0);
    check ("the soloed instance is heard", audible (three, 0));
    check ("and the others are not", ! audible (one, 0) && ! audible (two, 0));

    // A solo does not touch anybody's mute switch, so letting it go puts the
    // session back exactly as it was rather than un-muting what was muted.
    check ("the muted one is still muted", roster.entries()[1].muted, true);
    check ("and the unmuted one is still not", roster.entries()[0].muted, false);

    roster.setSoloed ("inst-3", false, -1.0);
    check ("letting solo go brings back what was playing", audible (one, 0));
    check ("and leaves muted what was muted", ! audible (two, 0));

    /* ---------------- two solos are a group ---------------- */
    roster.setSoloed ("inst-1", true, -1.0);
    roster.setSoloed ("inst-3", true, -1.0);
    check ("both soloed parts are heard", audible (one, 0) && audible (three, 0));
    check ("and the rest is not", ! audible (two, 0));

    // A quantised solo silences everybody on the same beat rather than over
    // three separate blocks.
    roster.setSoloed ("inst-1", false, 16.0);
    check ("one is still heard before the moment", audible (one, 15.9));
    check ("and not after", ! audible (one, 16.0));
    check ("its neighbour's moment is the same one",
           three->changeAtPpq.load(), 16.0);

    /* ---------------- what the page reads ---------------- */
    roster.describe (two, "Rhodes", "C comp 19", "phrases");
    const auto json = roster.json();
    check ("the name is in the json", json.find ("\"name\":\"Rhodes\"") != std::string::npos, true);
    check ("so is the articulation", json.find ("\"phrase\":\"C comp 19\"") != std::string::npos, true);
    check ("a quote in a track name does not break it",
           (roster.describe (one, "Bob\"s \\ Piano", "", "phrases"),
            roster.json().find ("Bob\\\"s \\\\ Piano") != std::string::npos), true);

    /* ---------------- and what kind of part each one is ----------------
     *
     * A window showing a track it is not has no other way to know whether that
     * track wants grooves or phrases, and the two catalogues are not
     * interchangeable. So the track says, and the roster carries it.
     */
    check ("an instance is on phrases until it says otherwise",
           roster.json().find ("\"mode\":\"phrases\"") != std::string::npos, true);

    roster.describe (three, "Kit", "", "drums");
    check ("a drum track says so",
           roster.json().find ("\"mode\":\"drums\"") != std::string::npos, true);
    // And it is per instance, not a setting the whole session shares.
    check ("while its neighbour is still on phrases",
           roster.json().find ("\"mode\":\"phrases\"") != std::string::npos, true);

    // Changing only the mode is still a change somebody would see, so the tabs
    // have to be told. It used to compare the name and the phrase alone.
    const auto beforeSwitch = roster.revision();
    roster.describe (three, "Kit", "", "phrases");
    check ("switching a track's mode bumps the revision", roster.revision() > beforeSwitch, true);

    /* ---------------- what each track's drums are bound to ----------------
     *
     * Per track, which it had not been. Every instance kept its bindings in one
     * browser-wide drawer, so two tracks could not hold different drum parts --
     * and a window showing somebody else's track had no way to find out what
     * that track played.
     */
    roster.publishDrums (three, "{\"Verse\":{\"groove\":\"g1841\"}}");
    check ("a track's bindings are published",
           roster.json().find ("\"drums\":{\"Verse\":{\"groove\":\"g1841\"}}") != std::string::npos, true);
    check ("and its neighbour's are its own",
           roster.json().find ("\"drums\":{}") != std::string::npos, true);

    /*
     * And one page's rubbish is not everybody's problem.
     *
     * The bindings go into the roster's JSON as an object rather than a string,
     * so a truncated payload would make the whole thing unparseable and empty
     * every window's tabs at once. Anything that is not plainly an object is
     * stored as one that is.
     */
    roster.publishDrums (three, "{\"Verse\":{\"groove\"");
    check ("a truncated payload does not break the roster",
           roster.json().find ("\"drums\":{\"Verse\":{\"groove\"") == std::string::npos, true);
    roster.publishDrums (three, "not json at all");
    check ("nor does rubbish", roster.json().find ("not json") == std::string::npos, true);
    roster.publishDrums (three, "[1,2,3]");
    check ("nor does an array where an object belongs",
           roster.json().find ("[1,2,3]") == std::string::npos, true);

    /* ---------------- asking an instance to play something ---------------- */
    // A page cannot reach into another page, so changing another track's
    // articulation is a request the owning instance picks up and acts on --
    // it is the one with the catalogue to look the name up in.
    uint64_t seenByTwo = 0;
    std::string wanted;
    check ("nothing has been asked for yet",
           ! roster.takePhraseRequest (two, wanted, seenByTwo));

    roster.requestPhrase ("inst-2", "F# pad 3");
    check ("the request arrives", roster.takePhraseRequest (two, wanted, seenByTwo));
    check ("and says what to play", wanted, std::string ("F# pad 3"));
    check ("and is not delivered twice",
           ! roster.takePhraseRequest (two, wanted, seenByTwo));

    /* ---------------- and asking one to bind its drums ----------------
     *
     * The same shape and for the same reason: only the instance that owns the
     * track holds the grooves and can compile them. Whole bindings rather than
     * one change, so two requests arriving close together cannot be applied in
     * the wrong order.
     */
    uint64_t drumsSeenByTwo = 0;
    std::string wantedDrums;
    check ("no drum request yet",
           ! roster.takeDrumsRequest (two, wantedDrums, drumsSeenByTwo));

    roster.requestDrums ("inst-2", "{\"Chorus\":{\"fill\":\"g99\"}}");
    check ("the drum request arrives", roster.takeDrumsRequest (two, wantedDrums, drumsSeenByTwo));
    check ("and carries the whole binding",
           wantedDrums, std::string ("{\"Chorus\":{\"fill\":\"g99\"}}"));
    check ("and is not delivered twice",
           ! roster.takeDrumsRequest (two, wantedDrums, drumsSeenByTwo));

    // A request made while that track's window is shut waits in the slot rather
    // than being lost -- the window opening is the only moment anything could
    // have acted on it anyway.
    roster.requestDrums ("inst-2", "{\"Verse\":{\"groove\":\"g7\"}}");
    uint64_t freshWindow = 0;
    check ("a window opening later still gets it",
           roster.takeDrumsRequest (two, wantedDrums, freshWindow));
    check ("and gets the latest one",
           wantedDrums, std::string ("{\"Verse\":{\"groove\":\"g7\"}}"));

    // The two channels are independent: asking for drums does not look like
    // asking for a phrase.
    check ("a drum request is not a phrase request",
           ! roster.takePhraseRequest (two, wanted, seenByTwo));

    /* ---------------- and asking one to silence a drum ----------------
     *
     * A mute is a thing somebody does to a *track*, and the window they do it
     * from is whichever one happens to be open -- so muting the hi-hat on the
     * drum track from the piano track's window has to reach the drum track.
     * One bit per voice, in the order the vocabulary is written.
     */
    uint64_t mutesSeenByTwo = 0;
    uint64_t wantedMutes = 0;
    check ("no mute request yet",
           ! roster.takeVoiceMutesRequest (two, wantedMutes, mutesSeenByTwo));

    roster.requestVoiceMutes ("inst-2", 0b1010u);
    check ("the mute request arrives", roster.takeVoiceMutesRequest (two, wantedMutes, mutesSeenByTwo));
    check ("and carries which drums", (int) wantedMutes, 10);
    check ("and is not delivered twice",
           ! roster.takeVoiceMutesRequest (two, wantedMutes, mutesSeenByTwo));

    // Nothing muted is a request too: bringing every drum back is as much an
    // instruction as taking one out, and a zero that was swallowed would leave
    // a track silent with nothing on screen to say why.
    roster.requestVoiceMutes ("inst-2", 0u);
    check ("unmuting everything is still a request",
           roster.takeVoiceMutesRequest (two, wantedMutes, mutesSeenByTwo));
    check ("and says nothing is muted", (int) wantedMutes, 0);

    /*
     * A mask wider than thirty-two bits survives the journey.
     *
     * There are forty voices now that General MIDI's percussion has somewhere
     * to go, and the mask was a `uint32_t` at both ends and an `int` in the
     * bridge. Bit 39 -- the open triangle -- landed on bit 7 or on nothing,
     * so silencing a triangle silenced a closed hi-hat. The page has the same
     * trap in the other direction: JavaScript's `<<` is 32-bit, so the mask is
     * built with arithmetic there. @see src/store.js maskOf
     */
    const uint64_t high = 1ull << 39;
    roster.requestVoiceMutes ("inst-2", high | 1ull);
    check ("a forty-voice mask arrives whole",
           roster.takeVoiceMutesRequest (two, wantedMutes, mutesSeenByTwo));
    check ("the top voice is still set", (wantedMutes & high) != 0);
    check ("and the bottom one too", (wantedMutes & 1ull) != 0);
    check ("and nothing in between was invented", wantedMutes == (high | 1ull));

    /*
     * The channels do not collide -- with the drums channel drained first.
     *
     * Asserting it without draining tests nothing about collision: there is a
     * real drum request still pending from further up this test, and it comes
     * back whether or not the mute channel touched anything.
     */
    while (roster.takeDrumsRequest (two, wantedDrums, drumsSeenByTwo)) { }
    roster.requestVoiceMutes ("inst-2", 0b11u);
    check ("a mute request is not a drum request",
           ! roster.takeDrumsRequest (two, wantedDrums, drumsSeenByTwo));
    check ("and the mute one is still there",
           roster.takeVoiceMutesRequest (two, wantedMutes, mutesSeenByTwo));

    // The same phrase asked for again is a second request, not a repeat to be
    // swallowed: pressing the same button twice means it twice.
    roster.requestPhrase ("inst-2", "F# pad 3");
    check ("asking again asks again", roster.takePhraseRequest (two, wanted, seenByTwo));

    // Nobody else picks it up.
    uint64_t seenByOne = 0;
    check ("and it was not for anybody else",
           ! roster.takePhraseRequest (one, wanted, seenByOne));

    roster.requestPhrase ("nobody-here", "x");   // must not throw or match

    /* ---------------- leaving ---------------- */
    const auto before = roster.revision();
    roster.leave (three);
    check ("one fewer", roster.entries().size(), (size_t) 2);
    check ("and somebody noticed", roster.revision() != before);

    roster.leave (one);
    roster.leave (two);
    check ("an empty roster is empty", roster.entries().size(), (size_t) 0);
    check ("and says so", roster.json(), std::string ("[]"));
}
