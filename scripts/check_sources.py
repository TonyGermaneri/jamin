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

    print("sources: all checks passed" if failures == 0 else f"sources: {failures} FAILED")
    return 1 if failures else 0

sys.exit(main())
