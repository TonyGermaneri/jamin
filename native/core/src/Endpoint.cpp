#include "jamin/Endpoint.h"
#include "jamin/Sockets.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace jamin
{

namespace
{

constexpr size_t kMaxHeader = 16 * 1024;
constexpr size_t kMaxBody = 4 * 1024 * 1024;

/**
    How long a connection may say nothing before it is given up on.

    This is what bounds stop(): a thread parked in recv() on a client that
    opened a socket and then went quiet would otherwise keep the node alive for
    as long as that client felt like holding it. It applies to the request, not
    to a stream -- /events is held open by a poll loop that watches `running`,
    not by a blocking read.
*/
constexpr int kIdleMs = 2000;

/** Allows anyone, deliberately, and says so where somebody will read it. */
constexpr const char* kCors =
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
    "Access-Control-Allow-Headers: Content-Type\r\n"
    "Access-Control-Max-Age: 86400\r\n";

bool writeAll (SocketHandle connection, const char* data, size_t size)
{
    size_t sent = 0;
    while (sent < size)
    {
        const auto wrote = sendBytes (connection, data + sent, size - sent);
        if (wrote <= 0)
            return false;
        sent += (size_t) wrote;
    }
    return true;
}

bool writeAll (SocketHandle connection, const std::string& text)
{
    return writeAll (connection, text.data(), text.size());
}

void respond (SocketHandle connection, const char* status, const std::string& type,
              const std::string& body)
{
    std::ostringstream head;
    head << "HTTP/1.1 " << status << "\r\n"
         << kCors
         << "Content-Type: " << type << "\r\n"
         << "Content-Length: " << body.size() << "\r\n"
         << "Cache-Control: no-store\r\n"
         << "Connection: close\r\n\r\n";

    writeAll (connection, head.str());
    writeAll (connection, body);
}

/** One header's value, case-insensitively, or empty. */
std::string header (const std::string& request, const std::string& name)
{
    std::string lowered;
    lowered.reserve (request.size());
    for (const char c : request) lowered += (char) std::tolower ((unsigned char) c);

    std::string key = "\r\n";
    for (const char c : name) key += (char) std::tolower ((unsigned char) c);
    key += ':';

    const auto at = lowered.find (key);
    if (at == std::string::npos) return {};

    auto from = at + key.size();
    while (from < request.size() && (request[from] == ' ' || request[from] == '\t')) ++from;
    const auto to = request.find ("\r\n", from);
    return to == std::string::npos ? std::string {} : request.substr (from, to - from);
}

/** Or from the query, because EventSource cannot set a header at all. */
std::string queryKey (const std::string& target)
{
    const auto at = target.find ("k=");
    if (at == std::string::npos) return {};
    const auto from = at + 2;
    const auto to = target.find_first_of ("&#", from);
    return target.substr (from, to == std::string::npos ? std::string::npos : to - from);
}

/** A path that cannot climb out of the directory it is served from. */
bool safePath (const std::string& path)
{
    if (path.find ("..") != std::string::npos) return false;
    if (path.find ('\\') != std::string::npos) return false;
    return true;
}

std::string readFile (const std::string& path, bool& found)
{
    // std::filesystem rather than stat, which is spelled three ways across the
    // platforms this builds on and means slightly different things in each.
    std::error_code ec;
    if (! std::filesystem::is_regular_file (std::filesystem::path (path), ec))
    {
        found = false;
        return {};
    }

    std::ifstream in (path, std::ios::binary);
    if (! in)
    {
        found = false;
        return {};
    }

    found = true;
    return { std::istreambuf_iterator<char> (in), std::istreambuf_iterator<char>() };
}

} // namespace

std::string mimeFor (const std::string& path)
{
    static const std::pair<const char*, const char*> table[]
    {
        { ".html", "text/html; charset=utf-8" },    { ".js",    "text/javascript" },
        { ".mjs",  "text/javascript" },             { ".css",   "text/css" },
        { ".json", "application/json" },            { ".svg",   "image/svg+xml" },
        { ".woff2", "font/woff2" },                 { ".woff",  "font/woff" },
        { ".png",  "image/png" },                   { ".jpg",   "image/jpeg" },
        { ".ico",  "image/x-icon" },                { ".voc",   "text/plain; charset=utf-8" },
        { ".map",  "application/json" },            { ".txt",   "text/plain; charset=utf-8" },
    };

    for (const auto& [suffix, mime] : table)
    {
        const auto at = path.size();
        const auto length = std::strlen (suffix);
        if (at >= length && path.compare (at - length, length, suffix) == 0)
            return mime;
    }

    return "application/octet-stream";
}

bool sameSecret (const std::string& a, const std::string& b)
{
    // Length is not secret and cannot be hidden by this anyway; the contents
    // are compared whole so a wrong guess takes as long whatever it got right.
    if (a.size() != b.size())
        return false;

    unsigned char difference = 0;
    for (size_t i = 0; i < a.size(); ++i)
        difference |= (unsigned char) (a[i] ^ b[i]);

    return difference == 0;
}

bool postTo (const std::string& host, int port, const std::string& path,
             const std::string& body, const std::string& secret, int timeoutMs)
{
    sockaddr_in to {};
    to.sin_family = AF_INET;
    to.sin_port = htons ((uint16_t) port);

    // A peer's address comes from the packet its beacon arrived in, so it is
    // always a dotted quad and there is nothing here to resolve.
    if (! parseIPv4 (host, to.sin_addr))
        return false;

    auto handle = openSocket (SOCK_STREAM);
    if (! valid (handle))
        return false;

    setTimeouts (handle, timeoutMs);
    suppressSigPipe (handle);

    if (::connect (nativeSocket (handle), (sockaddr*) &to, sizeof (to)) != 0)
    {
        closeSocket (handle);
        return false;
    }

    std::ostringstream request;
    request << "POST " << path << " HTTP/1.1\r\n"
            << "Host: " << host << "\r\n"
            << "Content-Type: application/json\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "X-Jamin-Key: " << secret << "\r\n"
            << "Connection: close\r\n\r\n" << body;

    const auto text = request.str();
    const bool sent = writeAll (handle, text);

    // The answer is read and thrown away, so the peer is not left writing into
    // a socket nobody is reading.
    char discard[512];
    if (sent)
        recvBytes (handle, discard, sizeof (discard));

    closeSocket (handle);
    return sent;
}

Endpoint::~Endpoint() { stop(); }

bool Endpoint::start (Options options)
{
    stop();
    settings = std::move (options);
    lastError.clear();

    if (settings.secret.empty())
    {
        lastError = "no password set, so nothing will be shared";
        return false;
    }

    listener = openSocket (SOCK_STREAM);
    if (! valid (listener))
    {
        lastError = "no socket: " + socketErrorText();
        return false;
    }

    allowRebind (listener);
    suppressSigPipe (listener);

    sockaddr_in address {};
    address.sin_family = AF_INET;
    // Loopback unless asked otherwise: a port on the network is something to
    // opt into, not something that happens because the feature was compiled in.
    address.sin_addr.s_addr = htonl (settings.onNetwork ? INADDR_ANY : INADDR_LOOPBACK);
    address.sin_port = htons ((uint16_t) settings.port);

    if (::bind (nativeSocket (listener), (sockaddr*) &address, sizeof (address)) != 0)
    {
        lastError = "could not bind port " + std::to_string (settings.port) + ": "
                  + socketErrorText();
        closeSocket (listener);
        return false;
    }

    if (::listen (nativeSocket (listener), 32) != 0)
    {
        lastError = "could not listen: " + socketErrorText();
        closeSocket (listener);
        return false;
    }

    sockaddr_in actual {};
    socklen_t length = (socklen_t) sizeof (actual);
    ::getsockname (nativeSocket (listener), (sockaddr*) &actual, &length);
    boundPort = ntohs (actual.sin_port);

    running = true;
    accepter = std::thread ([this] { acceptLoop(); });
    return true;
}

void Endpoint::stop()
{
    running = false;

    // Every thread here owns the socket it is working on and closes it itself,
    // and every one of them notices `running` within a quarter of a second --
    // the accept loop and the streams because they poll with a timeout, a
    // request because its socket cannot block for longer than kIdleMs. So this
    // waits for them rather than closing sockets out from under them.
    //
    // The alternative -- close everything, then join -- is two bugs. One is a
    // double close, because a stream thread closes its own connection on the
    // way out. The other is worse: a closed handle is reused immediately on
    // Windows, so a thread that was about to read from it reads from whatever
    // the host opened next instead.
    if (accepter.joinable())
        accepter.join();

    for (auto& worker : workers)
        if (worker.joinable())
            worker.join();
    workers.clear();

    {
        const std::lock_guard<std::mutex> guard (lock);
        streams.clear();                 // already closed by their own threads
    }

    closeSocket (listener);
}

void Endpoint::acceptLoop()
{
    while (running)
    {
        pollfd waiting {};
        waiting.fd = nativeSocket (listener);
        waiting.events = POLLIN;

        if (pollSockets (&waiting, 1, 200) <= 0)
            continue;
        if (! running)
            break;

        const auto connection = acceptOn (listener);
        if (! valid (connection))
            continue;

        const int on = 1;
        suppressSigPipe (connection);
        setOption (connection, IPPROTO_TCP, TCP_NODELAY, on);
        setTimeouts (connection, kIdleMs);

        const std::lock_guard<std::mutex> guard (lock);
        // Finished threads are joined here rather than detached, so stop() can
        // be sure nothing is still running when it returns.
        workers.erase (std::remove_if (workers.begin(), workers.end(),
                                       [] (std::thread& t) { return ! t.joinable(); }),
                       workers.end());
        workers.emplace_back ([this, connection] { serve (connection); });
    }
}

void Endpoint::serve (SocketHandle connection)
{
    std::string request;
    char buffer[4096];

    // Headers first, up to the blank line.
    size_t headerEnd = std::string::npos;
    while (running && request.size() < kMaxHeader)
    {
        headerEnd = request.find ("\r\n\r\n");
        if (headerEnd != std::string::npos)
            break;

        const auto got = recvBytes (connection, buffer, sizeof (buffer));
        if (got <= 0)
            break;
        request.append (buffer, (size_t) got);
    }

    if (headerEnd == std::string::npos)
        headerEnd = request.find ("\r\n\r\n");

    if (headerEnd == std::string::npos)
    {
        closeSocket (connection);
        return;
    }

    const auto firstLine = request.substr (0, request.find ("\r\n"));
    std::istringstream line (firstLine);
    std::string method, target;
    line >> method >> target;

    const auto query = target.find ('?');
    const auto path = query == std::string::npos ? target : target.substr (0, query);

    // The page is served to anybody -- an application shell is not a secret, and
    // a browser must load something before it can be asked for anything. The
    // chart is what is behind the door.
    const bool guarded = (path == "/ops" || path == "/doc" || path == "/peers" || path == "/events");

    if (guarded && method != "OPTIONS")
    {
        auto offered = header (request, "X-Jamin-Key");
        if (offered.empty() && query != std::string::npos)
            offered = queryKey (target.substr (query + 1));

        if (! sameSecret (offered, settings.secret))
        {
            respond (connection, "401 Unauthorized", "application/json",
                     R"({"error":"password"})");
            closeSocket (connection);
            return;
        }
    }

    if (method == "OPTIONS")
    {
        respond (connection, "204 No Content", "text/plain", "");
        closeSocket (connection);
        return;
    }

    if (method == "POST" && path == "/ops")
    {
        size_t length = 0;
        const auto marker = request.find ("Content-Length:");
        if (marker != std::string::npos)
            length = (size_t) std::atol (request.c_str() + marker + 15);

        if (length > kMaxBody)
        {
            respond (connection, "413 Payload Too Large", "text/plain", "too big");
            closeSocket (connection);
            return;
        }

        std::string body = request.substr (headerEnd + 4);
        while (running && body.size() < length)
        {
            const auto got = recvBytes (connection, buffer, sizeof (buffer));
            if (got <= 0)
                break;
            body.append (buffer, (size_t) got);
        }

        if (onOps)
            onOps (body);

        respond (connection, "200 OK", "application/json", "{\"ok\":true}");
        closeSocket (connection);
        return;
    }

    if (method != "GET" && method != "HEAD")
    {
        respond (connection, "405 Method Not Allowed", "text/plain", "no");
        closeSocket (connection);
        return;
    }

    if (path == "/doc")
    {
        respond (connection, "200 OK", "application/json", docJson ? docJson() : "[]");
        closeSocket (connection);
        return;
    }

    if (path == "/peers")
    {
        respond (connection, "200 OK", "application/json", peersJson ? peersJson() : "[]");
        closeSocket (connection);
        return;
    }

    if (path == "/events")
    {
        const std::string head =
            std::string ("HTTP/1.1 200 OK\r\n") + kCors
            + "Content-Type: text/event-stream\r\n"
              "Cache-Control: no-store\r\n"
              "Connection: keep-alive\r\n"
              "X-Accel-Buffering: no\r\n\r\n"
              ": welcome\n\n";

        if (! writeAll (connection, head))
        {
            closeSocket (connection);
            return;
        }

        {
            const std::lock_guard<std::mutex> guard (lock);
            streams.push_back (connection);
        }

        holdStream (connection);
        return;
    }

    if (settings.files.empty() || ! safePath (path))
    {
        respond (connection, "404 Not Found", "text/plain", "no");
        closeSocket (connection);
        return;
    }

    const auto relative = (path == "/" || path.empty()) ? std::string ("/index.html") : path;
    bool found = false;
    const auto body = readFile (settings.files + relative, found);

    if (! found)
        respond (connection, "404 Not Found", "text/plain", "no");
    else
        respond (connection, "200 OK", mimeFor (relative), body);

    closeSocket (connection);
}

void Endpoint::holdStream (SocketHandle connection)
{
    // The stream is written to from broadcast(); this thread only waits for the
    // other end to go away. A comment every fifteen seconds keeps anything in
    // between from deciding the connection is idle.
    char discard[256];
    uint64_t nextPing = 0;

    while (running)
    {
        pollfd waiting {};
        waiting.fd = nativeSocket (connection);
        waiting.events = POLLIN;

        const int ready = pollSockets (&waiting, 1, 250);
        if (ready > 0)
        {
            const auto got = recvBytes (connection, discard, sizeof (discard));
            if (got <= 0)
                break;              // the browser closed it
        }

        if (++nextPing >= 60)
        {
            nextPing = 0;
            const std::lock_guard<std::mutex> guard (lock);
            if (std::find (streams.begin(), streams.end(), connection) == streams.end())
                break;
            if (! writeAll (connection, ": ping\n\n"))
                break;
        }
    }

    const std::lock_guard<std::mutex> guard (lock);
    streams.erase (std::remove (streams.begin(), streams.end(), connection), streams.end());
    closeSocket (connection);
}

void Endpoint::broadcast (const std::string& event, const std::string& data)
{
    // One frame, built once. Newlines in the payload would split it into several
    // events, so the caller is expected to send one line -- JSON, in practice.
    std::string frame = "event: " + event + "\ndata: ";
    for (const char c : data)
        frame += (c == '\n' || c == '\r') ? ' ' : c;
    frame += "\n\n";

    const std::lock_guard<std::mutex> guard (lock);
    std::vector<SocketHandle> alive;
    alive.reserve (streams.size());

    for (const SocketHandle stream : streams)
    {
        if (writeAll (stream, frame))
            alive.push_back (stream);
        else
            shutdownSocket (stream);          // its thread will notice and tidy up
    }

    streams = alive;
}

int Endpoint::listeners() const
{
    const std::lock_guard<std::mutex> guard (lock);
    return (int) streams.size();
}

} // namespace jamin
