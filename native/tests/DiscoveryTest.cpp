#include "check.h"
#include <jamin/Discovery.h>

#include <thread>
#include <unistd.h>

using namespace jamin;

namespace
{

/** Wait for something to become true, or give up. Beacons are on a timer, so
    every assertion here is "eventually" rather than "now". */
template <typename Condition>
bool eventually (Condition condition, int milliseconds = 4000)
{
    const auto until = nowMs() + (uint64_t) milliseconds;
    while (nowMs() < until)
    {
        if (condition())
            return true;
        std::this_thread::sleep_for (std::chrono::milliseconds (25));
    }
    return condition();
}

/** A group and port nobody else is using, so a real jamin on this network --
    or another copy of this suite -- cannot be mistaken for a peer. */
Discovery::Options options (const char* id, int port)
{
    Discovery::Options out;
    out.id = id;
    out.name = std::string ("test ") + id;
    out.port = port;
    out.group = "239.77.65.200";
    out.groupPort = 40000 + (int) (::getpid() % 20000);
    out.beaconMs = 150;
    out.forgetMs = 900;
    return out;
}

} // namespace

void discoveryTests()
{
    /* ---------------- two nodes find each other ---------------- */
    {
        Discovery one, two;
        check ("the first node starts", one.start (options ("one", 7801)), true);
        if (! one.isRunning())
        {
            std::printf ("     %s\n", one.lastError.c_str());
            return;
        }
        check ("the second starts too", two.start (options ("two", 7802)), true);

        check ("the first hears the second",
               eventually ([&] { return one.peers().size() == 1; }));
        check ("and the second hears the first",
               eventually ([&] { return two.peers().size() == 1; }));

        const auto heard = one.peers();
        if (heard.size() == 1)
        {
            checkEqual ("by id", heard[0].id, "two");
            checkEqual ("with the name it announced", heard[0].name, "test two");
            check ("and the port to reach it on", heard[0].port, 7802);
            check ("and an address, taken from the packet", ! heard[0].host.empty());
        }

        check ("nobody hears themselves",
               eventually ([&] {
                   for (const auto& peer : one.peers())
                       if (peer.id == "one")
                           return false;
                   return true;
               }));

        /* ---------------- a third arrives ---------------- */
        {
            Discovery three;
            three.start (options ("three", 7803));
            check ("everyone finds the newcomer",
                   eventually ([&] { return one.peers().size() == 2 && two.peers().size() == 2; }));
            check ("and the newcomer finds everyone",
                   eventually ([&] { return three.peers().size() == 2; }));
        }

        /* ---------------- and leaves ---------------- */
        check ("a node that stops beaconing is forgotten",
               eventually ([&] { return one.peers().size() == 1; }, 4000));
        check ("and the ones still here are not",
               eventually ([&] { return one.peers().size() == 1 && one.peers()[0].id == "two"; }));
    }

    /* ---------------- one instance, many nodes ---------------- */
    // A DAW with jamin on four tracks is four nodes on one machine sharing one
    // port. If that did not work, the normal case would be the broken one.
    {
        Discovery a, b, c, d;
        const int port = 40000 + (int) (::getpid() % 20000) + 1;

        auto sameMachine = [port] (const char* id)
        {
            auto out = options (id, 7900);
            out.groupPort = port;
            return out;
        };

        check ("four on one machine all start",
               a.start (sameMachine ("a")) && b.start (sameMachine ("b"))
               && c.start (sameMachine ("c")) && d.start (sameMachine ("d")), true);

        check ("and each hears the other three",
               eventually ([&] {
                   return a.peers().size() == 3 && b.peers().size() == 3
                       && c.peers().size() == 3 && d.peers().size() == 3;
               }));
    }

    /* ---------------- it refuses the impossible rather than pretending ------ */
    {
        Discovery nameless;
        auto bad = options ("", 7801);
        check ("a node with no id is refused", nameless.start (bad), false);
        check ("and says why", ! nameless.lastError.empty());
        check ("and is not running", nameless.isRunning(), false);
    }

    /* ---------------- stopping and starting again ---------------- */
    {
        Discovery restarted;
        check ("it starts", restarted.start (options ("restart", 7804)), true);
        restarted.stop();
        check ("stops", restarted.isRunning(), false);
        check ("and has forgotten everyone", restarted.peers().empty());
        check ("and starts again", restarted.start (options ("restart", 7804)), true);
        restarted.stop();
    }
}
