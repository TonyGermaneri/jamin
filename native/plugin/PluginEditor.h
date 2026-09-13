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

    /** Where the built page is read from: $JAMIN_WEB_DIR if it is set, so a
        `npm run build` is the whole iteration loop, otherwise Resources/web
        inside this bundle. */
    static juce::File webRoot();

private:
    void timerCallback() override;
    std::optional<juce::WebBrowserComponent::Resource> provide (const juce::String& path);

    JaminProcessor& plugin;
    juce::WebBrowserComponent browser;

    uint64_t lastSongGeneration { 0 };
    double lastPpqSent { -1.0 };
    bool lastPlayingSent { false };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (JaminEditor)
};
