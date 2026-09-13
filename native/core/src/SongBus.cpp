#include "jamin/SongBus.h"

#include <atomic>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

namespace jamin
{

namespace
{
constexpr uint32_t kMagic = 0x6a616d31;   // 'jam1'
constexpr size_t kCapacity = 1u << 20;    // 1 MiB of chart is about 20,000 bars
std::mutex& localLock() { static std::mutex m; return m; }
}

/**
    The segment.

    A seqlock rather than a mutex: a writer must never be able to leave a lock
    held across a crash and wedge every other instance in the session, and a
    reader must never block the message thread of a DAW it does not own. The
    cost is that a reader may have to try twice, which is free.
*/
struct SongBus::Shared
{
    std::atomic<uint32_t> magic;
    std::atomic<uint32_t> version;
    std::atomic<uint64_t> seq;          ///< odd while a write is in progress
    std::atomic<uint64_t> generation;
    std::atomic<uint32_t> length;
    char text[kCapacity];
};

std::string SongBus::storagePath()
{
    const char* home = std::getenv ("HOME");
    std::filesystem::path dir = home != nullptr ? std::filesystem::path (home) : std::filesystem::temp_directory_path();
#if defined (__APPLE__)
    dir /= "Library/Application Support/jamin";
#else
    dir /= ".local/share/jamin";
#endif
    return (dir / "song.json").string();
}

SongBus& SongBus::instance()
{
    static SongBus bus { "/jamin.song.v1", storagePath() };
    return bus;
}

SongBus::SongBus (const char* segmentName, const std::string& filePath)
    : path (filePath)
{
    // A host that sandboxes its plugins can refuse this, and that must not be
    // fatal: instances inside this process still share through the singleton,
    // and the file still carries the chart between sessions. Losing the segment
    // costs cross-process sharing, not the feature.
    fd = ::shm_open (segmentName, O_CREAT | O_RDWR, 0600);

    if (fd >= 0)
    {
        struct ::stat info {};
        const bool fresh = ::fstat (fd, &info) == 0 && info.st_size < (off_t) sizeof (Shared);

        if (! fresh || ::ftruncate (fd, sizeof (Shared)) == 0)
        {
            void* p = ::mmap (nullptr, sizeof (Shared), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);

            if (p != MAP_FAILED)
            {
                shared = static_cast<Shared*> (p);
                mapped = sizeof (Shared);

                // Whoever gets there first stamps it. A second instance racing
                // through here writes the same values, so the race is benign.
                if (shared->magic.load (std::memory_order_acquire) != kMagic)
                {
                    shared->seq.store (0, std::memory_order_relaxed);
                    shared->generation.store (0, std::memory_order_relaxed);
                    shared->length.store (0, std::memory_order_relaxed);
                    shared->version.store (1, std::memory_order_relaxed);
                    shared->magic.store (kMagic, std::memory_order_release);
                }
            }
        }
    }

    if (fd >= 0 && shared == nullptr)
    {
        ::close (fd);
        fd = -1;
    }

    // Which way this goes depends on who got here first. A segment somebody is
    // already using is the truth and the file on disk is stale, so read it. But
    // a virgin segment -- the first instance after a reboot -- knows nothing,
    // and polling it would overwrite the chart just loaded from disk with
    // nothing at all. In that case the file seeds the segment instead.
    readFile();

    if (shared != nullptr && shared->generation.load (std::memory_order_acquire) == 0)
    {
        if (! localJson.empty())
            publish (localJson);
    }
    else
    {
        poll();
    }
}

SongBus::~SongBus()
{
    if (shared != nullptr)
        ::munmap (shared, mapped);
    if (fd >= 0)
        ::close (fd);
}

uint64_t SongBus::publish (const std::string& json)
{
    if (json.size() >= kCapacity)
        return localGeneration;    // refuse rather than truncate somebody's song

    std::lock_guard<std::mutex> guard (localLock());

    const uint64_t next = localGeneration + 1;
    localGeneration = next;
    localJson = json;

    if (shared != nullptr)
    {
        const uint64_t s = shared->seq.load (std::memory_order_relaxed);
        shared->seq.store (s + 1, std::memory_order_release);          // odd: writing
        std::atomic_thread_fence (std::memory_order_release);

        std::memcpy (shared->text, json.data(), json.size());
        shared->length.store (static_cast<uint32_t> (json.size()), std::memory_order_relaxed);
        shared->generation.store (next, std::memory_order_relaxed);

        std::atomic_thread_fence (std::memory_order_release);
        shared->seq.store (s + 2, std::memory_order_release);          // even: settled
    }

    writeFile();
    return next;
}

SongBus::Snapshot SongBus::snapshot() const
{
    std::lock_guard<std::mutex> guard (localLock());
    return { localGeneration, localJson };
}

bool SongBus::poll()
{
    if (shared == nullptr)
        return false;

    if (shared->magic.load (std::memory_order_acquire) != kMagic)
        return false;

    // The common case, and the only one that runs at timer rate: one load, no
    // copy, no lock.
    if (shared->generation.load (std::memory_order_acquire) == localGeneration)
        return false;

    for (int attempt = 0; attempt < 8; ++attempt)
    {
        const uint64_t before = shared->seq.load (std::memory_order_acquire);
        if ((before & 1u) != 0u)
            continue;                    // a write is in flight; look again

        const uint64_t generation = shared->generation.load (std::memory_order_relaxed);
        const uint32_t length = shared->length.load (std::memory_order_relaxed);
        if (length >= kCapacity)
            return false;

        std::string text (shared->text, length);
        std::atomic_thread_fence (std::memory_order_acquire);

        if (shared->seq.load (std::memory_order_acquire) != before)
            continue;                    // it moved under us; the copy is torn

        if (generation == localGeneration)
            return false;

        {
            std::lock_guard<std::mutex> guard (localLock());
            localGeneration = generation;
            localJson = std::move (text);
        }
        return true;
    }

    return false;
}

void SongBus::writeFile() const
{
    if (path.empty())
        return;

    std::error_code ec;
    std::filesystem::create_directories (std::filesystem::path (path).parent_path(), ec);

    // Written to a sibling and renamed, so a reader never sees half a chart and
    // a crash mid-write leaves the previous one intact.
    const std::string temp = path + ".tmp";
    {
        std::ofstream out (temp, std::ios::binary | std::ios::trunc);
        if (! out)
            return;
        out.write (localJson.data(), static_cast<std::streamsize> (localJson.size()));
    }
    std::filesystem::rename (temp, path, ec);
}

bool SongBus::readFile()
{
    std::ifstream in (path, std::ios::binary);
    if (! in)
        return false;

    std::string text { std::istreambuf_iterator<char> (in), std::istreambuf_iterator<char>() };
    if (text.empty() || text.size() >= kCapacity)
        return false;

    std::lock_guard<std::mutex> guard (localLock());
    if (localGeneration != 0)
        return false;                    // the segment already had something newer

    localGeneration = 1;
    localJson = std::move (text);
    return true;
}

} // namespace jamin
