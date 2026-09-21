#!/usr/bin/env python3
"""Does the map come back exactly as it was left?

"The graph layout must be preserved between sessions! If the user has moved
the nodes around or opened/closed nodes the graph must remember exactly where
everything is placed."

Three things have to survive the window closing, and only one of them used
to: which nodes are open did, where they sit did not, and neither did the
camera. A force simulation has no memory -- it is re-run from scratch on every
open -- so a folder dragged out of the way was back in the middle a second
after the next window opened.

Nothing here reads the code. It opens the map, opens some folders, drags a
node somewhere it would never have settled on its own, notes every position,
reloads the page, and compares. A reload is the honest test: the arrangement
has to have reached storage and come back, not merely have been kept in
memory.

    <venv>/bin/python scripts/arrange_check.py
"""
import functools
import http.server
import math
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDE, TALL = 1920, 1080

# How far a position may move and still count as the same place.
#
# Positions are stored rounded to whole world units, so half a unit of
# rounding times the zoom is the error floor -- about 1.7px at the scale a
# catalogue opens at. Anything past three pixels is the arrangement not
# having been kept, not the arithmetic.
SLACK = 3.0


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=os.path.join(ROOT, "dist"))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


OPEN_MAP = r"""
async ([fresh]) => {
  const app = window.__jaminApp
  app.state.settings.graph.drums = true
  if (fresh) app.forgetGraphArrangements()
  app.openBook('drums')
  return true
}
"""

# Open a few folders, so there is an arrangement to have.
DIG = r"""
() => {
  const probe = window.__jaminTreeProbe
  if (!probe) return null
  const shut = probe.shapes().filter((one) => one.shut)
  if (!shut.length) return { shut: 0, showing: probe.showing() }
  for (const one of shut.slice(0, 6)) probe.open(one.label)
  return { shut: shut.length, showing: probe.showing() }
}
"""

# Everything that makes up "where things are".
STATE = r"""
() => {
  const probe = window.__jaminTreeProbe
  if (!probe) return null
  const drawn = probe.shapes()
  return {
    open: drawn.filter((one) => !one.shut && !one.leaf).length,
    showing: probe.showing(),
    camera: probe.camera(),
    places: probe.places(),
    dim: drawn.filter((one) => one.dim).length,
    lit: drawn.filter((one) => !one.dim).length,
    named: probe.named(),
    dimNames: drawn.filter((one) => one.dim).map((one) => one.label),
  }
}
"""


# A second library, so "only this one" has something to exclude.
#
# Rows in the shape the store keeps them: an id, the set it belongs to, a
# name, the path the tree is built from, and the facet fields. Small --
# forty clips is enough to make a branch on the map and nothing here is
# about size. @see core/drumStore.js
SECOND_LIBRARY = r"""
async () => {
  const app = window.__jaminApp
  const rows = []
  for (let n = 0; n < 40; n++) {
    rows.push({
      id: `two:${n}`, s: 'shot-two', n: `clip ${n}`,
      p: `Second Library/Shelf ${n % 4}/clip ${n}`,
      f: `Second Library/Shelf ${n % 4}`,
      k: n % 5 ? 'beat' : 'fill', r: (n % 4) + 1, t: '4-4',
      g: 'rock', b: 120, x: {}, v: [], m: {},
    })
  }
  if (await app.putGrooves(rows)) return false
  await app.putSet({
    id: 'shot-two', name: 'Second Library', root: '', byReference: false,
    kit: 'gm', customMap: {}, folderKits: {}, folders: 4,
    count: rows.length, addedAt: Date.now(),
  })
  await app.refreshDrumSets()
  // The map is drawn at import, and this is an import by another name.
  await app.forgetCatalogueGraph('drums')
  await app.buildBulkGraph('drums')
  return true
}
"""


def look(page):
    return page.evaluate(STATE)


def still(page):
    """Stop the forces, then read the picture.

    A force simulation takes about five seconds of animation to come to rest
    on a real machine and a minute and a half in a headless one with a
    software GPU -- measured, at four frames a second. Waiting for it turns
    this into a check of the frame rate; comparing a frame of the animation
    against a settled position turns it into a check of nothing. So the
    forces are stopped and then it is read. @see canvas/treeGraph.js rest
    """
    page.evaluate("() => window.__jaminTreeProbe.rest()")
    page.wait_for_timeout(400)
    return page.evaluate(STATE)


