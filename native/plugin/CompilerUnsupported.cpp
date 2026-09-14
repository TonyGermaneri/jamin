/*
    The compiler, on a platform with no JavaScriptCore.

    jamin's music lives in JavaScript and the plugin runs it headless to turn a
    chart into a sequence. macOS ships JavaScriptCore, which is why that works
    there with nothing added. Windows ships no JavaScript engine at all, so until
    one is embedded -- QuickJS is the obvious candidate: one file, MIT, and
    already the shape this expects -- the plugin there can show the page and
    cannot play it.

    Refusing loudly rather than returning an empty sequence: an empty sequence is
    indistinguishable from a chart with nothing in it, and this is not that.

    @see Compiler.cpp
*/
#include "Compiler.h"

namespace jamin
{

struct Compiler::Impl {};

Compiler::Compiler() : impl (std::make_unique<Impl>()) {}
Compiler::~Compiler() = default;

bool Compiler::load (const juce::File&)
{
    lastError = "jamin has no JavaScript engine on this platform yet, so it cannot work out "
                "what to play. The chart and the editor work; the notes do not.";
    loaded = false;
    return false;
}

std::unique_ptr<Sequence> Compiler::compile (const juce::String&)
{
    lastError = "no JavaScript engine on this platform";
    return nullptr;
}

} // namespace jamin
