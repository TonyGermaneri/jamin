# The port's own code, with no JUCE and no plugin API in it.
#
# Kept that way deliberately: it is what lets the sequence reader be tested
# without a host, and what would let the same code be reused if jamin ever grows
# a second front end.
#
# All of it builds everywhere. The networking and the shared segment used to be
# POSIX-only, with honest stubs standing in on Windows that refused out loud --
# which meant a Windows jamin could play a chart but never share one. The four
# calls that actually differ now live behind Sockets.h and two `#if`s in
# SongBus.cpp, and the sources above them read as one program.
add_library(jamin_core STATIC
    src/Sequence.cpp
    src/Node.cpp
    src/Roster.cpp
    src/SongBus.cpp
    src/Discovery.cpp
    src/Endpoint.cpp)

target_include_directories(jamin_core PUBLIC include)
target_compile_features(jamin_core PUBLIC cxx_std_20)

if(WIN32)
    # Winsock itself, and nothing else. The macros it needs -- _WIN32_WINNT,
    # WIN32_LEAN_AND_MEAN, NOMINMAX -- are set by Sockets.h, conditionally, so
    # that a translation unit which has already chosen (JUCE picks its own
    # _WIN32_WINNT) is not contradicted from the command line, where a
    # definition cannot be made conditional.
    target_link_libraries(jamin_core PUBLIC ws2_32)
endif()
