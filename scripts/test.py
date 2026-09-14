#!/usr/bin/env python3
"""Run the pure-logic test suites through JavaScriptCore (see scripts/jsrun.py)."""
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SUITES = [
    (["src/core/chordParser.js"], "tests/chords.test.js"),
    (["src/core/chordParser.js", "src/core/score.js"], "tests/score.test.js"),
    (["src/core/chordParser.js", "src/core/voiceLeading.js", "src/core/voicing.js"], "tests/voicing.test.js"),
    (["src/canvas/layout.js", "src/core/chordParser.js", "src/core/score.js"], "tests/layout.test.js"),
    ([
        "src/core/midi.js"], "tests/midi.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/importers.js",
        "src/core/progressions.js",
    ], "tests/progressions.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/key.js",
    ], "tests/key.test.js"),
    ([
        "tests/fixtures/chordonomicon-vocab.js", "src/core/chordParser.js", "src/core/score.js",
        "src/core/importers.js", "src/core/progressions.js",
    ], "tests/importers.test.js"),
    (["src/core/themes.js", "src/core/settings.js"], "tests/settings.test.js"),
    (["src/core/host.js"], "tests/host.test.js"),
    (["src/core/drumKits.js"], "tests/drums.test.js"),
    (["src/core/crdt.js"], "tests/crdt.test.js"),
    # The shared segment: what may travel between instances in one host, and why
    # it is operations rather than text.
    (["src/core/crdt.js", "src/core/host.js", "src/core/net.js"], "tests/shared.test.js"),
    ([
        "src/core/themes.js", "src/core/settings.js", "src/core/chordParser.js",
        "src/core/voiceLeading.js", "src/core/phrases.js",
    ], "tests/clipboard.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/voiceLeading.js",
        "src/core/voicing.js", "src/core/themes.js", "src/core/settings.js",
        "src/core/player.js", "src/core/compile.js",
    ], "tests/compile.test.js"),
    (["src/core/vocParser.js"], "tests/voc.test.js"),
    ([
        "src/core/themes.js", "src/core/settings.js", "src/core/chordParser.js",
        "src/core/score.js", "src/core/voiceLeading.js", "src/core/phrases.js",
        "src/core/midiFile.js", "src/core/midiPhrases.js",
    ], "tests/midi-import.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/voiceLeading.js",
        "src/core/voicing.js", "src/core/themes.js", "src/core/settings.js",
        "src/core/player.js", "src/core/compile.js",
    ], "tests/accent.test.js"),
    ([
        "src/core/themes.js", "src/core/settings.js", "src/core/chordParser.js",
        "src/core/voiceLeading.js", "src/core/phrases.js", "src/core/vocParser.js",
        "src/core/fetchResource.js", "src/core/licks.js",
    ], "tests/licks.test.js"),
    ([
        "src/core/themes.js", "src/core/settings.js", "src/core/chordParser.js",
        "src/core/voiceLeading.js", "src/core/phrases.js", "src/core/vocParser.js",
        "src/core/fetchResource.js", "src/core/licks.js", "src/core/chordDictionary.js", "src/core/parts.js",
    ], "tests/parts.test.js"),
    ([
        "src/core/themes.js", "src/core/settings.js", "src/core/chordParser.js",
        "src/core/voiceLeading.js", "src/core/phrases.js",
    ], "tests/phrase-keys.test.js"),
    ([
        "src/core/themes.js", "src/core/settings.js", "src/core/chordParser.js",
        "src/core/voiceLeading.js", "src/core/phrases.js",
    ], "tests/phrase-names.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/voiceLeading.js",
        "src/core/voicing.js", "src/core/themes.js", "src/core/settings.js", "src/core/player.js",
    ], "tests/player.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/voiceLeading.js",
        "src/core/voicing.js", "src/core/themes.js", "src/core/settings.js", "src/core/player.js",
        # The rest of the program that walks the same token list: transposing,
        # the shorthand rewrite, the progression library and the clipboard.
        # Not key.js: it and voiceLeading.js each declare mod12, and these are
        # concatenated rather than linked.
        "src/core/phrases.js", "src/core/importers.js", "src/core/progressions.js",
    ], "tests/pedal.test.js"),
]

failed = 0
for modules, suite in SUITES:
    args = [sys.executable, os.path.join(HERE, "jsrun.py")] + modules + [suite]
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    # JavaScriptCore under osascript prints console.log to stderr and exits 0
    # whatever the script did, so both streams are read and the suite's own
    # sign-off line is required -- otherwise a suite that dies halfway through
    # is indistinguishable from one that passed.
    said = result.stdout + result.stderr
    if (result.returncode != 0 or "FAIL" in said or "THREW" in said
            or "all checks passed" not in said):
        if "all checks passed" not in said and "FAIL" not in said:
            sys.stdout.write(f"{suite}: never reached its sign-off line\n")
        failed += 1

# Source invariants -- about where code reads from rather than what it computes.
check = subprocess.run([sys.executable, os.path.join(HERE, "check_sources.py")],
                       cwd=ROOT, capture_output=True, text=True)
sys.stdout.write(check.stdout)
sys.stderr.write(check.stderr)
if check.returncode != 0:
    failed += 1

sys.exit(1 if failed else 0)
