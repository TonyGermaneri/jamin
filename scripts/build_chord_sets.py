#!/usr/bin/env python3
"""Build src/data/chordSets.json from the ChordDictionary/SetTheory set.js database.

Source: https://github.com/ChordDictionary/SetTheory (set.js) -- ~2000 pitch-class
sets generated from Pascal's triangle and named by hand.  We only need a compact
"pitch-class set -> names" index so the app can tell the user what it thinks the
chord they typed actually is, and so verbose spellings ("Cminormajor7") can be
resolved by name when the rule-based parser comes up empty.

Usage:  python3 scripts/build_chord_sets.py [path-or-url-to-set.js]
"""
import json
import os
import re
import sys
import urllib.request

SRC = "https://raw.githubusercontent.com/ChordDictionary/SetTheory/master/set.js"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "chordSets.json")


def load(src):
    if src.startswith("http"):
        return urllib.request.urlopen(src).read().decode("utf-8")
    with open(src, "r", encoding="utf-8") as fh:
        return fh.read()


def to_json(text):
    body = text[text.index("{", text.index("return")):]
    body = re.sub(r"(?m)^(\s*)([A-Za-z_$][\w$]*)\s*:", r'\1"\2":', body)
    body = re.sub(r",(\s*[}\]])", r"\1", body)
    return json.JSONDecoder().raw_decode(body)[0]


def normalize(name):
    """Fold a human chord name down to something a user might actually type."""
    n = name.lower()
    n = n.replace("triad", "").replace("chord", "")
    n = re.sub(r"[^a-z0-9#b]", "", n)
    return n


def main():
    data = to_json(load(sys.argv[1] if len(sys.argv) > 1 else SRC))
    sets = {}
    by_name = {}
    for category, groups in data["list"].items():
        for group, entries in groups.items():
            if not isinstance(entries, dict):
                continue
            for entry in entries.values():
                if not isinstance(entry, dict) or "set" not in entry:
                    continue
                pcs = sorted(set(entry["set"]))
                if not pcs:
                    continue
                key = ",".join(str(p) for p in pcs)
                names = []
                for field in ("chordSymbol", "name"):
                    value = (entry.get(field) or "").strip()
                    for part in value.split(","):
                        part = part.strip()
                        if part and part not in names:
                            names.append(part)
                if not names:
                    continue
                bucket = sets.setdefault(key, [])
                for name in names:
                    if name not in bucket:
                        bucket.append(name)
                    slug = normalize(name)
                    if slug and slug not in by_name:
                        by_name[slug] = key

    out = {
        "source": "https://github.com/ChordDictionary/SetTheory",
        "sets": sets,
        "byName": by_name,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), sort_keys=True)
    print("sets: %d   names: %d   bytes: %d" % (len(sets), len(by_name), os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
