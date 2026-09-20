#!/usr/bin/env python3
"""Drive the browser test harnesses in real Chromium via Playwright.

Covers the things the JavaScriptCore suites cannot: WebGL shader compilation,
canvas text metrics and painting, and the Web MIDI API surface.

    <venv>/bin/python scripts/browser_test.py [page ...]
"""
import functools
import http.server
import os
import re
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = sys.argv[1:] or ["tests/browser/modules.html"]
SHOTS = os.path.join(ROOT, "tests", "browser", "shots")


class Bundlerish(http.server.SimpleHTTPRequestHandler):
    """The repository, with the one thing Vite does that a browser will not.

    `src/core/genres.js` has `import VOCABULARY from '../data/genres.json'`,
    which a bundler turns into a module and a browser refuses: a JSON file
    fetched as a module script needs an import attribute, and without one the
    engine rejects it on MIME type alone. The whole page then fails to load
    `store.js` and every check in it reports as "never finished" -- which is
    how this harness came to be broken for a week without anybody noticing.

    So a JSON file *requested as a script* is answered as one. `Sec-Fetch-Dest`
    is what separates that from an ordinary fetch of the same URL, so nothing
    else changes. This is the same simulated bundling the page already relies
    on for bare specifiers and CSS imports.
    """

    def do_GET(self):
        clean = self.path.split("?", 1)[0]
        wanted = self.headers.get("Sec-Fetch-Dest", "")
        if clean.endswith(".json") and wanted == "script":
            where = self.translate_path(clean)
            try:
                with open(where, "rb") as file:
                    body = b"export default " + file.read() + b"\n"
            except OSError:
                self.send_error(404, "File not found")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def serve():
    handler = functools.partial(Bundlerish, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def main():
    httpd, port = serve()
    os.makedirs(SHOTS, exist_ok=True)
    failures = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            args=[
                "--enable-unsafe-swiftshader",
                "--use-angle=swiftshader",
                "--enable-features=SharedArrayBuffer",
            ]
        )
        for page_path in PAGES:
            context = browser.new_context(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
            try:
                context.grant_permissions(["midi", "midi-sysex"])
            except Exception as exc:
                print("note: could not grant midi permission:", exc)
            page = context.new_page()

            console = []
            page.on("console", lambda msg: console.append((msg.type, msg.text)))
            # The stack, not just the message: an uncaught error inside the page is
            # almost always the reason a harness "never finished", and the
            # message alone rarely says where.
            page.on("pageerror", lambda err: console.append(
                ("pageerror", f"{err}\n      {(getattr(err, 'stack', '') or '').strip()[:700]}")))

            url = f"http://127.0.0.1:{port}/{page_path}"
            print(f"\n=== {page_path} ===")
            page.goto(url, wait_until="load")
            try:
                page.wait_for_function("window.__done === true", timeout=90000)
            except Exception as exc:
                print("FAIL page never finished:", exc)
                failures += 1

            payload = page.evaluate("window.__results || null")
            if payload:
                for item in payload["results"]:
                    mark = "ok  " if item["pass"] else "FAIL"
                    detail = f"   ({item['detail']})" if item.get("detail") else ""
                    print(f"{mark} {item['name']}{detail}")
                    if not item["pass"]:
                        failures += 1

            # A page may deliberately provoke console errors -- a test for how a
            # cross-origin failure is handled cannot avoid the browser logging
            # one. Those pages declare the patterns they expect.
            expected = page.evaluate("window.__expectedConsole || []") or []
            patterns = [re.compile(pattern) for pattern in expected]

            for kind, text in console:
                if kind not in ("error", "pageerror", "warning"):
                    continue
                if any(pattern.search(text) for pattern in patterns):
                    print(f"CONSOLE {kind} (expected): {text[:120]}")
                    continue
                print(f"CONSOLE {kind}: {text[:400]}")
                if kind in ("error", "pageerror"):
                    failures += 1

            shot = os.path.join(SHOTS, os.path.basename(page_path).replace(".html", ".png"))
            page.screenshot(path=shot, full_page=False)
            print(f"screenshot -> {os.path.relpath(shot, ROOT)}")
            context.close()

        browser.close()

    httpd.shutdown()
    print("\n" + ("FAILURES: %d" % failures if failures else "browser: all checks passed"))
    sys.exit(1 if failures else 0)


main()
