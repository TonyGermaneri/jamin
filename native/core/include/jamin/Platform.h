#pragma once

#include <cstdint>

#if defined (_WIN32)
 #include <process.h>
#else
 #include <unistd.h>
#endif

namespace jamin
{

/**
    A socket, named without dragging a socket library into every header.

    Winsock's `SOCKET` is `UINT_PTR` -- unsigned, pointer-sized, and *not* a
    small integer -- while a POSIX descriptor is a small signed int. The two are
    not interchangeable, and the usual `if (handle >= 0)` is always true for the
    Windows one, so a port that only swapped `close` for `closesocket` would
    compile and then treat every failure as success.

    So the type is spelled out here, in a header with no platform includes in it
    at all: `Discovery` and `Endpoint` can hold one without `<winsock2.h>` being
    pulled into the plugin, where it would have to fight `<windows.h>` over which
    of them gets included first. The real socket calls live in Sockets.h, which
    only the sources that make them include.
*/
#if defined (_WIN32)
using SocketHandle = std::uintptr_t;      // Winsock's SOCKET, exactly
#else
using SocketHandle = int;
#endif

/** -1 either way: INVALID_SOCKET is `(SOCKET) ~0`, which is what this is. */
constexpr SocketHandle kNoSocket = (SocketHandle) -1;

/** The only correct test. @see SocketHandle for why `>= 0` is not. */
constexpr bool valid (SocketHandle handle) { return handle != kNoSocket; }

/** This process. Used to give a test run its own ports and its own segment, so
    two runs on one machine -- a developer and a CI agent, say -- do not collide. */
inline int processId()
{
   #if defined (_WIN32)
    return (int) ::_getpid();
   #else
    return (int) ::getpid();
   #endif
}

} // namespace jamin
