#!/usr/bin/env python3
"""Run ES modules through macOS JavaScriptCore (osascript -l JavaScript).

There is no Node on this machine, so this strips `import`/`export` keywords,
concatenates the requested modules in order, appends a test script and runs the
whole thing through JXA.  Only useful for the pure-logic modules (no DOM, no
Web MIDI).

    python3 scripts/jsrun.py src/core/chordParser.js tests/chords.test.js
"""
import re
import subprocess
import sys
import tempfile

def strip(path):
    src = open(path, encoding="utf-8").read()
    # Imports, including the multi-line `import {\n  a,\n  b,\n} from "x"` form.
    src = re.sub(r"(?ms)^[ \t]*import\b\s+[^;]*?from\s*['\"][^'\"]*['\"]\s*;?[ \t]*$", "", src)
    src = re.sub(r"(?m)^[ \t]*import\s*['\"][^'\"]*['\"]\s*;?[ \t]*$", "", src)
    src = re.sub(r"(?m)^[ \t]*import\b[^\n]*\n", "", src)
    src = re.sub(r"(?m)^export default ", "const __default = ", src)
    src = re.sub(r"(?m)^export\s+(?=(const|let|var|function|class|async))", "", src)
    src = re.sub(r"(?m)^export\s*\{[^}]*\}\s*;?\s*$", "", src)
    # Not a module here, so import.meta would be a syntax error.
    src = src.replace("import.meta.url", '"file:///"')
    return src

def main():
    blob = "\n".join(strip(p) for p in sys.argv[1:])
    # Suites may use `await` at the top level; JavaScriptCore has no module
    # scope here, so run the whole thing inside an async function.
    if re.search(r"(?m)^\s*(await |for await |.*= await )", blob):
        # `void` so osascript does not echo the promise as a result.
        blob = "void (async () => {\n" + blob + "\n})().catch((e) => { console.log('THREW ' + e.message) })"
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(blob)
        path = fh.name
    proc = subprocess.run(["osascript", "-l", "JavaScript", path], capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    # osascript exits 0 whatever the script did, and JavaScriptCore prints
    # console.log to stderr, so the status has to come from what was said: an
    # unhandled rejection is reported by the catch above, and a failed assertion
    # is a suite printing FAIL and carrying on. Without this a suite could die on
    # its first line and be recorded as a pass.
    said = proc.stdout + proc.stderr
    sys.exit(proc.returncode or ("THREW" in said) or ("FAIL" in said))

main()
