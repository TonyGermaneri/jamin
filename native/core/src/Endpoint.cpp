#include "jamin/Endpoint.h"

#include <algorithm>
#include <arpa/inet.h>
#include <cstring>
#include <fstream>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sstream>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

namespace jamin
{

namespace
{

constexpr size_t kMaxHeader = 16 * 1024;
constexpr size_t kMaxBody = 4 * 1024 * 1024;

/** Allows anyone, deliberately, and says so where somebody will read it. */
constexpr const char* kCors =
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
    "Access-Control-Allow-Headers: Content-Type\r\n"
    "Access-Control-Max-Age: 86400\r\n";

bool writeAll (int connection, const char* data, size_t size)
{
    size_t sent = 0;
    while (sent < size)
    {
        const auto wrote = ::send (connection, data + sent, size - sent, 0);
        if (wrote <= 0)
            return false;
        sent += (size_t) wrote;
    }
    return true;
}

bool writeAll (int connection, const std::string& text)
{
    return writeAll (connection, text.data(), text.size());
}

void respond (int connection, const char* status, const std::string& type, const std::string& body)
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

/** A path that cannot climb out of the directory it is served from. */
bool safePath (const std::string& path)
{
    if (path.find ("..") != std::string::npos) return false;
    if (path.find ('\\') != std::string::npos) return false;
    return true;
}

std::string readFile (const std::string& path, bool& found)
{
    struct ::stat info {};
    if (::stat (path.c_str(), &info) != 0 || (info.st_mode & S_IFDIR) != 0)
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

bool postTo (const std::string& host, int port, const std::string& path,
             const std::string& body, int timeoutMs)
{
    const int handle = ::socket (AF_INET, SOCK_STREAM, 0);
    if (handle < 0)
        return false;

    timeval timeout {};
    timeout.tv_sec = timeoutMs / 1000;
    timeout.tv_usec = (timeoutMs % 1000) * 1000;
    ::setsockopt (handle, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof (timeout));
    ::setsockopt (handle, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof (timeout));
    int on = 1;
    ::setsockopt (handle, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof (on));

    sockaddr_in to {};
    to.sin_family = AF_INET;
    to.sin_port = htons ((uint16_t) port);
    to.sin_addr.s_addr = ::inet_addr (host.c_str());

    if (::connect (handle, (sockaddr*) &to, sizeof (to)) < 0)
    {
        ::close (handle);
        return false;
    }

    std::ostringstream request;
    request << "POST " << path << " HTTP/1.1\r\n"
            << "Host: " << host << "\r\n"
            << "Content-Type: application/json\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "Connection: close\r\n\r\n" << body;

    const auto text = request.str();
    const bool sent = writeAll (handle, text);

    // The answer is read and thrown away, so the peer is not left writing into
    // a socket nobody is reading.
    char discard[512];
    if (sent)
        ::recv (handle, discard, sizeof (discard), 0);

    ::close (handle);
    return sent;
}

Endpoint::~Endpoint() { stop(); }

bool Endpoint::start (Options options)
{
    stop();
    settings = std::move (options);
    lastError.clear();

    listener = ::socket (AF_INET, SOCK_STREAM, 0);
    if (listener < 0)
    {
        lastError = "no socket: " + std::string (std::strerror (errno));
        return false;
    }

    int on = 1;
    ::setsockopt (listener, SOL_SOCKET, SO_REUSEADDR, &on, sizeof (on));
    ::setsockopt (listener, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof (on));

    sockaddr_in address {};
    address.sin_family = AF_INET;
    // Loopback unless asked otherwise: a port on the network is something to
    // opt into, not something that happens because the feature was compiled in.
    address.sin_addr.s_addr = htonl (settings.onNetwork ? INADDR_ANY : INADDR_LOOPBACK);
    address.sin_port = htons ((uint16_t) settings.port);

    if (::bind (listener, (sockaddr*) &address, sizeof (address)) < 0)
    {
        lastError = "could not bind port " + std::to_string (settings.port) + ": "
                  + std::string (std::strerror (errno));
        ::close (listener);
        listener = -1;
        return false;
    }

    if (::listen (listener, 32) < 0)
    {
        lastError = "could not listen: " + std::string (std::strerror (errno));
        ::close (listener);
        listener = -1;
        return false;
    }

    sockaddr_in actual {};
    socklen_t length = sizeof (actual);
    ::getsockname (listener, (sockaddr*) &actual, &length);
    boundPort = ntohs (actual.sin_port);

    running = true;
    accepter = std::thread ([this] { acceptLoop(); });
    return true;
}

void Endpoint::stop()
{
    running = false;

    if (listener >= 0)
    {
        ::shutdown (listener, SHUT_RDWR);
        ::close (listener);
        listener = -1;
    }

    {
        // Closing the streams is what ends the threads parked on them.
        const std::lock_guard<std::mutex> guard (lock);
        for (const int stream : streams)
        {
            ::shutdown (stream, SHUT_RDWR);
            ::close (stream);
        }
        streams.clear();
    }

    if (accepter.joinable())
        accepter.join();

    for (auto& worker : workers)
        if (worker.joinable())
            worker.join();
    workers.clear();
}

void Endpoint::acceptLoop()
{
    while (running)
    {
        pollfd waiting {};
        waiting.fd = listener;
        waiting.events = POLLIN;

        if (::poll (&waiting, 1, 200) <= 0)
            continue;
        if (! running)
            break;

        const int connection = ::accept (listener, nullptr, nullptr);
        if (connection < 0)
            continue;

        int on = 1;
        ::setsockopt (connection, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof (on));
        ::setsockopt (connection, IPPROTO_TCP, TCP_NODELAY, &on, sizeof (on));

        const std::lock_guard<std::mutex> guard (lock);
        // Finished threads are joined here rather than detached, so stop() can
        // be sure nothing is still running when it returns.
        workers.erase (std::remove_if (workers.begin(), workers.end(),
                                       [] (std::thread& t)
                                       {
                                           if (! t.joinable()) return true;
                                           return false;
                                       }),
                       workers.end());
        workers.emplace_back ([this, connection] { serve (connection); });
    }
}

void Endpoint::serve (int connection)
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

        const auto got = ::recv (connection, buffer, sizeof (buffer), 0);
        if (got <= 0)
            break;
        request.append (buffer, (size_t) got);
    }

