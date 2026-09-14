#include "jamin/Roster.h"

#include <algorithm>

namespace jamin
{

namespace
{

/** JSON string escaping, for the handful of characters a track name can hold. */
std::string escape (const std::string& text)
{
    std::string out;
    out.reserve (text.size() + 8);
    for (const char c : text)
    {
        switch (c)
        {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if ((unsigned char) c < 0x20)
                    out += ' ';
                else
                    out += c;
        }
    }
    return out;
}

} // namespace

Roster& Roster::instance()
{
    static Roster only;
    return only;
}

Roster::Handle Roster::join (const std::string& id)
{
    const std::lock_guard<std::mutex> guard (lock);

    // An instance that rejoins under the same id -- a host rebuilding its graph
    // does this -- takes its old place rather than appearing twice.
    for (const auto& existing : slots)
        if (existing->id == id)
            return existing;

    auto slot = std::make_shared<Slot>();
    slot->id = id;
    slot->order = nextOrder++;
    slots.push_back (slot);

    recompute (-1.0);
    return slot;
}

void Roster::leave (const Handle& slot)
{
    if (slot == nullptr)
        return;

    const std::lock_guard<std::mutex> guard (lock);
    slots.erase (std::remove (slots.begin(), slots.end(), slot), slots.end());
    recompute (-1.0);
}

void Roster::describe (const Handle& slot, const std::string& name, const std::string& phrase)
{
    if (slot == nullptr)
        return;

    const std::lock_guard<std::mutex> guard (lock);
    if (slot->name == name && slot->phrase == phrase)
        return;                            // nothing a person would see changed

    slot->name = name;
    slot->phrase = phrase;
    version.fetch_add (1, std::memory_order_release);
}

void Roster::setMuted (const std::string& id, bool muted, double atPpq)
{
    const std::lock_guard<std::mutex> guard (lock);
    for (const auto& slot : slots)
        if (slot->id == id)
        {
            if (slot->wantMuted == muted)
                return;
            slot->wantMuted = muted;
            recompute (atPpq);
            return;
        }
}

void Roster::setSoloed (const std::string& id, bool soloed, double atPpq)
{
    const std::lock_guard<std::mutex> guard (lock);
    for (const auto& slot : slots)
        if (slot->id == id)
        {
            if (slot->wantSoloed == soloed)
                return;
            slot->wantSoloed = soloed;
            recompute (atPpq);
            return;
        }
}

void Roster::requestPhrase (const std::string& id, const std::string& phrase)
{
    const std::lock_guard<std::mutex> guard (lock);
    for (const auto& slot : slots)
        if (slot->id == id)
        {
            slot->wantPhrase = phrase;
            slot->wantPhraseRevision += 1;
            version.fetch_add (1, std::memory_order_release);
            return;
        }
}

bool Roster::takePhraseRequest (const Handle& slot, std::string& phrase, uint64_t& seen) const
{
    if (slot == nullptr)
        return false;

    const std::lock_guard<std::mutex> guard (lock);
    if (slot->wantPhraseRevision == seen)
        return false;

    seen = slot->wantPhraseRevision;
    phrase = slot->wantPhrase;
    return true;
}

bool Roster::anySoloed() const
{
    const std::lock_guard<std::mutex> guard (lock);
    for (const auto& slot : slots)
        if (slot->wantSoloed)
            return true;
    return false;
}

void Roster::recompute (double atPpq)
{
    // Solo is a statement about everybody else, not about the soloed track: with
    // one instance soloed the others go quiet without anyone having muted them,
    // and their own mute switches are left exactly as they were for when solo is
    // let go again.
    bool soloing = false;
    for (const auto& slot : slots)
        if (slot->wantSoloed)
            soloing = true;

    for (const auto& slot : slots)
    {
        const bool audible = soloing ? slot->wantSoloed : ! slot->wantMuted;

        if (atPpq < 0.0)
        {
            // Now. Both sides agree, so there is no moment for the audio thread
            // to be waiting for.
            slot->audibleBefore.store (audible, std::memory_order_relaxed);
            slot->audibleAfter.store (audible, std::memory_order_relaxed);
            slot->changeAtPpq.store (-1.0, std::memory_order_release);
        }
        else
        {
            // Every slot is given the same moment, so a solo that silences three
            // tracks silences them together rather than over three blocks.
            slot->audibleAfter.store (audible, std::memory_order_relaxed);
            slot->changeAtPpq.store (atPpq, std::memory_order_release);
        }
    }

    version.fetch_add (1, std::memory_order_release);
}

void Roster::settle (double ppq)
{
    const std::lock_guard<std::mutex> guard (lock);

    bool moved = false;
    for (const auto& slot : slots)
    {
        const double at = slot->changeAtPpq.load (std::memory_order_acquire);
        if (at < 0.0 || ppq < at)
            continue;

        slot->audibleBefore.store (slot->audibleAfter.load (std::memory_order_relaxed),
                                   std::memory_order_relaxed);
        slot->changeAtPpq.store (-1.0, std::memory_order_release);
        moved = true;
    }

    if (moved)
        version.fetch_add (1, std::memory_order_release);
}

std::vector<Roster::Entry> Roster::entries() const
{
    const std::lock_guard<std::mutex> guard (lock);

    std::vector<Entry> out;
    out.reserve (slots.size());
    for (const auto& slot : slots)
        out.push_back ({ slot->id, slot->name, slot->phrase,
                         slot->wantMuted, slot->wantSoloed,
                         slot->audibleAfter.load (std::memory_order_relaxed),
                         slot->order });

    std::sort (out.begin(), out.end(),
               [] (const Entry& a, const Entry& b) { return a.order < b.order; });
    return out;
}

std::string Roster::json() const
{
    const auto list = entries();

    std::string out = "[";
    bool first = true;
    for (const auto& entry : list)
    {
        if (! first) out += ',';
        first = false;
        out += "{\"id\":\"" + escape (entry.id)
             + "\",\"name\":\"" + escape (entry.name)
             + "\",\"phrase\":\"" + escape (entry.phrase)
             + "\",\"muted\":" + (entry.muted ? "true" : "false")
             + ",\"soloed\":" + (entry.soloed ? "true" : "false")
             + ",\"audible\":" + (entry.audible ? "true" : "false")
             + ",\"order\":" + std::to_string (entry.order) + "}";
    }
    return out + "]";
}

} // namespace jamin
