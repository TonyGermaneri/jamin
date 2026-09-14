# The core, tested without a host. No JUCE here either -- these run in a second
# and are the first thing to look at when a chord lands on the wrong beat.
add_executable(jamin-tests
    SequenceTest.cpp
    SongBusTest.cpp
    DiscoveryTest.cpp
    EndpointTest.cpp
    NodeTest.cpp
    main.cpp)

target_link_libraries(jamin-tests PRIVATE jamin_core)
target_include_directories(jamin-tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
set_target_properties(jamin-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

add_test(NAME jamin-tests COMMAND jamin-tests)

# The page, running in the editor's own web view. This is the test that would
# catch a Vite change that breaks module loading over a custom scheme, which no
# amount of testing in Chrome ever would.
# The compiler, against the bundle the plugin will actually load.
if(APPLE AND TARGET jamin-compile AND TARGET JaminInstrument_AU)
    add_test(NAME jamin-compile
             COMMAND jamin-compile
                     "$<TARGET_BUNDLE_CONTENT_DIR:JaminInstrument_AU>/Resources/web/jamin-compile.js")
    set_tests_properties(jamin-compile PROPERTIES TIMEOUT 60)
endif()

if(APPLE AND TARGET jamin-boot AND TARGET JaminInstrument_AU)
    add_test(NAME jamin-boot
             COMMAND jamin-boot
                     "$<TARGET_BUNDLE_CONTENT_DIR:JaminInstrument_AU>/Resources/web")
    set_tests_properties(jamin-boot PROPERTIES TIMEOUT 60)

    # And the bridge: a stand-in for window.__JUCE__, a playhead driven past it,
    # and the chart checked for having followed. The page half of phase 1, which
    # no C++ compiler can check.
    # Two sizes, because the editor is whatever shape the DAW leaves room for:
    # one that stacks the book columns and one that puts them side by side. The
    # assertions are the same either way -- the books fit, and the pagination is
    # on screen rather than below the fold.
    foreach(_size 720x480 820x520 1180x760)
        add_test(NAME jamin-host-${_size}
                 COMMAND jamin-boot
                         "$<TARGET_BUNDLE_CONTENT_DIR:JaminInstrument_AU>/Resources/web"
                         --host --size ${_size})
        set_tests_properties(jamin-host-${_size} PROPERTIES TIMEOUT 90)
    endforeach()
endif()

# Opening the editor and throwing it away is what a host spends its time doing,
# and auval never does it at all -- it does not instantiate the view. This runs
# the full cycle, including a teardown while the page is still loading, which is
# the case with a dangling `this` in it if anything has one.
#
# It needs the plugin installed where the system can find it, so it is not part
# of the default run: `ctest -L installed` after copying the component in.
if(APPLE AND TARGET jamin-auhost)
    add_test(NAME jamin-auhost COMMAND jamin-auhost 4 --seconds 0.5)
    set_tests_properties(jamin-auhost PROPERTIES TIMEOUT 120 LABELS installed)

    # The case a DAW actually crashed on: a track jamin is playing that is also
    # being played from a keyboard. The editor is open, a compiled sequence is
    # performing, and MIDI arrives at the same time. The harness fails if the
    # plugin emits nothing, so a run that survives by doing nothing cannot pass.
    add_test(NAME jamin-auhost-midi COMMAND jamin-auhost 2 --midi 300 --seconds 6)
    set_tests_properties(jamin-auhost-midi PROPERTIES TIMEOUT 180 LABELS installed)
endif()

# The seal. Copying the page into a bundle that was already signed breaks its
# signature, and a hardened host then refuses to load it with "a sealed resource
# is missing or invalid" -- which sounds like a corrupt download and is really a
# build step in the wrong order. It cost an afternoon once; it gets a test.
if(APPLE)
    foreach(_sealed IN ITEMS
            JaminInstrument_VST3 JaminInstrument_AU JaminInstrument_Standalone JaminMidiFx_AU)
        if(TARGET ${_sealed})
            add_test(NAME codesign-${_sealed}
                     COMMAND codesign --verify --strict --verbose=2
                             "$<TARGET_BUNDLE_DIR:${_sealed}>")
        endif()
    endforeach()
endif()
