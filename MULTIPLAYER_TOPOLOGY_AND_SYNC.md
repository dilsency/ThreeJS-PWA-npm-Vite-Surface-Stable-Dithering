# Multiplayer topology and state sync

Context: `LAN_MULTIPLAYER_CONSIDERATIONS.md` covers *how two players find each
other* (PeerJS, the one-time code, phase 1 vs. the phase-2 native app) and is
already implemented and verified for exactly two players (see
`entity components/peer_connection.js`'s `EntityComponentPeerConnection`/
`EntityComponentPeerConnectionUI`). This doc covers what comes next: scaling
that to **up to ~6 simultaneously connected players**, representing each
remote player as a placeholder cube in every *other* player's scene, and
continuously syncing position/facing-direction between everyone.

Implementation status, updated as each step lands: the connection-transport
generalization (single connection → `Map<peerId, DataConnection>`) and remote
cube spawn/sync/despawn (`EntityComponentPlayerNetworkSync` +
`EntityComponentRemotePlayerManager`) are both implemented and verified for
the 2-player case. Mesh formation (`EntityComponentPeerMeshFormation`,
scaling past 2 players) is still design-only — see "Entity component
breakdown" and "Status" below for the precise line.

## Topology: full mesh vs. host-relay

The 2-player case doesn't force this choice (with only one other peer,
"everyone connects to everyone" and "everyone connects to the host" are the
same graph). It has to be decided explicitly once a third player joins.

### Full mesh — chosen

Every player holds a direct PeerJS `DataConnection` to every other player.
At *N* players that's `N*(N-1)/2` total connections in the session, `N-1`
per player — at the stated ceiling of 6 players, 15 total, 5 per peer.

**Pros:**
- No single point of failure — any one player disconnecting only removes
  that player, not the whole session.
- Every message is genuinely peer-to-peer, one hop, no relay — lowest
  latency, and truest to "entirely LAN."
- Consistent with every topology decision already made in
  `LAN_MULTIPLAYER_CONSIDERATIONS.md`: phase 1 was chosen specifically
  *without* stacking a second external matchmaking service on top of PeerJS,
  and phase 2 (native sockets) was chosen specifically to get LAN discovery
  with **zero** external services, not even PeerJS's own broker. A mesh
  keeps that same "no privileged central node" property for gameplay
  traffic; a relay host would quietly reintroduce one.

**Cons:**
- `O(n^2)` connection count — more sockets to establish and hold open than
  a star. At the ~6-player ceiling this is a non-issue (15 lightweight
  WebRTC data channels is nothing), but it wouldn't scale to a much larger
  lobby without a different approach.
- A newly-joining player only knows the one peer whose code they typed —
  getting them connected to everyone *else* already in the session needs an
  extra handshake step (see "Mesh formation" below) that a star topology
  wouldn't need at all.

### Host-relay (star) — considered, not chosen

One player (whoever's code was originally shared) is the de facto host;
every other player connects only to them, and the host relays messages
between clients that aren't directly talking to it.

**Pros:**
- Far simpler: `N-1` connections total, not `N*(N-1)/2`. No mesh-formation
  handshake needed — there is only ever one connection point to know about.
- One obvious place to put any future authoritative logic (if the game ever
  needs a source of truth for something), without extra design work.

**Cons:**
- Single point of failure: the host disconnecting ends the session for
  everyone else, unless host migration is built as a *second* system on top
  — real added complexity this doc doesn't otherwise need.
- Every client-to-client message costs two hops (client → host → other
  client) instead of one — still fast on a LAN, but a real, needless extra
  step compared to mesh.
- Functionally reintroduces a client/server asymmetry — the host is acting
  as a lightweight ad hoc server. That cuts directly against the reasoning
  that shaped phase 2's design (native sockets specifically to avoid *any*
  server-shaped node in the architecture), even though the "server" here is
  just another player's browser tab, not a hosted cloud service.

### Why full mesh won

At ~6 players, mesh's `O(n^2)` growth is small enough not to matter (15
connections, not 15,000), so the one real cost it has doesn't bite at this
scale — while host-relay's cost (a single point of failure, a hidden
client/server asymmetry) is a permanent architectural compromise regardless
of player count. Given this project has consistently chosen "no privileged
central node" at every prior networking decision, mesh is the consistent
choice here too, not just the theoretically nicer one.

## Mesh formation: how a new player learns about everyone

The existing one-time-code UI is unchanged as the entry point — you still
connect to exactly one specific peer to join. What has to be added is a
handshake that runs the moment any `DataConnection` opens (on **both**
sides, regardless of which side is the "host" for that particular
connection — see `EntityComponentPeerConnection`'s existing host/client
distinction, which stays meaningful per-connection even once there are
several):

