# jamin on a local network

Several machines running jamin, all holding the same chart, any of them able to change it, and a
browser anywhere on the network able to drive the lot. No accounts, no configuration, no server
to start.

---

## What was verified before writing this

Four claims decide the shape of this, and the first two are the ones that matter. All were
measured on this machine (macOS 26.6, Mac Studio, 192.168.87.202) rather than assumed.

**Multicast discovery works, and nothing asks permission.** A process joined `239.7.7.7:47717`,
sent to the group and received its own packet back with the sender's LAN address attached — no
prompt, no entitlement, no configuration.

```
joined 239.7.7.7:47717
sent
received "jamin/1 hello" from 192.168.87.202
```

**A browser can reach a machine by name.** `Mac-Studio-9.local` resolves and serves over HTTP.
The resolution happens in the operating system, not in the page, which is what makes this usable
from a browser at all.

```
$ curl -o /dev/null -w '%{http_code}' http://Mac-Studio-9.local:7788/
200
```

**A browser page cannot discover peers on macOS — but the web platform can, elsewhere.** The
flat version of this claim is wrong and the precise version matters, so:

*The capability exists.* The **Direct Sockets API** gives a page `TCPSocket`, `UDPSocket` and
`TCPServerSocket`, and multicast was added to it for exactly this purpose — local device
discovery. It is restricted to **Isolated Web Apps**, which are signed, installed bundles, and
IWAs are available to end users on **ChromeOS only**. Checked in Chrome 151 on this machine:

```
Direct Sockets: TCPSocket          undefined
Direct Sockets: UDPSocket          undefined
Direct Sockets: TCPServerSocket    undefined
```

*Reaching a local address is a separate question, and it now has a permission.* Chrome shipped
**Local Network Access** in 142, and it is queryable:

```
permission: local-network-access   prompt
```

LNA gates a page *reaching* a private address; it does not tell the page which addresses exist.
Discovery and access are different problems and only the second one has an API.

*The macOS prompt is Chrome, not a page.* "Allow Chrome to discover devices on your local
network" is the operating system asking the **application**, and Chrome's own manifest says what
for:

```
$ PlistBuddy -c "Print :NSBonjourServices" "/Applications/Google Chrome.app/Contents/Info.plist"
Array { _googlecast._tcp }
```

One service, Google Cast. Chrome does mDNS to find Chromecasts. A page cannot ask it to look for
anything else.

**A page served by one node can reach all the others directly.** This is the finding that changed
the design, and it went the opposite way to the guess. LNA gates *public → private*; a page whose
own origin is already a local address is not gated going to another one. Measured, cross-origin,
with nothing but ordinary CORS headers:

```
origin         http://mac-studio-9.local:7801
same node      200 {"node":"7801"}
another node   200 {"node":"7802"}
by raw LAN ip  200 {"node":"7802"}
```

So the browser does not have to relay everything through whichever node served it. It holds a
connection to every machine.

**WebTransport is not the answer here.** It needs a secure context, which on a network of `.local`
names means certificates for names that no certificate authority will vouch for. Verified
`undefined` on a plain-HTTP LAN origin. Server-sent events over HTTP need none of that machinery
and carry the same traffic.

**JUCE has the pieces for the native half and none for the browser half.** `DatagramSocket` does
multicast — `joinMulticast`, `setMulticastLoopbackEnabled`, `setEnablePortReuse` — and
`StreamingSocket` does TCP. There is no HTTP server and no WebSocket in JUCE, so that part is
ours to write.

---

## Do we need more moving parts?

**One, and it is not a new process.** A small server inside the plugin: a multicast socket to
find the other machines, and an HTTP endpoint to talk to browsers. No broker, no cloud, no daemon
to install, nothing to launch.

It has to be there because discovery has no browser API on this platform. Discovery is done by
the **nodes**, which are native and can; the browser is then *handed* the list rather than
finding it, and talks to every machine on it directly. Which means the browser's experience is
still automatic, as long as it reaches a node once:

```
        multicast 239.x : nodes find each other, automatically
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │ jamin in │◄─►│ jamin in │◄─►│ jamin,   │
   │ Live     │   │ Logic    │   │ standalone│
   └────┬─────┘   └──────────┘   └──────────┘
        │ http + server-sent events
        ▼
   a browser, anywhere on the network — handed the peer list by
   whichever node served it, then talking to all of them directly
```

Open `http://mac-studio-9.local:7777` once and bookmark it. That page is jamin, it is already
connected, and it knows about every other machine because the node that served it does. Nothing
was configured and nothing was discovered by the browser.

**Server-sent events rather than WebSocket.** A WebSocket server is a handshake, a framing layer,
masking rules and a ping/pong timer — several hundred lines of protocol to write and get wrong.
`EventSource` downstream and an ordinary `POST` upstream need none of it: the downstream is a
text stream that never closes, and the upstream is a request. Both are browser protocols of
exactly the same vintage, and the page being served by the node it talks to means there is no
CORS to negotiate either.

---

## Agreeing on the chart

Sending the text does not work. Whoever wrote last erases whoever wrote first, and with a network
round trip in between that is not an edge case — it is what happens whenever two people type in
the same second.

