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
# WaveContour makes jamin, as it makes Waveshape. The company name is what a host
# lists the plugin under and the manufacturer code is what it groups by, so both
# have to match Waveshape's exactly or the two appear as unrelated products by
# unrelated people.
#
# The four-character codes are the part that cannot be revised later: a host
# remembers a plugin by its manufacturer and plugin codes and not by any of the
# names, so changing them after a release orphans every saved session that used
# the old pair. AU additionally requires at least one capital in the manufacturer
# code, which is why WvCt is mixed case rather than the lowercase it would
# otherwise be.
#
# The plugin codes are what keep the products apart under that shared
# manufacturer. Waveshape holds Wvs1; jamin holds Jam1 and JamF.
# Not cache variables, deliberately. A plugin's identity is a property of the
# product rather than a per-build option, and a cached one goes stale: editing
# the values here and rebuilding an existing tree would keep the old identity
# without saying so, which ships a plugin under the wrong name and orphans every
# session that loaded it. Any entry left by an earlier arrangement is cleared so
# that this file is the only answer.
foreach(_stale IN ITEMS JAMIN_COMPANY JAMIN_PRODUCT JAMIN_BUNDLE_ID
                        JAMIN_MANUFACTURER JAMIN_PLUGIN_CODE JAMIN_MIDIFX_CODE)
    unset(${_stale} CACHE)
endforeach()

set(JAMIN_COMPANY      "WaveContour")   # what a host lists it under
set(JAMIN_PRODUCT      "Jamin")
set(JAMIN_BUNDLE_ID    "dev.Jamin")
set(JAMIN_MANUFACTURER "WvCt")          # what a host groups it by -- Waveshape's
set(JAMIN_PLUGIN_CODE  "Jam1")          # the instrument
set(JAMIN_MIDIFX_CODE  "JamF")          # the MIDI effect

# A shared manufacturer code makes the plugin codes the whole of the identity, so
# a collision between them is two plugins claiming to be the same one -- and the
# host resolves that silently, by loading whichever it saw first.
foreach(_code IN ITEMS JAMIN_MANUFACTURER JAMIN_PLUGIN_CODE JAMIN_MIDIFX_CODE)
    string(LENGTH "${${_code}}" _length)
    if(NOT _length EQUAL 4)
        message(FATAL_ERROR "${_code} must be exactly four characters, not \"${${_code}}\"")
    endif()
endforeach()

if(JAMIN_PLUGIN_CODE STREQUAL JAMIN_MIDIFX_CODE)
    message(FATAL_ERROR
        "The instrument and the MIDI effect share the plugin code "
        "\"${JAMIN_PLUGIN_CODE}\". Under one manufacturer that makes them the same plugin.")
endif()

# The codes already taken under WvCt, read off `auval -a` on the machine that
# makes them. Not variables: they are facts about other repositories, and a
# variable would invite somebody to set one. Two plugins sharing a manufacturer
# and a plugin code are the same plugin as far as a host is concerned, and it
# resolves that silently by loading whichever it happened to see first -- so
# this is worth failing a configure over rather than finding in a session.
# Parallel lists rather than pairs: a CMake list is flat, so "Wvs1;Waveshape"
# is two entries and not one.
set(_taken_codes  Wvs1      PrPl             Wvr1)
set(_taken_owners Waveshape "Prophet Panel"  Waveroll)

list(LENGTH _taken_codes _count)
math(EXPR _last "${_count} - 1")
foreach(_i RANGE ${_last})
    list(GET _taken_codes  ${_i} _code)
    list(GET _taken_owners ${_i} _owner)
    if(JAMIN_PLUGIN_CODE STREQUAL _code OR JAMIN_MIDIFX_CODE STREQUAL _code)
        message(FATAL_ERROR "${_code} is already ${_owner}'s, under this same manufacturer.")
    endif()
endforeach()

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
