/*
 * The bytes a file read hands the page, checked against what the page decodes.
 *
 * This exists because of a bug that read every file in a library successfully
 * and imported none of them. `MemoryBlock::toBase64Encoding` is not base64: it
 * writes the byte count, then a '.', then the data through a private table that
 * packs each six bits least-significant first. Its only partner is
 * `fromBase64Encoding`. Handed to the page's `atob` it decodes to noise, and a
 * MIDI file of noise parses to nothing -- so every file was read, skipped, and
 * counted as "not a drum file".
 *
 * Nothing about the name says any of that, which is why this is pinned to
 * known-good vectors rather than to a round trip through JUCE. A round trip
 * would have passed with the wrong encoder.
 *
 * @see native/plugin/PluginEditor.cpp asBase64
 */
#include <juce_core/juce_core.h>
#include <cstdio>
#include <string>

static int failures = 0;

static void check (const char* label, const juce::String& got, const juce::String& want)
{
    if (got == want)
        return;

    ++failures;
    std::printf ("FAIL %s: got \"%s\" want \"%s\"\n",
                 label, got.toRawUTF8(), want.toRawUTF8());
}

/** The same helper the editor uses to answer jaminReadFile(s). */
static juce::String asBase64 (const void* data, size_t size)
{
    juce::MemoryOutputStream encoded;
    if (! juce::Base64::convertToBase64 (encoded, data, size))
        return {};

    return encoded.toString();
}

static juce::String encode (const std::string& text)
{
    return asBase64 (text.data(), text.size());
}

int main()
{
    // RFC 4648 section 10, which is the standard `atob` implements. Every one of
    // these is a different padding case, and padding is where a private encoding
    // and a standard one part company first.
    check ("empty",   encode (""),       "");
    check ("one pad",   encode ("f"),      "Zg==");
    check ("two pads",  encode ("fo"),     "Zm8=");
    check ("no pad",    encode ("foo"),    "Zm9v");
    check ("one pad again", encode ("foob"),   "Zm9vYg==");
    check ("two pads again", encode ("fooba"),  "Zm9vYmE=");
    check ("no pad again",   encode ("foobar"), "Zm9vYmFy");

    // A MIDI file's own first bytes, which is what actually crosses the bridge.
    // High bits set, which is where a table that packs the wrong way round
    // shows up.
    const juce::uint8 header[] = { 'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 1, 0, 2, 0, 0x60 };
    check ("a MIDI header", asBase64 (header, sizeof (header)), "TVRoZAAAAAYAAQACAGA=");

    // And the thing that was wrong: JUCE's own toBase64Encoding is not this, and
    // must never be mistaken for it again.
    juce::MemoryBlock block (header, sizeof (header));
    if (block.toBase64Encoding() == asBase64 (header, sizeof (header)))
    {
        ++failures;
        std::printf ("FAIL toBase64Encoding is not standard base64 and this says it is\n");
    }

    std::printf (failures == 0 ? "base64: all checks passed\n"
                               : "base64: %d FAILED\n", failures);
    return failures == 0 ? 0 : 1;
}
