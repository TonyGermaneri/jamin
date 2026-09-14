/*
    jamin-node — one machine's share of a networked jamin, without a DAW.

    Discovery and an endpoint, wired together: it announces itself, finds the
    others, serves the page, and passes edits along. It is the plugin's
    networking with the plugin taken away, which makes it the thing to run when
    something is not syncing and you want to know whether the network or the
    plugin is at fault. It is also useful on its own -- a machine with no DAW can
    hold the chart for everybody else.

      jamin-node [--port N] [--files DIR] [--name NAME] [--network] [--quiet]
*/
#include <jamin/Discovery.h>
#include <jamin/Endpoint.h>

#include <atomic>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <deque>
#include <mutex>
#include <set>
#include <vector>
#include <string>
#include <thread>
#include <unistd.h>

namespace
{

std::atomic<bool> keepGoing { true };
void onSignal (int) { keepGoing = false; }

/** Pull one string value out of flat JSON, without a JSON parser. */
std::string field (const std::string& json, const std::string& name)
{
    const auto key = "\"" + name + "\":\"";
    const auto at = json.find (key);
    if (at == std::string::npos) return {};
    const auto from = at + key.size();
    const auto to = json.find ('"', from);
    return to == std::string::npos ? std::string {} : json.substr (from, to - from);
}

std::string escape (const std::string& text)
{
    std::string out;
    for (const char c : text)
    {
        if (c == '"' || c == '\\') out += '\\';
        out += (c == '\n' || c == '\r') ? ' ' : c;
    }
    return out;
}

} // namespace

int main (int argc, char** argv)
{
    int port = 0;
    bool onNetwork = false, quiet = false;
    std::string files, name;

    for (int i = 1; i < argc; ++i)
    {
        const std::string arg = argv[i];
        if (arg == "--port" && i + 1 < argc) port = std::atoi (argv[++i]);
        else if (arg == "--files" && i + 1 < argc) files = argv[++i];
        else if (arg == "--name" && i + 1 < argc) name = argv[++i];
        else if (arg == "--network") onNetwork = true;
        else if (arg == "--quiet") quiet = true;
        else { std::printf ("unknown argument: %s\n", arg.c_str()); return 1; }
    }

    char hostname[256] {};
    ::gethostname (hostname, sizeof (hostname) - 1);

    const std::string id = std::string (hostname) + "-" + std::to_string (::getpid());
    if (name.empty()) name = hostname;

    jamin::Endpoint endpoint;
    jamin::Discovery discovery;

    // Edits already passed on, so a ring of nodes does not circulate one for
    // ever. Each envelope carries an id; this is the memory of having seen it.
    std::mutex seenLock;
    std::set<std::string> seen;
    std::deque<std::string> order;

    // Everything this node has accepted, so somebody arriving later can be
    // handed the lot. Kept as it arrived: this node does not know what an edit
    // means and does not need to.
    std::mutex logLock;
    std::vector<std::string> log;

    endpoint.docJson = [&]
    {
        const std::lock_guard<std::mutex> guard (logLock);
        std::string json = "[";
        for (size_t i = 0; i < log.size(); ++i)
        {
            if (i) json += ',';
            json += log[i];
        }
        return json + "]";
    };

    endpoint.onOps = [&] (const std::string& body)
    {
        const auto message = field (body, "m");

        if (! message.empty())
        {
            const std::lock_guard<std::mutex> guard (seenLock);
            if (! seen.insert (message).second)
                return;                       // round it goes; stop it here

            order.push_back (message);
            while (order.size() > 4096)
            {
                seen.erase (order.front());
                order.pop_front();
            }
        }

        {
            // A chart is small and a session is finite, but an append-only log
            // is still append-only. Twenty thousand envelopes is far more than
            // a day of typing and far less than a problem.
            const std::lock_guard<std::mutex> guard (logLock);
            if (log.size() < 20000)
                log.push_back (body);
        }

        // Everybody attached to this node hears it, and so does every other
        // node. The duplicate check above is what makes that safe rather than
        // a broadcast storm.
        endpoint.broadcast ("ops", body);

        for (const auto& peer : discovery.peers())
            jamin::postTo (peer.host, peer.port, "/ops", body);
    };

    endpoint.peersJson = [&]
    {
        std::string json = "[";
        bool first = true;
        for (const auto& peer : discovery.peers())
        {
            if (! first) json += ',';
            first = false;
            json += "{\"id\":\"" + escape (peer.id) + "\",\"name\":\"" + escape (peer.name)
                  + "\",\"host\":\"" + escape (peer.host) + "\",\"port\":" + std::to_string (peer.port) + "}";
        }
        return json + "]";
    };

    jamin::Endpoint::Options served;
    served.port = port;
    served.files = files;
    served.onNetwork = onNetwork;

    if (! endpoint.start (served))
    {
        std::printf ("FAIL %s\n", endpoint.lastError.c_str());
        return 1;
    }

    jamin::Discovery::Options announced;
    announced.id = id;
    announced.name = name;
    announced.port = endpoint.port();

    if (! discovery.start (announced))
        std::printf ("warning: no discovery (%s) -- this node is on its own\n", discovery.lastError.c_str());

    if (! quiet)
    {
        std::printf ("jamin-node\n  id     %s\n  http   http://%s:%d/\n  bound  %s\n  files  %s\n",
                     id.c_str(), onNetwork ? hostname : "127.0.0.1", endpoint.port(),
                     onNetwork ? "the network" : "loopback only",
                     files.empty() ? "(none)" : files.c_str());
        std::fflush (stdout);
    }

    std::signal (SIGINT, onSignal);
    std::signal (SIGTERM, onSignal);

    int wasKnown = -1;
    while (keepGoing)
    {
        std::this_thread::sleep_for (std::chrono::milliseconds (250));

        if (quiet)
            continue;

        const int now = (int) discovery.peers().size();
        if (now != wasKnown)
        {
            wasKnown = now;
            std::printf ("  peers  %d\n", now);
            std::fflush (stdout);
        }
    }

    discovery.stop();
    endpoint.stop();
    return 0;
}
