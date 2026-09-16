#pragma once

#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

/**
    The editor is the web app, and only the web app.

    Everything visible -- the chart, the phrase book, the shaders -- is the page
    in ../../src, built by Vite and served to a WKWebView out of the plugin's own
    bundle. Nothing is drawn twice and nothing is ported.

    The window is not where the music lives, though. Closing it takes the editor
    away and leaves the compiled sequence playing, which is the property that
    makes a web UI acceptable in a plugin at all.
*/
class JaminEditor final : public juce::AudioProcessorEditor,
                          private juce::Timer
{
public:
    explicit JaminEditor (JaminProcessor&);
    ~JaminEditor() override;

    void resized() override;

private:
    void timerCallback() override;
    std::optional<juce::WebBrowserComponent::Resource> provide (const juce::String& path);

    JaminProcessor& plugin;
    juce::WebBrowserComponent browser;

    uint64_t lastSongGeneration { 0 };
    uint64_t lastRoster { 0 };
    uint64_t lastPhraseRequest { 0 };
    uint64_t lastDrumsRequest { 0 };
    /// Which drums are silenced, as a bitmask, so the page hears about a switch
    /// thrown in the DAW and nothing is sent when nothing moved.
    uint32_t lastVoiceMutes { 0 };

    /** Held while a folder chooser is open: it is asynchronous and the dialog
        outlives the call that opened it. */
    std::unique_ptr<juce::FileChooser> chooser;

    /** The MIDI files written for drags out of here, cleared when the editor
        goes. They live in the temporary directory and a DAW copies what it
        wants out of them, but leaving a trail behind is untidy. */
    juce::Array<juce::File> dragging;
  int lastCompiledEvents { -1 };
    double lastPpqSent { -1.0 };
    bool lastPlayingSent { false };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (JaminEditor)
};
