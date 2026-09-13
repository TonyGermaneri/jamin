#include "PluginPaths.h"

#include <utility>

namespace jamin
{

juce::File webRoot()
{
    // Set JAMIN_WEB_DIR to the repository's dist and the page can be rebuilt and
    // reloaded without rebuilding or reinstalling the plugin.
    const auto chosen = [&]
    {
        if (auto fromEnvironment = juce::SystemStats::getEnvironmentVariable ("JAMIN_WEB_DIR", {});
            fromEnvironment.isNotEmpty())
        {
            const juce::File dir (fromEnvironment);
            if (dir.getChildFile ("index.html").existsAsFile())
                return dir;

            // Naming a directory that has no page in it is a typo, not a
            // preference, and falling through to the bundle in silence is how
            // you spend an afternoon editing a copy nothing is reading. Once
            // per process: this is reached for every file the page asks for.
            static bool warned = false;
            if (! std::exchange (warned, true))
                juce::Logger::writeToLog ("jamin: JAMIN_WEB_DIR has no index.html: " + fromEnvironment);
        }

        // Inside the bundle: .../Contents/MacOS/<binary> -> .../Contents/Resources/web
        const auto binary = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
        return binary.getParentDirectory().getSiblingFile ("Resources").getChildFile ("web");
    }();

    // Said once per process. A blank editor is almost always a page that is not
    // where the plugin looked, and this is the one line that answers it.
    static bool announced = false;
    if (! std::exchange (announced, true))
        juce::Logger::writeToLog ("jamin: serving the page from " + chosen.getFullPathName());

    return chosen;
}

} // namespace jamin
