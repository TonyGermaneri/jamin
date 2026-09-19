#!/usr/bin/env python3
"""How long the catalogue map takes, at the size somebody's own collection is.

The requirement is a number, so this reports numbers: jamin is a plugin in a
DAW and nothing it does may take longer than a second, because a second is
long enough to lose the thing you were about to play.

Measured in a real browser against the real collection -- 774,268 drum
patterns off the disk they live on, built into the 932,299-node tree the
application would build. `fake-indexeddb` is emphatically not a performance
model for this; it has been measured lying by two orders of magnitude in both
directions, so every timing here comes from WebKit-or-Chromium doing the real
work on the real bytes.

    python3 scripts/corpus_trees.py --drums /Volumes/external/800k-drums
    python3 scripts/graph_perf.py

What it times, in the order somebody meets it:

  write     building the map into the database. Once, when asked, and
            allowed to be slow -- it is the only thing here that is.
  open      what happens every time the map is opened. This is the one
            that has to be instant.
  expand    opening a node, which must not rebuild anything.
  filter    changing a filter, which must not rebuild anything either.
"""
import argparse
import functools
import http.server
import json
import os
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPORA = os.path.join(ROOT, "tests", "browser", "corpora")

# What a plugin may spend before somebody notices it. Not a round number
# chosen for tidiness: it is how long a DAW's user will wait for a window
# before deciding the plugin is broken.
BUDGET_MS = 1000


def serve():
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


TIMINGS = """
async ([which]) => {
  const app = window.__jaminApp
  const ms = async (fn) => {
    const at = performance.now()
    const got = await fn()
    return [Math.round(performance.now() - at), got]
  }
  const out = {}

  const held = await fetch(`corpora/${which}-tree.json`)
  if (!held.ok) throw new Error(`no ${which} tree: ${held.status}`)
  const [fetched, tree] = await ms(() => held.json())
  out.parse = fetched
  out.nodes = tree.nodes.length
  out.clips = tree.clips

  // Writing it: the once-ever cost, and the only one allowed to be slow.
  const [wrote] = await ms(() => app.writeGraph(which, tree))
  out.write = wrote

  // Opening it: what happens every single time, and what has to be instant.
  const [opened, got] = await ms(() => app.storedGraph(which))
  out.open = opened
  out.opened = got ? got.nodes.length : 0

  // And again, because a second open is the common one and a cold first
  // read can flatter or damn a design that is really about caching.
  const [again] = await ms(() => app.storedGraph(which))
  out.reopen = again

  return out
}
"""

# Reading the map out of the database turned out not to be the slow part, so
# the harness has to time the part somebody actually waits through: the view
# building itself. Measured from asking for the book to the first node being
# on screen, which is when the window stops being empty.
SHOW = """
async ([which, book]) => {
  const app = window.__jaminApp
  const at = performance.now()
  const g = app.state.settings.graph
  g.drums = g.phrases = g.progressions = true
  app.state.ui.progressions = false
  app.state.ui.book = null
  if (book === 'progressions') app.state.ui.progressions = true
  else app.openBook(book)

  // Drawn, not merely mounted: a graph with no nodes in it is a window
  // somebody is still waiting on.
  const drawn = await new Promise((done) => {
    const give = performance.now() + 120000
    const look = () => {
      const probe = window.__jaminTreeProbe
      if (probe && probe.showing() > 0) return done(probe.showing())
      if (performance.now() > give) return done(0)
      requestAnimationFrame(look)
    }
    look()
  })
  return { ms: Math.round(performance.now() - at), drawn }
}
"""

# The rows themselves, which is what a filter actually searches.
#
# 773,836 of them, streamed in rather than held as one string: the file is
# 297MB and `await response.text()` on that is a tab that stops answering.
# Seeded once into a browser profile that is kept, because paying five
# minutes on every run to measure a query is how a harness stops being run.
SEED = r"""
async ([rows]) => {
  const app = window.__jaminApp
  await app.refreshDrumSets()
  const already = app.state.drumSets.find((one) => one.id === 'seeded')
  if (already && already.count >= rows - 10) return { already: already.count }

  const at = performance.now()
  const response = await fetch('corpora/drums-rows.ndjson')
  if (!response.ok) throw new Error(`no rows: ${response.status}`)

  const reader = response.body.getReader()
  const decode = new TextDecoder()
  let rest = ''
  let batch = []
  let put = 0

  const flush = async () => {
    if (!batch.length) return
    await app.putGrooves(batch)
    put += batch.length
    batch = []
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    rest += decode.decode(value, { stream: true })
    const lines = rest.split('\n')
    rest = lines.pop()
    for (const line of lines) {
      if (line) batch.push(JSON.parse(line))
    }
    if (batch.length >= 4000) await flush()
  }
  if (rest.trim()) batch.push(JSON.parse(rest))
  await flush()

  await app.putSet({
    id: 'seeded', name: 'the whole collection', kit: 'gm', customMap: {},
    folderKits: {}, count: put, addedAt: Date.now(), facts: {},
  })
  await app.refreshDrumSets()
  return { seeded: put, ms: Math.round(performance.now() - at) }
}
"""

