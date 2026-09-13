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
# String/File/JSON and JavaScriptCore for the engine itself -- but nothing of the
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
        juce::juce_recommended_config_flags
        "-framework JavaScriptCore")
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
