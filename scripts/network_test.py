#!/usr/bin/env python3
"""
Two machines, two browsers, one chart.

Runs real jamin-node processes, points a real browser at each, types into one
and waits for the other to agree. Nothing is mocked: the nodes find each other
by multicast, the pages are served over HTTP, the edits travel as server-sent
events, and what is asserted is that two independently-rendered chord charts
end up saying the same thing.

    <venv>/bin/python scripts/network_test.py [--node PATH] [--files DIR]

The venv is the one with playwright in it; see scripts/browser_test.py.
"""
import argparse
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

results = []


def ok(label, passed, detail=""):
    results.append(passed)
    print(f"{'ok  ' if passed else 'FAIL'} {label}" + (f"   ({detail})" if detail else ""))


def settle(page, ms):
    page.wait_for_timeout(ms)


def chart_of(page):
    return page.eval_on_selector(".jamin-input", "el => el.value")


def wait_for_chart(page, wanted, timeout_ms=8000):
    """The whole point is that agreement is eventual, so this waits for it."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if chart_of(page) == wanted:
            return True
        page.wait_for_timeout(100)
    return chart_of(page) == wanted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", default=os.path.join(ROOT, "native/build/bin/jamin-node"))
    parser.add_argument("--files", default=os.path.join(ROOT, "dist"))
    args = parser.parse_args()

    if not os.path.exists(args.node):
        print(f"FAIL no jamin-node at {args.node} — build it first")
        return 1
    if not os.path.exists(os.path.join(args.files, "index.html")):
        print(f"FAIL no built page at {args.files} — npm run build")
        return 1

    ports = [7811, 7812]
    nodes = []
    for port, name in zip(ports, ("alpha", "beta")):
        nodes.append(subprocess.Popen(
            [args.node, "--port", str(port), "--files", args.files, "--name", name, "--network", "--quiet"],
            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))

    try:
        # Long enough for two beacons, so each has heard the other.
        time.sleep(3.0)

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            # Separate contexts, because two machines do not share a localStorage
            # and a test that let them would be testing the wrong thing.
            one = browser.new_context()
            two = browser.new_context()
            a = one.new_page()
            b = two.new_page()

            errors = []
            for page, who in ((a, "alpha"), (b, "beta")):
                page.on("pageerror", lambda e, who=who: errors.append(f"{who}: {e}"))

            a.goto(f"http://127.0.0.1:{ports[0]}/", wait_until="load")
            b.goto(f"http://127.0.0.1:{ports[1]}/", wait_until="load")
            settle(a, 4000)
            settle(b, 1500)

            ok("both pages load", a.query_selector(".jamin-input") is not None
               and b.query_selector(".jamin-input") is not None)

            joined = a.evaluate("() => !!(window.__jaminNet && window.__jaminNet.joined)")
            peers = a.evaluate("async () => (await (await fetch('/peers')).json()).length")
            ok("the node found its peer", peers == 1, f"{peers} peers")

            # --- one types, the other agrees --------------------------------
            a.fill(".jamin-input", "Cmaj7 A-7 D-7 G7")
            settle(a, 400)
            ok("an edit on one machine reaches the other",
               wait_for_chart(b, "Cmaj7 A-7 D-7 G7"), chart_of(b))

            # --- and back the other way -------------------------------------
            b.fill(".jamin-input", "Cmaj7 A-7 D-7 G7 | Ebmaj7")
            settle(b, 400)
            ok("and it works in both directions",
               wait_for_chart(a, "Cmaj7 A-7 D-7 G7 | Ebmaj7"), chart_of(a))

            # --- both at once -----------------------------------------------
            # The case that a last-writer-wins scheme gets wrong: two edits made
            # before either has heard the other.
            a.evaluate("""() => {
                const el = document.querySelector('.jamin-input')
                el.value = 'AAA ' + el.value
                el.dispatchEvent(new Event('input', { bubbles: true }))
            }""")
            b.evaluate("""() => {
                const el = document.querySelector('.jamin-input')
                el.value = el.value + ' ZZZ'
                el.dispatchEvent(new Event('input', { bubbles: true }))
            }""")
            settle(a, 2500)
            settle(b, 2500)

            first, second = chart_of(a), chart_of(b)
            ok("simultaneous edits converge", first == second, f"{first!r} vs {second!r}")
            ok("and neither edit was lost",
               "AAA" in first and "ZZZ" in first, first)

            # --- a third browser arrives later ------------------------------
            three = browser.new_context()
            c = three.new_page()
            c.goto(f"http://127.0.0.1:{ports[0]}/", wait_until="load")
            settle(c, 4000)
            ok("a browser that joins late is caught up",
               wait_for_chart(c, first), chart_of(c))

            # --- a node goes away -------------------------------------------
            nodes[1].terminate()
            nodes[1].wait(timeout=5)
            time.sleep(8.0)   # three missed beacons plus room
            left = a.evaluate("async () => (await (await fetch('/peers')).json()).length")
            ok("a node that leaves is forgotten", left == 0, f"{left} peers")

            # And the survivors carry on.
            a.fill(".jamin-input", "F-7 Bb7 Ebmaj7")
            settle(a, 500)
            ok("and the rest keep working",
               wait_for_chart(c, "F-7 Bb7 Ebmaj7"), chart_of(c))

            ok("no page errors anywhere", not errors, "; ".join(errors[:2]))
            browser.close()
    finally:
        for node in nodes:
            if node.poll() is None:
                node.terminate()
                try:
                    node.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    node.kill()

    failures = results.count(False)
    print("network: all checks passed" if not failures else f"network: {failures} FAILED")
    return 1 if failures else 0


sys.exit(main())
