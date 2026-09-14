#pragma once

#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace jamin
{

/** Somebody else running jamin on this network. */
struct Peer
{
    std::string id;     ///< stable for as long as that instance lives
    std::string name;   ///< what to show a person: the machine, and the host
    std::string host;   ///< taken from the packet, not from what the sender claimed
    int port { 0 };     ///< where its HTTP endpoint is listening
    uint64_t lastSeen { 0 };
};

/**
    Finding the other machines, with nothing to configure.

    A beacon goes out to a multicast group every couple of seconds saying who we
    are and where to reach us; everybody else's beacons come back the same way.
    That is the whole protocol. There is no registry, no first machine that has
    to be started before the others, and no address for anybody to type: a node
    that appears is heard within one beacon, and a node that goes away stops
    being heard and ages out.

    **The address a peer is reachable at comes from the packet, not from the
    packet's contents.** A sender does not always know which of its own
    interfaces a packet left by, and cannot know how it looks from here; the
    receiving socket does.

    No JUCE and no plugin API, so two of these can be stood up in one test
    process and pointed at each other. @see docs/network.md
*/
class Discovery
{
public:
    struct Options
    {
        std::string id;                    ///< this instance; must be unique
        std::string name;                  ///< shown to people
        int port { 0 };                    ///< our HTTP endpoint

        /// Administratively scoped, so it cannot leave the site even if
        /// something upstream is misconfigured; the time-to-live of 1 keeps it
        /// on this subnet regardless.
        std::string group { "239.77.65.74" };
        int groupPort { 47365 };

        int beaconMs { 2000 };
        /// Three missed beacons. Two is jumpy on a busy network, and multicast
        /// is allowed to lose one.
        int forgetMs { 7000 };
    };

    Discovery() = default;
    ~Discovery();

    Discovery (const Discovery&) = delete;
    Discovery& operator= (const Discovery&) = delete;

    /** Begin announcing and listening. False if the socket could not be had,
        which on a machine with no network is not an error worth stopping for. */
    bool start (Options options);
    void stop();

    bool isRunning() const { return running; }

    /** Everyone heard from recently, oldest first. Safe from any thread. */
    std::vector<Peer> peers() const;

    /** Announce now rather than waiting for the next beacon -- on joining, so
        the others learn about us immediately rather than in a second or two. */
    void announce();

    /** What went wrong, if start() said no. */
    std::string lastError;

private:
    void run();
    void receive();
    void forgetTheDeparted();

    Options settings;
    int socketHandle { -1 };
    std::thread worker;
    volatile bool running { false };

    mutable std::mutex lock;
    std::vector<Peer> known;
};

/** Milliseconds since some fixed point. Exposed because the tests drive it. */
uint64_t nowMs();

} // namespace jamin
