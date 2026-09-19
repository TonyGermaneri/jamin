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

It needs a build first, because it drives dist/ rather than the dev server --
what is photographed should be what ships. Use `npm run build`, not
`npm run build:page`: Vite empties dist before it writes, so building the page
alone deletes `jamin-compile.js` and leaves a plugin that renders perfectly and
plays nothing.
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

        print(f"\n  {reachTools(page)}")
        print(f"  {openingKeepsIt(page)}\n")

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


def reachTools(page):
    """Can the pointer actually get to the icons?

    The bug this exists for: the icons appear above the chord, reaching them
    means leaving the chord, and leaving the chord used to take them away
    before the pointer arrived -- so they could not be clicked at all. A
    screenshot cannot see that. Only moving a real mouse can.
    """
    page.evaluate("""() => {
      const app = window.__jaminApp
      app.state.ui.book = null
      app.state.ui.progressions = false
      app.setText('| Dmi7 G7 | Cmaj7 Ami7 |')
    }""")
    page.wait_for_timeout(600)

    spot = page.evaluate("() => window.__jaminChartProbe('where')")
    page.mouse.move(spot["x"], spot["y"])
    page.wait_for_timeout(250)
    if page.locator(".jamin-token-tools").count() == 0:
        return "FAIL the icons never appeared over the chord"

    box = page.locator(".jamin-token-tools").bounding_box()
    if not box:
        return "FAIL the icons have no box to aim at"

    # Straight from the chord to the icons, through the gap between them.
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=12)
    page.wait_for_timeout(320)
    if page.locator(".jamin-token-tools").count() == 0:
        return "FAIL the icons vanished while the pointer was on its way"

    # And they take a click, which is the whole point of reaching them.
    before = page.evaluate("() => window.__jaminApp.state.text")
    page.locator(".jamin-token-tool").first.click()
    page.wait_for_timeout(300)
    after = page.evaluate("() => window.__jaminApp.state.text")
    if after == before:
        return "FAIL clicking the first icon changed nothing"
    return f"ok   pointer reaches the icons, and delete works ({before!r} -> {after!r})"


def openingKeepsIt(page):
    """Does the picture survive a node being opened?

    The complaint this exists for: opening a node made the graph vanish and
    come back as something else. What a hierarchy explorer has to do instead is
    keep every node that was on screen on screen, and grow the new ones out of
    the one that was opened. No screenshot can see that -- it is a question
    about the frames in between -- so this opens one and watches the count.
    """
    page.evaluate("""() => {
      const app = window.__jaminApp
      app.state.settings.graph.drums = true
      app.openBook('drums')
    }""")
    page.wait_for_timeout(3000)
    if not page.evaluate("() => Boolean(window.__jaminTreeProbe)"):
        return "FAIL the graph never drew"

    before = page.evaluate("() => window.__jaminTreeProbe.showing()")
    shut = page.evaluate("() => window.__jaminTreeProbe.shutOnes()")
    if not shut:
        return "FAIL nothing was left closed to open"

    opened = page.evaluate("(l) => window.__jaminTreeProbe.open(l)", shut[0])
    if not opened:
        return f"FAIL could not open {shut[0]!r}"

    # Through the transition, sampling as it runs.
    lowest = before
    for _ in range(14):
        page.wait_for_timeout(40)
        lowest = min(lowest, page.evaluate("() => window.__jaminTreeProbe.showing()"))
    page.wait_for_timeout(500)
    after = page.evaluate("() => window.__jaminTreeProbe.showing()")

    if lowest < before:
        return f"FAIL the picture shrank while opening ({before} -> {lowest} -> {after})"
    if after <= before:
        return f"FAIL opening {shut[0]!r} added nothing ({before} -> {after})"
    return (f"ok   opening {shut[0]!r} kept every node and added "
            f"{after - before} ({before} -> {after}, never below {lowest})")


def withLibrary(page, book):
    """A catalogue view with something actually in it.

    The empty state and the loaded state are different pictures, and the
    interesting faults live in the loaded one: the progression list once
    rendered only when the filter panel did *not*, so it disappeared the
    moment a library gave the filters some genres to offer. Photographed
    empty, it looked perfect.
    """
    page.evaluate("""async () => {
      const app = window.__jaminApp
      const GEN = ['rock', 'pop', 'jazz', 'metal', 'soul', 'country', 'blues', 'folk']
      const rows = []
      for (let n = 0; n < 4000; n++) {
        rows.push({ n, name: `${GEN[n % GEN.length]} ${1950 + (n % 7) * 10}s #${n}`,
          chords: '<verse_1> C Am F G', bars: [2, 4, 4, 8][n % 4],
          genre: GEN[n % GEN.length], decade: String(1950 + (n % 7) * 10),
          source: 'seeded' })
      }
      await app.putProgressions(rows)
      app.state.bulk.count = rows.length
    }""")
    page.wait_for_timeout(600)
    show(page, book)
    page.wait_for_timeout(1200)


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
    # The same view with a library in it, which is where the faults are.
    ("list-progressions-full", lambda page: (graph(page, False),
                                             withLibrary(page, "progressions"))),
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
