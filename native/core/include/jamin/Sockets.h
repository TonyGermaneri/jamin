#pragma once

/*
    One socket API, spelled two ways.

    Discovery and the endpoint are ordinary BSD sockets, and Winsock is the same
    API with a handful of deliberate differences -- the ones that are easy to
    miss because the code still compiles without them:

      * `SOCKET` is unsigned, so `if (handle >= 0)` always passes. @see Platform.h
      * `WSAStartup` must run before anything else, or every call fails with
        WSANOTINITIALISED and nothing says why.
      * `SO_RCVTIMEO` takes a DWORD of milliseconds, not a `timeval`. Handing it
        a `timeval` is accepted and gives a timeout of whatever its first four
        bytes happened to mean -- usually seconds read as milliseconds.
      * `IP_MULTICAST_TTL` and `IP_MULTICAST_LOOP` take a DWORD, not the one
        byte POSIX takes; the one-byte version fails with WSAEFAULT.
      * `SO_REUSEPORT` does not exist. Windows `SO_REUSEADDR` already means what
        BSD `SO_REUSEPORT` means -- several sockets may bind one address -- which
        is exactly what several jamins on one machine need.
      * `send`/`recv` take `char*` and an `int` length and return `int`.
      * There is no SIGPIPE, so nothing to suppress; on Linux there is, and it is
        suppressed per-call rather than per-socket as on macOS.
      * `errno` says nothing; the error is `WSAGetLastError()`.

    Every one of those lives behind a function here, so the two sources read as
    one program rather than as a program with a Windows branch through it.

    @see docs/network.md
*/

// Set here rather than on the compiler's command line, and only if nobody has
// already chosen -- a command-line definition cannot be conditional, and JUCE
// picks its own _WIN32_WINNT. Two different values is a redefinition warning at
// best and two headers disagreeing about what exists at worst.
#if defined (_WIN32)
 #ifndef _WIN32_WINNT
  #define _WIN32_WINNT 0x0601        // Windows 7, which is where WSAPoll starts
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN        // or <windows.h> pulls in the original
 #endif                              // <winsock.h>, which collides with v2
 #ifndef NOMINMAX
  #define NOMINMAX                   // or the min/max macros eat std::min
 #endif
#endif

#include "Platform.h"

#include <string>

#if defined (_WIN32)
 // In this order, always: <winsock2.h> must come before <windows.h>, or the
 // ancient <winsock.h> gets included by it first and the two collide.
 #include <winsock2.h>
 #include <ws2tcpip.h>
 #include <windows.h>
 #include <mutex>
#else
 #include <arpa/inet.h>
 #include <cerrno>
 #include <cstring>
 #include <netinet/in.h>
 #include <netinet/tcp.h>
 #include <poll.h>
 #include <sys/socket.h>
 #include <unistd.h>
#endif

