juce_add_plugin(JaminPlugin
    COMPANY_NAME              "${JAMIN_COMPANY}"
    BUNDLE_ID                 "${JAMIN_BUNDLE_ID}"
    PLUGIN_MANUFACTURER_CODE  "${JAMIN_MANUFACTURER}"
    PLUGIN_CODE               "${JAMIN_PLUGIN_CODE}"
    PRODUCT_NAME              "${JAMIN_PRODUCT}"

    # A MIDI effect, not an instrument. In Logic that puts it in the MIDI FX
    # slot directly above the instrument it is playing, which is exactly the
    # arrangement the multi-instance idea needs: one track, one articulation,
    # one instance, every instance reading the same chart.
    IS_MIDI_EFFECT            TRUE
    NEEDS_MIDI_INPUT          TRUE
    NEEDS_MIDI_OUTPUT         TRUE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE      # the chart is typed into

    FORMATS                   AU Standalone
    COPY_PLUGIN_AFTER_BUILD   FALSE)

target_sources(JaminPlugin PRIVATE
    PluginProcessor.cpp
    PluginEditor.cpp)

target_compile_definitions(JaminPlugin PUBLIC
    JUCE_WEB_BROWSER=1              # the editor is the web app
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(JaminPlugin PRIVATE
    jamin_core
    juce::juce_audio_utils
    juce::juce_gui_extra
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags)

# Every format target gets its own copy of the page; the artefacts are separate
# bundles and a standalone cannot read the AU's resources.
foreach(_format IN ITEMS AU Standalone)
    if(TARGET JaminPlugin_${_format})
        jamin_bundle_web(JaminPlugin_${_format})
    endif()
endforeach()