1. Each side immediately sends `{type: "roster", peerIds: [...]}` — the
   list of every peer id it currently holds an open connection to (not
   including the recipient, who obviously already knows about this
   connection).
2. On receiving a `roster` message, for every id in the list that isn't
   already an open (or in-progress) connection and isn't the receiver's own
   id, initiate `peer.connect(id)` to it.
3. This converges the whole group to full mesh within a couple of hops as
   each new connection triggers its own roster exchange — a player joining
   an existing 5-person session doesn't need to be told about all 5 in one
   message from one source; discovering 2 of them directly and the
   remaining 3 transitively (via those 2's own roster messages) reaches the
   same end state.

**A real correctness issue worth flagging, not glossing over:** two peers
who each discover the other from a roster message at roughly the same time
could both call `peer.connect()` on each other simultaneously, opening two
separate `DataConnection`s for the same pair. The mesh-formation logic needs
a tie-breaker before actually implementing this — e.g. only the
lexicographically (or numerically) smaller peer id is allowed to initiate a
new connection; the other side just waits to receive one. Noted here so
it's not rediscovered the hard way mid-implementation.

## Message envelope, identity, and transform sync

All messages sent over any `DataConnection`, of any kind, share one small
typed envelope — `{type: "...", ...}` — rather than each concern inventing
its own payload shape. Known types so far:

- `{type: "roster", peerIds: [...]}` — mesh formation, above.
- `{type: "identity", shapeIndex, colorIndex1, colorIndex2}` (implemented) —
  the local player's cubeHUD shape (0-9), `colorIndex1` into
  `playerColorPaletteBody` (base/body color) and `colorIndex2` into
  `playerColorPaletteDither` (dither color) - two separate arrays (`main.js`),
  each holding HSL color strings (`THREE.Color` parses `"hsl(h, s%, l%)"`
  directly, same as it does hex strings, so no conversion code was needed).
  Sent as raw indices, not resolved color strings, since every client runs
  the same hardcoded palettes - the receiving `EntityComponentRemotePlayerManager`
  looks each index up in its own copies (`colorPaletteBody`/`colorPaletteDither`,
  passed in at construction) rather than needing the actual color values
  transmitted. Sent by `EntityComponentPlayerNetworkSync` to each connection
  **once**, the first frame that connection appears - checked every frame
  (cheap - a handful of ids), not throttled like `transform`, so it lands as
  soon as
  possible after connecting. Never resent afterward, since shape/colors don't
  change for the lifetime of a connection (unlike position/facing, which
  changes constantly) - see "Entity component breakdown" below for how
  `EntityComponentRemotePlayerManager` defers actually creating the remote
  cube until this arrives, since a cube's shape/colors are fixed at
  construction and can't be changed after the fact.
- `{type: "transform", position: {x, y, z}, yaw, pitch}` — a remote player's
  current position and facing direction, in radians. Only yaw and pitch, no
  roll, since that's all the local player's own controllers
  (`EntityComponentPlayerController` / `EntityComponentCameraControllerFirstPerson`)
  track for facing direction in the first place — there's nothing to send
  that isn't already being computed.

**Send rate:** throttle outbound `transform` messages to roughly 15–20/sec
per connection rather than once per render frame. LAN bandwidth isn't the
constraint here, but there's no reason to saturate every connection at 60Hz
either — this is a starting point to tune once actually measured, not a
hard commitment.

**Not tackled yet, and deliberately deferred:** interpolating/smoothing a
remote player's cube between received `transform` updates so it doesn't
visually snap at whatever the send rate ends up being. Real polish item,
but doesn't block getting position/rotation sync working at all, so it's
left for a follow-up pass rather than bundled into this design.

## Entity component breakdown

Splitting this into single-purpose components, per the existing
Input-vs-logic precedent (`EntityComponentCameraControllerFirstPersonInput`
/ `EntityComponentCameraControllerFirstPerson`, etc.) and the rule in
`TEMPORARY_DEV_TOOLS_VS_ECS.md`: once a piece of state is read by more than
one concern, it belongs in its own component, looked up via
`methodGetComponent`, not threaded through closures or bolted onto whichever
component happened to need it first. Connection state here is about to be
read by at least four different concerns (UI, mesh formation, remote-cube
spawning, transform routing), which is exactly that signal.

- **`EntityComponentPeerConnection`** (implemented). Owns the local `Peer`
  instance and the connection *transport* itself: a
  `Map<peerId, DataConnection>` plus each connection's host/client role
  keyed by peer id, `methodGetConnectionIds()`, `methodGetIsHostForId(peerId)`,
  `methodSendToId(peerId, message)`, `methodSendToAll(message)`, and
  `methodDrainMessages()` (a per-frame-polled inbox rather than a registrable
  callback — see below). Still knows nothing about rosters, cubes, or what a
  `transform` message means — purely "here are my open pipes." Also owns a
  `beforeunload` handler that destroys the local `Peer` on tab close/navigate
  — see "Disconnect detection" below for why that turned out to matter.
- **`EntityComponentPeerConnectionUI`** (existing — unchanged in shape).
  Still just the code-entry/checkmark DOM described in
  `LAN_MULTIPLAYER_CONSIDERATIONS.md`, reading from
  `EntityComponentPeerConnection` via the normal sibling lookup. Showing
  more than one connection's state (multiple checkmarks) is a real gap once
  there are >2 players, but it's a UI-only follow-up on top of already
  having per-connection data available — not something to solve as part of
  this design.
- **`EntityComponentPeerMeshFormation`** (not yet implemented). Owns the roster handshake
  described above: sends a `roster` message when a connection opens,
  handles incoming `roster` messages, and issues new `peer.connect()` calls
  (through `EntityComponentPeerConnection`, via sibling lookup) for ids it
  doesn't recognize yet. This is policy about *which connections should
  exist*, deliberately kept separate from `EntityComponentPeerConnection`'s
  job of *managing whatever connections already exist*.
- **`EntityComponentRemotePlayerManager`** (implemented). Owns
  `Map<peerId, Entity>` for remote players. Each frame, reconciles that map
  against `EntityComponentPeerConnection.methodGetConnectionIds()` to
  spawn/despawn a bare `Entity` per peer (despawning also removes any cube
  mesh from `scene` and the entity from `EntityManager` —
  `EntityManager.methodRemoveEntity()` didn't exist before this and was added
  for it), and drains `EntityComponentPeerConnection.methodDrainMessages()` to
  handle two message types: `identity` attaches the entity's
  `EntityComponentTestCube` for the first time, using the received
  `shapeIndex` directly and resolving `colorIndex1`/`colorIndex2` via its own
  `colorPaletteBody`/`colorPaletteDither` constructor params (the same two
  arrays `main.js` rolled the sender's own indices from in the first place,
  so both sides agree on what an index means without the actual color values
  ever needing to cross the wire); `transform`
  applies position/rotation directly to that cube (not through the ECS
  `methodSetPosition` broadcast — it's a "dumb" remote representation with no
  controller logic of its own) and is silently dropped if the cube hasn't
  been created yet (identity not received yet). Never touches the local
  player's own entity — only ever creates entities for *other* peers, which
  is exactly why a local player never sees a body for themselves: their own
  client simply never spawns one.
- **`EntityComponentPlayerNetworkSync`** (implemented, attached to the local
  player's own entity, not the remote ones). Two responsibilities, both
  outbound: sends `identity` (its `shapeIndex`/`colorIndex1`/`colorIndex2`
  constructor params, set from `main.js`'s local-identity rolls) to each
  connection exactly once, tracked via a `#identitySentToIds` Set checked
  every frame; and reads the local player's current position/facing from its
  sibling `EntityComponentCameraControllerFirstPerson` (which gained
  `methodGetPosition()`/`methodGetYaw()`/`methodGetPitch()` for this) to send
  `transform` messages to every open connection (via
  `EntityComponentPeerConnection.methodSendToAll`) at the throttled rate
  (~18Hz, via a `#secondsSinceLastSend` accumulator against
  `EntityManager`'s per-frame `timeDelta`, which is in seconds). The one
  component in this list that's about *outbound* local state rather than
  *inbound* remote/session state.

Four components, four separable concerns — transport, mesh-formation
policy, remote representation, and outbound broadcasting — each readable and
testable on its own, matching how the camera/player controller split already
works in this codebase.

## Disconnect detection: PeerJS's `close` event, the `beforeunload` fix, and a Playwright gotcha

Spawn and transform-sync worked correctly the moment they were built and
tested. Despawn looked broken at first, and the actual cause was more
specific — and more interesting — than "the code is wrong."

**What was observed:** after two Playwright tabs connected (host + client),
closing the client tab (`page.close()`) left the host still showing the
client's remote-player cube, unmoving, forever — re-checked every 5 seconds
for a full 60 seconds with no change.

**Root cause, once traced:** `conn.on('close', ...)` (registered in
`EntityComponentPeerConnection.methodHandleConnection`, which is exactly what
`EntityComponentRemotePlayerManager` relies on via
`methodGetConnectionIds()` no longer including that peer) is correct code —
but PeerJS's `DataConnection` only fires `close` when it actually detects the
underlying WebRTC connection has ended. An abruptly-closed browser tab sends
**no graceful WebRTC/DTLS teardown signal** to the other side at all — there
is no "goodbye" packet, no `beforeunload`-equivalent for network transport
built into WebRTC itself. Detecting the loss any other way falls back to
ICE connection-state timeouts, which are not fast, and in this testing
PeerJS never reached that point within 60 seconds regardless. Chromium isn't
doing anything wrong here either — this is just the actual, sometimes-slow
reality of WebRTC failure detection, which is exactly why this doc's earlier
tradeoff discussion of full mesh vs. host-relay never assumed disconnects
would be instantly visible for free.

**The fix:** `EntityComponentPeerConnection`'s constructor now registers a
single `window.addEventListener('beforeunload', () => { if(this.#peer !=
null){this.#peer.destroy();} })`. A normal tab close/refresh/navigate *does*
fire `beforeunload` in a real browser, and `peer.destroy()` closes every
open `DataConnection` immediately, so the other side's `close` event fires
right away instead of waiting on ICE timeouts. Registered once in the
constructor (not `methodInitialize`, which can re-run on an
`unavailable-id` retry) and reads `this.#peer` at actual unload time so it
always targets whichever peer instance is current.

**The Playwright gotcha, worth remembering for any future test in this
project:** the first attempt to verify the fix used `page.close()` again,
and it *still* showed the cube stuck after 60 seconds — which looked like
the fix had failed. It hadn't. A follow-up test confirmed
`window.addEventListener('beforeunload', ...)` handlers **do not reliably
fire when Playwright closes a page via `page.close()`** in headless
Chromium at all (verified directly: a handler writing to `localStorage` on
`beforeunload` never actually wrote anything across a `page.close()`,
checked by reopening a page and reading it back). Switching the test to an
actual in-page navigation (`page.goto('about:blank')`) — a much closer proxy
for what happens when a real user closes or navigates away from a tab — made
the fix visibly work: the host despawned the remote cube within about 1
second. **Conclusion: don't use `page.close()` to test anything that depends
on `beforeunload` in this project; use a real navigation instead**, or the
test will look like a regression that isn't one.

**What this fix does not cover:** a real crash, a killed tab process, or a
yanked network cable still won't fire `beforeunload` (there's no JS left
running to fire it), so those disconnects still rely on the slow ICE-timeout
path today. Closing that gap for good would need an application-level
heartbeat (periodic ping; treat a peer as gone if nothing — ping or
`transform` — arrives for N seconds) — considered, not implemented yet, since
`beforeunload` alone was judged sufficient for now (it covers the common
"player quits normally" case, which is most of real usage).

## Local spawn position (fixed a real colocation bug)

Every player used to start at the identical hardcoded `(0, 0, 5)`. That's
harmless solo, but once connected, it meant a remote player's cube rendered
*exactly on top of your own camera* the moment they joined and hadn't moved
yet — discovered while producing demo screenshots for this doc's earlier
sections (a spectator-camera hack was needed just to get a clean shot with
separation between the two). Not a sync bug: position was being relayed
correctly; there was just nothing giving two independent local sessions
distinct starting points.

Fixed in `main.js` by deriving a random local spawn X *and* Z from the
`ground` entity's own actual extent, computed from the same `groundSize`/
`groundPositionOffset` values used to construct the ground's
`EntityComponentTestCube` (not the ground's live `THREE.Mesh`, since that's
built asynchronously and isn't guaranteed to exist yet at this point in
`initEntityComponents()`): `groundMinX`/`groundMaxX` from
`groundPositionOffset.x ∓ groundSize.x/2` (and the same shape for Z), then
`localPlayerStartX`/`localPlayerStartZ` each rolled uniformly and
independently between their respective min/max. Y stays fixed at `0` -
randomizing across the ground's full X/Z footprint is sufficient to keep two
players from colocating in the common case and keeps everyone provably
standing on the ground (by construction, since both ranges come directly
from the ground's own width/depth). Doesn't prevent two players from rolling
a spawn point *near* each other by chance (a real possibility now that both
axes are independent random draws over the same ~20x20 footprint, unlike the
near-zero chance of an exact collision), and there's no minimum-separation
guarantee between players - not addressed here, since it wasn't asked for.

## Status

`EntityComponentPeerConnection` (multi-connection transport + `beforeunload`
graceful close), `EntityComponentPlayerNetworkSync` (outbound `identity` +
`transform` broadcasting), and `EntityComponentRemotePlayerManager` (remote
cube spawn/skin/sync/despawn) are all implemented and verified for the
2-player case — see `entity components/peer_connection.js`,
`player_network_sync.js`, and `remote_player_manager.js`. Verified end-to-end:
each side's remote cube exactly matches the other player's own randomly-rolled
shape, base color, and dither color. `EntityComponentPeerMeshFormation` (the
roster handshake needed to scale past 2 players to the full-mesh ~6-player target)
is still design-only, per "Mesh formation" above.