namespace jamin
{

#if defined (_WIN32)
static_assert (sizeof (SocketHandle) == sizeof (SOCKET),
               "SocketHandle must be Winsock's SOCKET");
static_assert (kNoSocket == (SocketHandle) INVALID_SOCKET,
               "kNoSocket must be INVALID_SOCKET");
#endif

/**
    Make sockets usable in this process. Cheap, idempotent, safe from any thread.

    Called at the top of everything that opens a socket rather than once at
    startup, because there is no startup here to speak of: the plugin is a
    library loaded by somebody else's program, and a node may be created before
    any code of ours has run.

    `WSACleanup` is deliberately never called. It is refcounted per process, so
    ours would only undo ours -- but a plugin can be unloaded and reloaded while
    the host keeps its own sockets open, and the failure mode of getting that
    wrong is a DAW whose network stack stops working. One refcount held for the
    life of the process costs nothing.
*/
inline void startSockets()
{
   #if defined (_WIN32)
    static std::once_flag once;
    std::call_once (once, []
    {
        WSADATA data {};
        ::WSAStartup (MAKEWORD (2, 2), &data);
    });
   #endif
}

/** What just went wrong, as something a person can read. */
inline std::string socketErrorText()
{
   #if defined (_WIN32)
    const DWORD code = (DWORD) ::WSAGetLastError();
    char* text = nullptr;
    const auto length = ::FormatMessageA (FORMAT_MESSAGE_ALLOCATE_BUFFER
                                            | FORMAT_MESSAGE_FROM_SYSTEM
                                            | FORMAT_MESSAGE_IGNORE_INSERTS,
                                          nullptr, code, 0, (char*) &text, 0, nullptr);
    std::string message = length > 0 && text != nullptr ? std::string (text, length)
                                                        : std::string ("error ") + std::to_string (code);
    if (text != nullptr)
        ::LocalFree (text);

    while (! message.empty() && (message.back() == '\n' || message.back() == '\r' || message.back() == '.'))
        message.pop_back();

    return message + " (" + std::to_string (code) + ")";
   #else
    return std::strerror (errno);
   #endif
}

inline void closeSocket (SocketHandle& handle)
{
    if (! valid (handle))
        return;

   #if defined (_WIN32)
    ::closesocket ((SOCKET) handle);
   #else
    ::close (handle);
   #endif

    handle = kNoSocket;
}

/** Both directions. Failure is ignored: this is only ever used to hurry along a
    socket that is about to be closed anyway. */
inline void shutdownSocket (SocketHandle handle)
{
    if (! valid (handle))
        return;

   #if defined (_WIN32)
    ::shutdown ((SOCKET) handle, SD_BOTH);
   #else
    ::shutdown (handle, SHUT_RDWR);
   #endif
}

/** `poll`, or `WSAPoll`, which is the same function under a different name.
    `struct pollfd` and `POLLIN` are spelled the same on both. */
inline int pollSockets (pollfd* waiting, unsigned int count, int timeoutMs)
{
   #if defined (_WIN32)
    return ::WSAPoll (waiting, count, timeoutMs);
   #else
    return ::poll (waiting, count, timeoutMs);
   #endif
}

/** The handle as the platform's own socket calls want it. Every raw call below
    -- bind, listen, accept, connect, getsockname -- goes through this. */
#if defined (_WIN32)
inline SOCKET nativeSocket (SocketHandle handle) { return (SOCKET) handle; }
#else
inline int nativeSocket (SocketHandle handle) { return handle; }
#endif

/** A socket, or kNoSocket. Winsock is started first, so the first call in a
    process cannot fail for want of it. */
inline SocketHandle openSocket (int type)
{
    startSockets();
    const auto handle = ::socket (AF_INET, type, 0);

   #if defined (_WIN32)
    return handle == INVALID_SOCKET ? kNoSocket : (SocketHandle) handle;
   #else
    return handle < 0 ? kNoSocket : (SocketHandle) handle;
   #endif
}

/** setsockopt, with the cast Winsock wants and POSIX does not mind. */
template <typename Value>
inline bool setOption (SocketHandle handle, int level, int name, const Value& value)
{
    return ::setsockopt (nativeSocket (handle), level, name,
                         (const char*) &value, (socklen_t) sizeof (value)) == 0;
}

/** A socket that cannot block for longer than this, in either direction.

    Not a nicety: it is what bounds shutdown. A thread parked in `recv` on a
    client that connected and then said nothing would otherwise keep the whole
    node alive for as long as that client cared to hold the line. */
inline void setTimeouts (SocketHandle handle, int milliseconds)
{
   #if defined (_WIN32)
    const DWORD timeout = (DWORD) milliseconds;
   #else
    timeval timeout {};
    timeout.tv_sec = milliseconds / 1000;
    timeout.tv_usec = (milliseconds % 1000) * 1000;
   #endif

    setOption (handle, SOL_SOCKET, SO_RCVTIMEO, timeout);
    setOption (handle, SOL_SOCKET, SO_SNDTIMEO, timeout);
}

/** Several jamins on one machine must all be able to bind the discovery port.
    On BSD that is SO_REUSEPORT; on Windows SO_REUSEADDR already means it. */
inline void allowSharedBind (SocketHandle handle)
{
    const int on = 1;
    setOption (handle, SOL_SOCKET, SO_REUSEADDR, on);
   #if defined (SO_REUSEPORT)
    setOption (handle, SOL_SOCKET, SO_REUSEPORT, on);
   #endif
}

/**
    A listener that can rebind its port after the last one closed -- and that
    nobody else can take away.

    This is the one option that must *not* be the same on both. BSD
    `SO_REUSEADDR` on a listening socket means "ignore TIME_WAIT from the
    connection that just closed", which is what is wanted. Windows
    `SO_REUSEADDR` means something else entirely: it lets an unrelated process
    bind a port this one is already listening on and quietly take the traffic.
    `SO_EXCLUSIVEADDRUSE` is the Windows spelling of the intent -- and Windows
    has no TIME_WAIT bind problem to work around in the first place.
*/
inline void allowRebind (SocketHandle handle)
{
   #if defined (_WIN32)
    const int on = 1;
    setOption (handle, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, on);
   #else
    const int on = 1;
    setOption (handle, SOL_SOCKET, SO_REUSEADDR, on);
   #endif
}

/** A connection, or kNoSocket. */
inline SocketHandle acceptOn (SocketHandle listener)
{
    const auto connection = ::accept (nativeSocket (listener), nullptr, nullptr);

   #if defined (_WIN32)
    return connection == INVALID_SOCKET ? kNoSocket : (SocketHandle) connection;
   #else
    return connection < 0 ? kNoSocket : (SocketHandle) connection;
   #endif
}

inline void setMulticastLoop (SocketHandle handle, bool on)
{
   #if defined (_WIN32)
    const DWORD value = on ? 1u : 0u;
   #else
    const unsigned char value = on ? 1 : 0;
   #endif
    setOption (handle, IPPROTO_IP, IP_MULTICAST_LOOP, value);
}

inline void setMulticastTtl (SocketHandle handle, int hops)
{
   #if defined (_WIN32)
    const DWORD value = (DWORD) hops;
   #else
    const unsigned char value = (unsigned char) hops;
   #endif
    setOption (handle, IPPROTO_IP, IP_MULTICAST_TTL, value);
}

/**
    Nothing must take this process down because a peer hung up mid-write.

    macOS does it per socket, Linux per call, Windows not at all -- a closed
    socket is simply an error return there, which is what the other two are being
    made to do.
*/
inline void suppressSigPipe ([[maybe_unused]] SocketHandle handle)
{
   #if defined (SO_NOSIGPIPE)
    const int on = 1;
    setOption (handle, SOL_SOCKET, SO_NOSIGPIPE, on);
   #endif
}

constexpr int kSendFlags =
   #if defined (MSG_NOSIGNAL)
    MSG_NOSIGNAL;      // Linux
   #else
    0;                 // macOS uses SO_NOSIGPIPE above; Windows has no signal
   #endif

/** `inet_pton` rather than `inet_addr`, which reports failure as 255.255.255.255
    -- a real address, and a broadcast one at that.

    It lives in ws2_32 on Windows, so Winsock is brought up first even though
    parsing four numbers has no business needing it: this is called before the
    socket is opened, and a library that has not been initialised is entitled to
    refuse. */
inline bool parseIPv4 (const std::string& text, in_addr& out)
{
    startSockets();
    return ::inet_pton (AF_INET, text.c_str(), &out) == 1;
}

inline std::string addressText (const in_addr& address)
{
    char text[INET_ADDRSTRLEN] {};
    ::inet_ntop (AF_INET, (const void*) &address, text, sizeof (text));
    return text;
}

/* The three calls whose signatures differ, wrapped so the sources do not carry
   a cast each time they read or write a byte. `long long` holds both an `int`
   and a `ssize_t`. */

#if defined (_WIN32)
using ByteCount = int;              // what Winsock takes and returns
#else
using ByteCount = size_t;
#endif

inline long long sendBytes (SocketHandle handle, const char* data, size_t size)
{
    return ::send (nativeSocket (handle), data, (ByteCount) size, kSendFlags);
}

inline long long recvBytes (SocketHandle handle, char* data, size_t size)
{
    return ::recv (nativeSocket (handle), data, (ByteCount) size, 0);
}

inline long long sendTo (SocketHandle handle, const char* data, size_t size,
                         const sockaddr_in& to)
{
    return ::sendto (nativeSocket (handle), data, (ByteCount) size, 0,
                     (const sockaddr*) &to, (socklen_t) sizeof (to));
}

inline long long recvFrom (SocketHandle handle, char* data, size_t size, sockaddr_in& from)
{
    socklen_t length = (socklen_t) sizeof (from);
    return ::recvfrom (nativeSocket (handle), data, (ByteCount) size, 0,
                       (sockaddr*) &from, &length);
}

} // namespace jamin
