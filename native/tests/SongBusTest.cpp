#include "check.h"
#include <jamin/SongBus.h>

#include <jamin/Platform.h>

#include <cstdio>
#include <filesystem>

using namespace jamin;

void songBusTests()
{
    // A private segment and a private file, so the suite never touches the real
    // one and two runs cannot interfere with each other.
    const auto name = std::string ("/jamin.test.") + std::to_string (processId());
    const auto dir = std::filesystem::temp_directory_path()
                   / ("jamin-test-" + std::to_string (processId()));
    const auto file = (dir / "song.json").string();
    SongBus::forget (name.c_str());

    {
        SongBus a { name.c_str(), file };
        check ("starts empty", a.snapshot().json.empty());
        check ("generation starts at zero", a.snapshot().generation, (uint64_t) 0);

        const auto generation = a.publish ("{\"text\":\"Cm7 F7\"}");
        check ("publishing advances the generation", generation, (uint64_t) 1);
        checkEqual ("and it reads back", a.snapshot().json, "{\"text\":\"Cm7 F7\"}");

        // A second bus is another instance -- in this process here, in another
        // one in real life; the segment does not know the difference. It picks
        // the chart up as it attaches, so a plugin added to a session halfway
        // through is already in step rather than blank until the next edit.
        SongBus b { name.c_str(), file + ".other" };
        checkEqual ("a new instance joins in step", b.snapshot().json, "{\"text\":\"Cm7 F7\"}");

        check ("and polling finds nothing new", ! b.poll());

        a.publish ("{\"text\":\"Abmaj7\"}");
        check ("an edit propagates", b.poll());
        checkEqual ("with the new text", b.snapshot().json, "{\"text\":\"Abmaj7\"}");

        // Publishing from the other end works the same way; there is no owner.
        b.publish ("{\"text\":\"Bb6\"}");
        check ("it goes both ways", a.poll());
        checkEqual ("either direction", a.snapshot().json, "{\"text\":\"Bb6\"}");

        // A chart too large for the segment is refused rather than truncated.
        const auto before = a.snapshot().json;
        a.publish (std::string (2u << 20, 'x'));
        checkEqual ("an oversized chart is refused", a.snapshot().json, before);

        check ("the segment came up", a.isShared());

        // Two editors in one process -- two plugin instances on two tracks in
        // one DAW. They share this one bus, and each keeps its own idea of what
        // it last handed its page.
        //
        // This is the case the whole segment exists for, and it is the one that
        // was broken: the editor asked poll(), which answers "has another
        // *process* written", and a publish from this process has already moved
        // the local copy -- so poll() said no, correctly, and every other
        // instance in the same host stayed silent for ever.
        uint64_t editorB = a.generation();
        const auto published = a.publish ("{\"text\":\"Bb7 Eb\"}");
        check ("poll says nothing arrived, because nothing did", ! a.poll());
        check ("but the chart moved all the same", a.generation(), published);
        check ("so the other editor in this process can see it",
               a.generation() != editorB);
        editorB = a.generation();
        check ("and having caught up, has nothing more to do", a.generation(), editorB);
    }

    // The durable copy: a fresh process with an empty segment picks the chart
    // back up off disk rather than starting blank. Both buses above have gone
    // out of scope by now, which on Windows is what destroys the section --
    // there is no name left to unlink, and forget() says so by doing nothing.
    SongBus::forget (name.c_str());
    {
        SongBus c { name.c_str(), file };
        check ("the chart survived every instance closing", ! c.snapshot().json.empty());
    }

    SongBus::forget (name.c_str());
    std::error_code ec;
    std::filesystem::remove_all (dir, ec);
    std::filesystem::remove (file + ".other", ec);
}
