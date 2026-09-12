#!/usr/bin/env python3
"""Drive the browser test harnesses in real Chromium via Playwright.

Covers the things the JavaScriptCore suites cannot: WebGL shader compilation,
canvas text metrics and painting, and the Web MIDI API surface.

    <venv>/bin/python scripts/browser_test.py [page ...]
"""
import functools
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = sys.argv[1:] or ["tests/browser/modules.html"]
SHOTS = os.path.join(ROOT, "tests", "browser", "shots")


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
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
            page.on("pageerror", lambda err: console.append(("pageerror", str(err))))

            url = f"http://127.0.0.1:{port}/{page_path}"
            print(f"\n=== {page_path} ===")
            page.goto(url, wait_until="load")
            try:
                page.wait_for_function("window.__done === true", timeout=30000)
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

            bad = [(t, text) for t, text in console if t in ("error", "pageerror", "warning")]
            for kind, text in bad:
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
