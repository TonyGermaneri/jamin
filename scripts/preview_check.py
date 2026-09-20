#!/usr/bin/env python3
"""Does the Preview button make a sound, and does the roll show where it is?

Both reported together: "The preview button does not preview the clip when the
transport is stopped. The clip piano roll does not show the transport bar move
across the clip when that clip is playing."

They had one cause. Preview armed a drum accent and rebuilt the drum track,
which is how a groove gets played -- by `flushDrums`, which is called from
`tick`, which is called from the clock. A stopped clock does not tick. So the
button armed a pattern for the next time somebody pressed play and made no
sound in the meantime, and the playhead had nothing to follow because the
playhead follows the song position and there was no song.

This runs the real page, binds a port that records instead of sending, and
presses the real button with the transport stopped.

    <venv>/bin/python scripts/preview_check.py

Nothing goes near a MIDI port: the engine's output is replaced with a recorder
before anything is pressed. @see the standing rule about the attached hardware.
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


class Quiet(http.server.SimpleHTTPRequestHandler):
    """dist, without a line of log per asset over the check's own output."""

    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=os.path.join(ROOT, "dist"))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


# Every note the page tries to play, kept instead of sent.
#
# `engine.noteOn` is the last thing before the port, and it returns false when
# there is nothing bound -- which in a headless browser is always. Replacing it
# records what would have gone out and, just as importantly, tells the caller
# it arrived, so the path under test behaves as it does on a machine with a
# port. Nothing reaches any hardware, because nothing reaches any port.
LISTEN = r"""
() => {
  const app = window.__jaminApp
  window.__heard = []
  app.engine.noteOn = (outputId, channel, note, velocity) => {
    window.__heard.push({ at: Math.round(performance.now()), note, velocity, channel })
    return true
  }
  app.engine.noteOff = () => true
  return true
}
"""

# A pattern with something in it, out of the corpus that ships.
#
# Not the first row: the point is to count hits, and a groove with three of
# them cannot tell "it played" from "it played one bar of four". The busiest
# of the first hundred is a real pattern and gives the count something to be.
PICK = r"""
async () => {
  const app = window.__jaminApp
  await app.openDrumBook()
  // The shipped corpus is filed in the database like any other library, so
  // this is the same query the list runs -- a page of it, by the real path.
  await app.searchDrums({ set: '', page: 1 }, { limit: 120, offset: 0 })
  const rows = (app.state.drumHits || []).slice(0, 120)
  const full = []
  for (const row of rows) {
    const whole = await app.notesFor(row)
    if (whole && (whole.notes || []).length) full.push(whole)
  }
  /*
   * A beat of a couple of bars, not a performance.
   *
   * The corpus holds whole takes as well as loops -- the busiest row in the
   * first hundred is a 141-bar funk song, four and a half minutes of it --
   * and previewing one of those is a real thing to do and a useless thing to
   * time. The case under test is the common one: press Preview on a loop and
   * hear the loop. The busiest short beat gives the count something to be.
   */
  const loops = full.filter((one) => one.kind !== 'song' && one.bars > 0 && one.bars <= 2)
  // A beat if the page has one, a fill otherwise. Both are loops of a bar or
  // two, which is what somebody presses Preview on.
  const short = loops.filter((one) => one.kind === 'beat').length
    ? loops.filter((one) => one.kind === 'beat') : loops
  if (!short.length) {
    return { why: 'no short beat in the first page', saw: full.slice(0, 5)
      .map((one) => ({ name: one.name, kind: one.kind, bars: one.bars })) }
  }
  short.sort((a, b) => b.notes.length - a.notes.length)
  const one = short[0]
  return { id: one.id, name: one.name, hits: one.notes.length, kind: one.kind,
           bars: one.bars, lengthPulses: one.lengthPulses }
}
"""

# Press it, and watch both things at once.
#
# The notes are counted as they arrive rather than at the end, because "did it
# play" and "did it play all at once" are different answers and only the second
# is a preview. The fraction is sampled on the same schedule for the same
# reason: a line that appears at 0 and jumps to 1 is not a line that moved.
PLAY = r"""
async ([id, forMs]) => {
  const app = window.__jaminApp
  const state = app.state

  // Stopped, which is the case under test. Nothing here starts a clock.
  if (state.status.running) return { why: 'the transport is running' }

  const row = (state.drumHits || []).find((one) => one.id === id)
  if (!row) return { why: 'the pattern went out of the list' }

  window.__heard = []
  const marks = []
  app.previewGroove(row)

  const step = 40
  for (let waited = 0; waited < forMs; waited += step) {
    await new Promise((go) => setTimeout(go, step))
    marks.push({ ms: waited + step, heard: window.__heard.length, at: state.drumPreview.at })
  }

  return {
    heard: window.__heard.length,
    notes: window.__heard.map((one) => one.note),
    channels: [...new Set(window.__heard.map((one) => one.channel))],
    marks,
    // Back to nothing once the pass is over, or the next pattern's roll
    // opens with a line frozen wherever the last one stopped.
    left: state.drumPreview.at,
  }
}
"""

