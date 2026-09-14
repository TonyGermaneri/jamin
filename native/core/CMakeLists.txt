# The port's own code, with no JUCE and no plugin API in it.
#
# Kept that way deliberately: it is what lets the sequence reader be tested
# without a host, and what would let the same code be reused if jamin ever grows
# a second front end.
# The chart, the timeline and the sequence reader are portable and are built
# everywhere. The networking and the shared segment are POSIX, and on a platform
# without them the same classes are compiled from honest stubs instead -- so a
# change that breaks the portable half is caught on every platform, rather than
# on the one that happens to run the sockets. @see src/Unsupported.cpp
if(UNIX)
    set(_platform src/SongBus.cpp src/Discovery.cpp src/Endpoint.cpp)
else()
    set(_platform src/SongBusUnsupported.cpp src/Unsupported.cpp)
endif()

add_library(jamin_core STATIC
    src/Sequence.cpp
    src/Node.cpp
    ${_platform})

target_include_directories(jamin_core PUBLIC include)
target_compile_features(jamin_core PUBLIC cxx_std_20)
