#!/usr/bin/env python3
"""Run the pure-logic test suites through JavaScriptCore (see scripts/jsrun.py)."""
import re
import subprocess
import tempfile
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SUITES = [
    (["src/core/chordParser.js"], "tests/chords.test.js"),
    (["src/core/chordParser.js", "src/core/score.js"], "tests/score.test.js"),
    (["src/core/chordParser.js", "src/core/score.js"], "tests/sections.test.js"),
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
    (["src/core/drumKits.js"], "tests/drumMap.test.js"),
    (["src/core/drumKits.js"], "tests/kitClassify.test.js"),
    (["src/core/midiFile.js", "src/core/drumImport.js"], "tests/drumImport.test.js"),
    (["src/core/midiFile.js", "src/core/midiWrite.js"], "tests/midiWrite.test.js"),
    (["src/core/genres.js"], "tests/genres.test.js"),
    (["src/core/genres.js", "src/core/drumTags.js"], "tests/drumTags.test.js"),
    # Which rows a search of the catalogue reads, and how far apart. What it
    # does to a real library is measured by scripts/import_check.py.
    (["src/core/genres.js", "src/core/drumStore.js"], "tests/drumSearch.test.js"),
    # What the graph looks like and how the keyboard walks it -- the arithmetic
    # that decides the picture, without a GPU to decide it on.
    (["src/core/chordParser.js", "src/core/score.js", "src/core/key.js",
      "src/core/degrees.js", "src/core/graphView.js"], "tests/graphView.test.js"),
    # The catalogue as the tree it already is, which is what replaced the
    # co-occurrence hairball.
    (["src/core/pathTree.js"], "tests/pathTree.test.js"),
    # What a node is drawn as, and whether the shapes are the same size as
    # each other -- on this map a node's size is a number, not a flourish.
    (["src/canvas/nodeShapes.js"], "tests/nodeShapes.test.js"),
    (["src/core/chordParser.js", "src/core/score.js", "src/core/chartEdit.js",
      "src/core/chordPicker.js"], "tests/chartEdit.test.js"),
    (["src/core/chordParser.js", "src/core/chordDetect.js"], "tests/chordDetect.test.js"),
    # Ten thousand edits to one chart. Slow on purpose -- it is measuring what a
    # day's work costs, and a day's work is what broke it.
    (["src/core/crdt.js"], "tests/crdtBurn.test.js"),
    # The shipped corpus itself, checked as data. @see materialise
    (["src/data/grooveDrums.json"], "tests/grooveData.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/voiceLeading.js",
        "src/core/voicing.js", "src/core/themes.js", "src/core/settings.js",
        "src/core/fetchResource.js", "src/core/drumKits.js", "src/core/drums.js",
        "src/core/drumBindings.js", "src/core/chordDetect.js", "src/core/player.js",
    ], "tests/drums.test.js"),
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
        "src/core/fetchResource.js", "src/core/drumKits.js", "src/core/drums.js",
        "src/core/drumBindings.js", "src/core/chordDetect.js", "src/core/player.js", "src/core/compile.js",
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
        "src/core/fetchResource.js", "src/core/drumKits.js", "src/core/drums.js",
        "src/core/drumBindings.js", "src/core/chordDetect.js", "src/core/player.js", "src/core/compile.js",
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
        "src/core/voicing.js", "src/core/themes.js", "src/core/settings.js", "src/core/fetchResource.js", "src/core/drumKits.js", "src/core/drums.js",
        "src/core/drumBindings.js", "src/core/chordDetect.js", "src/core/player.js",
    ], "tests/player.test.js"),
    ([
        "src/core/chordParser.js", "src/core/score.js", "src/core/voiceLeading.js",
        "src/core/voicing.js", "src/core/themes.js", "src/core/settings.js", "src/core/fetchResource.js", "src/core/drumKits.js", "src/core/drums.js",
        "src/core/drumBindings.js", "src/core/chordDetect.js", "src/core/player.js",
        # The rest of the program that walks the same token list: transposing,
        # the shorthand rewrite, the progression library and the clipboard.
        # Not key.js: it and voiceLeading.js each declare mod12, and these are
        # concatenated rather than linked.
        "src/core/phrases.js", "src/core/importers.js", "src/core/progressions.js",
    ], "tests/pedal.test.js"),
]

def materialise(path):
    """A `.json` in a suite's module list becomes a global holding its contents.

    The drum corpus is 1.3MB of data and is worth checking *as data* -- a
    slicing mistake in it is silent, and the first one broke sixty per cent of
    the loops without failing anything. Checking a copy would only prove the
    copy right, so the shipped file itself is loaded, wrapped in a name taken
    from its own filename.
    """
    if not path.endswith(".json"):
        return path

    name = os.path.splitext(os.path.basename(path))[0]
    upper = re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()
    with open(os.path.join(ROOT, path), encoding="utf-8") as handle:
        body = handle.read()

    handle = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8")
    handle.write(f"const {upper} = {body}\n")
    handle.close()
    temporary.append(handle.name)
    return handle.name


temporary = []
failed = 0
for modules, suite in SUITES:
    args = [sys.executable, os.path.join(HERE, "jsrun.py")] + [materialise(m) for m in modules] + [suite]
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
            sys.stdout.write(f"FAIL {suite}: never reached its sign-off line "
                             f"— it threw, or it calls something that no longer exists\n")
        failed += 1

for path in temporary:
    try:
        os.unlink(path)
    except OSError:
        pass

# What the drum store promises, against a real IndexedDB.
#
# Node rather than JavaScriptCore, because these need a database. Correctness
# only: this shim is not a performance model. @see scripts/store_check.py
store = subprocess.run([sys.executable, os.path.join(HERE, "store_check.py")],
                       cwd=ROOT, capture_output=True, text=True)
sys.stdout.write(store.stdout)
sys.stderr.write(store.stderr)
if store.returncode != 0:
    failed += 1

# Source invariants -- about where code reads from rather than what it computes.
check = subprocess.run([sys.executable, os.path.join(HERE, "check_sources.py")],
                       cwd=ROOT, capture_output=True, text=True)
sys.stdout.write(check.stdout)
sys.stderr.write(check.stderr)
if check.returncode != 0:
    failed += 1

# And every name a file uses is one it defined or imported.
#
# eslint with a single rule, no-undef. Eight of these have shipped -- toast,
# resourceOk, mapDrumNotes, realizeChord, scoreOptions, SAMPLE_CHART, openBook,
# barsOfProgression -- and vite bundles every one of them without a word, so the
# first sign is a button that does nothing. @see eslint.config.js
lint = os.path.join(ROOT, "node_modules", ".bin", "eslint")
if os.path.exists(lint):
    result = subprocess.run([lint, "src"], cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    print("undefined names: none" if result.returncode == 0
          else "undefined names: FOUND — vite would have bundled these silently")
    if result.returncode != 0:
        failed += 1
else:
    print("     (eslint is not installed; skipping the undefined-name check)")

# Said once at the end, because a single failing line is easy to lose in forty
# passing ones -- which is exactly how a suite testing a function that had been
# deleted went on "passing" for a commit.
print(f"\n{failed} of {len(SUITES) + 3} checks FAILED" if failed
      else f"\nall {len(SUITES) + 3} checks passed")

sys.exit(1 if failed else 0)