# The queries underneath, timed on their own.
#
# End-to-end numbers say a window was slow; they do not say which part of it
# was. Twice in this file's short history the answer turned out to be
# somewhere other than where the end-to-end number pointed, so the pieces are
# timed separately and the whole is timed as well.
QUERIES = r"""
async () => {
  const app = window.__jaminApp
  const ms = async (fn) => {
    const at = performance.now()
    const got = await fn()
    return [Math.round(performance.now() - at), got]
  }
  const out = {}

  // What the book asks for the moment it opens: one page of rows.
  const [page, first] = await ms(() => app.searchGrooves({}, { limit: 24, offset: 0 }))
  out.firstPage = page
  out.total = first.total

  // What the facet lists cost, which is what fills the dropdowns.
  const [facets] = await ms(() => app.grooveFacets(''))
  out.facets = facets

  // One filter, as a page of a list.
  const [listed, hits] = await ms(() =>
    app.searchGrooves({ genre: 'Rock' }, { limit: 24, offset: 0 }))
  out.filterList = listed
  out.filterHits = hits.total

  // And the same filter as a *graph*, which asks for everything it matches.
  const [mapped, all] = await ms(() =>
    app.searchGrooves({ genre: 'Rock' }, { limit: 60000, offset: 0 }))
  out.filterGraph = mapped
  out.filterRows = all.rows.length

  return out
}
"""

# And a filter change, which must not rebuild anything.
FILTER = """
async ([genre]) => {
  const app = window.__jaminApp
  const before = (window.__jaminTreeProbe || { showing: () => 0 }).showing()
  const at = performance.now()
  app.state.drumFilters.genre = genre
  const settled = await new Promise((done) => {
    const give = performance.now() + 120000
    const look = () => {
      const probe = window.__jaminTreeProbe
      if (probe && probe.showing() > 0 && probe.showing() !== before) {
        return done(probe.showing())
      }
      if (performance.now() > give) return done(0)
      requestAnimationFrame(look)
    }
    look()
  })
  return { ms: Math.round(performance.now() - at), settled, before }
}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--which", default="drums", choices=["drums", "progressions"])
    args = parser.parse_args()

    if not os.path.exists(os.path.join(ROOT, "dist", "index.html")):
        raise SystemExit("no build in dist/ -- run `npm run build` first")
    tree = os.path.join(CORPORA, f"{args.which}-tree.json")
    if not os.path.exists(tree):
        raise SystemExit(f"no {args.which} tree; see scripts/corpus_trees.py")

    httpd, port = serve()
    profile = os.path.join(CORPORA, "profile")
    with sync_playwright() as pw:
        # Persistent, so 773,836 rows are written once and not on every run.
        # Under the gitignored corpora, and thrown away with them.
        browser = pw.chromium.launch_persistent_context(
            profile, viewport={"width": 1920, "height": 1080},
            args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])
        page = browser.new_page()
        trouble = []
        page.on("pageerror", lambda err: trouble.append(str(err)))
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="load")
        page.wait_for_selector(".v-application", timeout=30000)
        page.wait_for_function("() => Boolean(window.__jaminApp)", timeout=30000)
        page.wait_for_timeout(800)

        if args.which == "drums":
            rows = os.path.join(CORPORA, "drums-rows.ndjson")
            if os.path.exists(rows):
                with open(rows, "rb") as handle:
                    many = sum(1 for _ in handle)
                seeded = page.evaluate(SEED, [many])
                if seeded.get("already"):
                    print(f"  rows      {seeded['already']:,} already in the database")
                else:
                    print(f"  seeded    {seeded['seeded']:,} rows in "
                          f"{seeded['ms'] / 1000:.0f}s (kept for next time)")
            else:
                print("  rows      none; see scripts/corpus_rows.py -- "
                      "the filter timing below is meaningless without them")

        found = page.evaluate(TIMINGS, [args.which])
        found["queries"] = page.evaluate(QUERIES)
        book = "drums" if args.which == "drums" else "progressions"
        found["show"] = page.evaluate(SHOW, [args.which, book])
        page.wait_for_timeout(500)
        found["filter"] = page.evaluate(FILTER, ["rock"])
        browser.close()
    httpd.shutdown()

    size = os.path.getsize(tree)
    print(f"\n  {args.which}: {found['clips']:,} clips -> {found['nodes']:,} nodes, "
          f"{size / 1024 / 1024:.0f}MB on disk")
    print(f"  parse     {found['parse']:,} ms   (JSON.parse of the tree)")
    print(f"  write     {found['write']:,} ms   (once, when asked)")
    print(f"  open      {found['open']:,} ms   -> {found['opened']:,} nodes")
    print(f"  reopen    {found['reopen']:,} ms")
    q = found.get("queries") or {}
    if q:
        print(f"  --- the queries underneath, over {q['total']:,} rows")
        print(f"  page      {q['firstPage']:,} ms   (the list's first page)")
        print(f"  facets    {q['facets']:,} ms   (the filter dropdowns)")
        print(f"  filtered  {q['filterList']:,} ms   (one genre, a page of it: "
              f"{q['filterHits']:,} hits)")
        print(f"  for graph {q['filterGraph']:,} ms   (the same genre, all "
              f"{q['filterRows']:,} rows)")
        print("  ---")
    print(f"  show      {found['show']['ms']:,} ms   -> {found['show']['drawn']:,} "
          f"nodes on screen")
    print(f"  filter    {found['filter']['ms']:,} ms   -> "
          f"{found['filter']['settled']:,} nodes (was {found['filter']['before']:,})")
    if trouble:
        print(f"  {len(trouble)} console error(s): {trouble[0][:160]}")

    spent = {"open": found["open"], "reopen": found["reopen"],
             "show": found["show"]["ms"], "filter": found["filter"]["ms"]}
    for name in ("firstPage", "facets", "filterList", "filterGraph"):
        if name in q:
            spent[name] = q[name]
    over = [name for name, took in spent.items() if took > BUDGET_MS]
    print()
    for name, took in spent.items():
        mark = "FAIL" if took > BUDGET_MS else "ok  "
        print(f"  {mark}  {name} in {took:,} ms against a {BUDGET_MS} ms budget")
    raise SystemExit(1 if over else 0)


if __name__ == "__main__":
    main()
