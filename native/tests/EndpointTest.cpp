#include "check.h"
#include <jamin/Endpoint.h>
#include <jamin/Sockets.h>

#include <cstring>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <thread>

using namespace jamin;

namespace
{

/** Speaks HTTP over a real socket, because that is what a browser will do. */
struct Client
{
    SocketHandle handle { kNoSocket };

    bool open (int port)
    {
        handle = openSocket (SOCK_STREAM);
        if (! valid (handle)) return false;

        sockaddr_in to {};
        to.sin_family = AF_INET;
        to.sin_port = htons ((uint16_t) port);
        parseIPv4 ("127.0.0.1", to.sin_addr);

        if (::connect (nativeSocket (handle), (sockaddr*) &to, sizeof (to)) != 0)
        {
            close();
            return false;
        }

        suppressSigPipe (handle);
        return true;
    }

    void send (const std::string& text) const { sendBytes (handle, text.data(), text.size()); }

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
            waiting.fd = nativeSocket (handle);
            waiting.events = POLLIN;
            if (pollSockets (&waiting, 1, 40) <= 0) continue;
            const auto got = recvBytes (handle, buffer, sizeof (buffer));
            if (got <= 0) break;
            out.append (buffer, (size_t) got);
        }
        return out;
    }

    void close() { closeSocket (handle); }
    ~Client() { close(); }
};

std::string get (int port, const std::string& path, int milliseconds = 500,
                 const char* key = "open-sesame")
{
    Client client;
    if (! client.open (port)) return {};
    client.send ("GET " + path + " HTTP/1.1\r\nHost: localhost\r\n"
                 + (key ? "X-Jamin-Key: " + std::string (key) + "\r\n" : "")
                 + "Connection: close\r\n\r\n");
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
    const auto dir = (std::filesystem::temp_directory_path()
                        / ("jamin-endpoint-" + std::to_string (processId()))).string();
    std::filesystem::create_directories (dir);
    { std::ofstream page (dir + "/index.html"); page << "<!doctype html><title>jamin</title>"; }
    { std::ofstream asset (dir + "/thing.json"); asset << "{\"real\":true}"; }

    Endpoint::Options options;
    options.files = dir;
    options.secret = "open-sesame";
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
                     "X-Jamin-Key: open-sesame\r\n"
                     "Content-Length: " + std::to_string (body.size()) + "\r\nConnection: close\r\n\r\n" + body);
        const auto answer = poster.readFor (500);
        check ("posting an edit is accepted", contains (answer, "200 OK"));
        checkEqual ("and the body arrives untouched", received, body);
    }

    /* ---------------- the stream ---------------- */
    {
        Client stream;
        check ("a stream opens", stream.open (port), true);
        // Through the query, as EventSource must: it cannot set a header.
        stream.send ("GET /events?k=open-sesame HTTP/1.1\r\nHost: localhost\r\n"
                     "Accept: text/event-stream\r\n\r\n");

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
        a.send ("GET /events?k=open-sesame HTTP/1.1\r\nHost: localhost\r\n\r\n");
        b.send ("GET /events?k=open-sesame HTTP/1.1\r\nHost: localhost\r\n\r\n");
        a.readFor (200); b.readFor (200);

        endpoint.broadcast ("ops", R"({"n":2})");
        check ("everybody listening gets it",
               contains (a.readFor (400), R"({"n":2})") && contains (b.readFor (400), R"({"n":2})"));
    }

    /* ---------------- the door ---------------- */
    // The page is for anybody: a browser has to load something before it can be
    // asked for a password, and an application shell is not a secret.
    check ("the page needs no password", contains (get (port, "/", 500, nullptr), "<title>jamin>"
           ) || contains (get (port, "/", 500, nullptr), "200 OK"));

    // The chart is not.
    check ("the chart does not open to nobody", contains (get (port, "/doc", 500, nullptr), "401"));
    check ("nor to the wrong word", contains (get (port, "/doc", 500, "guess"), "401"));
    check ("nor does the peer list", contains (get (port, "/peers", 500, nullptr), "401"));
    check ("nor the stream", contains (get (port, "/events", 400, nullptr), "401"));
    check ("and the right word opens it", contains (get (port, "/doc"), "200 OK"));

    {
        Client sneak;
        sneak.open (port);
        const std::string body = R"({"m":"x","ops":[]})";
        sneak.send ("POST /ops HTTP/1.1\r\nHost: localhost\r\n"
                    "Content-Length: " + std::to_string (body.size()) + "\r\nConnection: close\r\n\r\n" + body);
        check ("an edit without the word is refused", contains (sneak.readFor (400), "401"));
    }

    /* ---------------- a node with no word does not start ---------------- */
    {
        Endpoint shut;
        Endpoint::Options noSecret;
        noSecret.files = dir;
        check ("no password means no sharing at all", shut.start (noSecret), false);
        check ("and it says so", ! shut.lastError.empty(), shut.lastError);
        check ("and nothing is listening", shut.isRunning(), false);
    }

    /* ---------------- comparing ---------------- */
    check ("the same word matches", sameSecret ("hunter2", "hunter2"));
    check ("a different one does not", ! sameSecret ("hunter2", "hunter3"));
    check ("nor a prefix of it", ! sameSecret ("hunter", "hunter2"));
    check ("nor empty against anything", ! sameSecret ("", "hunter2"));

    /* ---------------- stopping ---------------- */
    endpoint.stop();
    check ("it stops", endpoint.isRunning(), false);
    check ("and the port is no longer answering", get (port, "/", 200).empty());

    // The same library that made it, rather than the POSIX calls that cannot
    // take it away everywhere. MSVC has no ::rmdir at all -- it spells that
    // one _rmdir in <direct.h> -- and it was the only one of the three the
    // compiler objected to, because it does carry a deprecated ::unlink. A
    // fix that added <direct.h> and an #ifdef would have been three lines
    // where remove_all is one, and create_directories above is already the
    // other half of this pair.
    //
    // error_code rather than the throwing overload: this is teardown of a
    // temporary directory, and a test that has already reported its result
    // should not turn a failure to tidy up into an exception.
    std::error_code ignored;
    std::filesystem::remove_all (dir, ignored);
}
