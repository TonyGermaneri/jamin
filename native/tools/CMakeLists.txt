# jamin-boot: proves the built page runs in the same web view the editor uses.
# macOS only -- it is WKWebView it is asking about.
if(APPLE)
    add_executable(jamin-boot boot_probe.m)
    set_target_properties(jamin-boot PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
    target_compile_options(jamin-boot PRIVATE -fobjc-arc)
    target_link_libraries(jamin-boot PRIVATE "-framework Cocoa" "-framework WebKit")
endif()

# jamin-compile: the plugin's compiler, without a plugin. Needs juce_core for
# String/File/JSON and QuickJS for the engine itself -- but nothing of the
# plugin API, so it builds and runs in a second.
if(APPLE)
    add_executable(jamin-compile
        compile_check.cpp
        ../plugin/Compiler.cpp)
    set_target_properties(jamin-compile PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
    target_link_libraries(jamin-compile PRIVATE
        jamin_core
        juce::juce_core
        juce::juce_recommended_config_flags)

    target_link_libraries(jamin-compile PRIVATE qjs)
    target_compile_definitions(jamin-compile PRIVATE
        JUCE_STANDALONE_APPLICATION=1 JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
endif()

# jamin-auhost: what a host does, without a host. auval never instantiates the
# editor, so it cannot see a crash that only happens once the web view has been
# created and thrown away.
if(APPLE)
    add_executable(jamin-auhost au_host.m)
    set_target_properties(jamin-auhost PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
    target_compile_options(jamin-auhost PRIVATE -fobjc-arc)
    target_link_libraries(jamin-auhost PRIVATE
        "-framework Cocoa" "-framework AudioToolbox" "-framework AudioUnit")
endif()

# jamin-vst3: the module, opened the way a scanner opens it. Uses the VST3
# interface headers JUCE already fetched -- headers only, no SDK sources, so
# there is nothing extra to build or license.
if(APPLE AND JAMIN_BUILD_PLUGIN)
    set(_vst3_headers
        "${juce_SOURCE_DIR}/modules/juce_audio_processors_headless/format_types/VST3_SDK")
    if(EXISTS "${_vst3_headers}/pluginterfaces/vst/ivstcomponent.h")
        add_executable(jamin-vst3 vst3_check.cpp)
        set_target_properties(jamin-vst3 PROPERTIES
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
        target_include_directories(jamin-vst3 PRIVATE "${_vst3_headers}")
        target_link_libraries(jamin-vst3 PRIVATE "-framework CoreFoundation")
    else()
        message(STATUS "  (no VST3 headers found; skipping jamin-vst3)")
    endif()
endif()

# jamin-multicast: does discovery work on this network, and does anything ask
# permission first? It is the first thing to run when peers cannot see each
# other, because it answers that question without jamin in the way.
if(APPLE)
    add_executable(jamin-multicast multicast_probe.c)
    set_target_properties(jamin-multicast PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
endif()

# jamin-node: the plugin's networking with the plugin taken away. What to run
# when something is not syncing and the question is whether the network or the
# plugin is at fault -- and useful on its own, since a machine with no DAW can
# hold the chart for everybody else.
add_executable(jamin-node node_main.cpp)
set_target_properties(jamin-node PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
target_link_libraries(jamin-node PRIVATE jamin_core)
