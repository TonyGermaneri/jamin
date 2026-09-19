#include "PluginEditor.h"
#include "PluginPaths.h"

#include <jamin/Roster.h>
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

/**
 * Bytes as base64 the page can actually decode.
 *
 * NOT `MemoryBlock::toBase64Encoding`, which is not base64. It writes the byte
 * count, then a '.', then the data through a private table packing each six
 * bits least-significant first -- a JUCE format whose only partner is
 * `fromBase64Encoding`. Handed to the page's `atob` it decodes to noise, and a
 * MIDI file of noise parses to nothing, so every file in a library was read
 * successfully and skipped.
 *
 * `Base64::convertToBase64` is RFC 4648, which is what `atob` expects.
 */
static juce::String asBase64 (const juce::MemoryBlock& block)
{
    juce::MemoryOutputStream encoded;
    if (! juce::Base64::convertToBase64 (encoded, block.getData(), block.getSize()))
        return {};

    return encoded.toString();
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
                   .withNativeFunction ("jaminTapDrum",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // "What does this kit actually have on 42" has one
                           // honest answer, which is to hit it. The page cannot
                           // send MIDI from inside a plugin, so this is the only
                           // way out of the process.
                           if (args.size() >= 2)
                               plugin.tapNote ((int) args[0],
                                               args.size() >= 3 ? (int) args[2] : 100,
                                               (int) args[1]);
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminSendNote",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // Mr. Accompany Me, answering a chord that is being
                           // played this moment. It cannot be compiled ahead
                           // of time because it has not happened yet, so this
                           // is the one thing the page sends in real time.
                           // @see JaminProcessor::sendNote
                           if (args.size() >= 4)
                               plugin.sendNote ((int) args[0], (int) args[2],
                                                (int) args[1], (bool) args[3]);
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminRoster",
                       [this] (const juce::Array<juce::var>&, auto complete)
                       {
                           // Every instance of jamin in this host, and which of
                           // them may be heard. @see jamin::Roster
                           auto* object = new juce::DynamicObject();
                           object->setProperty ("me", plugin.instanceId);
                           object->setProperty ("instances",
                                                juce::JSON::parse (jamin::Roster::instance().json()));
                           complete (juce::var (object));
                       })
                   .withNativeFunction ("jaminDescribe",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // What this instance is playing, and what kind of
                           // part it is, so the other windows can label its tab
                           // with something truthful and open the right
                           // catalogue for it. The name is the DAW's and is not
                           // overwritten here.
                           if (plugin.seat != nullptr && ! args.isEmpty())
                           {
                               const auto mode = args.size() > 1 ? args[1].toString().toStdString()
                                                                 : plugin.seat->mode;
                               jamin::Roster::instance().describe (plugin.seat,
                                                                   plugin.seat->name,
                                                                   args[0].toString().toStdString(),
                                                                   mode);
                           }
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminMuteVoice",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // One drum, on or off, landing on a bar line unless
                           // the settings say sooner. @see nextBoundaryPpq
                           if (args.size() >= 2)
                               plugin.setVoiceSounding ((int) args[0], (bool) args[1],
                                                        plugin.nextBoundaryPpq());
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminDrumNotes",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // Which note each voice comes out on, as this page's
                           // kit map says. The audio thread has no kit table and
                           // no business having one -- it needs to know that
                           // note 42 is the closed hat and nothing more.
                           if (! args.isEmpty() && args[0].isArray())
                               plugin.setVoiceNotes (*args[0].getArray(),
                                                     args.size() > 1 ? (int) args[1] : 9);
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminPublishDrums",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // What this track's drums are bound to, so another
                           // window can show it. Parsed before it is published:
                           // it goes into the roster's JSON as an object rather
                           // than a string, so rubbish here would empty every
                           // window's tabs at once. @see Roster::publishDrums
                           if (plugin.seat != nullptr && ! args.isEmpty())
                           {
                               const auto text = args[0].toString();
                               const auto parsed = juce::JSON::parse (text);
                               jamin::Roster::instance().publishDrums (
                                   plugin.seat,
                                   parsed.isObject() ? text.toStdString() : std::string ("{}"));
                           }
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminRequestMutes",
                       [] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // Silence some of another track's drums. A mute is a
                           // thing done to a track, and the window it is done
                           // from is whichever one happens to be open.
                           // Through `double`, not `int`. A var carrying a
                           // mask of forty voices does not fit in 32 bits, and
                           // `(int)` would quietly take the low half of it --
                           // silencing the wrong drums rather than none.
                           if (args.size() > 1)
                               jamin::Roster::instance().requestVoiceMutes (
                                   args[0].toString().toStdString(),
                                   (uint64_t) (double) args[1]);
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminRequestDrums",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // Ask another instance to bind its drums. A request
                           // rather than a setting, for the same reason a phrase
                           // is one: the grooves live in that instance's page
                           // and only it can compile them.
                           if (args.size() > 1)
                           {
                               const auto text = args[1].toString();
                               const auto parsed = juce::JSON::parse (text);
                               if (parsed.isObject())
                                   jamin::Roster::instance().requestDrums (
                                       args[0].toString().toStdString(), text.toStdString());
                           }
                           complete (juce::var (true));
                       })
                   .withNativeFunction ("jaminSetInstance",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // Mute or solo any instance in this host, from any
                           // instance's window -- which is the point of the
                           // whole thing: no hunting through the session for the
                           // track you want to silence.
                           if (args.size() >= 3)
                           {
                               const auto id = args[0].toString();
                               const auto what = args[1].toString();

                               if (what == "muted")
                                   plugin.setInstanceMuted (id, static_cast<bool> (args[2]));
                               else if (what == "soloed")
                                   plugin.setInstanceSoloed (id, static_cast<bool> (args[2]));
                               else if (what == "phrase")
                                   jamin::Roster::instance().requestPhrase (id.toStdString(),
                                                                            args[2].toString().toStdString());
                           }
                           complete (juce::var (jamin::Roster::instance().json()));
                       })
                   .withNativeFunction ("jaminChooseFolder",
                       [this] (const juce::Array<juce::var>&, auto complete)
                       {
                           // A directory, chosen the way the host's own dialogs
                           // choose one. The page cannot do this: a plugin's web
                           // view has no filesystem and a directory picker in it
                           // would be a picker onto nothing.
                           chooser = std::make_unique<juce::FileChooser> (
                               "Where is your drum library?",
                               juce::File::getSpecialLocation (juce::File::userMusicDirectory));

                           chooser->launchAsync (juce::FileBrowserComponent::openMode
                                                     | juce::FileBrowserComponent::canSelectDirectories,
                               [complete] (const juce::FileChooser& result)
                               {
                                   const auto folder = result.getResult();
                                   if (folder == juce::File())
                                       return complete (juce::var());

                                   auto* object = new juce::DynamicObject();
                                   object->setProperty ("path", folder.getFullPathName());
                                   object->setProperty ("name", folder.getFileName());
                                   complete (juce::var (object));
                               });
                       })
                   .withNativeFunction ("jaminScanFolder",
                       [] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // Paths only, and nothing opened. Three quarters of a
                           // million files is a walk of the tree, not a read of
                           // it, and the difference is a second against an hour.
                           if (args.isEmpty())
                               return complete (juce::var (juce::Array<juce::var>()));

                           const juce::File folder { args[0].toString() };
                           if (! folder.isDirectory())
                               return complete (juce::var (juce::Array<juce::var>()));

                           const int limit = args.size() >= 2 ? (int) args[1] : 200000;
                           // Recursive by default, because a folder somebody
                           // points at is usually a tree. The batch importer
                           // turns it off and walks the tree itself, a shelf at
                           // a time, so no single answer is thirty megabytes of
                           // path.
                           const bool deep = args.size() >= 3 ? (bool) args[2] : true;

                           juce::Array<juce::var> found;
                           for (const auto& entry : juce::RangedDirectoryIterator (
                                    folder, deep, "*.mid;*.midi", juce::File::findFiles))
                           {
                               if (found.size() >= limit)
                                   break;
                               found.add (entry.getFile().getRelativePathFrom (folder));
                           }

                           complete (juce::var (found));
                       })
                   .withNativeFunction ("jaminReadFile",
                       [] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // One file, as bytes the page can parse with its own
                           // reader. Read on demand rather than copied in: the
                           // library stays where it is and what plays is the
                           // original.
                           if (args.size() < 2)
                               return complete (juce::var());

                           const juce::File root { args[0].toString() };
                           const juce::File file = root.getChildFile (args[1].toString());

                           // Inside the folder that was chosen, and nowhere else.
                           // The paths come from our own scan of it, but the same
                           // rule as jaminOpenUrl: a reader that will read
                           // anything is a reader that will read anything.
                           if (! file.isAChildOf (root))
                               return complete (juce::var());

                           juce::MemoryBlock block;
                           if (! file.existsAsFile() || ! file.loadFileAsData (block))
                               return complete (juce::var());

                           complete (juce::var (asBase64 (block)));
                       })
                   .withNativeFunction ("jaminListFolders",
                       [] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // The folders directly inside this one, and nothing
                           // below them. A whole tree came back as one answer
                           // once: twenty-five thousand paths, which JUCE turns
                           // into a megabyte and a half of JavaScript source for
                           // one evaluateJavaScript call. The page walks the
                           // tree itself now, a rung at a time, and every
                           // crossing is small.
                           if (args.isEmpty())
                               return complete (juce::var (juce::Array<juce::var>()));

                           const juce::File folder { args[0].toString() };
                           if (! folder.isDirectory())
                               return complete (juce::var (juce::Array<juce::var>()));

                           juce::Array<juce::var> found;
                           for (const auto& entry : juce::RangedDirectoryIterator (
                                    folder, false, "*", juce::File::findDirectories))
                               found.add (entry.getFile().getFileName());

                           complete (juce::var (found));
                       })
                   .withNativeFunction ("jaminReadFiles",
                       [] (const juce::Array<juce::var>& args, auto complete)
                       {
                           // A batch of files in one crossing. Reading eight
                           // hundred thousand one at a time is eight hundred
                           // thousand round trips through the bridge, and the
                           // round trip costs more than the read does -- these
                           // are two-kilobyte files.
                           if (args.size() < 2 || ! args[1].isArray())
                               return complete (juce::var (juce::Array<juce::var>()));

                           const juce::File root { args[0].toString() };
                           const auto& wanted = *args[1].getArray();

                           juce::Array<juce::var> out;
                           for (const auto& relative : wanted)
                           {
                               const auto file = root.getChildFile (relative.toString());

                               // Inside the folder that was chosen, and nowhere
                               // else. @see jaminReadFile
                               juce::MemoryBlock block;
                               if (! file.isAChildOf (root) || ! file.existsAsFile()
                                   || ! file.loadFileAsData (block))
                               {
                                   out.add (juce::var());
                                   continue;
                               }

                               out.add (juce::var (asBase64 (block)));
                           }

                           complete (juce::var (out));
                       })
                   .withNativeFunction ("jaminDragMidi",
                       [this] (const juce::Array<juce::var>& args, auto complete)
                       {
                           /*
                            * Drag a pattern out of here and into the arrangement.
                            *
                            * The page must NOT use an HTML5 dragstart for this.
                            * The web view starts its own drag on that event and
                            * JUCE then refuses to start one -- "cannot start a
                            * new drag, a previous drag has not finished" -- so
                            * the page watches mousedown and mouseleave instead
                            * and calls this when the pointer leaves the row with
                            * the button still down. That is the gesture a drag
                            * out of a window actually is.
                            *
                            * A real file, because a DAW accepts a file and has no
                            * idea what a jamin pattern is. It goes in the
                            * system's temporary directory under a name somebody
                            * will recognise when it lands on a track.
                            */
                           if (args.size() < 2)
                               return complete (juce::var (false));

                           const auto name = args[0].toString();
                           juce::MemoryBlock block;
                           if (! block.fromBase64Encoding (args[1].toString()))
                               return complete (juce::var (false));

                           const auto folder = juce::File::getSpecialLocation (
                                                   juce::File::tempDirectory)
                                                   .getChildFile ("jamin-drag");
                           folder.createDirectory();

                           const auto file = folder.getChildFile (
                               juce::File::createLegalFileName (name.isEmpty() ? "jamin.mid" : name));
                           if (! file.replaceWithData (block.getData(), block.getSize()))
                               return complete (juce::var (false));

                           dragging.add (file);

                           // Answered before the drag starts, because the drag
                           // does not return until the mouse is let go and the
                           // page has no business waiting for that.
                           complete (juce::var (true));

                           juce::StringArray paths;
                           paths.add (file.getFullPathName());
                           juce::DragAndDropContainer::performExternalDragDropOfFiles (
                               paths, true, this);
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

    // The files written for drags out of here. Whatever the host wanted it has
    // already taken a copy of.
    for (const auto& file : dragging)
        file.deleteFile();
}

void JaminEditor::resized() { browser.setBounds (getLocalBounds()); }

std::optional<juce::WebBrowserComponent::Resource> JaminEditor::provide (const juce::String& path)
{
    const auto root = jamin::webRoot();
    auto relative = path.startsWith ("/") ? path.substring (1) : path;

    if (relative.isEmpty())
        relative = "index.html";

    /*
     * The shared chart, fetched rather than pushed.
     *
     * It used to travel as an event, and events are escaped by
     * WebBrowserComponent::Impl::emitEvent with two calls to String::replace --
     * which is quadratic, each replaceSection reallocating the whole string. A
     * chart carrying a day's editing took thirty-six seconds of CPU to escape,
     * every time an editor opened, and the profile was one stack from top to
     * bottom.
     *
     * Nothing here is escaped: the bytes go out as bytes. The event that
     * announces a new chart now carries a generation number and nothing else,
     * and the page comes and gets the rest. @see jaminSong
     */
    if (relative == "jamin-song.json")
    {
        const auto song = jamin::SongBus::instance().snapshot();
        const auto* first = reinterpret_cast<const std::byte*> (song.json.data());
        std::vector<std::byte> bytes (first, first + song.json.size());
        return juce::WebBrowserComponent::Resource { std::move (bytes), "application/json" };
    }

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

    // Two questions, and they are not the same one.
    //
    // poll() asks "has another process written since I last looked" and is one
    // atomic load in the common case. generation() asks "is the chart I hold
    // different from the one I last handed my page", which is the question this
    // is actually for.
    //
    // Gating the second on the first is what made several instances in one host
    // -- the case the whole shared segment exists for -- never hear each other:
    // a publish from this process has already moved the local copy, so poll()
    // correctly says nothing new arrived, and every other editor in the same
    // host stayed silent.
    bus.poll();

    // What is being played into this track, for Mr. Accompany Me to hear. Sent
    // only when there is something -- a silent keyboard should cost one atomic
    // load and nothing else.
    {
        juce::Array<juce::var> heard;
        if (plugin.takeHeardNotes (heard) > 0)
            browser.emitEventIfBrowserIsVisible ("jaminHeard", juce::var (heard));
    }

    if (bus.generation() != lastSongGeneration)
    {
        const auto song = bus.snapshot();
        lastSongGeneration = song.generation;

        // The number only. The chart itself is fetched over the resource
        // scheme, because an event this size costs thirty-six seconds to
        // escape. @see provide()
        auto* object = new juce::DynamicObject();
        object->setProperty ("generation", (juce::int64) song.generation);
        browser.emitEventIfBrowserIsVisible ("jaminSong", juce::var (object));
    }

    // Somebody muted a track, soloed one, renamed one, or changed what one is
    // playing. One atomic load unless it did.
    if (const auto revision = jamin::Roster::instance().revision(); revision != lastRoster)
    {
        lastRoster = revision;
        auto* object = new juce::DynamicObject();
        object->setProperty ("me", plugin.instanceId);
        object->setProperty ("instances", juce::JSON::parse (jamin::Roster::instance().json()));
        browser.emitEventIfBrowserIsVisible ("jaminRoster", juce::var (object));
    }

    // Another window has asked this instance to play something. Only this
    // instance can act on it: the catalogue the name is looked up in lives in
    // this page and nowhere else.
    {
        std::string wanted;
        if (jamin::Roster::instance().takePhraseRequest (plugin.seat, wanted, lastPhraseRequest))
        {
            auto* object = new juce::DynamicObject();
            object->setProperty ("phrase", juce::String (wanted));
            browser.emitEventIfBrowserIsVisible ("jaminSetPhrase", juce::var (object));
        }
    }

    // And another window has asked this instance to bind its drums differently.
    // Same reason again: the grooves are in this page's database.
    //
    // A request made while this window was shut waited in the slot, so opening
    // the window is when it arrives -- which is the first moment anything could
    // have acted on it.
    {
        std::string wantedDrums;
        if (jamin::Roster::instance().takeDrumsRequest (plugin.seat, wantedDrums, lastDrumsRequest))
        {
            auto* object = new juce::DynamicObject();
            object->setProperty ("drums", juce::JSON::parse (juce::String (wantedDrums)));
            browser.emitEventIfBrowserIsVisible ("jaminSetDrums", juce::var (object));
        }
    }

    // Another window has asked this instance to silence some of its drums.
    {
        uint64_t wanted = 0;
        if (jamin::Roster::instance().takeVoiceMutesRequest (plugin.seat, wanted, lastMutesRequest))
        {
            for (int at = 0; at < JaminProcessor::numVoices; ++at)
                plugin.setVoiceSounding (at, (wanted & (1ull << at)) == 0, plugin.nextBoundaryPpq());
        }
    }

    // A DAW nudged the articulation. Which one comes next is a question about a
    // catalogue that lives in the browser, so the answer is the page's.
    if (const auto step = plugin.phraseStep.exchange (0, std::memory_order_relaxed); step != 0)
    {
        auto* object = new juce::DynamicObject();
        object->setProperty ("step", step);
        browser.emitEventIfBrowserIsVisible ("jaminPhraseStep", juce::var (object));
    }

    if (const auto rolls = plugin.phraseRandom.exchange (0, std::memory_order_relaxed); rolls != 0)
        browser.emitEventIfBrowserIsVisible ("jaminPhraseRandom", juce::var (true));

    // The other three dice, for the same reason: what a random drum pattern or
    // a random progression *is* lives in a catalogue in this page.
    if (plugin.drumsRandom.exchange (0, std::memory_order_relaxed) != 0)
        browser.emitEventIfBrowserIsVisible ("jaminRollDrums", juce::var (true));

    if (plugin.progressionRandom.exchange (0, std::memory_order_relaxed) != 0)
        browser.emitEventIfBrowserIsVisible ("jaminRollProgression", juce::var (true));

    if (plugin.songRandom.exchange (0, std::memory_order_relaxed) != 0)
        browser.emitEventIfBrowserIsVisible ("jaminRollSong", juce::var (true));

    // What the drums are doing, so a switch thrown in the DAW shows in the
    // window. Sent only when it changes: fourteen booleans compared is cheaper
    // than one event nobody needed.
    {
        uint32_t now = 0;
        for (int at = 0; at < JaminProcessor::numVoices; ++at)
            if (! plugin.voices[at].soundingAfter.load (std::memory_order_relaxed))
                now |= (1u << at);

        if (now != lastVoiceMutes)
        {
            lastVoiceMutes = now;
            auto* object = new juce::DynamicObject();
            object->setProperty ("muted", (int) now);
            browser.emitEventIfBrowserIsVisible ("jaminDrumMutes", juce::var (object));
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
