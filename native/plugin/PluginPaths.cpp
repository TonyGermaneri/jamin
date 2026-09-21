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

        const auto binary = juce::File::getSpecialLocation (juce::File::currentExecutableFile);

        // Inside the bundle: .../Contents/MacOS/<binary> -> .../Contents/Resources/web.
        // A VST3 has this layout on every platform, an .app has it on macOS.
        const auto inBundle = binary.getParentDirectory()
                                    .getSiblingFile ("Resources").getChildFile ("web");
        if (inBundle.getChildFile ("index.html").existsAsFile())
            return inBundle;

        // Beside the executable: <dir>/<binary>.exe -> <dir>/Resources/web.
        //
        // A Windows standalone is a bare .exe with no Contents around it, so
        // the sibling walk above climbs one directory too far and lands
        // outside the build entirely. Not a fallback in the sense of a guess:
        // it is the other real layout, and it is where WebAssets.cmake puts
        // the page for a target that is not a bundle.
        const auto besideBinary = binary.getParentDirectory()
                                        .getChildFile ("Resources").getChildFile ("web");
        if (besideBinary.getChildFile ("index.html").existsAsFile())
            return besideBinary;

        // Neither, so report the one the bundle formats use. The line below
        // names it, which is the whole point of the line.
        return inBundle;
    }();

    // Said once per process. A blank editor is almost always a page that is not
    // where the plugin looked, and this is the one line that answers it.
    static bool announced = false;
    if (! std::exchange (announced, true))
        juce::Logger::writeToLog ("jamin: serving the page from " + chosen.getFullPathName());

    return chosen;
}

} // namespace jamin
