#!/usr/bin/env python3
"""Static server for the no-build entry (dev.html).

Only needed while there is no Node on this machine; `npm run dev` replaces it.
Serves the repo over http://127.0.0.1:<port>, which counts as a secure context,
so Web MIDI works.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8173


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves the no-build entry at the root.

    index.html is Vite's entry: it imports bare specifiers like `vue`, which a
    browser cannot resolve on its own. Served raw it fails with "Failed to
    resolve module specifier" and leaves a blank page -- and the root is exactly
    where anyone would look. So the root is dev.html here.
    """

    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map[".vue"] = "text/plain"
    extensions_map[".js"] = "text/javascript"

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean in ("/", "/index.html"):
            return os.path.join(ROOT, "dev.html")
        return super().translate_path(path)

    def end_headers(self):
        # No caching, so an edit is always the file you get back.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(Handler, directory=ROOT)

with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"jamin (no-build)  ->  http://127.0.0.1:{PORT}/")
    print("Chrome, Edge or Opera. Ctrl-C to stop.")
    sys.stdout.flush()
    httpd.serve_forever()