# The map, opened the way somebody opens it.
#
# The button lives in the map's right-hand aside, beside the map's own smaller
# roll -- so a playhead that exists only in the list view is a playhead nobody
# previewing a clip can see. This has to be the real panel or it proves
# nothing.
OPEN_MAP = r"""
() => {
  const app = window.__jaminApp
  app.state.settings.graph.drums = true
  // Nothing left open from a previous look, so the walk down starts at the top.
  app.forgetGraphArrangements()
  app.openBook('drums')
  return true
}
"""

# One clip, found by opening folders until there is one.
#
# `leaves()` is the nodes with nothing under them, which on this map is the
# clips. The corpus is shelved by genre, feel and drummer, so it is three
# levels down and the walk has to go and get one.
DIG = r"""
() => {
  const probe = window.__jaminTreeProbe
  if (!probe) return null
  const drawn = probe.shapes()
  const shut = drawn.filter((one) => one.shut)
  if (!shut.length) return { leaves: probe.leaves().length, shut: 0 }

  /*
   * Every closed folder there is, not the first one.
   *
   * The first attempt opened one node a round and went down the leftmost
   * branch, which on this corpus is a folder of nothing but songs -- 27
   * clips on screen, all the same kind, which cannot show that two kinds
   * are drawn differently. Opening the deepest row instead stayed in the
   * same branch and reached 42 of them. The corpus shelves by genre, then
   * feel *or* kind, then drummer, so the fills sit in folders of their own
   * and any walk that prefers one direction can miss every one of them.
   * Opening everything is the only walk that cannot.
   */
  const row = shut.slice(0, 160)
  for (const one of row) probe.open(one.label)
  return { leaves: probe.leaves().length, shut: shut.length,
           opened: row.length, deepest: Math.max(...shut.map((one) => one.depth)) }
}
"""

# What is on screen, and what shape each thing is.
SHAPES = "() => window.__jaminTreeProbe.shapes()"

# Where a clip is on screen, so the mouse can go there.
SPOTS = r"""
([names]) => {
  const probe = window.__jaminTreeProbe
  const want = new Set(names)
  return probe.places().filter((one) => want.has(one.label))
}
"""

