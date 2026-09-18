#!/usr/bin/env python3
"""Photograph the application at 1920x1080, so it can be looked at rather than imagined.

The graph views and the list views are both things whose only real test is
whether a person can read them. A unit test can say a tree has no node with a
thousand children; it cannot say the picture is legible, that the type is not
crammed, or that a panel has collapsed to nothing. So this drives the real app
in a real browser at a real desktop size, loads real data into it, and writes
PNGs.

    <venv>/bin/python scripts/shots.py                 # every view
    <venv>/bin/python scripts/shots.py graph-drums     # just one

The pictures land in tests/browser/shots/, which is gitignored -- they are
evidence for whoever is looking now, not artefacts to keep. Any corpus this
pulls down to fill the views is fetched into the same place and is never
committed and never bundled. @see docs/testing.md

It needs a build: `npm run build:page` first, because it drives dist/ rather
than the dev server -- what is photographed should be what ships.
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "browser", "shots")
CORPORA = os.path.join(ROOT, "tests", "browser", "corpora")
WIDE, TALL = 1920, 1080


def serve():
    """dist, with the corpora hung off it.

    A symlink rather than a second server: the page fetches them with a plain
    relative URL and nothing has to know about ports. `vite build` empties
    dist, so it is made here rather than kept.
    """
    link = os.path.join(ROOT, "dist", "corpora")
    if os.path.isdir(CORPORA) and not os.path.exists(link):
        try:
            os.symlink(CORPORA, link)
        except OSError as exc:
            print("note: could not reach the corpora:", exc)

    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=os.path.join(ROOT, "dist"))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def main():
    wanted = set(sys.argv[1:])
    if not os.path.exists(os.path.join(ROOT, "dist", "index.html")):
        raise SystemExit("no build in dist/ -- run `npm run build:page` first")

    os.makedirs(SHOTS, exist_ok=True)
    httpd, port = serve()
    taken = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            # The graph is WebGL, and a headless browser has no GPU. Without
            # these the canvas comes back empty and every picture is a lie.
            "--enable-unsafe-swiftshader",
            "--use-angle=swiftshader",
        ])
        context = browser.new_context(viewport={"width": WIDE, "height": TALL},
                                      device_scale_factor=1)
        page = context.new_page()
        trouble = []
        page.on("pageerror", lambda err: trouble.append(str(err)))
        page.on("console", lambda msg: trouble.append(msg.text)
                if msg.type == "error" else None)

        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="load")
        page.wait_for_selector(".v-application", timeout=30000)
        page.wait_for_timeout(1200)
        ready(page)

        for name, prepare in VIEWS:
            if wanted and name not in wanted:
                continue
            try:
                prepare(page)
            except Missing as exc:
                # The big collections are downloaded, never committed, and
                # thrown away again. Not having them is the normal state.
                print(f"  {name:<28} skipped — {exc}")
                continue
            except Exception as exc:
                print(f"FAIL {name}: {exc}")
                continue
            page.wait_for_timeout(1200)
            where = os.path.join(SHOTS, f"{name}.png")
            page.screenshot(path=where)
            taken.append((name, where))
            print(f"  {name:<28} {os.path.relpath(where, ROOT)}")

        context.close()
        browser.close()

    httpd.shutdown()
    if trouble:
        print(f"\n{len(trouble)} console error(s); first few:")
        for one in trouble[:5]:
            print("   ", one[:200])
    print(f"\n{len(taken)} picture(s) in {os.path.relpath(SHOTS, ROOT)}")
    return 0


def drive(page, script, arg=None):
    return page.evaluate(
        "([script, arg]) => { const app = window.__jaminApp;"
        " if (!app) throw new Error('the page exposes no handle to drive');"
        " return (new Function('app', 'arg', script))(app, arg) }",
        [script, arg])


def show(page, book):
    """Open one of the catalogues."""
    if book == "progressions":
        drive(page, "app.state.ui.book = null; app.state.ui.progressions = true")
    else:
        drive(page, "app.state.ui.progressions = false;"
                    " app.state.ui.book = null; app.openBook(arg)", book)
    page.wait_for_timeout(1400)


def graph(page, on):
    drive(page, "const g = app.state.settings.graph;"
                " g.drums = g.phrases = g.progressions = arg", bool(on))
    page.wait_for_timeout(300)


def ready(page):
    """The catalogues load on demand, so ask for them and wait."""
    drive(page, "app.ensureLicks(); app.searchDrums()")
    page.wait_for_timeout(3000)


class Missing(Exception):
    """A corpus that has not been fetched. @see scripts/corpus_trees.py"""


def big(page, which, book, seconds=180):
    """Put a real catalogue's map in front of the renderer.

    The tree is built by the application's own buildTree from the real
    collection -- 774,268 drum patterns off the disk they live on, 679,807
    progressions out of Chordonomicon -- and written into the store the plugin
    reads it back out of, so what is photographed is the real rendering path at
    the real size. Importing either through the UI first would be twenty
    minutes of watching a progress bar to arrive at the same tree.

    @see scripts/graph_check.py, which times buildTree itself at this size.
    """
    tree = os.path.join(CORPORA, f"{which}-tree.json")
    if not os.path.exists(tree):
        raise Missing(f"no {which} tree; see scripts/corpus_trees.py")

    page.evaluate("""async ([which, seconds]) => {
      const app = window.__jaminApp
      const held = await fetch(`corpora/${which}-tree.json`)
      if (!held.ok) throw new Error(`no ${which} tree: ${held.status}`)
      const tree = await held.json()
      await app.writeGraph(which, tree)
      // The book only reaches for a stored map when it believes a bulk library
      // is in: say so, since one is -- the tree came out of it.
      if (which === 'progressions') app.state.bulk.count = tree.clips
      window.__jaminBigTree = { nodes: tree.nodes.length, clips: tree.clips }
    }""", [which, seconds])
    graph(page, True)
    show(page, book)
    # A million nodes is a texture upload and a first frame, not a paint.
    page.wait_for_timeout(9000)
    said = page.evaluate("() => window.__jaminBigTree || null")
    if said:
        print(f"      {said['clips']:,} clips -> {said['nodes']:,} nodes")


def onChart(page, what, small=False):
    """The chart, with one of the pointing affordances open.

    Driven through the page rather than by moving a real mouse: the canvas
    hit-tests against its own layout, so the reliable way to put the pointer on
    a chord is to tell the component which token it is on.
    """
    if small:
        page.set_viewport_size({"width": 900, "height": 480})
    page.evaluate("""(what) => {
      const app = window.__jaminApp
      app.state.ui.book = null
      app.state.ui.progressions = false
      app.state.ui.settings = false
      if (!app.state.text || app.state.text.length < 8) {
        app.setText('| Dmi7 G7 | Cmaj7 .Ami7{comp} | [d:funk 138] % |')
      }
      window.__jaminChartProbe && window.__jaminChartProbe(what)
    }""", what)
    page.wait_for_timeout(700)

    # The second step of the picker is reached by choosing a root, so the
    # screenshot of it is taken by choosing one -- the same way anybody does.
    if what == "colours":
        page.click(".jamin-spoke-name")
        page.wait_for_timeout(400)


VIEWS = [
    ("home", lambda page: page.wait_for_timeout(200)),
    ("list-phrases", lambda page: (graph(page, False), show(page, "phrases"))),
    ("list-drums", lambda page: (graph(page, False), show(page, "drums"))),
    ("list-progressions", lambda page: (graph(page, False), show(page, "progressions"))),
    ("graph-phrases", lambda page: (graph(page, True), show(page, "phrases"))),
    ("graph-drums", lambda page: (graph(page, True), show(page, "drums"))),
    ("graph-progressions", lambda page: (graph(page, True), show(page, "progressions"))),
    # At the size somebody's own collection actually is. Only when the corpora
    # are there: they are downloaded, gitignored and thrown away afterwards.
    ("chart-tools", lambda page: onChart(page, "tools")),
    ("chart-picker-roots", lambda page: onChart(page, "picker")),
    ("chart-picker-colours", lambda page: onChart(page, "colours")),
    ("chart-picker-small", lambda page: onChart(page, "colours", small=True)),
    ("chart-insert-menu", lambda page: onChart(page, "insert")),
    ("graph-drums-whole", lambda page: big(page, "drums", "drums")),
    ("graph-progressions-whole", lambda page: big(page, "progressions", "progressions")),
]

sys.exit(main())
