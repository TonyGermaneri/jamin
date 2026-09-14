#include "PluginEditor.h"
#include "PluginPaths.h"

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
                   .withNativeFunction ("jaminNetwork",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // Switch it on or off, and say where it ended up: the
                           // page shows the address so somebody can open it on
                           // their phone without being told what it is.
                           if (args.size() >= 2)
                               plugin.setNetworking (static_cast<bool> (args[0]), args[1].toString());
                           else if (! args.isEmpty())
                               plugin.setNetworking (static_cast<bool> (args[0]), plugin.networkSecret);

                           auto* state = new juce::DynamicObject();
                           state->setProperty ("running", plugin.isNetworking());
                           state->setProperty ("port", plugin.network.port());
                           state->setProperty ("name", juce::SystemStats::getComputerName());
                           state->setProperty ("peers", juce::JSON::parse (plugin.network.peersJson()));
                           complete (juce::var (state));
                       })
                   .withNativeFunction ("jaminNetOps",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // An edit made here, on its way to every other
                           // machine. The envelope is opaque: this end does not
                           // know what an edit is and does not need to.
                           if (! args.isEmpty())
                               plugin.network.submit (args[0].toString().toStdString());
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminNetDoc",
                       [this] (const juce::Array<juce::var>&, auto complete)
                       {
                           complete (juce::JSON::parse (plugin.network.docJson()));
                       })
                   .withNativeFunction ("jaminOpenUrl",
                       [] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // WKWebView in a plugin has no download handling at all --
                           // JUCE wires up the file-open panel but nothing for
                           // WKDownload -- so a link that saves a file does nothing
                           // here, silently. Handing the URL to the system browser is
                           // the only honest version of that button.
                           if (args.isEmpty())
                               return complete (juce::var (false));

                           const juce::URL url (args[0].toString());
                           const auto scheme = url.getScheme().toLowerCase();

                           // Only the two schemes a link in a page should ever want.
                           // The page is ours, but a resource provider that will launch
                           // anything is a resource provider that will launch anything.
                           if (scheme != "http" && scheme != "https")
                               return complete (juce::var (false));

                           complete (juce::var (url.launchInDefaultBrowser()));
                       })
                   .withNativeFunction ("jaminCompile",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // Everything this instance needs to make its own
                           // noise, in one payload: the chart, the settings, and
                           // the phrases already resolved. It is the saved state
                           // as well as the compile request, so a reopened
                           // session plays without the editor being opened.
                           if (args.isEmpty())
                               return complete (juce::var (false));

                           plugin.requestCompile (args[0].toString());
                           complete (juce::var (true));
                       }))
{
    // Edits from other machines, pushed at the page as they arrive.
    plugin.onNetworkOps = [this] (const juce::String& envelope)
    {
        auto* carried = new juce::DynamicObject();
        carried->setProperty ("envelope", envelope);
        browser.emitEventIfBrowserIsVisible ("jaminNetOps", juce::var (carried));
    };

    addAndMakeVisible (browser);
    browser.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    setResizable (true, true);
    setResizeLimits (720, 480, 4096, 2400);
    setSize (1100, 720);

    startTimerHz (30);
}

JaminEditor::~JaminEditor()
{
    stopTimer();
    plugin.onNetworkOps = nullptr;
}

void JaminEditor::resized() { browser.setBounds (getLocalBounds()); }

std::optional<juce::WebBrowserComponent::Resource> JaminEditor::provide (const juce::String& path)
{
    const auto root = jamin::webRoot();
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

    // Say what the last compile produced, once per change. The page shows it in
    // the host readout: "0 events" with a chart on screen is a different problem
    // from "no reports received", and they are hard to tell apart otherwise.
    if (const auto events = plugin.compiledEvents.load (std::memory_order_relaxed);
        events != lastCompiledEvents)
    {
        lastCompiledEvents = events;
        auto* report = new juce::DynamicObject();
        report->setProperty ("events", events);
        report->setProperty ("chords", plugin.compiledChords.load (std::memory_order_relaxed));
        report->setProperty ("error", plugin.compileError);
        browser.emitEventIfBrowserIsVisible ("jaminCompiled", juce::var (report));
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
