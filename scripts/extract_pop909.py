#!/usr/bin/env python3
"""Build src/data/pop909Phrases.json from a local POP909 checkout.

Runs scripts/extract_pop909.html in a real browser so the extraction uses the
app's own MIDI reader, chord inference and phrase normalisation rather than a
second implementation that could drift from them.

    <venv>/bin/python scripts/extract_pop909.py /path/to/POP909-Dataset [songs]

POP909 is MIT licensed: https://github.com/music-x-lab/POP909-Dataset
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "data", "pop909Phrases.json")


def make_handler(dataset):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            clean = path.split("?", 1)[0].split("#", 1)[0]
            if clean.startswith("/pop909/"):
                return os.path.join(dataset, clean[len("/pop909/"):])
            return os.path.join(ROOT, clean.lstrip("/"))

        def log_message(self, *args):
            pass

    return Handler


def main():
    dataset = sys.argv[1] if len(sys.argv) > 1 else None
    if not dataset or not os.path.isdir(dataset):
        sys.exit("usage: extract_pop909.py /path/to/POP909-Dataset [song count]")
    songs_dir = os.path.join(dataset, "POP909")
    if not os.path.isdir(songs_dir):
        songs_dir = dataset

    ids = sorted(name for name in os.listdir(songs_dir) if name.isdigit())
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else len(ids)
    ids = ids[:limit]
    print(f"{len(ids)} songs from {songs_dir}")

    httpd = socketserver.TCPServer(("127.0.0.1", 0), make_handler(songs_dir))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.server_address[1]

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        # A failed module import shows up as a pageerror, not a console error.
        # Without this the run just hangs until the timeout with nothing to show
        # for it, which is exactly what it did the first time.
        failures = []
        page.on("pageerror", lambda e: failures.append(str(e)) or print("  pageerror:", str(e)[:200]))
        page.on("console", lambda m: print("  console:", m.text[:160]) if m.type == "error" else None)
        page.add_init_script(f"window.__config = {json.dumps({'songs': ids, 'perQuality': 160})}")
        page.goto(f"http://127.0.0.1:{port}/scripts/extract_pop909.html", wait_until="load")
        try:
            page.wait_for_function("window.__done === true", timeout=300000)
        except Exception:
            browser.close()
            httpd.shutdown()
            sys.exit("extraction never finished. " + (failures[0] if failures else "no error reported"))
        result = page.evaluate("window.__result")
        stats = page.evaluate("window.__stats")
        browser.close()

    httpd.shutdown()
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(result, fh, separators=(",", ":"))
    print("stats:", stats)
    print("wrote %s (%d bytes, %d parts)" % (OUT, os.path.getsize(OUT), len(result["parts"])))


main()
