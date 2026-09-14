#include "jamin/Discovery.h"
#include "jamin/Sockets.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>

namespace jamin
{

namespace
{

/**
    The beacon, as it goes on the wire.

    Tab-separated rather than JSON: there is no JSON reader in this library and
    adding one to parse four fields would be a poor trade. The leading magic and
    version mean a packet from something else sharing the group is ignored rather
    than misread, and a future version can change the shape without confusing
    anybody running this one.
*/
constexpr const char* kMagic = "jamin\t1";
constexpr size_t kMaxPacket = 1024;

/** Tabs and newlines are the only things that would break the format. */
std::string sanitise (const std::string& text)
{
    std::string clean;
    clean.reserve (text.size());
    for (const char c : text)
        clean += (c == '\t' || c == '\n' || c == '\r') ? ' ' : c;
    return clean.substr (0, 120);
}

std::vector<std::string> split (const std::string& line, char by)
{
    std::vector<std::string> parts;
    size_t from = 0;
    for (;;)
    {
        const auto at = line.find (by, from);
        if (at == std::string::npos) { parts.push_back (line.substr (from)); break; }
        parts.push_back (line.substr (from, at - from));
        from = at + 1;
    }
    return parts;
}

} // namespace

uint64_t nowMs()
{
    using namespace std::chrono;
    return (uint64_t) duration_cast<milliseconds> (steady_clock::now().time_since_epoch()).count();
}

Discovery::~Discovery() { stop(); }

bool Discovery::start (Options options)
{
    stop();
    settings = std::move (options);
    lastError.clear();

    if (settings.id.empty())
    {
        lastError = "a node with no id cannot be told apart from any other";
        return false;
    }

    in_addr group {};
    if (! parseIPv4 (settings.group, group))
    {
        lastError = "\"" + settings.group + "\" is not a multicast address";
        return false;
    }

    socketHandle = openSocket (SOCK_DGRAM);
    if (! valid (socketHandle))
    {
        lastError = "no datagram socket: " + socketErrorText();
        return false;
    }

    // Several instances share one machine -- a DAW with jamin on four tracks is
    // four nodes -- so the port has to be shareable or only the first would
    // hear anything. @see allowSharedBind, which is two different options.
    allowSharedBind (socketHandle);

    // Bound to the wildcard rather than to the group, which is the only thing
    // Windows accepts and is fine everywhere else.
    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl (INADDR_ANY);
    address.sin_port = htons ((uint16_t) settings.groupPort);

    if (::bind (nativeSocket (socketHandle), (sockaddr*) &address, sizeof (address)) != 0)
    {
        lastError = "could not bind the discovery port: " + socketErrorText();
        closeSocket (socketHandle);
        return false;
    }

    // The default interface, which is the one with the best route. On a machine
    // with several -- a laptop on Wi-Fi with a dock plugged in -- that is a
    // choice the routing table makes and this does not second-guess.
    ip_mreq membership {};
    membership.imr_multiaddr = group;
    membership.imr_interface.s_addr = htonl (INADDR_ANY);

    if (! setOption (socketHandle, IPPROTO_IP, IP_ADD_MEMBERSHIP, membership))
    {
        lastError = "could not join the group: " + socketErrorText();
        closeSocket (socketHandle);
        return false;
    }

    // Loopback on, because several nodes on one machine is the normal case here
    // and they have to hear each other. A node ignores its own beacon by id.
    setMulticastLoop (socketHandle, true);

    // One hop. Discovery has no business leaving this subnet, whatever the
    // routers in between have been told to do.
    setMulticastTtl (socketHandle, 1);

    running = true;
    worker = std::thread ([this] { run(); });
    announce();
    return true;
}

void Discovery::stop()
{
    running = false;

    // Joined *before* the socket is closed, not after.
    //
    // Closing it first is the obvious way round and is a use-after-close: the
    // worker may be between reading the handle and polling on it. On POSIX a
    // descriptor that has just been closed is usually still unused for a moment
    // and the bug hides; on Windows a handle is reused immediately, and the
    // thing polled could by then be a socket belonging to the host. The loop
    // checks `running` every quarter of a second, so this costs that at most.
    if (worker.joinable())
        worker.join();

    closeSocket (socketHandle);

    const std::lock_guard<std::mutex> guard (lock);
    known.clear();
}

void Discovery::announce()
{
    if (! valid (socketHandle))
        return;

    const std::string packet = std::string (kMagic) + '\t' + sanitise (settings.id) + '\t'
                             + sanitise (settings.name) + '\t' + std::to_string (settings.port);

    sockaddr_in to {};
    to.sin_family = AF_INET;
    to.sin_port = htons ((uint16_t) settings.groupPort);
    if (! parseIPv4 (settings.group, to.sin_addr))
        return;

    // Nothing is done about a failure. A beacon is a statement, not a request,
    // and the next one is two seconds away.
    sendTo (socketHandle, packet.data(), packet.size(), to);
}

void Discovery::run()
{
    uint64_t nextBeacon = nowMs();

    while (running)
    {
        const auto now = nowMs();
        if (now >= nextBeacon)
        {
            announce();
            nextBeacon = now + (uint64_t) std::max (250, settings.beaconMs);
        }

        pollfd waiting {};
        waiting.fd = nativeSocket (socketHandle);
        waiting.events = POLLIN;

        const int wait = (int) std::min<uint64_t> (250, nextBeacon > now ? nextBeacon - now : 0);
        const int ready = pollSockets (&waiting, 1, std::max (10, wait));

        if (! running)
            break;

        if (ready > 0 && (waiting.revents & POLLIN) != 0)
            receive();

        forgetTheDeparted();
    }
}

void Discovery::receive()
{
    char buffer[kMaxPacket];
    sockaddr_in from {};

    const auto got = recvFrom (socketHandle, buffer, sizeof (buffer) - 1, from);
    if (got <= 0)
        return;

    buffer[got] = '\0';
    const auto parts = split (std::string (buffer), '\t');

    // magic, version, id, name, port
    if (parts.size() < 5 || parts[0] != "jamin" || parts[1] != "1")
        return;

    const auto& id = parts[2];
    if (id.empty() || id == settings.id)
        return;                                  // our own voice

    Peer heard;
    heard.id = id;
    heard.name = parts[3];
    heard.port = std::atoi (parts[4].c_str());
    heard.lastSeen = nowMs();

    heard.host = addressText (from.sin_addr);

    if (heard.port <= 0 || heard.port > 65535)
        return;

    const std::lock_guard<std::mutex> guard (lock);
    for (auto& existing : known)
    {
        if (existing.id == heard.id)
        {
            // Everything but the first-seen order: a peer that moves interface
            // or changes its name should not become a second peer.
            existing.name = heard.name;
            existing.host = heard.host;
            existing.port = heard.port;
            existing.lastSeen = heard.lastSeen;
            return;
        }
    }

    known.push_back (heard);
}

void Discovery::forgetTheDeparted()
{
    const auto cutoff = nowMs() - (uint64_t) std::max (1000, settings.forgetMs);

    const std::lock_guard<std::mutex> guard (lock);
    known.erase (std::remove_if (known.begin(), known.end(),
                                 [cutoff] (const Peer& peer) { return peer.lastSeen < cutoff; }),
                 known.end());
}

std::vector<Peer> Discovery::peers() const
{
    const std::lock_guard<std::mutex> guard (lock);
    return known;
}

} // namespace jamin
