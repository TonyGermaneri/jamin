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
    roster.describe (two, "Rhodes", "C comp 19");
    const auto json = roster.json();
    check ("the name is in the json", json.find ("\"name\":\"Rhodes\"") != std::string::npos, true);
    check ("so is the articulation", json.find ("\"phrase\":\"C comp 19\"") != std::string::npos, true);
    check ("a quote in a track name does not break it",
           (roster.describe (one, "Bob\"s \\ Piano", ""), roster.json().find ("Bob\\\"s \\\\ Piano") != std::string::npos), true);

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
