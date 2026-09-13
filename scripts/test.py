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
        "tests/fixtures/chordonomicon-vocab.js", "src/core/chordParser.js", "src/core/score.js",
        "src/core/importers.js", "src/core/progressions.js",
    ], "tests/importers.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/voiceLeading.js",
        "src/core/voicing.js", "src/core/themes.js", "src/core/settings.js", "src/core/player.js",
    ], "tests/player.test.js"),
]

failed = 0
for modules, suite in SUITES:
    args = [sys.executable, os.path.join(HERE, "jsrun.py")] + modules + [suite]
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0 or "FAIL" in result.stdout:
        failed += 1

sys.exit(1 if failed else 0)
