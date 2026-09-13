# Script mode: copy SRC into DEST, dropping anything matching EXCLUDE, and only
# writing files whose content actually changed so an unchanged page does not
# restamp the bundle on every build.
file(GLOB_RECURSE _files RELATIVE "${SRC}" "${SRC}/*")
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
    math(EXPR _kept "${_kept} + 1")
endforeach()
message(STATUS "web: ${_kept} files copied, ${_skipped} skipped")