# Watch the line in the panel, while the real button is pressed by the mouse.
WATCH = r"""
async ([forMs]) => {
  const seen = []
  const step = 60
  for (let waited = 0; waited < forMs; waited += step) {
    await new Promise((go) => setTimeout(go, step))
    for (const one of document.querySelectorAll('.jamin-map-roll-head')) {
      if (one.style.left && !seen.includes(one.style.left)) seen.push(one.style.left)
    }
  }
  return seen
}
"""


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

        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="load")
        page.wait_for_selector(".v-application", timeout=30000)
        page.wait_for_function("() => Boolean(window.__jaminApp)", timeout=30000)
        page.wait_for_timeout(800)
        page.evaluate(LISTEN)

        chosen = page.evaluate(PICK)
        if not chosen or chosen.get("why"):
            print("FAIL nothing in the corpus to preview:", chosen)
            httpd.shutdown()
            return 1
        print(f"  previewing {chosen['name']!r} — {chosen['hits']} hits, "
              f"{chosen['bars']} bar(s), {chosen['lengthPulses']} pulses")

        # Long enough for two bars at 120bpm and then some. The pass ends by
        # itself; the wait is for the whole of it plus the tail.
        played = page.evaluate(PLAY, [chosen["id"], 5000])
        if played.get("why"):
            print("FAIL", played["why"])
            httpd.shutdown()
            return 1

        if os.environ.get("PREVIEW_TRACE"):
            for m in played["marks"]:
                print("   ", m)

        heard = played["heard"]
        print(f"  heard {heard} of {chosen['hits']} hits on channel(s) {played['channels']}")

        if heard == 0:
            failures.append("FAIL stopped, the preview played nothing at all")
        elif heard < chosen["hits"]:
            failures.append(f"FAIL only {heard} of {chosen['hits']} hits were played")
        else:
            print(f"ok    stopped, Preview played all {heard} hits")

        # Spread out in time, not fired in one go. A pattern whose every note
        # arrives in the same millisecond is a chord, not a groove.
        first_frame = played["marks"][0]["heard"] if played["marks"] else 0
        done = next((m["ms"] for m in played["marks"] if m["heard"] >= heard), 0)
        if heard and first_frame >= heard:
            failures.append("FAIL every hit arrived at once rather than in time")
        elif heard:
            print(f"ok    it arrived in time — {first_frame} in the first 40ms, "
                  f"all {heard} by {done}ms")

        # The fraction has to travel, and has to be let go of at the end.
        moved = [m["at"] for m in played["marks"] if m["at"] is not None]
        if len(moved) < 3:
            failures.append(f"FAIL the playhead never reported a position ({moved})")
        elif max(moved) - min(moved) < 0.4:
            failures.append(f"FAIL the playhead barely moved: {min(moved):.2f} -> {max(moved):.2f}")
        else:
            print(f"ok    the playhead ran {min(moved):.2f} -> {max(moved):.2f} "
                  f"over {len(moved)} samples")

        if played["left"] is not None:
            failures.append(f"FAIL the playhead was left at {played['left']} after the pass")
        else:
            print("ok    and it let go at the end")

        # ---- and now the panel, driven by a mouse -----------------------
        #
        # Everything above is the store. What was reported is the button, and
        # the button is in the map's aside beside the map's own roll.
        page.evaluate(OPEN_MAP)
        page.wait_for_timeout(3000)
        if not page.evaluate("() => Boolean(window.__jaminTreeProbe)"):
            failures.append("FAIL the map never drew")
        else:
            # Down through the shelves until there are clips on screen.
            #
            # More than one, and more than one kind. A single clip on screen
            # cannot show that a fill is drawn differently from a groove, and
            # a single clip is also easily behind the aside.
            dug = None
            for _ in range(6):
                dug = page.evaluate(DIG)
                page.wait_for_timeout(500)
                if dug and dug.get("shut") == 0:
                    break
            page.wait_for_timeout(1200)
            leaves = page.evaluate("() => window.__jaminTreeProbe.leaves()")

            # Fills are squares and grooves are circles, which is the other
            # half of this change and is not a thing a screenshot can settle
            # at four pixels across.
            drawnShapes = page.evaluate(SHAPES)
            # And a picture of it, because "a fill is a square" is in the end
            # a claim about what somebody sees. @see tests/browser/shots
            shot = os.path.join(ROOT, "tests", "browser", "shots", "graph-shapes.png")
            os.makedirs(os.path.dirname(shot), exist_ok=True)
            page.screenshot(path=shot)
            clips = [one for one in drawnShapes if one["leaf"]]
            kinds = sorted({one["shape"] for one in clips})
            if os.environ.get("PREVIEW_TRACE"):
                for one in clips[:14]:
                    print("   clip", one)
            if not clips:
                failures.append("FAIL no clip was ever drawn on the map")
            elif len(kinds) < 2:
                failures.append(
                    f"FAIL every clip on the map is drawn the same: {kinds} "
                    f"over {len(clips)} clips")
            else:
                counts = {k: len([o for o in clips if o["shape"] == k]) for k in kinds}
                print(f"ok    the map draws clips as {counts}")
            folders = [one["shape"] for one in drawnShapes if not one["leaf"]]
            if folders and set(folders) != {"circle"}:
                failures.append(f"FAIL a folder was given a clip's shape: {set(folders)}")
            elif folders:
                print(f"ok    and all {len(folders)} folders stayed circles")

            # A clip well inside the picture, clicked with the mouse.
            spots = page.evaluate(SPOTS, [leaves])
            inside = [one for one in spots
                      if 260 < one["y"] < TALL - 200 and 120 < one["x"] < WIDE - 460]
            if not inside:
                failures.append(f"FAIL none of the {len(leaves)} clips landed anywhere "
                                f"clickable")
            else:
                target = inside[0]
                page.mouse.click(target["x"], target["y"])
                page.wait_for_timeout(1500)

                button = page.locator(".jamin-map-detail:visible button", has_text="Preview")
                if not button.count():
                    said = page.evaluate("""() => {
                      const all = [...document.querySelectorAll('.jamin-map-detail')]
                      const shown = all.filter((one) => one.getClientRects().length)
                      return (shown[0] || { innerText: '' }).innerText.trim().slice(0, 120)
                    }""")
                    failures.append(f"FAIL no Preview button beside {target['label']!r}: "
                                    f"{said!r}")
                else:
                    before = page.locator(".jamin-map-roll-head").count()
                    page.evaluate(LISTEN)
                    button.first.click()
                    moved = page.evaluate(WATCH, [2400])
                    page.evaluate("() => window.__jaminApp.cancelPreview()")
                    page.wait_for_timeout(200)
                    after = page.locator(".jamin-map-roll-head").count()
                    rang = page.evaluate("() => (window.__heard || []).length")

                    if before:
                        failures.append(f"FAIL a playhead was drawn over the roll before "
                                        f"anything played ({before})")
                    if not rang:
                        failures.append(f"FAIL pressing Preview on {target['label']!r} "
                                        f"played nothing")
                    else:
                        print(f"ok    pressing Preview on {target['label']!r} played "
                              f"{rang} notes")
                    if len(moved) < 3:
                        failures.append(f"FAIL the roll's playhead did not move: {moved}")
                    else:
                        print(f"ok    and the line moved across the roll — "
                              f"{len(moved)} positions, {moved[0]} … {moved[-1]}")
                    if after:
                        failures.append("FAIL the playhead stayed after Cancel")
                    else:
                        print("ok    and went away when it was cancelled")

        if trouble:
            failures.append("FAIL the page threw: " + "; ".join(trouble[:3]))

        context.close()
        browser.close()

    httpd.shutdown()
    for line in failures:
        print(line)
    print("\npreview: all checks passed" if not failures
          else f"\npreview: {len(failures)} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
