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

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
handler.extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
handler.extensions_map[".vue"] = "text/plain"
handler.extensions_map[".js"] = "text/javascript"

with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"jamin (no-build)  ->  http://127.0.0.1:{PORT}/dev.html")
    print("Chrome, Edge or Opera. Ctrl-C to stop.")
    sys.stdout.flush()
    httpd.serve_forever()
