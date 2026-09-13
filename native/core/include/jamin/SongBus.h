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

    The transport is a POSIX shared-memory segment with a seqlock over it, so a
    reader never blocks a writer and there is no daemon, no socket and no
    listening port anywhere. A file in Application Support backs it up, so the
    chart survives every instance closing.

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
        common case. */
    bool poll();

    /** True if the cross-process segment is live. False means this process is on
        its own -- a sandbox refused the segment -- and instances inside it still
        share correctly through the singleton. */
    bool isShared() const { return shared != nullptr; }

    /** Where the durable copy lives. */
    static std::string storagePath();

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
    int fd { -1 };
    size_t mapped { 0 };
    std::string path;

    // The local copy. Reading the segment on every query would be a syscall-free
    // but still needless memcpy of the whole chart at 30 Hz.
    mutable uint64_t localGeneration { 0 };
    mutable std::string localJson;
};

} // namespace jamin
