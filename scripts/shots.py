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


class Both(http.server.SimpleHTTPRequestHandler):
    """dist, with the corpora answered from where they actually live.

    This was a symlink in dist/, which the page could fetch with a plain
    relative URL and nothing had to know about ports. It was also a trap: the
    plugin's web copy globs dist/ into the bundle, followed the link, and set
    about packing 374MB of test corpus into the plugin -- the drum collection
    is import-only and Chordonomicon is CC-BY-NC, so neither may ship. It
    filled the disk before it got that far.

    Answering the path instead means nothing the build can see ever points at
    them. @see native/cmake/CopyWeb.cmake, which now refuses as well.
    """

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/corpora/"):
            return os.path.join(CORPORA, *clean[len("/corpora/"):].split("/"))
        return super().translate_path(path)


def serve():
    handler = functools.partial(Both, directory=os.path.join(ROOT, "dist"))
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
        print(f"  {startsSmall(page)}")
        print(f"  {openingKeepsIt(page)}")
        print(f"  {openingStaysPut(page)}")
        print(f"  {eachCatalogue(page)}\n")

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


def startsSmall(page):
    """Does a catalogue open at its top level, or pour itself onto the screen?

    It used to open two levels deep, which on a shipped corpus is a few nodes
    and on a real library is thousands: a solid band of dots, with every label
    worth reading culled for collision against the ones that were not. The
    complaint was "there's too damn many nodes", and the number is the check.
    """
    page.evaluate("""() => {
      const app = window.__jaminApp
      app.state.settings.graph.drums = true
      app.openBook('drums')
    }""")
    page.wait_for_timeout(3000)
    if not page.evaluate("() => Boolean(window.__jaminTreeProbe)"):
        return "FAIL the graph never drew"
    deepest = page.evaluate("() => window.__jaminTreeProbe.deepest()")
    showing = page.evaluate("() => window.__jaminTreeProbe.showing()")
    named = page.evaluate("() => window.__jaminTreeProbe.labels()")
    shut = len(page.evaluate("() => window.__jaminTreeProbe.shutOnes()"))
    if deepest > 1:
        return f"FAIL the catalogue opened {deepest} levels deep, not 1"
    # And the point of showing less: what is left can be read. A ring of dots
    # with no words on it is not an improvement on a band of them.
    if showing and named < showing * 0.8:
        return f"FAIL only {named} of {showing} nodes got a label"
    return (f"ok   the catalogue opens at its top level: {showing} nodes, "
            f"{named} labelled, {shut} still closed")


def openingStaysPut(page):
    """Opening a node must not move the camera.

    "It should do so instantly, without moving the camera, no reloading the
    graph." Nothing a screenshot can see: a graph rebuilt around the node you
    clicked and a graph that grew from it look identical once both have
    settled. The transform is the difference, so the transform is what is
    checked -- along with the node count, because a rebuild that happens to
    leave the camera alone is still a rebuild.
    """
    if not page.evaluate("() => Boolean(window.__jaminTreeProbe)"):
        return "FAIL the graph never drew"

    before = page.evaluate("() => window.__jaminTreeProbe.showing()")
    was = page.evaluate("() => window.__jaminTreeProbe.camera()")
    shut = page.evaluate("() => window.__jaminTreeProbe.shutOnes()")
    if not shut:
        return "FAIL nothing was left closed to open"

    if not page.evaluate("(l) => window.__jaminTreeProbe.open(l)", shut[0]):
        return f"FAIL could not open {shut[0]!r}"

    # Through the bloom, sampling as it runs: nothing may vanish on the way.
    lowest = before
    for _ in range(20):
        page.wait_for_timeout(40)
        lowest = min(lowest, page.evaluate("() => window.__jaminTreeProbe.showing()"))
    page.wait_for_timeout(600)
    after = page.evaluate("() => window.__jaminTreeProbe.showing()")
    now = page.evaluate("() => window.__jaminTreeProbe.camera()")

    if lowest < before:
        return f"FAIL the picture shrank while opening ({before} -> {lowest} -> {after})"
    if after <= before:
        return f"FAIL opening {shut[0]!r} added nothing ({before} -> {after})"
    if now != was:
        return f"FAIL the camera moved: {was} -> {now}"
    return (f"ok   opening {shut[0]!r} grew it {before} -> {after} "
            f"and left the camera at k={now['k']}")


