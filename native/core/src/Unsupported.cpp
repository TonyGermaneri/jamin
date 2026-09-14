/*
    What jamin cannot do on this platform yet, said out loud.

    Discovery, the endpoint and the shared bus are written against POSIX sockets
    and POSIX shared memory. On Windows they would be Winsock and a file mapping
    -- a real port rather than a hard one, and not one to fake. So on any
    platform without them, these are the same classes with the same shapes,
    refusing rather than pretending: start() returns false and says why, and
    everything that asks gets an honest empty answer.

    That is deliberately not the same as failing to build. The rest of jamin --
    the chart, the timeline, the sequence reader -- is portable and is compiled
    and tested everywhere, so a change that breaks it is caught on every platform
    rather than on the one that happens to run the networking.

    @see docs/network.md
*/
#include "jamin/Discovery.h"
#include "jamin/Endpoint.h"

#include <chrono>

namespace jamin
{

namespace
{
constexpr const char* kWhy = "networking is not built on this platform yet";
}

uint64_t nowMs()
{
    using namespace std::chrono;
    return (uint64_t) duration_cast<milliseconds> (steady_clock::now().time_since_epoch()).count();
}

/* ---------------------------------------------------------------- discovery */

Discovery::~Discovery() = default;

bool Discovery::start (Options options)
{
    settings = std::move (options);
    lastError = kWhy;
    return false;
}

void Discovery::stop() {}
void Discovery::announce() {}
void Discovery::run() {}
void Discovery::receive() {}
void Discovery::forgetTheDeparted() {}

std::vector<Peer> Discovery::peers() const { return {}; }

/* ----------------------------------------------------------------- endpoint */

Endpoint::~Endpoint() = default;

bool Endpoint::start (Options options)
{
    settings = std::move (options);
    lastError = kWhy;
    return false;
}

void Endpoint::stop() {}
void Endpoint::acceptLoop() {}
void Endpoint::serve (int) {}
void Endpoint::holdStream (int) {}
void Endpoint::broadcast (const std::string&, const std::string&) {}
int Endpoint::listeners() const { return 0; }

std::string mimeFor (const std::string&) { return "application/octet-stream"; }

bool sameSecret (const std::string& a, const std::string& b)
{
    if (a.size() != b.size())
        return false;

    unsigned char difference = 0;
    for (size_t i = 0; i < a.size(); ++i)
        difference |= (unsigned char) (a[i] ^ b[i]);

    return difference == 0;
}

bool postTo (const std::string&, int, const std::string&, const std::string&,
             const std::string&, int)
{
    return false;
}

} // namespace jamin
