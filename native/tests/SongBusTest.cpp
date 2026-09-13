#include "check.h"
#include <jamin/SongBus.h>

#include <cstdio>
#include <filesystem>
#include <sys/mman.h>
#include <unistd.h>

using namespace jamin;

void songBusTests()
{
    // A private segment and a private file, so the suite never touches the real
    // one and two runs cannot interfere with each other.
    const auto name = std::string ("/jamin.test.") + std::to_string (::getpid());
    const auto dir = std::filesystem::temp_directory_path()
                   / ("jamin-test-" + std::to_string (::getpid()));
    const auto file = (dir / "song.json").string();
    ::shm_unlink (name.c_str());

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
    }

    // The durable copy: a fresh process with an empty segment picks the chart
    // back up off disk rather than starting blank.
    ::shm_unlink (name.c_str());
    {
        SongBus c { name.c_str(), file };
        check ("the chart survived every instance closing", ! c.snapshot().json.empty());
    }

    ::shm_unlink (name.c_str());
    std::error_code ec;
    std::filesystem::remove_all (dir, ec);
    std::filesystem::remove (file + ".other", ec);
}
