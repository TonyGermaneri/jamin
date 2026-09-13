#include "PluginEditor.h"

#include <jamin/SongBus.h>

namespace
{

/** The handful of types the built page actually asks for. Anything unknown is
    served as octet-stream, which is right for a font and harmless for the rest;
    guessing text/plain instead would make a stray .js fail to execute with no
    error anybody can see. */
juce::String mimeFor (const juce::String& path)
{
    static const std::pair<const char*, const char*> table[]
    {
        { ".html", "text/html" },        { ".js",   "text/javascript" },
        { ".mjs",  "text/javascript" },  { ".css",  "text/css" },
        { ".json", "application/json" }, { ".svg",  "image/svg+xml" },
        { ".woff2", "font/woff2" },      { ".woff", "font/woff" },
        { ".png",  "image/png" },        { ".jpg",  "image/jpeg" },
        { ".ico",  "image/x-icon" },     { ".map",  "application/json" },
        { ".voc",  "text/plain" },       { ".txt",  "text/plain" },
    };

    for (const auto& [suffix, mime] : table)
        if (path.endsWithIgnoreCase (suffix))
            return mime;

    return "application/octet-stream";
}

juce::var readJsonEvents (const juce::var& events, jamin::Sequence& into)
{
    if (auto* array = events.getArray())
    {
        into.events.reserve ((size_t) array->size());

        for (const auto& entry : *array)
        {
            auto* quad = entry.getArray();
            if (quad == nullptr || quad->size() < 4)
                continue;

            into.events.push_back ({ (int32_t)  (int) quad->getReference (0),
                                     (uint8_t)  (int) quad->getReference (1),
                                     (uint8_t)  (int) quad->getReference (2),
                                     (uint8_t)  (int) quad->getReference (3) });
        }
    }
    return {};
}

} // namespace

juce::File JaminEditor::webRoot()
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

JaminEditor::JaminEditor (JaminProcessor& p)
    : juce::AudioProcessorEditor (&p),
      plugin (p),
      browser (juce::WebBrowserComponent::Options {}
                   .withNativeIntegrationEnabled()
                   .withKeepPageLoadedWhenBrowserIsHidden()
                   .withResourceProvider ([this] (const auto& path) { return provide (path); })
                   .withInitialisationData ("jaminInstanceId", plugin.instanceId)
                   .withNativeFunction ("jaminReady",
                       [this] (const juce::Array<juce::var>&, auto complete)
                       {
                           // Everything the page needs to draw itself, in one
                           // round trip: who it is, what it was last set to, and
                           // the chart every other instance is also reading.
                           auto* object = new juce::DynamicObject();
                           object->setProperty ("instanceId", plugin.instanceId);
                           object->setProperty ("state", plugin.instanceState);

                           const auto song = jamin::SongBus::instance().snapshot();
                           object->setProperty ("song", juce::String (song.json));
                           object->setProperty ("songGeneration", (juce::int64) song.generation);
                           object->setProperty ("shared", jamin::SongBus::instance().isShared());
                           lastSongGeneration = song.generation;

                           complete (juce::var (object));
                       })
                   .withNativeFunction ("jaminSetSequence",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           auto next = std::make_unique<jamin::Sequence>();

                           if (! args.isEmpty())
                           {
                               const auto parsed = juce::JSON::parse (args[0].toString());
                               next->lengthPulses = (int32_t) (int) parsed.getProperty ("lengthPulses", 0);
                               next->generation = (uint64_t) (juce::int64) parsed.getProperty ("generation", 0);
                               readJsonEvents (parsed.getProperty ("events", {}), *next);
                           }

                           const auto count = next->events.size();
                           plugin.setSequence (std::move (next));
                           complete (juce::var ((int) count));
                       })
                   .withNativeFunction ("jaminPublishSong",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           if (args.isEmpty())
                               return complete (juce::var (false));

                           const auto generation = jamin::SongBus::instance()
                                                       .publish (args[0].toString().toStdString());
                           lastSongGeneration = generation;   // do not echo our own edit back
                           complete (juce::var ((juce::int64) generation));
                       })
                   .withNativeFunction ("jaminSaveState",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           if (! args.isEmpty())
                               plugin.instanceState = args[0].toString();
                           complete (juce::var (true));
                       }))
{
    addAndMakeVisible (browser);
    browser.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    setResizable (true, true);
    setResizeLimits (720, 480, 4096, 2400);
    setSize (1100, 720);

    startTimerHz (30);
}

JaminEditor::~JaminEditor() { stopTimer(); }

void JaminEditor::resized() { browser.setBounds (getLocalBounds()); }

std::optional<juce::WebBrowserComponent::Resource> JaminEditor::provide (const juce::String& path)
{
    const auto root = webRoot();
    auto relative = path.startsWith ("/") ? path.substring (1) : path;

    if (relative.isEmpty())
        relative = "index.html";

    // A path cannot climb out of the bundle. The page is ours and would never
    // try, but a resource provider is a file server and a file server that can
    // be talked out of its root is a file server with a hole in it.
    const auto file = root.getChildFile (relative);
    if (! file.isAChildOf (root) || ! file.existsAsFile())
        return std::nullopt;

    juce::MemoryBlock block;
    if (! file.loadFileAsData (block))
        return std::nullopt;

    std::vector<std::byte> bytes ((size_t) block.getSize());
    std::memcpy (bytes.data(), block.getData(), block.getSize());

    return juce::WebBrowserComponent::Resource { std::move (bytes), mimeFor (relative) };
}

void JaminEditor::timerCallback()
{
    auto& bus = jamin::SongBus::instance();

    // Somebody else changed the chart. One atomic load in the common case.
    if (bus.poll())
    {
        const auto song = bus.snapshot();
        if (song.generation != lastSongGeneration)
        {
            lastSongGeneration = song.generation;

            auto* object = new juce::DynamicObject();
            object->setProperty ("json", juce::String (song.json));
            object->setProperty ("generation", (juce::int64) song.generation);
            browser.emitEventIfBrowserIsVisible ("jaminSong", juce::var (object));
        }
    }

    const auto& transport = plugin.transport();
    const auto ppq = transport.ppqPosition.load (std::memory_order_relaxed);
    const auto playing = transport.playing.load (std::memory_order_relaxed);

    // Stopped and parked is the common state of a plugin nobody is using; not
    // sending in that case is what keeps an idle instance off the CPU entirely.
    if (playing == lastPlayingSent && std::abs (ppq - lastPpqSent) < 1.0e-9)
        return;

    lastPlayingSent = playing;
    lastPpqSent = ppq;

    auto* object = new juce::DynamicObject();
    object->setProperty ("ppq", ppq);
    object->setProperty ("playing", playing);
    object->setProperty ("bpm", transport.bpm.load (std::memory_order_relaxed));
    object->setProperty ("numerator", transport.timeSigNumerator.load (std::memory_order_relaxed));
    object->setProperty ("denominator", transport.timeSigDenominator.load (std::memory_order_relaxed));
    object->setProperty ("hasPlayhead", transport.hasPlayhead.load (std::memory_order_relaxed));
    browser.emitEventIfBrowserIsVisible ("jaminTransport", juce::var (object));
}
