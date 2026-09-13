# The core, tested without a host. No JUCE here either -- these run in a second
# and are the first thing to look at when a chord lands on the wrong beat.
add_executable(jamin-tests
    SequenceTest.cpp
    SongBusTest.cpp
    main.cpp)

target_link_libraries(jamin-tests PRIVATE jamin_core)
target_include_directories(jamin-tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
set_target_properties(jamin-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

add_test(NAME jamin-tests COMMAND jamin-tests)

# The page, running in the editor's own web view. This is the test that would
# catch a Vite change that breaks module loading over a custom scheme, which no
# amount of testing in Chrome ever would.
if(APPLE AND TARGET jamin-boot AND TARGET JaminPlugin_AU)
    add_test(NAME jamin-boot
             COMMAND jamin-boot
                     "$<TARGET_BUNDLE_CONTENT_DIR:JaminPlugin_AU>/Resources/web")
    set_tests_properties(jamin-boot PROPERTIES TIMEOUT 60)
endif()
