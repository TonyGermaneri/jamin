# jamin -- native build.
#
# The AU (and a Standalone for development) around the web app in ../src. The web
# app is not disturbed by any of this, and the two share the one thing that
# matters: the built page itself, which is read from ../dist rather than
# reimplemented. See cmake/WebAssets.cmake.
#
#   cmake -B build -G Ninja -S . -DCMAKE_OSX_ARCHITECTURES=arm64
#   cmake --build build
#   ctest --test-dir build --output-on-failure

cmake_minimum_required(VERSION 3.22)

# Set before project(), and once rather than per-invocation. 11.0 is the oldest
# macOS with a WKWebView that reports a secure context for a custom URL scheme,
# which is what localStorage and IndexedDB in the page depend on.
if(APPLE AND NOT DEFINED CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET 11.0 CACHE STRING "Minimum macOS version")
endif()

project(JaminNative VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "" FORCE)
endif()

option(JAMIN_BUILD_PLUGIN "Build the AU and Standalone targets" ON)
option(JAMIN_BUILD_TESTS  "Build the unit tests" ON)
option(JAMIN_BUILD_TOOLS  "Build jamin-boot, the page self-test" ON)
option(JAMIN_SANITIZE     "Build with ASan and UBSan" OFF)

# ---------------------------------------------------------------------------- identity
#
# The four-character codes are the part that cannot be revised later: a host
# remembers a plugin by its manufacturer and plugin codes and not by any of the
# names, so changing them after a release orphans every saved session that used
# the old pair. AU additionally requires at least one capital in the manufacturer
# code. These are placeholders and want deciding before anything ships.
set(JAMIN_COMPANY      "Jamin"       CACHE STRING "Company name shown by hosts")
set(JAMIN_PRODUCT      "Jamin"       CACHE STRING "Product name shown by hosts")
set(JAMIN_BUNDLE_ID    "dev.jamin"   CACHE STRING "Reverse-DNS bundle id prefix")
set(JAMIN_MANUFACTURER "Jmin"        CACHE STRING "Four-character manufacturer code")
set(JAMIN_PLUGIN_CODE  "Jam1"        CACHE STRING "Four-character code: the instrument")
set(JAMIN_MIDIFX_CODE  "JamF"        CACHE STRING "Four-character code: the MIDI effect")

# ---------------------------------------------------------------------------- the web app
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(WebAssets)

# ---------------------------------------------------------------------------- JUCE
#
# Pinned to 8.x rather than 9.x deliberately. WebBrowserComponent's native
# integration -- withResourceProvider, withNativeFunction, emitEvent -- arrived
# in JUCE 8 and is the whole basis of the design; 9.x is still settling and a
# plugin host matrix is not the place to find out what moved.
if(JAMIN_BUILD_PLUGIN)
    set(JAMIN_JUCE_TAG "8.0.15" CACHE STRING "JUCE release tag")
    include(FetchContent)
    FetchContent_Declare(JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG        "${JAMIN_JUCE_TAG}"
        GIT_SHALLOW    TRUE
        GIT_PROGRESS   TRUE)
    FetchContent_MakeAvailable(JUCE)
endif()

if(JAMIN_SANITIZE)
    add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address,undefined)
endif()

add_subdirectory(core)

if(JAMIN_BUILD_TOOLS)
    add_subdirectory(tools)
endif()

if(JAMIN_BUILD_PLUGIN)
    add_subdirectory(plugin)
endif()

if(JAMIN_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

message(STATUS "")
message(STATUS "  jamin ${PROJECT_VERSION}")
message(STATUS "  web   ${JAMIN_WEB_DIST}")
if(JAMIN_BUILD_PLUGIN)
    message(STATUS "  juce  ${JAMIN_JUCE_TAG}")
endif()
message(STATUS "")
