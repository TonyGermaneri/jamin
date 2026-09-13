#include "Compiler.h"

#include <JavaScriptCore/JavaScriptCore.h>

namespace jamin
{

namespace
{

/** JSStringRef is refcounted by hand; this is the only reason it is not. */
struct ScopedJSString
{
    explicit ScopedJSString (const juce::String& text)
        : ref (JSStringCreateWithUTF8CString (text.toRawUTF8())) {}
    explicit ScopedJSString (JSStringRef existing) : ref (existing) {}
    ~ScopedJSString() { if (ref != nullptr) JSStringRelease (ref); }

    ScopedJSString (const ScopedJSString&) = delete;
    ScopedJSString& operator= (const ScopedJSString&) = delete;

    operator JSStringRef() const { return ref; }
    JSStringRef ref;
};

juce::String toJuce (JSContextRef context, JSValueRef value)
{
    if (value == nullptr)
        return {};

    const ScopedJSString text { JSValueToStringCopy (context, value, nullptr) };
    if (text.ref == nullptr)
        return {};

    // getMaximumUTF8CStringSize already includes the terminator.
    const auto size = JSStringGetMaximumUTF8CStringSize (text);
    std::vector<char> buffer (size, '\0');
    JSStringGetUTF8CString (text, buffer.data(), size);
    return juce::String::fromUTF8 (buffer.data());
}

/** A thrown JavaScript error, as something worth printing. */
juce::String describe (JSContextRef context, JSValueRef exception)
{
    if (exception == nullptr)
        return {};

    auto message = toJuce (context, exception);

    if (auto* object = JSValueToObject (context, exception, nullptr))
    {
        const ScopedJSString lineKey { juce::String ("line") };
        const auto line = JSObjectGetProperty (context, object, lineKey, nullptr);
        if (line != nullptr && JSValueIsNumber (context, line))
            message << " (line " << juce::String ((int) JSValueToNumber (context, line, nullptr)) << ")";
    }

    return message;
}

} // namespace

struct Compiler::Impl
{
    JSGlobalContextRef context { nullptr };

    ~Impl()
    {
        if (context != nullptr)
            JSGlobalContextRelease (context);
    }
};

Compiler::Compiler() : impl (std::make_unique<Impl>()) {}
Compiler::~Compiler() = default;

bool Compiler::load (const juce::File& bundle)
{
    loaded = false;
    lastError.clear();

    if (! bundle.existsAsFile())
    {
        lastError = "No compiler bundle at " + bundle.getFullPathName();
        return false;
    }

    if (impl->context != nullptr)
    {
        JSGlobalContextRelease (impl->context);
        impl->context = nullptr;
    }

    impl->context = JSGlobalContextCreate (nullptr);
    if (impl->context == nullptr)
    {
        lastError = "JavaScriptCore would not give us a context";
        return false;
    }

    const ScopedJSString source { bundle.loadFileAsString() };
    const ScopedJSString url { bundle.getFullPathName() };

    JSValueRef exception = nullptr;
    JSEvaluateScript (impl->context, source, nullptr, url, 1, &exception);

    if (exception != nullptr)
    {
        lastError = "The compiler bundle would not run: " + describe (impl->context, exception);
        return false;
    }

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
    auto* global = JSContextGetGlobalObject (context);

    JSValueRef exception = nullptr;

    // jamin.compileJson(request) -- the one door in, as built by
    // vite.compile.config.js.
    const ScopedJSString namespaceKey { juce::String ("jamin") };
    const auto namespaceValue = JSObjectGetProperty (context, global, namespaceKey, &exception);
    if (exception != nullptr || namespaceValue == nullptr || ! JSValueIsObject (context, namespaceValue))
    {
        lastError = "The bundle did not define `jamin`";
        return nullptr;
    }

    auto* namespaceObject = JSValueToObject (context, namespaceValue, &exception);
    const ScopedJSString functionKey { juce::String ("compileJson") };
    const auto functionValue = JSObjectGetProperty (context, namespaceObject, functionKey, &exception);

    if (exception != nullptr || functionValue == nullptr || ! JSValueIsObject (context, functionValue))
    {
        lastError = "The bundle has no compileJson";
        return nullptr;
    }

    auto* function = JSValueToObject (context, functionValue, &exception);
    if (! JSObjectIsFunction (context, function))
    {
        lastError = "compileJson is not a function";
        return nullptr;
    }

    const ScopedJSString argument { requestJson };
    JSValueRef arguments[1] { JSValueMakeString (context, argument) };
    const auto result = JSObjectCallAsFunction (context, function, nullptr, 1, arguments, &exception);

    if (exception != nullptr)
    {
        // compileJson catches its own failures and reports them in the answer,
        // so reaching here means something further out went wrong.
        lastError = "compileJson threw: " + describe (context, exception);
        return nullptr;
    }

    const auto answer = toJuce (context, result);
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

    // The reader binary-searches, so order is not a preference. The compiler
    // emits in order already; this is here because a sequence that is not sorted
    // fails silently and intermittently, which is the worst way to find out.
    std::stable_sort (sequence->events.begin(), sequence->events.end(),
                      [] (const Sequence::Event& a, const Sequence::Event& b) { return a.pulse < b.pulse; });

    return sequence;
}

} // namespace jamin
