#include "check.h"
#include <jamin/Endpoint.h>

#include <arpa/inet.h>
#include <cstring>
#include <fstream>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

using namespace jamin;

namespace
{

/** Speaks HTTP over a real socket, because that is what a browser will do. */
struct Client
{
    int handle { -1 };

    bool open (int port)
    {
        handle = ::socket (AF_INET, SOCK_STREAM, 0);
        sockaddr_in to {};
        to.sin_family = AF_INET;
        to.sin_port = htons ((uint16_t) port);
        to.sin_addr.s_addr = ::inet_addr ("127.0.0.1");
        if (::connect (handle, (sockaddr*) &to, sizeof (to)) < 0) { close(); return false; }
        int on = 1;
        ::setsockopt (handle, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof (on));
        return true;
    }

    void send (const std::string& text) const { ::send (handle, text.data(), text.size(), 0); }

    /** Read whatever has arrived within the timeout. Not until close: a stream
        never closes, which is the point of it. */
    std::string readFor (int milliseconds) const
    {
        std::string out;
        char buffer[4096];
        const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds (milliseconds);

        while (std::chrono::steady_clock::now() < until)
        {
            pollfd waiting {};
            waiting.fd = handle;
            waiting.events = POLLIN;
            if (::poll (&waiting, 1, 40) <= 0) continue;
            const auto got = ::recv (handle, buffer, sizeof (buffer), 0);
            if (got <= 0) break;
            out.append (buffer, (size_t) got);
        }
        return out;
    }

    void close() { if (handle >= 0) { ::close (handle); handle = -1; } }
    ~Client() { close(); }
};

std::string get (int port, const std::string& path, int milliseconds = 500)
{
    Client client;
    if (! client.open (port)) return {};
    client.send ("GET " + path + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    return client.readFor (milliseconds);
}

bool contains (const std::string& haystack, const std::string& needle)
{
    return haystack.find (needle) != std::string::npos;
}

} // namespace

void endpointTests()
{
    /* ---------------- it comes up on a port it chose ---------------- */
    Endpoint endpoint;

    // Somewhere to serve from, so the static path is exercised for real.
    const auto dir = std::string ("/tmp/jamin-endpoint-") + std::to_string (::getpid());
    ::mkdir (dir.c_str(), 0755);
    { std::ofstream page (dir + "/index.html"); page << "<!doctype html><title>jamin</title>"; }
    { std::ofstream asset (dir + "/thing.json"); asset << "{\"real\":true}"; }

    Endpoint::Options options;
    options.files = dir;
    check ("it starts", endpoint.start (options), true);
    if (! endpoint.isRunning())
    {
        std::printf ("     %s\n", endpoint.lastError.c_str());
        return;
    }
    check ("and was given a port", endpoint.port() > 0);

    const int port = endpoint.port();

    /* ---------------- it serves the page ---------------- */
    const auto root = get (port, "/");
    check ("the root is the page", contains (root, "200 OK") && contains (root, "<title>jamin</title>"));
    check ("with a content type a browser will believe", contains (root, "text/html"));
    check ("and any origin may have it", contains (root, "Access-Control-Allow-Origin: *"));

    const auto asset = get (port, "/thing.json");
    check ("assets are served", contains (asset, "{\"real\":true}"));
    check ("with their own type", contains (asset, "application/json"));

    check ("something that is not there says so", contains (get (port, "/nope.js"), "404"));
    check ("and cannot be talked out of its directory",
           contains (get (port, "/../../etc/passwd"), "404"));

    /* ---------------- peers ---------------- */
    endpoint.peersJson = [] { return std::string (R"([{"id":"other","port":7777}])"); };
    check ("peers are reported", contains (get (port, "/peers"), "\"id\":\"other\""));

    /* ---------------- edits arrive ---------------- */
    std::string received;
    endpoint.onOps = [&received] (const std::string& body) { received = body; };

    {
        Client poster;
        check ("a client can connect", poster.open (port), true);
        const std::string body = R"({"ops":[{"t":"ins"}]})";
        poster.send ("POST /ops HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
                     "Content-Length: " + std::to_string (body.size()) + "\r\nConnection: close\r\n\r\n" + body);
        const auto answer = poster.readFor (500);
        check ("posting an edit is accepted", contains (answer, "200 OK"));
        checkEqual ("and the body arrives untouched", received, body);
    }

    /* ---------------- the stream ---------------- */
    {
        Client stream;
        check ("a stream opens", stream.open (port), true);
        stream.send ("GET /events HTTP/1.1\r\nHost: localhost\r\nAccept: text/event-stream\r\n\r\n");

        const auto head = stream.readFor (400);
        check ("it is an event stream", contains (head, "text/event-stream"));
        check ("and stays open", contains (head, ": welcome"));

        check ("the node knows somebody is listening",
               [&endpoint] {
                   for (int i = 0; i < 40 && endpoint.listeners() == 0; ++i)
                       std::this_thread::sleep_for (std::chrono::milliseconds (25));
                   return endpoint.listeners();
               }(), 1);

        endpoint.broadcast ("ops", R"({"from":"somebody"})");
        const auto pushed = stream.readFor (500);
        check ("a broadcast arrives", contains (pushed, "event: ops"));
        check ("carrying its data", contains (pushed, R"(data: {"from":"somebody"})"));

        // A payload with newlines in it would otherwise split into several
        // events and arrive as nonsense.
        endpoint.broadcast ("ops", "one\ntwo");
        const auto flattened = stream.readFor (400);
        check ("newlines in a payload cannot split the frame", contains (flattened, "data: one two"));

        stream.close();
        check ("and a stream that goes away is forgotten",
               [&endpoint] {
                   for (int i = 0; i < 60 && endpoint.listeners() > 0; ++i)
                       std::this_thread::sleep_for (std::chrono::milliseconds (25));
                   return endpoint.listeners();
               }(), 0);
    }

    /* ---------------- several listeners ---------------- */
    {
        Client a, b;
        a.open (port); b.open (port);
        a.send ("GET /events HTTP/1.1\r\nHost: localhost\r\n\r\n");
        b.send ("GET /events HTTP/1.1\r\nHost: localhost\r\n\r\n");
        a.readFor (200); b.readFor (200);

        endpoint.broadcast ("ops", R"({"n":2})");
        check ("everybody listening gets it",
               contains (a.readFor (400), R"({"n":2})") && contains (b.readFor (400), R"({"n":2})"));
    }

    /* ---------------- stopping ---------------- */
    endpoint.stop();
    check ("it stops", endpoint.isRunning(), false);
    check ("and the port is no longer answering", get (port, "/", 200).empty());

    ::unlink ((dir + "/index.html").c_str());
    ::unlink ((dir + "/thing.json").c_str());
    ::rmdir (dir.c_str());
}
