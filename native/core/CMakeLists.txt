# The port's own code, with no JUCE and no plugin API in it.
#
# Kept that way deliberately: it is what lets the sequence reader be tested
# without a host, and what would let the same code be reused if jamin ever grows
# a second front end.
add_library(jamin_core STATIC
    src/Sequence.cpp
    src/SongBus.cpp
    src/Discovery.cpp)

target_include_directories(jamin_core PUBLIC include)
target_compile_features(jamin_core PUBLIC cxx_std_20)
