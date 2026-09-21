#!/usr/bin/env python3
"""How much of the main thread the catalogue list takes while it loads.

Reported as "it loads the data in the background, but it does so on the
primary thread and really slows everything down". Half right, and the half
that was wrong is the half that mattered: the database read is off-thread
and leaves the main thread completely free -- 151,150 rows in 1.1 seconds
at 100% free. Every bit of the lag was in the view.

Two quadratic costs, both in the book rather than the store. Growing the
list with `concat` copies the whole of it on every batch, which over
seventy-six batches is about five and a half million element copies. And a
plain `ref` makes a reactive proxy of everything assigned to it, so each of
those copies re-proxied a hundred and fifty thousand objects -- to feed a
grid that paints onto a canvas and reads the array itself.

    <venv>/bin/python scripts/grid_perf.py [rows]

Measured with a 4ms timer rather than animation frames: a headless browser
with a software GPU produces frames at about four a second whatever is
happening, so frame gaps measure the renderer and a starved timer measures
the thread.

Its own browser profile and its own synthetic rows, so it never touches a
real catalogue.
"""
import functools, http.server, socketserver, threading, sys
from playwright.sync_api import sync_playwright
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
h=functools.partial(Q, directory=ROOT+'/dist')
d=socketserver.TCPServer(("127.0.0.1",0),h); d.allow_reuse_address=True
threading.Thread(target=d.serve_forever,daemon=True).start()
port=d.server_address[1]

SEED = r"""
async ([rows]) => {
  const app = window.__jaminApp
  const GENRES = ['rock','jazz','funk','blues','metal','soul','reggae','pop']
  const at = performance.now()
  for (let n = 0; n < rows; n += 5000) {
    const batch = []
    for (let i = n; i < Math.min(rows, n + 5000); i++) {
      batch.push({
        id: `big:${i}`, s: 'big', n: `clip ${i}`,
        p: `Big/Pack ${i % 40}/Shelf ${i % 9}/clip ${i}`,
        f: `Big/Pack ${i % 40}/Shelf ${i % 9}`,
        k: i % 5 ? 'beat' : 'fill', r: (i % 8) + 1, t: '4-4',
        g: GENRES[i % GENRES.length], b: 90 + (i % 60),
        x: { feel: i % 3 ? 'Straight' : 'Shuffle' },
        v: [[0, 36, 12, 100], [24, 38, 12, 90]], m: {},
      })
    }
    const bad = await app.putGrooves(batch)
    if (bad) return { error: bad }
  }
  await app.putSet({ id: 'big', name: 'Big', root: '', byReference: false,
    kit: 'gm', customMap: {}, folderKits: {}, folders: 40,
    count: rows, addedAt: Date.now() })
  await app.refreshDrumSets()
  return { seeded: rows, ms: Math.round(performance.now() - at) }
}
"""

PROBE = r"""
async () => {
  const app = window.__jaminApp

  let ticks = 0
  const beat = setInterval(() => { ticks++ }, 4)
  const idleAt = performance.now()
  await new Promise((go) => setTimeout(go, 600))
  const idle = ticks / ((performance.now() - idleAt) / 1000)

  // The real thing: the drum book's list, loading the way somebody opens it.
  ticks = 0
  const at = performance.now()
  app.state.settings.graph.drums = false
  app.openBook('drums')

  const grid = () => document.querySelector('canvas-datagrid')
  // Stable for a full second, not for one poll: the grid is handed its
  // rows a few times a second, so two equal readings a tenth of a second
  // apart is the wait between hand-overs rather than the end of the load.
  let rows = 0
  let still = 0
  for (let n = 0; n < 600; n++) {
    await new Promise((go) => setTimeout(go, 100))
    const g = grid()
    const now = g ? g.data.length : 0
    still = now === rows ? still + 1 : 0
    rows = now
    if (still >= 10 && rows > 1000) break
  }
  const total = performance.now() - at
  const busy = ticks / (total / 1000)
  clearInterval(beat)

  return {
    rows,
    total: Math.round(total),
    idleTicksPerSecond: Math.round(idle),
    loadingTicksPerSecond: Math.round(busy),
    responsiveness: Math.round((busy / idle) * 100) / 100,
  }
}
"""

with sync_playwright() as pw:
    b=pw.chromium.launch(args=["--enable-unsafe-swiftshader","--use-angle=swiftshader"])
    p=b.new_context(viewport={"width":1920,"height":1080}).new_page()
    p.on("pageerror", lambda e: print("PAGEERROR", e))
    p.goto(f"http://127.0.0.1:{port}/index.html", wait_until="load")
    p.wait_for_function("() => Boolean(window.__jaminApp)", timeout=60000)
    p.wait_for_timeout(1500)
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 150000
    seeded = p.evaluate(SEED, [n])
    if seeded.get("error"):
        print("FAIL could not seed:", seeded["error"])
        raise SystemExit(1)
    print(f"  seeded {seeded['seeded']:,} rows in {seeded['ms']}ms")
    p.wait_for_timeout(500)
    got = p.evaluate(PROBE)
    free = int(got["responsiveness"] * 100)
    print(f"  {got['rows']:,} rows on screen in {got['total']:,}ms, "
          f"thread {free}% free "
          f"({got['loadingTicksPerSecond']}/s against {got['idleTicksPerSecond']}/s idle)")

    # What it was before the list stopped being copied on every batch:
    # 27,537ms at 10% free. A list nobody can read while it arrives is one
    # thing; a window that will not scroll while it does is another.
    bad = []
    if got["total"] > 8000:
        bad.append(f"FAIL {got['rows']:,} rows took {got['total']:,}ms")
    if free < 60:
        bad.append(f"FAIL the main thread was only {free}% free while it loaded")
    for line in bad:
        print(line)
    print("\ngrid: all checks passed" if not bad else f"\ngrid: {len(bad)} FAILED")
    browser_failures = len(bad)
    b.close()
d.shutdown()
raise SystemExit(1 if browser_failures else 0)
