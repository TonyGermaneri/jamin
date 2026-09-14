#pragma once

#include "Discovery.h"
#include "Endpoint.h"

#include <deque>
#include <functional>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace jamin

{

/**
    One machine's share of a networked jamin: discovery and an endpoint, wired
    together.

    It announces itself, finds the others, serves the page, and passes edits
    along. What an edit *is* it has no idea about — the envelopes go through
    untouched — which is what lets the whole of the music live in JavaScript
    while the relaying lives here.

    Two things use this and they use it identically: `jamin-node`, which is this
    and nothing else, and the plugin, whose editor submits edits through the
    native bridge rather than over HTTP because its page is served from a
    `juce://` origin. Either way the traffic is the same and so is the code.

    @see docs/network.md
*/
class Node
{
public:
    Node() = default;
    ~Node();

    Node (const Node&) = delete;
    Node& operator= (const Node&) = delete;

    struct Options
    {
        std::string id;                 ///< unique to this instance
        std::string name;               ///< shown to people
        std::string files;              ///< the built page, or empty to serve none
        int port { 0 };                 ///< 0 for any free one
        bool onNetwork { false };       ///< bind beyond the loopback

        /// Overridden by the tests so a suite cannot mistake a real jamin on the
        /// network for one of its own.
        std::string group { "239.77.65.74" };
        int groupPort { 47365 };
        int beaconMs { 2000 };
        int forgetMs { 7000 };
    };

    bool start (Options options);
    void stop();

    bool isRunning() const { return endpoint.isRunning(); }
    int port() const { return endpoint.port(); }

    /**
        Take an edit from anywhere — this machine's own page, or another node —
        and pass it on to everybody who has not already had it.

        Safe to call from any thread and safe to call with something that has
        been round before: the envelope's id is remembered, so a ring of nodes
        does not circulate one for ever.
    */
    void submit (const std::string& envelope);

    /** An edit arrived from the network, for a page that is not reachable over
        HTTP. The plugin's editor is told this way. */
    std::function<void (const std::string& envelope)> onRemoteOps;

    /** Everyone heard from recently, as JSON. */
    std::string peersJson() const;

    /** Everything said so far, as JSON, for somebody arriving late. */
    std::string docJson() const;

    /** How many peers, and how many browsers are listening here. */
    int peerCount() const;
    int listenerCount() const { return endpoint.listeners(); }

    std::string lastError;

private:
    bool remember (const std::string& envelope);

    Endpoint endpoint;
    Discovery discovery;

    mutable std::mutex lock;
    std::set<std::string> seen;
    std::deque<std::string> order;
    std::vector<std::string> log;
};

} // namespace jamin