    if (headerEnd == std::string::npos)
        headerEnd = request.find ("\r\n\r\n");

    if (headerEnd == std::string::npos)
    {
        ::close (connection);
        return;
    }

    const auto firstLine = request.substr (0, request.find ("\r\n"));
    std::istringstream line (firstLine);
    std::string method, target;
    line >> method >> target;

    const auto query = target.find ('?');
    const auto path = query == std::string::npos ? target : target.substr (0, query);

    if (method == "OPTIONS")
    {
        respond (connection, "204 No Content", "text/plain", "");
        ::close (connection);
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
            ::close (connection);
            return;
        }

        std::string body = request.substr (headerEnd + 4);
        while (running && body.size() < length)
        {
            const auto got = ::recv (connection, buffer, sizeof (buffer), 0);
            if (got <= 0)
                break;
            body.append (buffer, (size_t) got);
        }

        if (onOps)
            onOps (body);

        respond (connection, "200 OK", "application/json", "{\"ok\":true}");
        ::close (connection);
        return;
    }

    if (method != "GET" && method != "HEAD")
    {
        respond (connection, "405 Method Not Allowed", "text/plain", "no");
        ::close (connection);
        return;
    }

    if (path == "/doc")
    {
        respond (connection, "200 OK", "application/json", docJson ? docJson() : "[]");
        ::close (connection);
        return;
    }

    if (path == "/peers")
    {
        respond (connection, "200 OK", "application/json", peersJson ? peersJson() : "[]");
        ::close (connection);
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
            ::close (connection);
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
        ::close (connection);
        return;
    }

    const auto relative = (path == "/" || path.empty()) ? std::string ("/index.html") : path;
    bool found = false;
    const auto body = readFile (settings.files + relative, found);

    if (! found)
        respond (connection, "404 Not Found", "text/plain", "no");
    else
        respond (connection, "200 OK", mimeFor (relative), body);

    ::close (connection);
}

void Endpoint::holdStream (int connection)
{
    // The stream is written to from broadcast(); this thread only waits for the
    // other end to go away. A comment every fifteen seconds keeps anything in
    // between from deciding the connection is idle.
    char discard[256];
    uint64_t nextPing = 0;

    while (running)
    {
        pollfd waiting {};
        waiting.fd = connection;
        waiting.events = POLLIN;

        const int ready = ::poll (&waiting, 1, 250);
        if (ready > 0)
        {
            const auto got = ::recv (connection, discard, sizeof (discard), 0);
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
    ::close (connection);
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
    std::vector<int> alive;
    alive.reserve (streams.size());

    for (const int stream : streams)
    {
        if (writeAll (stream, frame))
            alive.push_back (stream);
        else
            ::shutdown (stream, SHUT_RDWR);   // its thread will notice and tidy up
    }

    streams = alive;
}

int Endpoint::listeners() const
{
    const std::lock_guard<std::mutex> guard (lock);
    return (int) streams.size();
}

} // namespace jamin