So what travels is the edits, and `src/core/crdt.js` is what makes them safe to apply in any
order. It is a causal tree: every character carries an id unique for all time and the id of the
character it was typed after, and the document is that tree walked depth-first. Two people
inserting at the same point interleave the same way on every machine without anybody agreeing in
advance who went first.

There is **no leader and no server** in this. A node that has been off the network and comes back
converges by exchanging edits, not by being told what the answer is.

What is tested is the property rather than the feature: twenty-five randomised runs of four sites
making concurrent edits with reordered, delayed, duplicated and batched delivery, plus one run of
seven sites over four hundred rounds — every site ends up with the same text every time. Two real
faults were caught that way and neither would have been found by testing an edit:

- A delete arriving before the insert it removes was dropped, so the character came back. Deletes
  are remembered until the character they name turns up.
- An insert whose parent has not arrived is held rather than discarded, and released when it does.

**Tombstones accumulate.** A deleted character stays, marked, because a later insert may still
name it as a parent. A document edited all day grows even if its text does not. For a chord chart
that is nothing; for anything else it would need pruning, and it is worth knowing rather than
discovering.

---

## Shared, and not shared

The split already exists and the network does not change it.

| Shared across every machine | This machine only |
| --- | --- |
| the chart, and the phrase marks in it | which phrase this instance plays |
| bars per line, the key | its MIDI channel, octave, bass |
| the song phrase | its accent binding |
| | its transport — each host has its own |

Playback is deliberately **not** synchronised. Every instance takes its position from its own
host's playhead, and trying to agree on time across a network would be a hard real-time problem
solving something nobody asked for. What is shared is the document.

---

## No authentication, and what that means

Asked for, and worth stating plainly rather than burying: **anyone who can reach the port can
change the chart.** There is no password, no pairing, no confirmation. On a studio network that
is the point — a phone, a laptop and three machines all editing the same chart with nothing to
set up.

It also means this does not belong on a network you do not control. The mitigations that cost
nothing are worth taking anyway: bind to the local network rather than every interface, a
multicast TTL of 1 so discovery cannot leave the subnet, and a plugin that does not open the port
at all until networking is switched on.

macOS will ask the **host** application — Live, Logic — for Local Network permission the first
time, because permission belongs to the application and not to the plugin inside it. A command
line tool inherits the terminal's and is never asked, which is why the probe above saw no prompt
and a DAW will.

---

## Phases

**Phase N0 — the document. *Done; see `src/core/crdt.js`.*** Edits that converge, with the
property tested rather than asserted.

**Phase N1 — discovery. *Done; see `native/core/src/Discovery.cpp`.*** A beacon every two
seconds carrying id, name and port; a peer table that ages an entry out after three missed ones.
No registry, no first machine that has to be started before the others, and nothing to type.

The address a peer is reachable at is taken from the **packet**, not from what the packet says: a
sender does not always know which of its interfaces something left by, and cannot know how it
looks from here. The receiving socket does.

Several nodes share a machine as the normal case -- a DAW with jamin on four tracks is four
nodes -- so the socket is shareable and a node ignores its own beacon by id. That case is tested
rather than assumed, along with a third node arriving, one leaving and being forgotten, and a
node with no id being refused rather than started.

**Phase N2 — the endpoint. *Done; see `native/core/src/Endpoint.cpp`.*** The built page, `GET
/events` as a stream that never closes, `POST /ops`, `GET /peers`, and `GET /doc` -- everything
said so far, so a browser arriving late can be brought up to date. Every response allows any
origin, which is what lets one page talk to every machine.

Bound to the loopback unless asked otherwise. A port on the network is something to opt into, not
something that happens because the feature was compiled in.

**Phase N3 — joining the two. *Done; see `src/core/net.js` and `native/tools/node_main.cpp`.***
A page served by a node joins on its own: it asks `/peers`, and a node answers where a dev server
and the plugin's bundle do not, so there is nothing to switch on. `jamin-node` relays -- every
edit goes to everybody attached here and on to every other node, with an envelope id stopping it
going round for ever.

**Phase N4 — what people need to see. *Done.*** An indicator in the toolbar when there is a
network to be on at all, and the machines listed by name and address in settings, each a link to
open that machine's own copy. It says plainly that anyone who can reach the port can edit the
chart, because that is true and is better read than discovered.

The count is machines rather than people -- a machine with three browsers open is one machine --
because that is what discovery knows, and any other number would be invented.

---

## Proving it

`npm run test:network` is the one that matters. It starts real `jamin-node` processes, points a
real browser at each, types into one and waits for the other to agree. Nothing is mocked: the
nodes find each other by multicast, the pages come over HTTP, the edits travel as server-sent
events, and what is asserted is that two independently rendered chord charts end up saying the
same thing.

```
ok   the node found its peer   (1 peers)
ok   an edit on one machine reaches the other
ok   and it works in both directions
ok   simultaneous edits converge
ok   and neither edit was lost
ok   a browser that joins late is caught up
ok   a node that leaves is forgotten   (0 peers)
ok   and the rest keep working
ok   no page errors anywhere
```

The fourth and fifth are the ones a last-writer-wins scheme fails: two edits made before either
machine has heard the other. Both survive, and both machines agree on the result.
