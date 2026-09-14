/*
    The compiler: jamin's own music code, run headless.

    The chart, the phrases and the voice leading are JavaScript and stay
    JavaScript. This loads the very bundle the page is built from and asks it for
    the compiled sequence, so there is one implementation of the harmony rather
    than two that agree until they do not.

    **QuickJS, on every platform, including the one that has an engine already.**
    macOS ships JavaScriptCore and it is the faster of the two -- measured over a
    288-bar chart, 23 ms against 50 ms, and a third of a millisecond against two
    thirds over a short one. Both are far below the quarter-second the page waits
    before asking for a compile at all, and neither is anywhere near the audio
    thread, so speed decides nothing here.

    What decides it is that Windows has no system engine. Using JavaScriptCore
    where it exists would mean a second implementation that only runs where
    nobody can test it -- on the one platform nobody here can run. One engine
    means the code that ships on Windows is the code every macOS test has been
    exercising all along, which is worth more than twenty-seven milliseconds on a
    chart nobody writes.

    QuickJS is an interpreter with no JIT, which is also why the bundles need no
    entitlement to make executable memory.

    @see src/core/compile.js
*/
#include "Compiler.h"

#include <quickjs.h>

#include <algorithm>
#include <cstring>

namespace jamin
{

namespace
{

/** Whatever QuickJS is holding, as a std::string, freed properly. */
juce::String toJuce (JSContext* context, JSValueConst value)
{
    const char* text = JS_ToCString (context, value);
    if (text == nullptr)
        return {};

    juce::String copy = juce::String::fromUTF8 (text);
    JS_FreeCString (context, text);
    return copy;
}

/** A thrown JavaScript error, with its stack when there is one. */
juce::String describe (JSContext* context)
{
    const JSValue error = JS_GetException (context);
    juce::String message = toJuce (context, error);

    if (JS_IsError (context, error))
    {
        const JSValue stack = JS_GetPropertyStr (context, error, "stack");
        if (! JS_IsUndefined (stack))
            message << "\n" << toJuce (context, stack);
        JS_FreeValue (context, stack);
    }

    JS_FreeValue (context, error);
    return message;
}

} // namespace

struct Compiler::Impl
{
    JSRuntime* runtime { nullptr };
    JSContext* context { nullptr };

    ~Impl() { release(); }

    void release()
    {
        if (context != nullptr) { JS_FreeContext (context); context = nullptr; }
        if (runtime != nullptr) { JS_FreeRuntime (runtime); runtime = nullptr; }
    }
};

Compiler::Compiler() : impl (std::make_unique<Impl>()) {}
Compiler::~Compiler() = default;

bool Compiler::load (const juce::File& bundle)
{
    loaded = false;
    lastError.clear();
    impl->release();

    if (! bundle.existsAsFile())
    {
        lastError = "No compiler bundle at " + bundle.getFullPathName();
        return false;
    }

    impl->runtime = JS_NewRuntime();
    if (impl->runtime == nullptr)
    {
        lastError = "QuickJS would not give us a runtime";
        return false;
    }

    // A ceiling, so a runaway script inside a plugin cannot take the host's
    // memory with it. Sixty-four megabytes is far more than a chart needs and
    // far less than a problem.
    JS_SetMemoryLimit (impl->runtime, 64u * 1024u * 1024u);

    impl->context = JS_NewContext (impl->runtime);
    if (impl->context == nullptr)
    {
        lastError = "QuickJS would not give us a context";
        impl->release();
        return false;
    }

    const auto source = bundle.loadFileAsString();
    const auto utf8 = source.toRawUTF8();

    // JS_EVAL_TYPE_GLOBAL, so the bundle's `var jamin = ...` lands as a global
    // property rather than in a module scope nothing else can see.
    const JSValue result = JS_Eval (impl->context, utf8, std::strlen (utf8),
                                    bundle.getFileName().toRawUTF8(), JS_EVAL_TYPE_GLOBAL);

    if (JS_IsException (result))
    {
        lastError = "The compiler bundle would not run: " + describe (impl->context);
        JS_FreeValue (impl->context, result);
        impl->release();
        return false;
    }

    JS_FreeValue (impl->context, result);
    loaded = true;
    return true;
}

std::unique_ptr<Sequence> Compiler::compile (const juce::String& requestJson)
{
    lastError.clear();

    if (! loaded || impl->context == nullptr)
    {
        lastError = "The compiler was never loaded";
        return nullptr;
    }

    auto* context = impl->context;

    const JSValue global = JS_GetGlobalObject (context);
    const JSValue jaminObject = JS_GetPropertyStr (context, global, "jamin");

    if (! JS_IsObject (jaminObject))
    {
        lastError = "The bundle did not define `jamin`";
        JS_FreeValue (context, jaminObject);
        JS_FreeValue (context, global);
        return nullptr;
    }

    const JSValue function = JS_GetPropertyStr (context, jaminObject, "compileJson");
    if (! JS_IsFunction (context, function))
    {
        lastError = "The bundle has no compileJson";
        JS_FreeValue (context, function);
        JS_FreeValue (context, jaminObject);
        JS_FreeValue (context, global);
        return nullptr;
    }

    const auto utf8 = requestJson.toRawUTF8();
    JSValue argument = JS_NewStringLen (context, utf8, std::strlen (utf8));
    const JSValue answered = JS_Call (context, function, jaminObject, 1, &argument);

    JS_FreeValue (context, argument);
    JS_FreeValue (context, function);
    JS_FreeValue (context, jaminObject);
    JS_FreeValue (context, global);

    if (JS_IsException (answered))
    {
        // compileJson catches its own failures and reports them in the answer,
        // so reaching here means something further out went wrong.
        lastError = "compileJson threw: " + describe (context);
        JS_FreeValue (context, answered);
        return nullptr;
    }

    const auto answer = toJuce (context, answered);
    JS_FreeValue (context, answered);

    const auto parsed = juce::JSON::parse (answer);

    if (const auto reported = parsed.getProperty ("error", {}); ! reported.isVoid())
    {
        lastError = reported.toString();
        return nullptr;
    }

    auto sequence = std::make_unique<Sequence>();
    sequence->lengthPulses = (int32_t) (int) parsed.getProperty ("lengthPulses", 0);
    sequence->generation = (uint64_t) (juce::int64) parsed.getProperty ("generation", 0);
    lastChordCount = (int) parsed.getProperty ("chords", 0);

    if (auto* events = parsed.getProperty ("events", {}).getArray())
    {
        sequence->events.reserve ((size_t) events->size());

        for (const auto& entry : *events)
        {
            auto* quad = entry.getArray();
            if (quad == nullptr || quad->size() < 4)
                continue;

            sequence->events.push_back ({ (int32_t) (int) quad->getReference (0),
                                          (uint8_t)  (int) quad->getReference (1),
                                          (uint8_t)  (int) quad->getReference (2),
                                          (uint8_t)  (int) quad->getReference (3) });
        }
    }

    // The reader binary-searches, so order is not a preference.
    std::stable_sort (sequence->events.begin(), sequence->events.end(),
                      [] (const Sequence::Event& a, const Sequence::Event& b) { return a.pulse < b.pulse; });

    return sequence;
}

} // namespace jamin
