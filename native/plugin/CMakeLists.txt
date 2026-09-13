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
        COPY_PLUGIN_AFTER_BUILD   FALSE)

    target_sources(${target} PRIVATE PluginProcessor.cpp PluginEditor.cpp)

    target_compile_definitions(${target} PUBLIC
        JUCE_WEB_BROWSER=1              # the editor is the web app
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0)

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
            jamin_bundle_web(${target}_${_format})
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
