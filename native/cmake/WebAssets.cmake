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
    if(NOT EXISTS "${JAMIN_WEB_DIST}/index.html")
        message(FATAL_ERROR
            "No web build at ${JAMIN_WEB_DIST}.\n"
            "  Run `npm install && npm run build` in ${JAMIN_WEB_ROOT} first,\n"
            "  or `cmake --build <dir> --target web`.")
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
                -DDEST=$<TARGET_BUNDLE_CONTENT_DIR:${target}>/Resources/web
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

    # After the bundle exists, or there is nowhere to copy to.
    add_dependencies(${target}_web ${target})
endfunction()
