#!/usr/bin/env python3
"""Parse every source file with JavaScriptCore to catch syntax errors.

Stands in for a build while there is no Node on this machine.  `.vue` files have
their <script> block extracted; templates are not checked.
"""
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def source_of(path):
    text = open(path, encoding="utf-8").read()
    if path.endswith(".vue"):
        match = re.search(r"<script[^>]*>(.*?)</script>", text, re.S)
        text = match.group(1) if match else ""
        # <script setup> compiler macros are not real globals.
        text = re.sub(r"\b(defineExpose|defineProps|defineEmits)\s*\(", "void(", text)
    # Imports, including the multi-line `import {\n  a,\n  b,\n} from "x"` form.
    text = re.sub(r"(?ms)^[ \t]*import\b\s+[^;]*?from\s*['\"][^'\"]*['\"]\s*;?[ \t]*$", "", text)
    text = re.sub(r"(?m)^[ \t]*import\s*['\"][^'\"]*['\"]\s*;?[ \t]*$", "", text)
    text = re.sub(r"(?m)^[ \t]*import\b[^\n]*\n", "", text)
    text = re.sub(r"(?m)^export default ", "const __d = ", text)
    text = re.sub(r"(?m)^export\s+(?=(const|let|var|function|class|async))", "", text)
    text = re.sub(r"(?m)^export\s*\{[^}]*\}\s*;?\s*$", "", text)
    # `new Function` is not a module, so import.meta would be a syntax error here.
    text = text.replace("import.meta.url", '"file:///"')
    return text

failed = []
files = sorted(glob.glob(os.path.join(ROOT, "src", "**", "*.js"), recursive=True) +
               glob.glob(os.path.join(ROOT, "src", "**", "*.vue"), recursive=True))

for path in files:
    body = source_of(path)
    harness = "try { new Function(%s); console.log('ok') } catch (e) { console.log('ERR ' + e.message) }" % json.dumps(body)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(harness)
        tmp = fh.name
    result = subprocess.run(["osascript", "-l", "JavaScript", tmp], capture_output=True, text=True)
    os.unlink(tmp)
    out = (result.stdout + result.stderr).strip()
    rel = os.path.relpath(path, ROOT)
    if out != "ok":
        failed.append(rel)
        print("FAIL %-40s %s" % (rel, out))
    else:
        print("ok   %s" % rel)

sys.exit(1 if failed else 0)