def eachCatalogue(page):
    """The same question of all three, because they are not the same shape.

    The drum catalogue has one library at its middle; the phrase catalogue has
    a source per root and the progression catalogue a genre. A rule written
    against the shape of one of them is a rule that empties another.
    """
    out = []
    for book in ("drums", "phrases", "progressions"):
        # From a clean slate. What a catalogue was left open at is remembered
        # now, and a check that measures its own predecessor's leftovers is
        # measuring the wrong thing -- which is what this did on its first
        # run, reporting two levels deep because the check before it had
        # opened one.
        # Closed, forgotten, then opened -- with a wait in between, or the
        # book never unmounts and the graph keeps the nodes the check before
        # this one opened. Clearing the remembered set is not enough on its
        # own: the live renderer holds its own copy.
        page.evaluate("""() => {
          const app = window.__jaminApp
          app.state.ui.book = null
          app.state.ui.progressions = false
          app.state.settings.graph.open = {}
        }""")
        page.wait_for_timeout(400)
        page.evaluate("""(b) => {
          const app = window.__jaminApp
          app.state.settings.graph[b] = true
          app.openBook(b)
        }""", book)
        page.wait_for_timeout(2500)
        if not page.evaluate("() => Boolean(window.__jaminTreeProbe)"):
            out.append(f"FAIL {book}: no graph")
            continue
        showing = page.evaluate("() => window.__jaminTreeProbe.showing()")
        deepest = page.evaluate("() => window.__jaminTreeProbe.deepest()")
        places = page.evaluate("() => window.__jaminTreeProbe.places()")

        # Nothing may be drawn where nothing can be seen. The canvas runs the
        # whole window and the panels float on top of it, so a fit that does
        # not account for them puts nodes behind the detail pane: the phrase
        # book drew two sources and showed one, which is indistinguishable
        # from a catalogue that has lost half its contents.
        hidden = [one for one in places if page.evaluate("""(p) => {
          for (const el of document.querySelectorAll('[data-keep-clear]')) {
            const r = el.getBoundingClientRect()
            if (!r.width || !r.height) continue
            if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return true
          }
          return p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight
        }""", one)]

        if deepest > 1:
            out.append(f"FAIL {book} opened {deepest} levels deep")
        elif hidden:
            out.append(f"FAIL {book} hid {len(hidden)} of {showing}: "
                       + ", ".join(f"{h['label']}({h['x']},{h['y']})" for h in hidden[:4]))
        else:
            out.append(f"ok {book}: {showing} nodes, all in the clear")
    return "  |  ".join(out)


