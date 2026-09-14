# Script mode: make DEST look like SRC, dropping anything matching EXCLUDE, and
# only writing files whose content actually changed so an unchanged page does not
# restamp the bundle on every build.
#
# "Look like" rather than "copy into". Vite names every asset with a hash of its
# contents, so each build writes index-<new hash>.js and the old one is simply
# never referenced again -- and a copy that only ever adds leaves every one of
# them in the bundle for good. It had reached 7.3 MB of dead JavaScript and CSS
# in an 11 MB bundle, growing by about 1.6 MB per build, all of it shipped and
# none of it reachable.
#
# So this prunes as well as copies. What it must not do is empty DEST and refill
# it: that would rewrite every file every time, which restamps the bundle, which
# re-signs it -- and the whole point of ONLY_IF_DIFFERENT is that an unchanged
# page costs nothing.

file(GLOB_RECURSE _files RELATIVE "${SRC}" "${SRC}/*")

set(_wanted "")
set(_kept 0)
set(_skipped 0)

foreach(_f IN LISTS _files)
    if(EXCLUDE AND _f MATCHES "${EXCLUDE}")
        math(EXPR _skipped "${_skipped} + 1")
        continue()
    endif()
    get_filename_component(_dir "${DEST}/${_f}" DIRECTORY)
    file(MAKE_DIRECTORY "${_dir}")
    file(COPY_FILE "${SRC}/${_f}" "${DEST}/${_f}" ONLY_IF_DIFFERENT)
    list(APPEND _wanted "${_f}")
    math(EXPR _kept "${_kept} + 1")
endforeach()

# Anything in the bundle that the page no longer asks for. Excluded files are
# pruned too, which is what clears out a font that used to be shipped.
set(_removed 0)
if(EXISTS "${DEST}")
    file(GLOB_RECURSE _there RELATIVE "${DEST}" "${DEST}/*")
    foreach(_f IN LISTS _there)
        # list(FIND) rather than `IN_LIST`, which needs CMP0057 -- and a script
        # run with `cmake -P` inherits no policy settings from the project.
        list(FIND _wanted "${_f}" _at)
        if(_at LESS 0)
            file(REMOVE "${DEST}/${_f}")
            math(EXPR _removed "${_removed} + 1")
        endif()
    endforeach()
endif()

if(_removed GREATER 0)
    message(STATUS "web: ${_kept} files copied, ${_skipped} skipped, ${_removed} stale removed")
else()
    message(STATUS "web: ${_kept} files copied, ${_skipped} skipped")
endif()
