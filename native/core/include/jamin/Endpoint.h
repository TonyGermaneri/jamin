#pragma once

#include "Platform.h"

#include <functional>
#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace jamin
{

/**
    The way in: a small HTTP server, so a browser anywhere on the network is a
    jamin.

    It serves four things and nothing else.

      GET  /            the built page, and everything it asks for
      GET  /peers       who else is out there, as this node has heard it
      GET  /events      a stream that never closes, carrying edits as they happen
      POST /ops         an edit, from a page or from another node

    **Server-sent events rather than WebSocket.** A WebSocket server is a
    handshake, a framing layer, masking rules and a keepalive protocol -- several
    hundred lines to write and more to get wrong. `EventSource` downstream and an
    ordinary POST upstream need none of it, and are the same age.

    **Every response allows any origin.** A page served by one node talks
    directly to all the others, which is cross-origin by definition; without this
    it could only ever speak to the machine it came from. It is also the point at
    which to be honest that there is no authentication here at all: anything that
    can reach the port can change the chart. @see docs/network.md

    No JUCE, so the tests speak HTTP to it over a real socket.
*/
class Endpoint
{
public:
    Endpoint() = default;
    ~Endpoint();

    Endpoint (const Endpoint&) = delete;
    Endpoint& operator= (const Endpoint&) = delete;

    struct Options
    {
        /// 0 asks the system for any free port, which is what several instances
        /// on one machine need. The one actually bound is `port()`.
        int port { 0 };

        /// Where the built page lives. Empty serves no files, which is what a
        /// test wants and what a node with no page would do.
        std::string files;

        /// Bound to the loopback only unless this is set. Opening a port to the
        /// network is the sort of thing that should be asked for.
        bool onNetwork { false };

        /**
            The shared word, without which nothing is served but the page itself.

            Empty is not "no password", it is "not yet configured": start()
            refuses, because a chart that anybody on the network can edit by
            default is not a decision to make on somebody's behalf.

            The page is served without it -- an application shell is not a
            secret, and a browser has to load something before it can be asked
            for anything. The chart is what is behind the door.
        */
        std::string secret;
    };

    bool start (Options options);
    void stop();

    bool isRunning() const { return running; }

    /** The port actually bound, which is not the one asked for when 0 was. */
    int port() const { return boundPort; }

    /** Push to everybody listening on /events. Safe from any thread. */
    void broadcast (const std::string& event, const std::string& data);

    /** How many streams are open. What "three people have this chart" means. */
    int listeners() const;

    /** An edit arrived. The body is passed through untouched -- this layer has
        no opinion about what an edit is. */
    std::function<void (const std::string& body)> onOps;

    /** Asked when somebody wants /peers. Returns JSON. */
    std::function<std::string()> peersJson;

    /**
        Asked when somebody wants /doc: everything that has been said, so a
        browser that has just arrived can catch up.

        The node keeps the edits rather than the text. It has no idea what an
        edit means -- that is the page's business -- but it can hand a newcomer
        the lot and let them work it out, which is exactly what a document built
        from edits that can be applied in any order makes possible.
    */
    std::function<std::string()> docJson;

    std::string lastError;

private:
    void acceptLoop();
    void serve (SocketHandle connection);
    void holdStream (SocketHandle connection);

    Options settings;
    SocketHandle listener { kNoSocket };
    int boundPort { 0 };
    std::thread accepter;
    /// Not `volatile`, which is the traditional spelling and is not a
    /// synchronisation primitive: it orders nothing, and both shutdowns here
    /// depend on the worker seeing this promptly and in order. MSVC gives
    /// volatile acquire/release under /volatile:ms and nothing at all under
    /// /volatile:iso, which is the default on ARM -- so the two platforms would
    /// not even agree about what the old code meant.
    std::atomic<bool> running { false };

    mutable std::mutex lock;
    std::vector<SocketHandle> streams;
    std::vector<std::thread> workers;
};

/** The content type for a file name, for the handful jamin actually serves. */
std::string mimeFor (const std::string& path);

/** Compares without giving away how far it got. Cheap, and the right habit. */
bool sameSecret (const std::string& a, const std::string& b);

/**
    Hand a body to another node.

    Blocking, short, and deliberately incurious about the answer: a peer that has
    gone away is not an error to report, it is a peer that has gone away, and the
    next beacon will say so. Returns whether the bytes were accepted.
*/
bool postTo (const std::string& host, int port, const std::string& path,
             const std::string& body, const std::string& secret = {}, int timeoutMs = 1500);

} // namespace jamin
