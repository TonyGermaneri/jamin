/*
    The shared chart between instances in one process, on a platform without
    POSIX shared memory.

    The file behind it is portable and does the durable half; what is missing is
    the segment that lets separate processes see each other's edits without one.
    So this keeps the chart, keeps it on disk, and reports honestly that it is
    not shared beyond this process. @see SongBus.cpp
*/
#include "jamin/SongBus.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <mutex>

namespace jamin
{

namespace { std::mutex& localLock() { static std::mutex m; return m; } }

struct SongBus::Shared {};

std::string SongBus::storagePath()
{
    const char* home = std::getenv ("USERPROFILE");
    if (home == nullptr) home = std::getenv ("HOME");
    std::filesystem::path dir = home != nullptr ? std::filesystem::path (home)
                                                : std::filesystem::temp_directory_path();
    return (dir / "jamin" / "song.json").string();
}

SongBus& SongBus::instance()
{
    static SongBus bus { "", storagePath() };
    return bus;
}

SongBus::SongBus (const char*, const std::string& filePath) : path (filePath) { readFile(); }
SongBus::~SongBus() = default;

uint64_t SongBus::publish (const std::string& json)
{
    const std::lock_guard<std::mutex> guard (localLock());
    localGeneration += 1;
    localJson = json;
    writeFile();
    return localGeneration;
}

SongBus::Snapshot SongBus::snapshot() const
{
    const std::lock_guard<std::mutex> guard (localLock());
    return { localGeneration, localJson };
}

bool SongBus::poll() { return false; }

void SongBus::writeFile() const
{
    if (path.empty()) return;
    std::error_code ec;
    std::filesystem::create_directories (std::filesystem::path (path).parent_path(), ec);
    const std::string temp = path + ".tmp";
    { std::ofstream out (temp, std::ios::binary | std::ios::trunc);
      if (! out) return;
      out.write (localJson.data(), (std::streamsize) localJson.size()); }
    std::filesystem::rename (temp, path, ec);
}

bool SongBus::readFile()
{
    std::ifstream in (path, std::ios::binary);
    if (! in) return false;
    std::string text { std::istreambuf_iterator<char> (in), std::istreambuf_iterator<char>() };
    if (text.empty()) return false;
    const std::lock_guard<std::mutex> guard (localLock());
    if (localGeneration != 0) return false;
    localGeneration = 1;
    localJson = std::move (text);
    return true;
}

} // namespace jamin
