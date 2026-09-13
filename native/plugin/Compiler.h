#pragma once

#include <jamin/Sequence.h>
#include <juce_core/juce_core.h>

#include <memory>

namespace jamin
{

/**
    jamin's own music code, run headless.

    The chart, the phrases and the voice leading are JavaScript and stay
    JavaScript. This evaluates the very bundle the page is built from inside a
    JSContext -- JavaScriptCore is on every Mac and is the same engine the test
    suite has always used -- and asks it for the compiled sequence.

    So there is one implementation of the harmony, not two that agree until they
    do not. It is also what makes the editor window disposable: the compiler was
    never in the window, so a chart edit arriving with the window shut still
    turns into notes.

    Not real-time safe and never called from the audio thread. Compiling is a
    background job whose answer is handed over as a finished Sequence.

    @see src/core/compile.js
*/
class Compiler
{
public:
    Compiler();
    ~Compiler();

    /** Evaluate the bundle. False if it is missing or would not parse, in which
        case `lastError` says why. */
    bool load (const juce::File& bundle);

    bool isLoaded() const noexcept { return loaded; }

    /** Turn a request into a sequence. Returns nullptr on failure, with
        `lastError` set. Takes and returns JSON because that is the only thing
        the boundary carries. */
    std::unique_ptr<Sequence> compile (const juce::String& requestJson);

    juce::String lastError;

    /** What the last compile reported about itself, for the editor to show. */
    int lastChordCount { 0 };

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
    bool loaded { false };

    JUCE_DECLARE_NON_COPYABLE (Compiler)
};

} // namespace jamin
