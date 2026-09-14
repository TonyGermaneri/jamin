#pragma once

#include <cstdint>
#include <string>

namespace jamin
{

/**
    The one chord chart, shared by every instance that is running.

    The requirement is several plugins on several tracks, each playing its own
    phrase, all reading the same progression and all following an edit to it
    immediately. Nothing in an audio plugin API does that -- a host has no idea
    that two instances of a plugin are related -- so the channel has to sit
    outside the DAW altogether. This is that channel.

    **What is shared is the document, not the clock.** Every instance takes its
    position from its own host playhead, which is the same transport, sample-
    accurate, and already identical across every track in the session. So this
    only has to carry the text, and it can take a few milliseconds to do it
    without anybody hearing a thing. That is the observation the whole design
    rests on: trying to synchronise playback between instances would be a hard
    real-time problem, and synchronising the document is not a real-time problem
    at all.

    The transport is a named shared-memory segment with a seqlock over it, so a
    reader never blocks a writer and there is no daemon, no socket and no
    listening port anywhere. A POSIX segment from `shm_open` on macOS and Linux,
    a pagefile-backed section from `CreateFileMapping` on Windows: the same
    bytes and the same seqlock either way, and only the four calls that get the
    memory differ. A file in Application Support -- Local AppData on Windows --
    backs it up, so the chart survives every instance closing.

    The payload is opaque: whatever JSON the page decided to publish. Nothing
    here parses it, for the same reason nothing here parses a chord.
*/
class SongBus
{
public:
    /** One per process. Instances in the same host share this directly; instances
        in other processes meet through the shared segment. */
    static SongBus& instance();

    struct Snapshot
    {
        uint64_t generation { 0 };
        std::string json;
    };

    /** Replace the shared document. Returns the generation it was given. */
    uint64_t publish (const std::string& json);

    /** The document as it stands. Cheap: it is served from the local copy unless
        somebody else has published since the last poll(). */
    Snapshot snapshot() const;

    /** Pick up anything published by another process. Returns true if the
        document changed. Call it from a timer; it is a single atomic load in the
        common case.

        **Its answer is about other processes, not about the chart.** A publish
        from this process has already moved the local copy, so poll() has nothing
        left to report and says false -- correctly. Anything deciding whether to
        redraw wants `generation()`, which is about the chart. Gating on poll()
        instead means every instance in one host misses every edit made in that
        same host, which is the case this was built for. */
    bool poll();

    /** Which version of the chart this process holds. Cheap enough to compare on
        a timer: no copy, unlike snapshot(). */
    uint64_t generation() const;

    /** True if the cross-process segment is live. False means this process is on
        its own -- a sandbox refused the segment -- and instances inside it still
        share correctly through the singleton. */
    bool isShared() const { return shared != nullptr; }

    /** Where the durable copy lives. */
    static std::string storagePath();

    /** Forget a segment by name. A test seam: the segment outlives the process
        that made it on POSIX, so a run has to clear up after the last one. On
        Windows a section dies with its last handle and this does nothing. */
    static void forget (const char* segmentName);

    // Test seams. attach() is called by instance(); the tests drive it directly
    // so they can use a private segment instead of the real one.
    explicit SongBus (const char* segmentName, const std::string& filePath);
    ~SongBus();

    SongBus (const SongBus&) = delete;
    SongBus& operator= (const SongBus&) = delete;

private:
    void writeFile() const;
    bool readFile();

    struct Shared;
    Shared* shared { nullptr };

    // The segment's own handle, in the platform's own type rather than one
    // pretending to be the other: a descriptor from shm_open, or a Windows
    // section handle, which is a pointer and is not -1 when it is missing.
   #if defined (_WIN32)
    void* section { nullptr };
   #else
    int fd { -1 };
   #endif

    size_t mapped { 0 };
    std::string path;

    // The local copy. Reading the segment on every query would be a syscall-free
    // but still needless memcpy of the whole chart at 30 Hz.
    mutable uint64_t localGeneration { 0 };
    mutable std::string localJson;
};

} // namespace jamin
