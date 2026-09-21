#include "check.h"

#include <jamin/Discovery.h>
#include <jamin/Platform.h>

#include <chrono>
#include <cstdlib>
#include <string>
#include <thread>

void sequenceTests();
void songBusTests();
void discoveryTests();
void endpointTests();
void nodeTests();
void rosterTests();

namespace
{

/**
    Can two sockets in this process hear each other over multicast?

    Discovery and the node suite are the only two that need an answer, and on a
    developer's machine the answer is always yes -- which is why nothing asked
    until the first CI run, where fifteen checks failed at once and every one of
    them was a peer that never arrived. The sockets opened; the beacons went
    nowhere. A hosted runner has no multicast route, and no amount of waiting
    makes one.

    A suite that cannot tell "this is broken" from "this cannot be tested here"
    reports the same red either way, and the second kind teaches people to
    ignore it. So it is asked once, in three seconds, before the suites that
    depend on it -- and when the answer is no they are skipped out loud rather
    than run into the ground. @see native/tools/macos-sign.sh for the same
    distinction drawn about Gatekeeper.

    Set JAMIN_REQUIRE_MULTICAST=1 to make the absence a failure instead, which
    is what the machine that is supposed to have it should do.
*/
bool multicastWorks()
{
    auto options = [] (const char* id, int port)
    {
        jamin::Discovery::Options out;
        out.id = id;
        out.name = std::string ("probe ") + id;
        out.port = port;
        // A group and port of its own. The suites derive theirs from the
        // process id too, and sharing a port with them would have this probe
        // answering for traffic it did not send.
        out.group = "239.77.65.201";
        out.groupPort = 20000 + (int) (jamin::processId() % 15000);
        out.beaconMs = 100;
        out.forgetMs = 5000;
        return out;
    };

    jamin::Discovery one, two;
    if (! one.start (options ("probe-one", 7951)))
        return false;
    if (! two.start (options ("probe-two", 7952)))
        return false;

    const auto until = jamin::nowMs() + 3000;
    while (jamin::nowMs() < until)
    {
        if (! one.peers().empty() && ! two.peers().empty())
            return true;
        std::this_thread::sleep_for (std::chrono::milliseconds (25));
    }
    return false;
}

} // namespace

int main()
{
    sequenceTests();
    songBusTests();
    endpointTests();
    rosterTests();

    // Asked after the suites that do not care, so a machine with no multicast
    // still gets everything else at full speed.
    const bool required = std::getenv ("JAMIN_REQUIRE_MULTICAST") != nullptr;
    if (required || multicastWorks())
    {
        discoveryTests();
        nodeTests();
    }
    else
    {
        std::printf ("SKIP discovery and node: no multicast on this host.\n");
        std::printf ("     Two sockets in one process could not hear each other in three\n");
        std::printf ("     seconds, which is a property of the network and not of jamin.\n");
        std::printf ("     Set JAMIN_REQUIRE_MULTICAST=1 to fail instead of skipping.\n");
    }

    std::printf (jaminFailures == 0 ? "native: all checks passed\n"
                                    : "native: %d FAILED\n", jaminFailures);
    return jaminFailures == 0 ? 0 : 1;
}