def same(before, after):
    """Which nodes ended up somewhere else.

    By index, not by name. The corpus has a dozen folders called `song` and
    several drummers who appear under more than one genre, so matching on
    the label compares one `song` against a different `song` and reports
    nearly every node as having moved -- which is what the first version of
    this did.
    """
    was = {one["at"]: one for one in before["places"]}
    moved = []
    for one in after["places"]:
        had = was.pop(one["at"], None)
        if not had:
            moved.append(f"{one['label']} is new")
            continue
        if abs(had["x"] - one["x"]) > SLACK or abs(had["y"] - one["y"]) > SLACK:
            moved.append(f"{one['label']} {had['x']},{had['y']} -> {one['x']},{one['y']}")
    for one in was.values():
        moved.append(f"{one['label']} is gone")
    return moved


def main():
    httpd, port = serve()
    failures = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--enable-unsafe-swiftshader",
                                           "--use-angle=swiftshader"])
        context = browser.new_context(viewport={"width": WIDE, "height": TALL},
                                      device_scale_factor=1)
        page = context.new_page()
        trouble = []
        page.on("pageerror", lambda err: trouble.append(str(err)))

        def boot(fresh):
            page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="load")
            page.wait_for_selector(".v-application", timeout=30000)
            page.wait_for_function("() => Boolean(window.__jaminApp)", timeout=30000)
            page.wait_for_timeout(900)
            page.evaluate(OPEN_MAP, [fresh])
            page.wait_for_timeout(3000)
            if not page.evaluate("() => Boolean(window.__jaminTreeProbe)"):
                raise SystemExit("FAIL the map never drew")

        boot(fresh=True)

        for _ in range(3):
            page.evaluate(DIG)
            page.wait_for_timeout(700)

        opened = still(page)
        print(f"  {opened['showing']} nodes on screen, {opened['open']} folders open")
        if opened["showing"] < 8:
            print("FAIL not enough on the map to arrange")
            httpd.shutdown()
            return 1

        # Drag one somewhere the forces would never have put it: a long way
        # out, at an angle, well clear of everything else. It has to be a node
        # that is actually on screen and clear of the chrome, or the mouse
        # lands on the filter bar or past the edge and moves nothing.
        inside = [one for one in opened["places"]
                  if 300 < one["y"] < TALL - 200 and 200 < one["x"] < WIDE - 500]
        if not inside:
            print("FAIL no node landed anywhere draggable")
            httpd.shutdown()
            return 1
        target = inside[0]
        page.mouse.move(target["x"], target["y"])
        page.mouse.down()
        page.mouse.move(target["x"] - 300, target["y"] - 200, steps=18)
        page.mouse.up()
        # Long enough for the branch to relax around where it was dropped.
        page.wait_for_timeout(1200)
        still(page)

        # And move the camera, which is part of where things are. The right
        # button pans, from on top of a node -- which is the gesture the map
        # is actually driven with. @see scripts/shots.py rightButtonPans
        page.mouse.move(target["x"], target["y"])
        page.mouse.down(button="right")
        page.mouse.move(target["x"] - 170, target["y"] - 110, steps=14)
        page.mouse.up(button="right")
        page.wait_for_timeout(600)

        arranged = still(page)
        dragged = next((one for one in arranged["places"]
                        if one["label"] == target["label"]), None)
        if not dragged:
            failures.append(f"FAIL {target['label']!r} vanished when it was dragged")
        elif abs(dragged["x"] - target["x"]) < 40 and abs(dragged["y"] - target["y"]) < 40:
            failures.append(f"FAIL dragging {target['label']!r} did not move it "
                            f"({target['x']},{target['y']} -> {dragged['x']},{dragged['y']})")
        else:
            print(f"ok    dragged {target['label']!r} "
                  f"{target['x']},{target['y']} -> {dragged['x']},{dragged['y']}")
        if arranged["camera"] == opened["camera"]:
            failures.append("FAIL the right button did not move the camera")
        else:
            print(f"ok    and moved the camera to {arranged['camera']}")

        # ---- a filter marks the map, it does not rebuild it --------------
        #
        # "Make it so there is only one global layout and filtering simply
        # darkens the color of the nodes and removes the labels that are not
        # in the filtered list so the layout does not change between filter
        # changes." So: nothing moves, some nodes go dim, and the dim ones
        # lose their names.
        page.evaluate("() => window.__jaminBookProbe.filter('genre', 'rock')")
        page.wait_for_timeout(3000)
        narrowed = look(page)
        # What "darkens the colour and removes the labels" looks like, which
        # is not a thing the numbers below can show.
        page.screenshot(path=os.path.join(ROOT, "tests", "browser", "shots",
                                          "graph-filtered.png"))

        stayed = same(arranged, narrowed)
        if stayed:
            failures.append(f"FAIL filtering moved {len(stayed)} node(s): "
                            + "; ".join(stayed[:3]))
        else:
            print(f"ok    filtering left all {len(narrowed['places'])} nodes "
                  f"exactly where they were")

        if not narrowed["dim"]:
            failures.append("FAIL the filter dimmed nothing")
        elif not narrowed["lit"]:
            failures.append("FAIL the filter dimmed everything")
        else:
            print(f"ok    and dimmed {narrowed['dim']} of "
                  f"{narrowed['dim'] + narrowed['lit']}, leaving {narrowed['lit']} lit")

        named = set(narrowed["named"])
        wrong = [one for one in narrowed["dimNames"] if one in named]
        if wrong:
            failures.append(f"FAIL {len(wrong)} dimmed node(s) kept a name: "
                            + ", ".join(sorted(set(wrong))[:4]))
        else:
            print(f"ok    and named only what it lit ({len(named)} names)")

        # `any`, not empty: an empty genre is still a filter as far as the
        # book is concerned, and this check would then be measuring the
        # filtered map against itself.
        page.evaluate("() => window.__jaminBookProbe.filter('genre', 'any')")
        page.wait_for_timeout(3000)
        cleared = look(page)
        moved_by_filter = same(arranged, cleared)
        if moved_by_filter:
            failures.append(f"FAIL filtering and clearing lost the arrangement: "
                            f"{len(moved_by_filter)} node(s) moved, "
                            + "; ".join(moved_by_filter[:3]))
        elif cleared["dim"]:
            failures.append(f"FAIL {cleared['dim']} node(s) stayed dim after clearing")
        else:
            print("ok    and clearing it lights everything again, still unmoved")

        if os.environ.get("ARRANGE_TRACE"):
            print("   stored:", page.evaluate(
                "() => { const r = localStorage.getItem('jamin.graphArrangement.v1');"
                " const d = r ? (JSON.parse(r).drums || {}) : {};"
                " return { stamp: d.stamp, open: (d.open||[]).length,"
                " places: (d.places||[]).length, camera: d.camera,"
                " first: (d.places||[])[0] } }"))

        # ---- and it can be laid out as the tree it is --------------------
        #
        # The forces make a picture that is honest about how much is where
        # and, on a real catalogue, a knot. "Auto arrange" draws it as a
        # tree: the root in the middle and each level a ring further out.
        # Which is a claim about geometry, so it is measured as one.
        page.evaluate("() => window.__jaminBookProbe.filter('genre', 'any')")
        page.wait_for_timeout(2000)
        button = page.locator(".jamin-map-tools button", has_text="Auto arrange")
        if not button.count():
            failures.append("FAIL there is no Auto arrange button on the map")
        else:
            button.first.click()
            page.wait_for_timeout(1600)
            laid = look(page)
            # "Beautiful" is not a thing a number settles, so there is a
            # picture of it as well as the geometry.
            shot = os.path.join(ROOT, "tests", "browser", "shots", "graph-arranged.png")
            os.makedirs(os.path.dirname(shot), exist_ok=True)
            page.screenshot(path=shot)
            depths = page.evaluate("() => window.__jaminTreeProbe.shapes()")
            cam = laid["camera"]

            rings = {}
            for spot, node in zip(laid["places"], depths):
                r = math.hypot(spot["x"] - cam["x"], spot["y"] - cam["y"]) / cam["k"]
                rings.setdefault(node["depth"], []).append(r)

            ragged = []
            for depth, radii in sorted(rings.items()):
                if len(radii) < 3:
                    continue
                mid = sum(radii) / len(radii)
                if mid < 1:
                    continue
                if (max(radii) - min(radii)) / mid > 0.02:
                    ragged.append(f"depth {depth}: {min(radii):.0f}–{max(radii):.0f}")
            if ragged:
                failures.append("FAIL arranging did not put each level on a ring: "
                                + "; ".join(ragged))
            else:
                counted = {d: len(r) for d, r in sorted(rings.items())}
                print(f"ok    auto arrange put every level on its own ring {counted}")

            # And the rings are further out as they go down, which is what
            # makes it read as a tree rather than as a target.
            means = [sum(r) / len(r) for _, r in sorted(rings.items())]
            if means != sorted(means):
                failures.append(f"FAIL the rings are not in order: "
                                + ", ".join(f"{one:.0f}" for one in means))
            else:
                print("ok    and each ring outside the one above it — "
                      + ", ".join(f"{one:.0f}" for one in means))

            arranged = laid

        # ---- the session ends, and starts again -------------------------
        boot(fresh=False)
        back = still(page)

        print(f"  after reloading: {back['showing']} nodes, {back['open']} folders open")

        if back["open"] != arranged["open"]:
            failures.append(f"FAIL {arranged['open']} folders were open, "
                            f"{back['open']} came back")
        else:
            print(f"ok    the same {back['open']} folders came back open")

        if back["showing"] != arranged["showing"]:
            failures.append(f"FAIL {arranged['showing']} nodes were on screen, "
                            f"{back['showing']} came back")

        moved = same(arranged, back)
        if moved:
            failures.append(f"FAIL {len(moved)} node(s) came back somewhere else: "
                            + "; ".join(moved[:4]))
        else:
            print(f"ok    and all {len(back['places'])} of them to the pixel they were on")

        if back["camera"] != arranged["camera"]:
            failures.append(f"FAIL the camera came back at {back['camera']}, "
                            f"not {arranged['camera']}")
        else:
            print(f"ok    looking at exactly where it was left, {back['camera']}")

        # ---- and forgetting it really forgets it ------------------------
        boot(fresh=True)
        clean = still(page)
        if clean["showing"] == back["showing"] and not same(back, clean):
            failures.append("FAIL forgetting the arrangement changed nothing")
        else:
            print(f"ok    and thrown away, it opens at its top level again "
                  f"({clean['showing']} nodes)")

        # ---- the library on its own ------------------------------------
        #
        # The filter people reach for first, and the one that did nothing.
        # `filtered` leaves the library out on purpose -- in the list it is
        # a place rather than a filter -- so the marks were only computed
        # when something *else* was also on. Choosing a library dimmed
        # nothing until it had company, and then appeared to work.
        #
        # It needs two libraries to say anything at all: with one, every
        # clip matches and a correct answer lights the whole map. The
        # built-in corpus is one, so this seeds a second.
        seeded = page.evaluate(SECOND_LIBRARY)
        if not seeded:
            failures.append("FAIL could not seed a second library")
        else:
            page.wait_for_timeout(500)
            page.reload(wait_until="load")
            page.wait_for_function("() => Boolean(window.__jaminApp)", timeout=30000)
            page.wait_for_timeout(900)
            page.evaluate(OPEN_MAP, [True])
            page.wait_for_timeout(4000)
            for _ in range(3):
                page.evaluate(DIG)
                page.wait_for_timeout(500)
            both = still(page)
            print(f"  with two libraries: {both['showing']} nodes, {both['lit']} lit")

            page.evaluate("() => window.__jaminBookProbe.filter('library', 'builtin')")
            page.wait_for_timeout(3500)
            one = look(page)
            moved_by_library = same(both, one)

            if not one["dim"]:
                failures.append("FAIL choosing one of two libraries dimmed nothing")
            elif not one["lit"]:
                failures.append("FAIL choosing a library dimmed everything")
            elif moved_by_library:
                failures.append(f"FAIL choosing a library moved "
                                f"{len(moved_by_library)} node(s)")
            else:
                print(f"ok    a library on its own dims {one['dim']} of "
                      f"{one['dim'] + one['lit']} and moves nothing")

            # And back, which is the other half: changing the library has to
            # re-apply, not just apply once.
            page.evaluate("() => window.__jaminBookProbe.filter('library', 'shot-two')")
            page.wait_for_timeout(3500)
            other = look(page)
            if other["lit"] == one["lit"] and other["dim"] == one["dim"]:
                failures.append("FAIL changing the library changed nothing")
            elif not other["dim"]:
                failures.append("FAIL the second library dimmed nothing")
            else:
                print(f"ok    and changing it re-applies — {other['dim']} dim, "
                      f"{other['lit']} lit")

        if trouble:
            failures.append("FAIL the page threw: " + "; ".join(trouble[:3]))

        context.close()
        browser.close()

    httpd.shutdown()
    for line in failures:
        print(line)
    print("\narrange: all checks passed" if not failures
          else f"\narrange: {len(failures)} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
