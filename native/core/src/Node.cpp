#include "jamin/Node.h"

namespace jamin
{

namespace
{

/** One string value out of flat JSON, without dragging in a JSON parser for it. */
std::string field (const std::string& json, const std::string& name)
{
    const auto key = "\"" + name + "\":\"";
    const auto at = json.find (key);
    if (at == std::string::npos) return {};
    const auto from = at + key.size();
    const auto to = json.find ('"', from);
    return to == std::string::npos ? std::string {} : json.substr (from, to - from);
}

std::string escape (const std::string& text)
{
    std::string out;
    out.reserve (text.size());
    for (const char c : text)
    {
        if (c == '"' || c == '\\') out += '\\';
        out += (c == '\n' || c == '\r') ? ' ' : c;
    }
    return out;
}

/// A chart is small and a session is finite, but an append-only log is still
/// append-only. Far more than a day of typing, and far less than a problem.
constexpr size_t kMaxLog = 20000;
constexpr size_t kMaxSeen = 4096;

} // namespace

Node::~Node() { stop(); }

bool Node::start (Options options)
{
    stop();
    lastError.clear();
    secret = options.secret;

    endpoint.onOps = [this] (const std::string& body) { submit (body); };
    endpoint.peersJson = [this] { return peersJson(); };
    endpoint.docJson = [this] { return docJson(); };

    Endpoint::Options served;
    served.port = options.port;
    served.files = options.files;
    served.onNetwork = options.onNetwork;
    served.secret = options.secret;

    if (! endpoint.start (served))
    {
        lastError = endpoint.lastError;
        return false;
    }

    Discovery::Options announced;
    announced.id = options.id;
    announced.name = options.name;
    announced.port = endpoint.port();
    announced.group = options.group;
    announced.groupPort = options.groupPort;
    announced.beaconMs = options.beaconMs;
    announced.forgetMs = options.forgetMs;

    if (! discovery.start (announced))
    {
        // A machine with no network is a machine with no peers, not a failure
        // to start. The page still works and the endpoint still serves it.
        lastError = discovery.lastError;
    }

    return true;
}

void Node::stop()
{
    discovery.stop();
    endpoint.stop();

    const std::lock_guard<std::mutex> guard (lock);
    seen.clear();
    order.clear();
    log.clear();
}

bool Node::remember (const std::string& envelope)
{
    const auto message = field (envelope, "m");
    if (message.empty())
        return true;   // unlabelled: pass it on rather than swallow it

    const std::lock_guard<std::mutex> guard (lock);
    if (! seen.insert (message).second)
        return false;  // round it goes; stop it here

    order.push_back (message);
    while (order.size() > kMaxSeen)
    {
        seen.erase (order.front());
        order.pop_front();
    }

    if (log.size() < kMaxLog)
        log.push_back (envelope);

    return true;
}

void Node::submit (const std::string& envelope)
{
    if (envelope.empty() || ! remember (envelope))
        return;

    // Everybody attached here hears it -- browsers over the stream, and the
    // plugin's own editor through the bridge, since its page cannot use HTTP.
    endpoint.broadcast ("ops", envelope);
    if (onRemoteOps)
        onRemoteOps (envelope);

    // And so does every other machine. The duplicate check above is what makes
    // that a relay rather than a broadcast storm.
    for (const auto& peer : discovery.peers())
        postTo (peer.host, peer.port, "/ops", envelope, secret);
}

std::string Node::peersJson() const
{
    std::string json = "[";
    bool first = true;

    for (const auto& peer : discovery.peers())
    {
        if (! first) json += ',';
        first = false;
        json += "{\"id\":\"" + escape (peer.id)
              + "\",\"name\":\"" + escape (peer.name)
              + "\",\"host\":\"" + escape (peer.host)
              + "\",\"port\":" + std::to_string (peer.port) + "}";
    }

    return json + "]";
}

std::string Node::docJson() const
{
    const std::lock_guard<std::mutex> guard (lock);
    std::string json = "[";

    for (size_t i = 0; i < log.size(); ++i)
    {
        if (i) json += ',';
        json += log[i];
    }

    return json + "]";
}

int Node::peerCount() const
{
    return (int) discovery.peers().size();
}

} // namespace jamin
