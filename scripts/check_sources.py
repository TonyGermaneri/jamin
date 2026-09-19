#!/usr/bin/env python3
"""
Invariants that are about where code reads things from, not about what it computes.

These exist because jamin now runs in two places. In a browser tab the transport
arrives as MIDI clock bytes and MidiEngine counts them; inside the plugin there
is no Web MIDI at all and the host reports its playhead instead. Anything that
reads the engine directly is therefore correct in a tab and silently wrong in a
plugin -- and "silently" is the problem, because the chart still plays.

That is not hypothetical: the effects layer asked `engine.running`, which is
permanently false inside the plugin, so every word was drawn idle and the
shaders never lit while the music played perfectly.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Transport state, wherever it is read from. The store publishes all of this on
# `live` and `state.status`, which follow whichever clock is actually running.
TRANSPORT = re.compile(r"\bengine\.(running|pulse|bpm|position|internalEnabled|clockSeen)\b")

# Web MIDI setup is the engine's own business and is allowed to name it, but
# only in the places that exist to configure Web MIDI.
ALLOWED = {
    os.path.join("src", "store.js"),
}

def walk():
    for base in ("src",):
        for dirpath, _, filenames in os.walk(os.path.join(ROOT, base)):
            for name in filenames:
                if name.endswith((".js", ".vue")):
                    yield os.path.join(dirpath, name)

ICON = re.compile(r"mdi-[a-z0-9]+(?:-[a-z0-9]+)*")
FONT_CSS = os.path.join(ROOT, "node_modules", "@mdi", "font", "css", "materialdesignicons.css")


def known_icons():
    """Every icon class the bundled font actually defines.

    An icon that does not exist does not fail, warn or fall back -- it renders
    as nothing at all. A toolbar button with no glyph is an invisible button,
    which is how `mdi-drum` shipped: the markup was right, the icon was not in
    Material Design Icons, and the drum book had no way in.
    """
    try:
        with open(FONT_CSS, encoding="utf-8") as handle:
            return set(re.findall(r"^\.(mdi-[a-z0-9-]+)::before", handle.read(), re.M))
    except OSError:
        return None


def main():
    failures = 0

    icons = known_icons()
    if icons is None:
        print("     (no @mdi/font installed; skipping the icon check)")
    else:
        for path in sorted(walk()):
            relative = os.path.relpath(path, ROOT)
            with open(path, encoding="utf-8") as handle:
                for number, line in enumerate(handle, 1):
                    for name in ICON.findall(line):
                        if name in icons:
                            continue
                        failures += 1
                        print(f"FAIL {relative}:{number}: {name} is not in @mdi/font")
                        print("     An icon that does not exist renders as nothing, so the")
                        print("     control it belongs to is invisible rather than wrong.")

    for path in sorted(walk()):
        relative = os.path.relpath(path, ROOT)
        if relative in ALLOWED or relative.startswith(os.path.join("src", "core")):
            continue

        with open(path, encoding="utf-8") as handle:
            for number, line in enumerate(handle, 1):
                if line.lstrip().startswith(("*", "//")):
                    continue
                found = TRANSPORT.search(line)
                if found:
                    failures += 1
                    print(f"FAIL {relative}:{number}: reads {found.group(0)}")
                    print("     The transport must come from `live` or `state.status`;")
                    print("     inside the plugin there is no MIDI engine to ask.")

    failures += control_characters()
    failures += unimported()

    print("sources: all checks passed" if failures == 0 else f"sources: {failures} FAILED")
    return 1 if failures else 0


# A source file that is not text.
#
# `const DOWN = '\0'` with a real NUL byte in it rather than the escape parses
# and runs and bundles, and turns the file binary: `grep` matches nothing in it
# without a word, `file` calls it data, and a search for a function that is
# plainly there comes back empty. Half an hour was spent concluding a module did
# not contain what it contained.
def control_characters():
    failures = 0
    for path in sorted(walk()):
        raw = open(path, "rb").read()
        for at, byte in enumerate(raw):
            if byte < 9 or 13 < byte < 32:
                line = raw[:at].count(b"\n") + 1
                relative = os.path.relpath(path, ROOT)
                failures += 1
                print(f"FAIL {relative}:{line}: a raw control byte (0x{byte:02x}) in the source")
                print("     It runs, and it makes the file binary to grep and every")
                print(r"     other text tool. Write it as an escape (\u0000).")
                break
    return failures


# Something called out of the store that nobody imported.
#
# Vite compiles this green. The module is bundled, the name is simply not bound
# in the file that uses it, and the page throws a ReferenceError at the moment
# somebody clicks the thing -- which in a plugin is a button that does nothing
# and says nothing. Six of these have shipped: toast, resourceOk, mapDrumNotes,
# realizeChord, scoreOptions, SAMPLE_CHART, and openBook was the seventh, caught
# by running this by hand on the day it was written.
#
# Only calls, and only names the store exports. Matching bare identifiers finds
# 153 local variables that happen to share a name; matching `name(` against the
# store's own export list finds this and nothing else.
EXPORTED = re.compile(r"^export (?:async )?(?:function|const|let) (\w+)", re.M)

# A name the file declares for itself, which is therefore not the store's.
#
# `setHolding(on) {` opening a class method reads exactly like a bare call to
# the pattern above, so the player was reported for failing to import a
# function it defines. Anything of the shape `name(args) {` at the start of a
# line is a declaration -- a method, a shorthand method, a function -- and a
# real call is never followed by a brace.
DEFINED = re.compile(
    r"^\s*(?:export\s+)?(?:static\s+|async\s+|get\s+|set\s+|\*\s*)*"
    r"(?:function\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", re.M)

# And the same thing written as an arrow. `const timed = async (fn) => ...`
# in drumStore.js is a local helper that happens to share a name with a store
# export, and the file was reported for failing to import something it owns.
ARROWED = re.compile(
    r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"
    r"(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>", re.M)


def unimported():
    with open(os.path.join(ROOT, "src", "store.js"), encoding="utf-8") as handle:
        exported = set(EXPORTED.findall(handle.read()))
    if not exported:
        return 0

    failures = 0
    for path in sorted(walk()):
        relative = os.path.relpath(path, ROOT)
        if relative == os.path.join("src", "store.js"):
            continue
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        if "store.js" not in text:
            continue

        bound = set()
        for block in re.findall(r"import\s*\{([^}]*)\}\s*from", text):
            for one in block.split(","):
                name = one.strip().split(" as ")[-1].strip()
                if name:
                    bound.add(name)

        mine = set(DEFINED.findall(text)) | set(ARROWED.findall(text))
        for name in sorted(exported):
            if name in bound or name in mine:
                continue
            # A call, not a mention: `state.foo(` and `this.foo(` are somebody
            # else's foo.
            if re.search(r"(?<![.\w$])" + re.escape(name) + r"\s*\(", text):
                failures += 1
                print(f"FAIL {relative}: calls {name}() and does not import it")
                print("     Vite bundles this without complaint and the page throws")
                print("     a ReferenceError when somebody clicks it.")
    return failures

sys.exit(main())