def libraryNotes(page):
    """The table that asks what a library's own notes mean.

    Seeded with the shape the real thing has -- the Superior Drummer
    download's note tallies and the folders those notes live in -- because
    the question this screen has to answer well is what forty rows of it look
    like, and a library with three notes in it cannot say.
    """
    page.evaluate("""() => {
      const app = window.__jaminApp
      return app.putSet({
        id: 'shot-sd2',
        name: 'Superior Drummer 2 Drum Midi',
        root: '/Volumes/external/800k-drums/Superior Drummer 2 Drum Midi',
        byReference: true,
        kit: 'gm', customMap: {}, folderKits: {}, folders: 11040,
        count: 404685, addedAt: Date.now(),
        inMap: { 94: 'congaHigh' },
        inLearned: {
          hints: {
            17: { voice: 'timbaleHigh', share: 100, against: 0 },
            25: { voice: 'hatOpen', share: 74, against: 1 },
            90: { voice: 'congaLow', share: 88, against: 0 },
            103: { voice: 'congaHigh', share: 100, against: 0 },
          },
          where: {
            24: [{ shelf: '401@SONGS/150-S0803@HATS_OPEN', share: 91 },
                 { shelf: '000004@DFH/Snare Roughs/Ruffs on the beat', share: 88 }],
            17: [{ shelf: '48@TIMBALES/05@SALSA', share: 96 },
                 { shelf: '48@TIMBALES/02@CASCARA', share: 94 }],
            10: [{ shelf: '16@FILLS/01@SOFT_FILLS_8TH', share: 62 }],
            90: [{ shelf: '000045@EZX_LATIN_PERCUSSION/00@_CONGAS', share: 71 }],
            94: [{ shelf: '000045@EZX_LATIN_PERCUSSION/02@MARVIN_FUNK_SWING', share: 58 }],
            95: [{ shelf: '000045@EZX_LATIN_PERCUSSION/01@TUMBAO_SWING', share: 63 }],
            96: [{ shelf: '000045@EZX_LATIN_PERCUSSION/06@RUMBA', share: 54 }],
            97: [{ shelf: '000045@EZX_LATIN_PERCUSSION/04@MARTILLO', share: 66 }],
            103: [{ shelf: '34@CONGA', share: 81 }],
            25: [{ shelf: '105@STRAIGHT_4#4/123-S273@HATS_OPEN_VARIATIONS', share: 77 }],
            11: [{ shelf: '000045@EZX_LATIN_PERCUSSION/12@_CAJON', share: 55 }],
            12: [{ shelf: '000045@EZX_LATIN_PERCUSSION/12@_CAJON', share: 51 }],
          },
        },
        facts: {
          range: '0-127',
          kit: 'wider than General MIDI',
          pitchUse: {
            36: 12489949, 42: 12032974, 38: 9309522, 51: 4257003, 44: 2196419,
            24: 44885, 17: 42985, 25: 37078, 21: 23446, 29: 22303, 10: 18908,
            11: 6527, 12: 6988, 90: 6441, 94: 4560, 95: 6357, 96: 7171,
            97: 9008, 103: 2362, 116: 11271, 33: 7910, 34: 7764, 82: 4108,
          },
          pitches: [10, 11, 12, 17, 21, 24, 25, 29, 33, 34, 36, 38, 42, 44, 51,
                    82, 90, 94, 95, 96, 97, 103, 116],
        },
      }).then(() => app.refreshDrumSets())
    }""")
    page.wait_for_timeout(600)
    drive(page, "app.state.ui.book = null; app.state.ui.settings = true")
    page.wait_for_timeout(700)
    # The libraries live behind a tab of Settings; which one it is called has
    # changed twice, so try the names rather than an index.
    for label in ("Drums", "Libraries", "Drum libraries"):
        tab = page.locator(f".v-tab:has-text('{label}')").first
        if tab.count():
            tab.click()
            page.wait_for_timeout(500)
            break
    button = page.locator("button:has-text('Tell jamin what they are')").first
    if not button.count():
        raise Missing("no library row offered the note table")
    button.click()
    page.wait_for_timeout(800)


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
    ("library-notes", libraryNotes),
    ("chart-tools", lambda page: onChart(page, "tools")),
    ("chart-picker-roots", lambda page: onChart(page, "picker")),
    ("chart-picker-colours", lambda page: onChart(page, "colours")),
    ("chart-picker-small", lambda page: onChart(page, "colours", small=True)),
    ("chart-insert-menu", lambda page: onChart(page, "insert")),
    ("graph-drums-whole", lambda page: big(page, "drums", "drums")),
    ("graph-progressions-whole", lambda page: big(page, "progressions", "progressions")),
]

sys.exit(main())
