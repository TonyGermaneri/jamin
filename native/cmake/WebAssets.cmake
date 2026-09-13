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
    if(NOT EXISTS "${JAMIN_WEB_DIST}/index.html")
        message(FATAL_ERROR
            "No web build at ${JAMIN_WEB_DIST}.\n"
            "  Run `npm install && npm run build` in ${JAMIN_WEB_ROOT} first,\n"
            "  or `cmake --build <dir> --target web`.")
    endif()

    # The artefact directory is per-format, so this runs once per format target.
    add_custom_command(TARGET ${target} POST_BUILD
        COMMAND "${CMAKE_COMMAND}"
                # No quotes: VERBATIM passes each argument exactly as written,
                # so a quote here arrives as part of the path.
                -DSRC=${JAMIN_WEB_DIST}
                -DDEST=$<TARGET_BUNDLE_CONTENT_DIR:${target}>/Resources/web
                -DEXCLUDE=${JAMIN_WEB_EXCLUDE}
                -P "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/CopyWeb.cmake"
        COMMENT "Copying the web build into ${target}"
        VERBATIM)
endfunction()
