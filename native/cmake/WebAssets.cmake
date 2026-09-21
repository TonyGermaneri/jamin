# The built page, copied into the plugin bundle rather than reimplemented.
#
# The one rule here is the same one waveshape applies to its shaders: what the
# plugin shows is read from the web build's own output and never copied into
# this tree by hand. There is one jamin, and the plugin is a way of hosting it.
#
# The page is served to WKWebView from the bundle's Resources through JUCE's
# ResourceProvider, which means a juce:// origin. That origin is a secure
# context, so localStorage, IndexedDB and WebGL all work -- measured, see
# ../../docs/plugin.md.

set(JAMIN_WEB_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." CACHE PATH "The web app's repository root")
set(JAMIN_WEB_DIST "${JAMIN_WEB_ROOT}/dist" CACHE PATH "Vite's build output")

# Fonts: @mdi/font ships eot, ttf, woff and woff2, and Vite emits all four
# because the stylesheet names them. A @font-face src list is tried in order and
# woff2 is first, so WKWebView never asks for the other three -- they are 3.2 MB
# of bundle for a browser that will not request them.
set(JAMIN_WEB_EXCLUDE "\\.(eot|ttf|woff)$" CACHE STRING "Files not worth shipping")

find_program(JAMIN_NPM npm HINTS "$ENV{HOME}/.local/bin" /opt/homebrew/bin /usr/local/bin)

# Adding files to a bundle breaks its code signature, and a broken signature is
# not a warning -- a hardened host refuses to load the plugin and reports "a
# sealed resource is missing or invalid", which reads like a corrupt download
# rather than a build step in the wrong order. So the bundle is re-sealed after
# the page goes in. Ad-hoc by default; set this to a Developer ID to sign for
# real.
set(JAMIN_CODESIGN_IDENTITY "-" CACHE STRING "codesign identity, or - for ad-hoc")

# `cmake --build build --target web` rebuilds the page. Not automatic: the plugin
# build should not silently depend on a Node toolchain being present.
if(JAMIN_NPM)
    add_custom_target(web
        COMMAND "${JAMIN_NPM}" run build
        WORKING_DIRECTORY "${JAMIN_WEB_ROOT}"
        COMMENT "Building the web app with Vite"
        USES_TERMINAL VERBATIM)
endif()

# Copy dist into <target>.<ext>/Contents/Resources/web at build time.
#
# Copied rather than compiled into the binary because the copy is what makes the
# page debuggable: a `npm run build` and a reopen of the editor is the whole
# iteration loop, with no plugin rebuild and no host restart. JAMIN_WEB_DIR
# overrides it at runtime for even that.
function(jamin_bundle_web target)
    # An optional second argument: where to install the sealed bundle.
    set(_dest "${ARGV1}")

    if(NOT EXISTS "${JAMIN_WEB_DIST}/index.html")
        message(FATAL_ERROR
            "No web build at ${JAMIN_WEB_DIST}.\n"
            "  Run `npm install && npm run build` in ${JAMIN_WEB_ROOT} first,\n"
            "  or `cmake --build <dir> --target web`.")
    endif()

    #[[
      And the compiler, which is a separate bundle and a separate build.

      `npm run build` makes two things: the page, and `jamin-compile.js` --
      jamin's own music code, which the plugin runs headless in QuickJS to turn
      a chart into notes. @see plugin/PluginProcessor.cpp

      `npm run build:page` makes only the first, and Vite empties the output
      directory before it writes, so running it alone *removes* the compiler.
      The page still looks perfectly correct in a browser and in the editor --
      and the plugin plays nothing at all, because the thing that turns chords
      into MIDI is not in the bundle. That shipped, installed and was noticed
      from the DAW being silent.

      A missing compiler is now a build failure rather than a quiet one.
    ]]
    if(NOT EXISTS "${JAMIN_WEB_DIST}/jamin-compile.js")
        message(FATAL_ERROR
            "The page is built but the compiler is not: no jamin-compile.js in "
            "${JAMIN_WEB_DIST}.\n"
            "  `npm run build:page` builds only the page and empties dist on the "
            "way, which takes the compiler with it.\n"
            "  Run `npm run build` -- it makes both -- and build again.")
    endif()

    #[[
      Where the page goes, which is not the same question on every platform.

      The runtime answer does not vary and is one line: the plugin looks for a
      Resources/web beside its own binary. @see plugin/PluginPaths.cpp

      What varies is where CMake says that is. An .app is a bundle, and so is a
      VST3 -- the format defines that layout on Windows too, which is why a
      .vst3 there is a folder and not a DLL. A Windows standalone is a bare
      .exe with no Contents and no bundle of any kind, and asking CMake for its
      TARGET_BUNDLE_CONTENT_DIR is not a warning but a generate-time error:

        TARGET_BUNDLE_CONTENT_DIR is allowed only for Bundle targets.

      That error is every Windows configure this repository has ever run. It
      could not have been caught here, because on macOS all three formats are
      bundles and the question never comes up.

      Asked of the target rather than of the platform. MACOSX_BUNDLE is the
      property an .app carries and BUNDLE is the one a plugin bundle carries;
      a target with neither has its resources beside the executable.
    ]]
    get_target_property(_bundle     ${target} BUNDLE)
    get_target_property(_app_bundle ${target} MACOSX_BUNDLE)
    if(_bundle OR _app_bundle)
        set(_web_dest "$<TARGET_BUNDLE_CONTENT_DIR:${target}>/Resources/web")
    else()
        set(_web_dest "$<TARGET_FILE_DIR:${target}>/Resources/web")
    endif()

    # A target of its own rather than POST_BUILD on the plugin, because
    # POST_BUILD only fires when the plugin relinks -- so a `npm run build` with
    # no C++ change left a stale page inside the bundle, and the tests were
    # checking a version of the app that no longer existed. This runs every
    # build; the script copies only what differs, so an unchanged page costs
    # nothing and does not restamp the bundle.
    add_custom_target(${target}_web ALL
        COMMAND "${CMAKE_COMMAND}"
                # No quotes: VERBATIM passes each argument exactly as written,
                # so a quote here arrives as part of the path.
                -DSRC=${JAMIN_WEB_DIST}
                -DDEST=${_web_dest}
                -DEXCLUDE=${JAMIN_WEB_EXCLUDE}
                -P "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/CopyWeb.cmake"
        COMMENT "Copying the web build into ${target}"
        VERBATIM)

    # And re-seal it. This has to be the same target, immediately after the
    # copy: a bundle that is signed and then added to is worse than one that was
    # never signed, because the system trusts the seal and finds it broken.
    if(APPLE)
        add_custom_command(TARGET ${target}_web POST_BUILD
            COMMAND codesign --force --sign "${JAMIN_CODESIGN_IDENTITY}"
                    --timestamp=none $<TARGET_BUNDLE_DIR:${target}>
            COMMAND codesign --verify --strict $<TARGET_BUNDLE_DIR:${target}>
            COMMENT "Re-sealing ${target} around the page"
            VERBATIM)
    endif()

    # And only then does it go to the plugin folder.
    #
    # From here rather than from JUCE's COPY_PLUGIN_AFTER_BUILD, which is a
    # POST_BUILD on the plugin target and so runs before this target does --
    # installing the bundle as it stood before the page was copied in and the
    # seal remade. The build tree was always right and the installed plugin was
    # always one build behind, which is invisible until somebody wonders why a
    # fix they watched being built is not in the plugin they just opened.
    if(JAMIN_INSTALL_AFTER_BUILD AND _dest)
        add_custom_command(TARGET ${target}_web POST_BUILD
            COMMAND "${CMAKE_COMMAND}"
                    -DBUNDLE=$<TARGET_BUNDLE_DIR:${target}>
                    -DDEST=${_dest}
                    -P "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/InstallBundle.cmake"
            COMMENT "Installing ${target} into ${_dest}"
            VERBATIM)
    endif()

    # After the bundle exists, or there is nowhere to copy to.
    add_dependencies(${target}_web ${target})
endfunction()
