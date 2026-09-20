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
  return {
    open: probe.shapes().filter((one) => !one.shut && !one.leaf).length,
    showing: probe.showing(),
    camera: probe.camera(),
    places: probe.places(),
  }
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

        # ---- and a filter does not throw it away -------------------------
        #
        # Narrowing the catalogue is a different tree with different node
        # indexes, so it gets an arrangement of its own -- and clearing the
        # filter has to bring back the one that was there before, not a
        # fresh layout. Keeping one arrangement per book lost it.
        page.evaluate("() => window.__jaminBookProbe.filter('genre', 'rock')")
        page.wait_for_timeout(2500)
        # `any`, not empty: an empty genre is still a filter as far as the
        # book is concerned, so clearing it that way left the map on the
        # filtered tree and this check measured the wrong two pictures.
        page.evaluate("() => window.__jaminBookProbe.filter('genre', 'any')")
        page.wait_for_timeout(5000)
        filtered = still(page)
        moved_by_filter = same(arranged, filtered)
        if moved_by_filter:
            failures.append(f"FAIL filtering and clearing lost the arrangement: "
                            f"{len(moved_by_filter)} node(s) moved, "
                            + "; ".join(moved_by_filter[:3]))
        else:
            print("ok    filtering and clearing it leaves everything where it was")

        if os.environ.get("ARRANGE_TRACE"):
            print("   stored:", page.evaluate(
                "() => { const r = localStorage.getItem('jamin.graphArrangement.v1');"
                " const d = r ? (JSON.parse(r).drums || {}) : {};"
                " return { stamp: d.stamp, open: (d.open||[]).length,"
                " places: (d.places||[]).length, camera: d.camera,"
                " first: (d.places||[])[0] } }"))

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
