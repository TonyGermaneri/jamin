# jamin is built twice, from one set of sources.
#
# What it actually is, is a MIDI effect: it makes no sound, it emits notes, and
# it wants to sit above the instrument it is playing. Logic has a slot for
# exactly that. Ableton Live does not host AU MIDI processors at all -- not this
# one, any of them -- and neither do several other hosts, so the same plugin is
# also declared as an instrument, which is a shape every host understands. It
# makes silence on its own track and the track that wants the notes takes them
# from it.
#
# Only the bus layout differs. @see PluginProcessor.h

# Read once and handed to every target as text: JUCE parses whatever string
# PLIST_TO_MERGE is given rather than opening a path.
#
# Flattened to one line first, and the comment taken out. JUCE writes these
# options into a file it reads back a line at a time, so a value with a newline
# in it does not survive the trip -- it arrives truncated and the entry simply
# never appears, with nothing anywhere saying why. The file stays readable and
# commented; what is passed is what is left of it.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../packaging/Info.extra.plist" JAMIN_EXTRA_PLIST)
string(REGEX REPLACE "<!--.*-->" "" JAMIN_EXTRA_PLIST "${JAMIN_EXTRA_PLIST}")
string(REGEX REPLACE "[\r\n]+" " " JAMIN_EXTRA_PLIST "${JAMIN_EXTRA_PLIST}")
string(REGEX REPLACE " +" " " JAMIN_EXTRA_PLIST "${JAMIN_EXTRA_PLIST}")

function(jamin_add_plugin target)
    cmake_parse_arguments(ARG "MIDI_EFFECT;SYNTH" "CODE;PRODUCT" "FORMATS" ${ARGN})

    juce_add_plugin(${target}
        COMPANY_NAME              "${JAMIN_COMPANY}"
        BUNDLE_ID                 "${JAMIN_BUNDLE_ID}.${ARG_CODE}"
        PLUGIN_MANUFACTURER_CODE  "${JAMIN_MANUFACTURER}"
        PLUGIN_CODE               "${ARG_CODE}"
        PRODUCT_NAME              "${ARG_PRODUCT}"

        IS_MIDI_EFFECT            ${ARG_MIDI_EFFECT}
        IS_SYNTH                  ${ARG_SYNTH}
        NEEDS_MIDI_INPUT          TRUE
        NEEDS_MIDI_OUTPUT         TRUE
        EDITOR_WANTS_KEYBOARD_FOCUS TRUE      # the chart is typed into

        FORMATS                   ${ARG_FORMATS}

        # The XML itself, not a path to it: JUCE parses whatever string it is
        # given. @see packaging/Info.extra.plist
        PLIST_TO_MERGE            "${JAMIN_EXTRA_PLIST}"

        # CI collects from the build tree and signs there; installing into somebody's own plugin
        # folders is a thing to opt into, not a thing a build does behind their back.
        #
        # Always FALSE, even when installing is asked for: JUCE's copy is a
        # POST_BUILD on this target, and the page is copied in afterwards by a
        # target that depends on it, so JUCE's copy is always of the bundle
        # before the page went in. @see cmake/WebAssets.cmake, which installs
        # the bundle it has just sealed.
        COPY_PLUGIN_AFTER_BUILD   FALSE)

    target_sources(${target} PRIVATE
        PluginProcessor.cpp
        PluginEditor.cpp
        PluginPaths.cpp
        Compiler.cpp)

    target_compile_definitions(${target} PUBLIC
        JUCE_WEB_BROWSER=1              # the editor is the web app
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0)

    # QuickJS runs jamin's own music code headless, so the plugin keeps no
    # implementation of the harmony at all. @see Compiler.cpp
    target_link_libraries(${target} PRIVATE qjs)

    target_link_libraries(${target} PRIVATE
        jamin_core
        juce::juce_audio_utils
        juce::juce_gui_extra
      PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

    # Every format target is its own bundle, and a standalone cannot read the
    # AU's resources, so each gets its own copy of the page.
    foreach(_format IN ITEMS AU VST3 Standalone)
        if(TARGET ${target}_${_format})
            # Where each format lives, asked of JUCE rather than spelled out
            # here, so a machine that keeps its plugins somewhere else still
            # gets them in the right place. A standalone is an application and
            # has nowhere to be installed to.
            set(_where "")
            if(JAMIN_INSTALL_AFTER_BUILD AND NOT _format STREQUAL "Standalone")
                get_property(_where GLOBAL PROPERTY JUCE_${_format}_COPY_DIR)
            endif()
            jamin_bundle_web(${target}_${_format} "${_where}")
        endif()
    endforeach()
endfunction()

# The instrument: what Live, Bitwig, Cubase and Reaper will show. It carries the
# primary plugin code because it is the one most people will load.
jamin_add_plugin(JaminInstrument
    SYNTH
    CODE    "${JAMIN_PLUGIN_CODE}"
    PRODUCT "${JAMIN_PRODUCT}"
    FORMATS AU VST3 Standalone)

# The MIDI effect: Logic's MIDI FX slot, where no routing is needed at all.
jamin_add_plugin(JaminMidiFx
    MIDI_EFFECT
    CODE    "${JAMIN_MIDIFX_CODE}"
    PRODUCT "${JAMIN_PRODUCT} MIDI FX"
    FORMATS AU)
