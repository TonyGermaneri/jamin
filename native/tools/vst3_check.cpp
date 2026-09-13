/*
    jamin-vst3 — load the VST3 module the way a host's scanner does.

    Ableton's scanner database had the bundle listed and no plugins extracted
    from it, which says the module was rejected rather than not found. That is
    not something auval can answer, and reading CMake flags cannot either. This
    opens the bundle, calls its entry point, asks the factory what classes it
    has, instantiates the audio processor and reports its buses — which is the
    sequence every VST3 host performs before deciding whether to list it.

      jamin-vst3 <path to Something.vst3>
*/
#include <pluginterfaces/base/funknown.h>
#include <pluginterfaces/base/ipluginbase.h>
#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivstcomponent.h>

#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>

#include <cstdio>
#include <string>

using namespace Steinberg;

// The SDK declares the interface ids and leaves one translation unit to define
// them. Nothing links them in for us here, because this tool deliberately uses
// the headers alone.
DEF_CLASS_IID (Steinberg::FUnknown)
DEF_CLASS_IID (Steinberg::IPluginBase)
DEF_CLASS_IID (Steinberg::IPluginFactory)
DEF_CLASS_IID (Steinberg::IPluginFactory2)
DEF_CLASS_IID (Steinberg::IPluginFactory3)
DEF_CLASS_IID (Steinberg::Vst::IComponent)
DEF_CLASS_IID (Steinberg::Vst::IAudioProcessor)

namespace
{
int failures = 0;

void check (const char* label, bool ok, const std::string& detail = {})
{
    if (ok)
        return;
    ++failures;
    std::printf ("FAIL %s%s\n", label, detail.empty() ? "" : (" — " + detail).c_str());
}
} // namespace

int main (int argc, char** argv)
{
    if (argc < 2)
    {
        std::printf ("usage: jamin-vst3 <path to Something.vst3>\n");
        return 1;
    }

    const std::string path = argv[1];
    std::printf ("jamin-vst3\n  bundle   %s\n", path.c_str());

    // A .vst3 is a bundle; the host opens it as one so the bundle's own entry
    // point runs and its resources are available.
    CFURLRef url = CFURLCreateFromFileSystemRepresentation (
        nullptr, (const UInt8*) path.c_str(), (CFIndex) path.size(), true);
    CFBundleRef bundle = url != nullptr ? CFBundleCreate (nullptr, url) : nullptr;
    if (url != nullptr)
        CFRelease (url);

    check ("it is a loadable bundle", bundle != nullptr);
    if (bundle == nullptr)
        return 1;

    CFErrorRef error = nullptr;
    const bool executable = CFBundleLoadExecutableAndReturnError (bundle, &error);
    check ("its executable loads", executable);
    if (! executable)
    {
        if (error != nullptr)
        {
            CFStringRef text = CFErrorCopyDescription (error);
            char buffer[512] {};
            CFStringGetCString (text, buffer, sizeof (buffer), kCFStringEncodingUTF8);
            std::printf ("  reason   %s\n", buffer);
            CFRelease (text);
        }
        return 1;
    }

    using BundleEntryFn = bool (*) (CFBundleRef);
    using FactoryFn = IPluginFactory* (*) ();

    auto* entry = (BundleEntryFn) CFBundleGetFunctionPointerForName (bundle, CFSTR ("bundleEntry"));
    auto* getFactory = (FactoryFn) CFBundleGetFunctionPointerForName (bundle, CFSTR ("GetPluginFactory"));

    check ("it exports bundleEntry", entry != nullptr);
    check ("it exports GetPluginFactory", getFactory != nullptr);
    if (entry == nullptr || getFactory == nullptr)
        return 1;

    check ("bundleEntry succeeds", entry (bundle));

    IPluginFactory* factory = getFactory();
    check ("it returns a factory", factory != nullptr);
    if (factory == nullptr)
        return 1;

    PFactoryInfo factoryInfo {};
    factory->getFactoryInfo (&factoryInfo);
    std::printf ("  vendor   %s\n  classes  %d\n", factoryInfo.vendor, factory->countClasses());

    check ("the factory has at least one class", factory->countClasses() > 0);

    int audioModules = 0;
    for (int32 i = 0; i < factory->countClasses(); ++i)
    {
        PClassInfo info {};
        factory->getClassInfo (i, &info);

        std::string subCategories;
        if (FUnknownPtr<IPluginFactory2> factory2 { factory })
        {
            PClassInfo2 info2 {};
            if (factory2->getClassInfo2 (i, &info2) == kResultOk)
                subCategories = info2.subCategories;
        }

        std::printf ("    [%d] %-22s %-22s %s\n", i, info.category, info.name, subCategories.c_str());

        if (std::string (info.category) != kVstAudioEffectClass)
            continue;

        ++audioModules;

        // What the scanner does next: make one, start it up, and look at its
        // buses. A plugin that cannot be instantiated is a plugin that is not
        // listed, and nothing says so out loud.
        Vst::IComponent* component = nullptr;
        const auto created = factory->createInstance (info.cid, Vst::IComponent::iid, (void**) &component);
        check ("the audio class can be instantiated", created == kResultOk && component != nullptr);

        if (component == nullptr)
            continue;

        check ("it initialises", component->initialize (nullptr) == kResultOk);

        const auto audioIn  = component->getBusCount (Vst::kAudio, Vst::kInput);
        const auto audioOut = component->getBusCount (Vst::kAudio, Vst::kOutput);
        const auto eventIn  = component->getBusCount (Vst::kEvent, Vst::kInput);
        const auto eventOut = component->getBusCount (Vst::kEvent, Vst::kOutput);

        std::printf ("         buses: audio in %d, audio out %d, event in %d, event out %d\n",
                     audioIn, audioOut, eventIn, eventOut);

        // Live lists an instrument; an instrument with no audio output is not
        // one, however it describes itself in its sub-categories.
        if (subCategories.find ("Instrument") != std::string::npos)
        {
            check ("an instrument has an audio output bus", audioOut > 0);
            check ("an instrument has an event input bus", eventIn > 0);
        }

        component->terminate();
        component->release();
    }

    check ("there is an audio module class", audioModules > 0);

    std::printf (failures == 0 ? "  ok       all checks passed\n" : "  %d FAILED\n", failures);
    return failures == 0 ? 0 : 1;
}
