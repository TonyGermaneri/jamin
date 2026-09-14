/*
    jamin-node — one machine's share of a networked jamin, without a DAW.

    Discovery and an endpoint, wired together: it announces itself, finds the
    others, serves the page, and passes edits along. It is the plugin's
    networking with the plugin taken away, which makes it the thing to run when
    something is not syncing and you want to know whether the network or the
    plugin is at fault. It is also useful on its own -- a machine with no DAW can
    hold the chart for everybody else.

      jamin-node --secret WORD [--port N] [--files DIR] [--name NAME]
                 [--network] [--quiet]

    The word is required and is the one every machine sharing a chart has to
    agree on. There is no "anybody may join".
*/
#include <jamin/Node.h>
#include <jamin/Sockets.h>

#include <atomic>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

namespace
{

std::atomic<bool> keepGoing { true };
void onSignal (int) { keepGoing = false; }

} // namespace

int main (int argc, char** argv)
{
    int port = 0;
    bool onNetwork = false, quiet = false;
    std::string files, name, secret;

    for (int i = 1; i < argc; ++i)
    {
        const std::string arg = argv[i];
        if (arg == "--port" && i + 1 < argc) port = std::atoi (argv[++i]);
        else if (arg == "--files" && i + 1 < argc) files = argv[++i];
        else if (arg == "--name" && i + 1 < argc) name = argv[++i];
        else if (arg == "--secret" && i + 1 < argc) secret = argv[++i];
        else if (arg == "--network") onNetwork = true;
        else if (arg == "--quiet") quiet = true;
        else { std::printf ("unknown argument: %s\n", arg.c_str()); return 1; }
    }

    // Winsock has to be up before gethostname, which is a socket call there and
    // fails with WSANOTINITIALISED if it is not. @see jamin/Sockets.h
    jamin::startSockets();

    char hostname[256] {};
    if (::gethostname (hostname, sizeof (hostname) - 1) != 0 || hostname[0] == '\0')
        std::strcpy (hostname, "jamin");

    const std::string id = std::string (hostname) + "-" + std::to_string (jamin::processId());
    if (name.empty()) name = hostname;

    if (secret.empty())
    {
        std::printf ("FAIL --secret is required: every machine sharing a chart agrees on one word\n");
        return 1;
    }

    jamin::Node node;

    jamin::Node::Options options;
    options.id = id;
    options.name = name;
    options.files = files;
    options.port = port;
    options.onNetwork = onNetwork;
    options.secret = secret;

    if (! node.start (options))
    {
        std::printf ("FAIL %s\n", node.lastError.c_str());
        return 1;
    }

    if (! node.lastError.empty())
        std::printf ("warning: no discovery (%s) -- this node is on its own\n", node.lastError.c_str());

    if (! quiet)
    {
        std::printf ("jamin-node\n  id     %s\n  http   http://%s:%d/\n  bound  %s\n  files  %s\n",
                     id.c_str(), onNetwork ? hostname : "127.0.0.1", node.port(),
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

        const int now = node.peerCount();
        if (now != wasKnown)
        {
            wasKnown = now;
            std::printf ("  peers  %d\n", now);
            std::fflush (stdout);
        }
    }

    node.stop();
    return 0;
}
