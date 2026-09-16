#!/usr/bin/env python3
"""Run ES modules through macOS JavaScriptCore (osascript -l JavaScript).

There is no Node on this machine, so this strips `import`/`export` keywords,
concatenates the requested modules in order, appends a test script and runs the
whole thing through JXA.  Only useful for the pure-logic modules (no DOM, no
Web MIDI).

    python3 scripts/jsrun.py src/core/chordParser.js tests/chords.test.js
"""
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import sys
import tempfile

# A specifier concatenation cannot satisfy: a package, or a JSON file. Both are
# handled the same way -- esbuild flattens them into the module.
BARE_IMPORT = re.compile(r"""(?m)^\s*import\b[^'"]*['"]([^.'"/][^'"]*|[^'"]*\.json)['"]""")


def bundled(path):
    """
    A module that imports a package, flattened into one file.

    The harness works by stripping imports and concatenating, which is enough
    for modules that only import each other and no use at all for one that
    depends on something in node_modules. esbuild is already here for Vite, so
    the module is bundled first and the result concatenated as usual -- its
    dependency inlined, its own exports still there to be stripped.
    """
    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    if not os.path.exists(esbuild):
        raise SystemExit(f"{path} needs bundling and esbuild is not installed")

    # Bundled as an IIFE rather than a module, because everything else here is
    # concatenated into one scope and a bundled package brings hundreds of its
    # own top-level names with it -- two of which were already taken. The IIFE
    # keeps them to itself; only what the module exports is lifted out.
    name = "__bundle_" + re.sub(r"\W", "_", os.path.basename(path))
    out = subprocess.run(
        [esbuild, path, "--bundle", "--format=iife", f"--global-name={name}",
         "--log-level=error", "--platform=neutral"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise SystemExit(f"bundling {path} failed:\n{out.stderr}")

    source = open(path, encoding="utf-8").read()
    exported = re.findall(
        r"(?m)^export\s+(?:async\s+)?(?:function\s*\*?\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)",
        source,
    )
    if not exported:
        raise SystemExit(f"{path} imports a package but exports nothing this harness can lift")

    lifted = ", ".join(sorted(set(exported)))
    return f"{out.stdout}\nconst {{ {lifted} }} = {name};\n"


def strip(path):
    src = open(path, encoding="utf-8").read()
    # A package or a JSON file cannot be satisfied by concatenation, so flatten it.
    if BARE_IMPORT.search(src):
        src = bundled(path)
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
    # JavaScriptCore under osascript has no `crypto`, and lib0 reaches for it to
    # seed a client id. Deterministic here on purpose: a test that shuffles
    # differently on every run is a test that fails differently on every run.
    shim = (
        "if (typeof globalThis.crypto === 'undefined') {\n"
        "  let seed = 0x2545F491;\n"
        "  globalThis.crypto = { getRandomValues: (a) => {\n"
        "    for (let i = 0; i < a.length; i++) {\n"
        "      seed ^= seed << 13; seed >>>= 0;\n"
        "      seed ^= seed >>> 17;\n"
        "      seed ^= seed << 5; seed >>>= 0;\n"
        "      a[i] = seed & 0xff;\n"
        "    }\n"
        "    return a;\n"
        "  } };\n"
        "}\n"
    )
    blob = shim + "\n".join(strip(p) for p in sys.argv[1:])
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
