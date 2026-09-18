#!/usr/bin/env python3
"""Check what the drum store promises about itself, against a real IndexedDB.

Unlike filter_check.py and import_check.py this needs no library of anybody's,
so it runs as part of `npm test`. It covers the things that are true about the
store regardless of what is in it -- above all the remembered dropdowns, which
are a cache, and a wrong cache is worse than a slow one.

Node rather than JavaScriptCore, because these need a database and the JSC
harness has none. What it must not be used for is *timing*: fake-indexeddb is
correct and is not a performance model. Measured against the web view the
plugin actually embeds, it steps through duplicates on a `nextunique` cursor
instead of seeking, and it deletes rows about three hundred times slower --
1,000 rows with their indexes take 61ms in WebKit and over forty seconds of
solid CPU here. Nine hours were once spent waiting on a check that was only
ever measuring the shim. Timings are taken by native/tools/boot_probe.m.

    python3 scripts/store_check.py
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DRIVER = r"""
import 'fake-indexeddb/auto'
import {
  putSet, listSets, putGrooves, grooveFacets, deleteSet, clearImported, countGrooves,
} from 'SRC/core/drumStore.js'

let failed = 0
function check(label, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g !== w) { failed++; console.log(`FAIL ${label}: got ${g} want ${w}`) }
}

/*
 * Small on purpose.
 *
 * Every row deleted here maintains nineteen indexes and this shim does that
 * slowly enough that a couple of thousand rows is minutes. What is being
 * checked is what the store *says*, which needs a handful of rows; what it
 * costs is a question for a real engine. @see native/tools/boot_probe.m
 */
async function fill(setId, rows, genre) {
  const batch = []
  for (let n = 0; n < rows; n++) {
    batch.push({
      id: `${setId}:${n}`, s: setId, n: `clip ${n}`, p: `Pack/Shelf ${n % 5}/c${n}.mid`,
      f: `Pack/Shelf ${n % 5}`, k: n % 4 ? 'beat' : 'fill', r: (n % 3) + 1, t: '4-4',
      g: genre, b: 120, h: 8, x: { feel: 'straight' }, m: {},
    })
  }
  const trouble = await putGrooves(batch)
  if (trouble) throw new Error(`could not write: ${trouble}`)
  await putSet({ id: setId, name: setId, kit: 'gm', customMap: {}, count: rows, addedAt: 1 })
}

/* ---------------- a kit survives being set ----------------------------- */
/*
 * The library list writes a kit straight out of Vue's reactive state, and the
 * structured clone an IndexedDB write performs refuses a Proxy outright --
 * `DataCloneError: #<Object> could not be cloned`. It threw on every change,
 * silently, so the setting appeared stuck on whatever the importer decided.
 * The store's own guarantee is only this: what is put can be got.
 */
await putSet({ id: 'k', name: 'K', kit: 'gm', customMap: {}, folderKits: { a: 'gm' },
               facts: { pitches: [36, 38] }, count: 0, addedAt: 1 })
const filed = (await listSets()).find((one) => one.id === 'k')
await putSet({ ...filed, kit: 'vdrums' })
check('a kit that is written is a kit that is read',
      (await listSets()).find((one) => one.id === 'k').kit, 'vdrums')

/* ---------------- the dropdowns are remembered, and correctly ---------- */
await fill('a', 300, 'rock')
await fill('b', 200, 'jazz')

const cold = await grooveFacets('a')
const warm = await grooveFacets('a')
check('asking twice gives the same answer', JSON.stringify(warm), JSON.stringify(cold))
check('and it is the true one',
      [cold.holds, cold.genres.length, cold.folders.length, cold.kinds.length],
      [300, 1, 5, 2])
check('the counts add up to the rows',
      cold.kinds.reduce((sum, [, n]) => sum + n, 0), 300)

const both = await grooveFacets(null)
check('everything sees every library', [both.holds, both.genres.length], [500, 2])

// A row arriving changes the count, which is the stamp the cache is kept under.
await putGrooves([{ id: 'a:new', s: 'a', n: 'new', p: 'Pack/Shelf 9/n.mid', f: 'Pack/Shelf 9',
                    k: 'fill', r: 1, t: '4-4', g: 'funk', b: 120, h: 4, x: {}, m: {} }])
const grown = await grooveFacets('a')
check('a row arriving is noticed', [grown.holds, grown.genres.length], [301, 2])

// And a library leaving invalidates its own answer and the catalogue's.
await deleteSet('b')
check('the library is gone', await countGrooves('b'), 0)
const fewer = await grooveFacets(null)
check('a library leaving is noticed everywhere', [fewer.holds, fewer.genres.length], [301, 2])

/*
 * And an emptied catalogue answers as empty.
 *
 * The stamp is a row count, and an emptied catalogue counts zero -- which a
 * cache written when it was empty would match. So the wipe takes the
 * remembered answers with it.
 */
await clearImported()
await fill('c', 50, 'soul')
const after = await grooveFacets(null)
check('a wiped catalogue does not answer out of the old one',
      [after.holds, after.genres.length, after.genres[0][0]], [50, 1, 'soul'])

console.log(failed ? `store: ${failed} FAILED` : 'store: all checks passed')
"""


def main():
    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    if not os.path.exists(esbuild):
        print("     (esbuild is not installed; skipping the store check)")
        return 0

    # Inside the project: the driver imports the real store and a stand-in for
    # the browser's database, and node resolves both by walking up from the file.
    work = os.path.join(ROOT, "node_modules", ".store-check")
    os.makedirs(work, exist_ok=True)
    entry = os.path.join(work, "driver.mjs")
    with open(entry, "w", encoding="utf-8") as handle:
        handle.write(DRIVER.replace("SRC", os.path.join(ROOT, "src")))

    bundle = os.path.join(work, "bundle.mjs")
    built = subprocess.run(
        [esbuild, entry, "--bundle", "--format=esm", "--platform=node",
         "--log-level=error", f"--outfile={bundle}"],
        capture_output=True, text=True,
    )
    if built.returncode != 0:
        print(f"FAIL bundling the store check:\n{built.stderr}")
        return 1

    out = subprocess.run(["node", bundle], capture_output=True, text=True)
    sys.stdout.write(out.stdout)
    if out.returncode != 0:
        print(f"FAIL the store check threw:\n{out.stderr[-3000:]}")
        return 1
    return 0 if "all checks passed" in out.stdout else 1


sys.exit(main())
