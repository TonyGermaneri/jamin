#include "check.h"
#include <jamin/Node.h>

#include <thread>
#include <jamin/Platform.h>

using namespace jamin;

namespace
{

template <typename Condition>
bool eventually (Condition condition, int milliseconds = 5000)
{
    const auto until = nowMs() + (uint64_t) milliseconds;
    while (nowMs() < until)
    {
        if (condition()) return true;
        std::this_thread::sleep_for (std::chrono::milliseconds (25));
    }
    return condition();
}

Node::Options options (const char* id)
{
    Node::Options out;
    out.id = id;
    out.name = id;
    out.secret = "test-word";
    out.onNetwork = true;          // peers reach each other by address, not loopback
    out.group = "239.77.65.201";
    out.groupPort = 20000 + (int) (processId() % 20000);
    out.beaconMs = 150;
    out.forgetMs = 900;
    return out;
}

} // namespace

void nodeTests()
{
    Node one, two;
    std::vector<std::string> heardByOne, heardByTwo;
    one.onRemoteOps = [&] (const std::string& e) { heardByOne.push_back (e); };
    two.onRemoteOps = [&] (const std::string& e) { heardByTwo.push_back (e); };

    check ("a node starts", one.start (options ("one")), true);
    if (! one.isRunning()) { std::printf ("     %s\n", one.lastError.c_str()); return; }
    check ("and a second", two.start (options ("two")), true);
    check ("each was given a port", one.port() > 0 && two.port() > 0);

    check ("they find each other",
           eventually ([&] { return one.peerCount() == 1 && two.peerCount() == 1; }));
    check ("and say so", one.peersJson().find ("\"name\":\"two\"") != std::string::npos,
           one.peersJson());

    /* ---------------- an edit travels ---------------- */
    one.submit (R"({"m":"one-1","from":"a","ops":[{"t":"ins"}]})");

    check ("the other node hears it",
           eventually ([&] { return ! heardByTwo.empty(); }));
    checkEqual ("and it arrived whole",
                heardByTwo.empty() ? std::string() : heardByTwo[0],
                R"({"m":"one-1","from":"a","ops":[{"t":"ins"}]})");
    check ("the node that sent it also sees it once", heardByOne.size(), 1u);

    /* ---------------- and does not go round for ever ---------------- */
    const auto before = heardByOne.size() + heardByTwo.size();
    one.submit (R"({"m":"one-1","from":"a","ops":[{"t":"ins"}]})");
    std::this_thread::sleep_for (std::chrono::milliseconds (400));
    check ("an envelope already seen is dropped", heardByOne.size() + heardByTwo.size(), before);

    /* ---------------- a newcomer is caught up ---------------- */
    check ("the log has it", one.docJson().find ("one-1") != std::string::npos);
    check ("and the other node kept it too", two.docJson().find ("one-1") != std::string::npos);

    Node three;
    three.start (options ("three"));
    check ("a node that arrives later is found",
           eventually ([&] { return one.peerCount() == 2 && three.peerCount() == 2; }));

    three.submit (R"({"m":"three-1","from":"c","ops":[]})");
    check ("and can be heard by everyone",
           eventually ([&] {
               return one.docJson().find ("three-1") != std::string::npos
                   && two.docJson().find ("three-1") != std::string::npos;
           }));

    /* ---------------- leaving ---------------- */
    three.stop();
    check ("a node that leaves is forgotten",
           eventually ([&] { return one.peerCount() == 1; }, 4000));

    /* ---------------- nonsense ---------------- */
    const auto steady = heardByOne.size();
    one.submit ("");
    check ("an empty envelope does nothing", heardByOne.size(), steady);

    /* ---------------- and no word, no node ---------------- */
    {
        Node shut;
        auto bare = options ("shut");
        bare.secret.clear();
        check ("a node with no password refuses to start", shut.start (bare), false);
        check ("and is not running", shut.isRunning(), false);
    }

    one.stop();
    two.stop();
    checkEqual ("stopping clears the log", one.docJson(), "[]");
}
