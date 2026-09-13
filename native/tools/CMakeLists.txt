# jamin-boot: proves the built page runs in the same web view the editor uses.
# macOS only -- it is WKWebView it is asking about.
if(APPLE)
    add_executable(jamin-boot boot_probe.m)
    set_target_properties(jamin-boot PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
    target_compile_options(jamin-boot PRIVATE -fobjc-arc)
    target_link_libraries(jamin-boot PRIVATE "-framework Cocoa" "-framework WebKit")
endif()
