#!/usr/bin/env python3
"""Build src/data/improvisorLicks.json from Impro-Visor's vocabulary.

Impro-Visor (https://github.com/Impro-Visor/Impro-Visor) is GPL-2.0-or-later, so
its vocabulary can be redistributed here under jamin's GPL-3.0-or-later. This
script is the "corresponding source" for that conversion: it reads `vocab/My.voc`
and keeps every entry played over a single chord, which is what jamin's phrase
model is -- one chord's worth of music, plus the chord it was played over.

Entries spanning a chord sequence are skipped: re-pointing a two-chord lick at
one chord would misrepresent it.

Leadsheet note syntax, confirmed against all 37,000 notes in the file:

    pitch     [a-g] accidentals(#|b|bb) octave(+ up, - down, repeatable), or `r`
    duration  a sum of tied terms: 8, 4., 8/3, 4+8, 16/5 ...
              `N` is a 1/N note; `.` dots it; `/D` makes it one of D in the time
              of the nearest lower power of two; an empty duration repeats the
              previous one

    python3 scripts/build_licks.py [path-or-url-to-My.voc]
"""
import json
import math
import os
import re
import sys
import urllib.request

SRC = "https://raw.githubusercontent.com/Impro-Visor/Impro-Visor/master/vocab/My.voc"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "improvisorLicks.json")

PPQN = 24
WHOLE = PPQN * 4
LETTER = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
KINDS = ("lick", "cell", "idiom", "quote")


def load(src):
    if src.startswith("http"):
        return urllib.request.urlopen(src).read().decode("utf-8", "replace")
    with open(src, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def blocks(text, tag):
    """Every top-level (tag ...) s-expression, balanced by paren depth."""
    for match in re.finditer(r"(?m)^\(" + tag + r"\b", text):
        start = match.start()
        depth = 0
        i = start
        while i < len(text):
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
                if depth == 0:
                    yield text[start:i + 1]
                    break
            i += 1


def field(block, name):
    match = re.search(r"\(" + name + r"\s+([^)]*)\)", block)
    return match.group(1).strip() if match else None


def duration_pulses(spec, previous):
    """A tied sum of note values, in pulses. None if it cannot be read."""
    if not spec:
        return previous
    total = 0.0
    for term in spec.split("+"):
        match = re.match(r"^(\d+)(\.?)(?:/(\d+))?$", term)
        if not match:
            return None
        value = WHOLE / int(match.group(1))
        if match.group(2):
            value *= 1.5
        if match.group(3):
            group = int(match.group(3))
            # D notes in the time of the nearest lower power of two.
            fits = 1 << int(math.floor(math.log(group, 2)))
            value = value * fits / group
        total += value
    return total


def pitch_midi(token):
    match = re.match(r"^([a-g])([#b]*)([+-]*)", token)
    if not match:
        return None
    pitch = LETTER[match.group(1)]
    for char in match.group(2):
        pitch += 1 if char == "#" else -1
    octave = 4 + match.group(3).count("+") - match.group(3).count("-")
    note = 12 * (octave + 1) + pitch
    return note if 0 <= note <= 127 else None


def read_notes(spec):
    """-> ([[at, midi, duration], ...], total pulses) or None if unreadable."""
    events = []
    at = 0.0
    previous = float(WHOLE / 8)
    for token in spec.split():
        head = re.match(r"^([a-g][#b]*[+-]*|r)(.*)$", token)
        if not head:
            return None
        length = duration_pulses(head.group(2), previous)
        if length is None or length <= 0:
            return None
        previous = length
        if head.group(1) != "r":
            note = pitch_midi(head.group(1))
            if note is None:
                return None
            events.append([round(at), note, max(1, round(length))])
        at += length
    return (events, at) if events else None


def single_chord(block):
    """The one chord this entry is played over, or None if it spans several."""
    context = field(block, "chords") or field(block, "sequence")
    if not context:
        return None
    words = [word for word in context.split() if word != "|"]
    unique = set(words)
    return words[0] if len(unique) == 1 else None


def main():
    text = load(sys.argv[1] if len(sys.argv) > 1 else SRC)
    out = []
    skipped = {"multi-chord": 0, "unreadable": 0, "no notes": 0}

    for kind in KINDS:
        for block in blocks(text, kind):
            chord = single_chord(block)
            if not chord:
                skipped["multi-chord"] += 1
                continue
            spec = field(block, "notes")
            if not spec:
                skipped["no notes"] += 1
                continue
            read = read_notes(spec)
            if not read:
                skipped["unreadable"] += 1
                continue
            events, total = read
            name = (field(block, "name") or kind).strip()
            out.append({
                "n": re.sub(r"\s+", " ", name)[:48],
                "k": kind,
                "c": chord,
                # Round the length up to a beat: these are written to sit in a
                # bar, and the player stretches them to the chord anyway.
                "d": max(PPQN, int(math.ceil(total / PPQN) * PPQN)),
                "v": events,
            })

    payload = {
        "source": "https://github.com/Impro-Visor/Impro-Visor",
        "license": "GPL-2.0-or-later",
        "note": "Vocabulary from Impro-Visor by Robert Keller and Harvey Mudd College, "
                "converted by scripts/build_licks.py. Entries spanning more than one "
                "chord are omitted.",
        "ppqn": PPQN,
        "licks": out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print("licks: %d   skipped: %s   bytes: %d" % (len(out), skipped, os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
