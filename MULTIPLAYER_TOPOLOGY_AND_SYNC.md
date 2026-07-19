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
generalization (single connection → `Map<peerId, DataConnection>`), remote
cube spawn/sync/despawn (`EntityComponentPlayerNetworkSync` +
`EntityComponentRemotePlayerManager`), mesh formation past 2 players
(`EntityComponentPeerMeshFormation`), `EntityComponentPeerConnectionUI`'s
live connection-count indicator + collapse/expand UI, and interpolating
remote players' position/rotation between throttled `transform` updates so
they don't visually snap (`TODO.md` item 7 — the interpolation math itself
is written up in `MATH_TRICKS.md`) are all implemented — see "Entity
component breakdown" and "Status" below for exactly what's been tested.

## Glossary

Terms as used specifically in this doc/project — not general networking
definitions. Alphabetical.

- **Convergence** — the point at which every player in a session has
  finished discovering and connecting to every other player, so the group's
  connections form a complete peer mesh. Mesh formation (below) is the
  process that drives a group toward convergence as players join; a
  "convergence gap" (see "Mesh formation") is a bug where some pair of
  players never ends up connected at all.
- **`DataConnection`** — PeerJS's object representing one actual WebRTC
  peer-to-peer data channel to a specific other peer. `EntityComponentPeerConnection`
  holds these in a `Map<peerId, DataConnection>`, one per connected player.
  Not the same thing as a *peer* (a player) — one player, once connected to
  several others, holds several `DataConnection`s, one per peer.
- **Full mesh** — see **Peer mesh**.
- **Host / Client (per-connection roles)** — *not* a topology (this project
  is always a peer mesh, never host-relay) — a label for which side of one
  specific connection shared the one-time code (host) versus typed someone
  else's (client). Purely about how that one connection came to exist;
  doesn't imply anything about authority, relaying, or centralization, and a
  single player is simultaneously "host" for some of their connections and
  "client" for others once more than 2 players are involved.
- **Host-relay (star)** — the rejected alternative topology: every player
  connects only to one designated host, who relays messages between
  clients that aren't talking to it directly. See "Topology: full mesh vs.
  host-relay" for why this project chose peer mesh instead.
- **Identity (message)** — the `{type: "identity", shapeIndex, colorIndex1,
  colorIndex2}` message. A player's chosen cubeHUD shape/colors, sent once
  per connection (never repeats, since it never changes for that
  connection's lifetime) so the receiving player can skin that peer's
  remote-representation cube correctly. See "Message envelope, identity,
  and transform sync."
- **Mesh formation** — the roster-handshake protocol
  (`EntityComponentPeerMeshFormation`) that grows a player's one initial
  connection (from typing/sharing a one-time code) into a full peer mesh
  with everyone else already in the session, without needing every pair of
  players to manually exchange codes with each other. See "Mesh formation:
  how a new player learns about everyone."
- **Message envelope** — the shared `{type: "...", ...}` wrapper shape every
  message sent over any `DataConnection` uses, regardless of which concern
  (`roster`, `identity`, `transform`) it carries — one shape, so a new
  message kind never needs its own transport mechanism.
- **Peer mesh (full mesh)** — the topology this project uses: every player
  holds a direct `DataConnection` to every other player, with no relay and
  no central/privileged node. At *N* players that's `N*(N-1)/2` total
  connections, `N-1` per player. See "Topology: full mesh vs. host-relay."
- **Per-frame message snapshot** — `EntityComponentPeerConnection.methodGetMessagesThisFrame()`'s
  return value: every message received since the last frame, across all
  connections, as one array that any number of sibling components can read
  the *same* copy of that frame (non-destructively) — as opposed to a
  destructive drain, which only the first reader each frame would actually
  see anything from. See "Entity component breakdown."
- **Roster** — the `{type: "roster", peerIds: [...]}` message: one player's
  current list of who they're already connected to, sent to converge the
  mesh (see **Mesh formation**). Re-broadcast to every current connection
  whenever the sender's own connection set changes — *not* sent only once
  to a newcomer, which was tried first and found to leave convergence gaps
  (see "Mesh formation" for the actual bug this caused).
- **Signaling** — the WebRTC handshake (SDP offer/answer + ICE candidates)
  that has to pass between two browsers before their direct
  `DataConnection` can exist at all. Handled entirely by PeerJS's public
  broker in this project (see `LAN_MULTIPLAYER_CONSIDERATIONS.md`) — once
  signaling completes, all further traffic (roster/identity/transform)
  flows peer-to-peer, not through that broker.
- **Tie-breaker** — the rule deciding which of two peers is allowed to
  initiate a new connection when both independently discover, from a
  `roster` message, that they need to connect to each other at roughly the
  same time. Decided as: only the peer with the numerically **smaller** id
  initiates; the other side waits to receive. Prevents a duplicate
  `DataConnection` forming for the same pair; has no effect on anything
  else, since who dials first doesn't change the mesh's end state.
- **Transform (message)** — the `{type: "transform", position, cameraPivotQuaternion,
  cameraQuaternion}` message: a player's current position and facing
  direction, sent continuously at a throttled rate (~18Hz) for as long as a
  connection is open, unlike `identity`, which is sent once. See "Message
  envelope, identity, and transform sync."

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

## Mesh formation: how a new player learns about everyone (implemented)

The existing one-time-code UI is unchanged as the entry point — you still
connect to exactly one specific peer to join. `EntityComponentPeerMeshFormation`
(`entity components/peer_mesh_formation.js`, living alongside
`EntityComponentPeerConnection` on the "multiplayer" entity) handles the
rest:

1. Whenever a peer's own connection set changes — a connection opens *or*
   closes — it re-broadcasts `{type: "roster", peerIds: [...]}` to **every**
   currently-connected peer, not just to whichever one just joined. Compared
   against the last-broadcast set each frame so it's a no-op once the mesh
   is stable, not a resend-every-frame cost.
2. On receiving a `roster` message, for every id in the list that isn't
   already an open connection and isn't the receiver's own id, initiate
   `peer.connect(id)` — subject to the tie-breaker below.
3. This converges the whole group to full mesh, since every peer keeps
   re-announcing its own growing connection set to everyone it already
   knows, rather than only informing each peer once at the moment it joins.

**Why "once per newcomer" isn't enough — a real bug this project actually
hit, not a hypothetical:** the first implementation sent `roster` exactly
once, to each connection, the moment *that* connection opened. A stress
test — 5 tabs all connecting to the same hub within milliseconds of each
other — showed several pairs never discovering each other at all (not a
duplicate-connection race; a convergence gap). Cause: a peer that connected
to the hub *early* received its one-and-only roster message before the hub
had also connected to peers that joined a moment *later* — that snapshot
was permanently stale, and since nothing ever re-sent it, the early peer
never learned about the later ones. Re-broadcasting to *all* current
connections on every change (not just to the newcomer) closes this
completely: verified with the same 5-tab stress scenario across three
repeated runs, all converging to a full mesh every time.

**The tie-breaker (a separate, real correctness issue, decided up
front):** two peers who each discover the other from a `roster` message at
roughly the same time could both call `peer.connect()` on each other
simultaneously, opening two separate `DataConnection`s for the same pair.
Fixed by only letting the peer with the numerically **smaller** id
initiate; the larger id just waits to receive. Which side "wins" has no
lasting effect on the session — once the mesh converges, everyone ends up
directly connected to everyone regardless of who dialed first — so this is
purely about avoiding a duplicate connection, not a decision that matters
otherwise.

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
- `{type: "transform", position: {x, y, z}, cameraPivotQuaternion: {x,y,z,w},
  cameraQuaternion: {x,y,z,w}}` — a remote player's current position and
  facing direction. Originally sent as derived `yaw`/`pitch` scalars, which
  only worked because `cameraPivot` currently only ever rotates on Y and
  `camera` (its child) only ever rotates on X — extracting each object's own
  Euler component happened to fully capture the composition, but would
  silently break if that constraint ever loosened (e.g. roll added to
  either object). Switched to sending each object's actual `quaternion`
  instead: `EntityComponentRemotePlayerManager` composes them the same way
  the real rig produces its final view direction
  (`cube.quaternion.set(...cameraPivotQuaternion).multiply(new
  THREE.Quaternion(...cameraQuaternion))`, parent then child), so the remote
  cube's orientation stays correct regardless of how the local rig's
  rotation logic evolves. Cost: 8 floats instead of 2, not a concern for LAN
  bandwidth at ~6 players.

**Send rate:** throttle outbound `transform` messages to roughly 15–20/sec
per connection rather than once per render frame. LAN bandwidth isn't the
constraint here, but there's no reason to saturate every connection at 60Hz
either — this is a starting point to tune once actually measured, not a
hard commitment.

**Interpolation/smoothing** of a remote player's cube between received
`transform` updates, so it doesn't visually snap at whatever the send rate
ends up being, was deliberately deferred out of this original design (real
polish item, didn't block getting position/rotation sync working at all) —
now implemented, see `TODO.md` item 7 and `MATH_TRICKS.md`'s "Interpolation
alpha" section for the full design.

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
  `methodGetMessagesThisFrame()` — a **non-destructive** per-frame snapshot
  of received messages (moved into place once per frame by this component's
  own `methodUpdate()`), not a registrable callback, and not a destructive
  drain either — an earlier `methodDrainMessages()` was destructive (first
  caller each frame got everything, the next got nothing), which silently
  broke the moment a second sibling
  (`EntityComponentPeerMeshFormation`, needing `roster` messages) needed to
  read the same incoming batch that `EntityComponentRemotePlayerManager`
  already consumed for `identity`/`transform`. Still knows nothing about
  rosters, cubes, or what a `transform` message means — purely "here are my
  open pipes." Also owns a `beforeunload` handler that destroys the local
  `Peer` on tab close/navigate — see "Disconnect detection" below for why
  that turned out to matter.
- **`EntityComponentPeerConnectionUI`** (existing — unchanged in shape so
  far). Still just the code-entry/checkmark DOM described in
  `LAN_MULTIPLAYER_CONSIDERATIONS.md`, reading from
  `EntityComponentPeerConnection` via the normal sibling lookup. Showing
  more than one connection's state (a live connection-count indicator
  instead of a static checkmark, plus a collapse/expand toggle for the
  code-entry UI) is planned — see "Implementation plan: mesh formation"
  below, sub-step 7 — but not yet built.
- **`EntityComponentPeerMeshFormation`** (implemented). Owns the roster
  handshake described above: re-broadcasts `{type: "roster", peerIds}` to
  every current connection whenever its own connection set changes, handles
  incoming `roster` messages, and issues new `peer.connect()` calls (through
  `EntityComponentPeerConnection`, via sibling lookup) for ids it doesn't
  recognize yet — subject to the numerically-smaller-id tie-breaker. This is
  policy about *which connections should exist*, deliberately kept separate
  from `EntityComponentPeerConnection`'s job of *managing whatever
  connections already exist*. Registered before
  `EntityComponentRemotePlayerManager` on the "multiplayer" entity in
  `main.js` — harmless either way for this pair specifically, since both
  only *read* `EntityComponentPeerConnection`'s per-frame snapshot, but it's
  `EntityComponentPeerConnection` itself that must run first (registered
  first), so its own `methodUpdate()` populates that snapshot before either
  sibling reads it that frame.
- **`EntityComponentRemotePlayerManager`** (implemented). Owns
  `Map<peerId, Entity>` for remote players. Each frame, reconciles that map
  against `EntityComponentPeerConnection.methodGetConnectionIds()` to
  spawn/despawn a bare `Entity` per peer (despawning also removes any cube
  mesh from `scene` and the entity from `EntityManager` —
  `EntityManager.methodRemoveEntity()` didn't exist before this and was added
  for it), and reads `EntityComponentPeerConnection.methodGetMessagesThisFrame()`
  (non-destructively, alongside `EntityComponentPeerMeshFormation`'s own read
  of the same batch) to handle two message types: `identity` attaches the
  entity's
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
  sibling `EntityComponentCameraControllerFirstPerson` (which exposes
  `methodGetPosition()`/`methodGetCameraPivotQuaternion()`/
  `methodGetCameraQuaternion()` for this) to send `transform` messages to
  every open connection (via
  `EntityComponentPeerConnection.methodSendToAll`) at the throttled rate
  (~18Hz, via a `#secondsSinceLastSend` accumulator against
  `EntityManager`'s per-frame `timeDelta`, which is in seconds). The one
  component in this list that's about *outbound* local state rather than
  *inbound* remote/session state.

Four components, four separable concerns — transport, mesh-formation
policy, remote representation, and outbound broadcasting — each readable and
testable on its own, matching how the camera/player controller split already
works in this codebase.

## Peer mesh roster messages: performance concerns

Worth writing down precisely, since it's easy to assume "one more thing
checked every frame" is a new cost category when it isn't.

**How messages are checked — before mesh formation.** Already a per-frame
poll, not something mesh formation introduced. `EntityComponentRemotePlayerManager.methodUpdate()`
has always run once per frame (the ECS calls every component's
`methodUpdate()` every frame, unconditionally — same as the player
controller checking keys every frame, or the camera controller checking
mouse movement every frame; nothing in this engine is purely event-driven).
The one part that *is* genuinely event-driven, both before and after, is
the WebRTC layer itself: PeerJS's `conn.on('data', ...)` callback fires the
instant a message actually arrives and pushes it onto a queue
(`#pendingMessages`) — but *consuming* that queue has always been a
per-frame check for "anything new since last frame," never an immediate
on-arrival handler.

**How messages are checked — after mesh formation.** The only actual
change: there are now **two** per-frame consumers instead of one —
`EntityComponentRemotePlayerManager` (still checking for `identity`/
`transform`) and `EntityComponentPeerMeshFormation` (checking for
`roster`). Both are the same kind of check as before, just duplicated
across one more component.

**How messages are consumed — before mesh formation.** `EntityComponentPeerConnection.methodDrainMessages()`
(now removed) was destructive: it returned the pending messages and
cleared the buffer in the same call. Safe at the time, since exactly one
consumer ever called it.

**How messages are consumed — after mesh formation.** Had to change,
not just duplicate: with two consumers reading in the same frame, a
destructive drain would hand the whole frame's messages to whichever
component's `methodUpdate()` happened to run first and leave the other
with nothing (see "Entity component breakdown" above). Replaced with
`methodGetMessagesThisFrame()` — a **non-destructive** snapshot,
moved into place once per frame by `EntityComponentPeerConnection`'s own
`methodUpdate()`, that any number of siblings can read the same copy of.

**Performance cost — before and after: trivial, for the same reason both
times.** Every operation involved is `O(number of connections)`, and this
project's ceiling is ~6 players (5 connections per peer, at most). Concretely,
per frame: `methodGetConnectionIds()` allocates one small array from a
`Map`'s keys; `EntityComponentPeerMeshFormation` sorts it and compares it
against the last-known set (via `JSON.stringify` on an array of at most 5
short strings) to decide whether anything changed; both consumers loop over
a messages array that, most frames, is empty (`transform` sends at a
throttled ~18Hz against a ~60fps frame rate, so most frames carry zero new
messages per connection, and `roster`/`identity` are one-shot events, not
continuous). None of this changed in kind when mesh formation was added —
only the count of components doing this exact same class of cheap check
went from one to two, and swapping a destructive drain for a reference-copy
snapshot doesn't add a new complexity class either (still `O(1)` for the
handoff itself). This is the same order of cost as everything else already
running every frame in this engine — not something that would ever show up
as a measurable difference.

## Concern? Reading the same message on subsequent frame(s)

A natural question once messages are read from a per-frame snapshot instead
of a destructive drain: what stops a component from reading the *same*
message again on the next frame? And if it somehow did, would that actually
matter?

**What actually prevents it.** `EntityComponentPeerConnection.methodUpdate()`:

```js
this.#messagesThisFrame = this.#pendingMessages;
this.#pendingMessages = [];
```

This **replaces** the reference every frame rather than merging into it.
A given message exists in exactly one frame's snapshot: once frame *N+1*
arrives, `#messagesThisFrame` points at a brand-new array (usually empty),
and the array holding frame *N*'s messages is gone — unreachable, garbage.
Consumers don't cache it either: `EntityComponentRemotePlayerManager` and
`EntityComponentPeerMeshFormation` both call `methodGetMessagesThisFrame()`
fresh, inside their own `methodUpdate()`, every frame — so they only ever
see whatever is current *that* frame. This isn't a "mark as seen" scheme;
it's simpler than that. Old data is structurally gone by the next frame,
not tracked and skipped.

**Would a double-read actually be harmless, if it somehow happened
anyway?** Depends on the message type — not all three are equally safe, and
it's worth being honest about that rather than assuming uniform safety:

- **`identity`** — harmless. `methodApplyIdentity` already explicitly
  guards against reapplying: it checks whether the entity already has its
  `EntityComponentTestCube` attached and returns early if so.
- **`transform`** — harmless. Setting the same position/quaternion values
  twice in a row has no different effect than setting them once; there's no
  accumulation, only assignment.
- **`roster`** — **not actually safe**. `methodConnectToRemoteId`'s dedupe
  check only looks at `EntityComponentPeerConnection`'s `#connections` map,
  which is populated once a connection's `'open'` event fires — not the
  moment `peer.connect()` is called. Processing the same roster entry twice
  *before* the first connection attempt has finished opening would call
  `peer.connect()` a second time, creating two separate `DataConnection`s to
  the same peer — the same category of bug the tie-breaker (see "Mesh
  formation" above) exists to prevent, just triggered by local
  double-processing instead of two peers racing each other to connect.

This gap is currently unexercised — the replace-not-merge mechanism above
means it can't actually occur today — but it's a real asymmetry worth
knowing about rather than assuming all three message types would tolerate a
double-read equally well if the snapshot mechanism were ever changed again.

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

## Implementation plan: mesh formation (TODO.md item #2)

Written up before starting, per this project's usual design-before-code
habit. **Sub-steps 1-6 are done** (tie-breaker decided and implemented,
`EntityComponentPeerMeshFormation` built and wired in, all three test
stages passed — see each sub-step below for what was actually verified).
**Sub-step 7 (checkmark → connection-count indicator + collapse/expand UI)
is not yet implemented.**

1. **Settle the tie-breaker before writing any connect logic.** Two peers
   that each discover the other from the same `roster` message at roughly
   the same time could both call `peer.connect()` simultaneously, opening a
   duplicate connection for that pair — see "Mesh formation" above. Decided:
   only the peer with the numerically **smaller** id is allowed to initiate
   a new connection when both sides independently decide they need to
   connect to each other; the larger id just waits to receive the incoming
   `DataConnection`. Which side "wins" is arbitrary and doesn't matter for
   anything else — once mesh formation converges, every player ends up with
   their own direct connection to every other player regardless of who
   happened to dial first, so this is purely a tie-breaker to prevent a
   duplicate connection, not a decision with any lasting effect on the
   session.
2. **Build `EntityComponentPeerMeshFormation`.** ~~Sends `{type: "roster",
   peerIds: [...]}` once per newly-opened connection~~ — tried this first,
   matching `identity`'s one-shot-per-connection pattern, but a 5-tab stress
   test found it insufficient: a peer connected early never learns about a
   peer that joins later, since its one-and-only roster snapshot is frozen
   at whatever was true the moment *it* connected. Fixed by re-broadcasting
   `{type: "roster", peerIds: [...]}` to **every** current connection
   whenever the local connection set actually changes (tracked by comparing
   against the last-broadcast id set, so it's a no-op once stable, not a
   resend-every-frame cost) — see "Mesh formation" above for the full story.
   On receiving a `roster` message, for every id in the list that isn't
   already an open connection, isn't the receiver's own id, and passes the
   tie-breaker from step 1 (own id < the new id), calls
   `EntityComponentPeerConnection.methodConnectToRemoteId(id)` — that method
   already no-ops if a connection to that id exists, so redundant calls are
   harmless.
3. **Wire it into `main.js`** on the "multiplayer" entity, alongside
   `EntityComponentPeerConnection`/`EntityComponentPeerConnectionUI`/
   `EntityComponentRemotePlayerManager`.
4. **Regression-test with the existing 2-tab setup first — done.** Verified:
   exactly one connection each side, no extras triggered, and identity/
   transform sync (each side spawns exactly 1 remote entity) still worked
   unchanged.
5. **Test actual mesh formation with 3 tabs — done.** Connected A↔B
   directly, then C to A only — B and C were never given each other's code.
   Verified: B and C discovered and connected to each other automatically
   via the roster relay; all three ended up with exactly the other two as
   connections.
6. **Stress the tie-breaker — done.** 5 tabs all connecting to the same hub
   within milliseconds of each other, repeated across 3 runs. This is what
   actually surfaced the "once per newcomer isn't enough" bug described in
   "Mesh formation" above (a genuine convergence gap, not the
   duplicate-connection race step 1 was guarding against) — after the fix,
   all 3 repeated runs converged to a full 5-way mesh with no duplicates
   and nothing missing.
7. **Replace `EntityComponentPeerConnectionUI`'s green checkmark with a live
   connection-count indicator — done.** Once more than one connection is possible,
   a static checkmark no longer communicates anything useful. Instead: show
   a circled-digit character (`①`, `②`, `③`, ... — Unicode `U+2460` upward,
   consecutive code points, so `String.fromCodePoint(0x2460 + count - 1)`
   covers 1-10 cleanly, comfortably past the ~6-player target) matching
   `EntityComponentPeerConnection.methodGetConnectionIds().length` at that
   moment, re-evaluated every frame (not just once) so it updates live as
   players join or leave — unlike the old checkmark, which only ever had to
   flip between two fixed states. Same show/hide gating as today otherwise
   (hidden entirely at 0 connections, shown once ≥1).

   **Resolved:** the code-entry input/button don't hide *permanently* once
   connected (the old behavior, fine when 2 was the maximum but not once up
   to ~6 players are expected to join over time) — whether *my own* input is
   visible doesn't actually gate anything, since joining is driven by
   whoever isn't connected yet typing *someone else's* code into *their own*
   input, not by the state of mine. Instead they get their own collapse/
   expand toggle, mirroring the existing cubeHUD tuning panel's `v`/`^`
   mechanic (`tuningShowButton`/`tuningHideButton` in `main.js`) rather than
   inventing a new UI pattern — including that mechanic's implementation
   shape: **two separate, single-purpose buttons** (a `^` element and a `v`
   element, toggling which is visible) rather than one button that swaps its
   own label and click handler on each click. Two buttons keeps each one's
   behavior fixed and simple, and avoids the more error-prone alternative of
   re-binding (or branching inside) a single handler based on current state
   — and it's already the one working pattern this codebase has for exactly
   this kind of toggle, not worth a second, different way of doing the same
   thing.
   - A collapse button labeled `^` sits next to the input field and Connect
     button. By default (0 connections), all three — input, button, `^` —
     are visible.
   - Clicking `^` hides all three (input, button, and `^` itself) and
     reveals a separate expand button labeled `v` in their place.
   - Clicking `v` reverses it: shows input/button/`^` again, hides `v`.
   - **On making a connection** (the transition from 0 to ≥1 connections),
     the UI auto-collapses exactly as if `^` had been clicked — input,
     button, and `^` all hidden, `v` shown — so the join UI doesn't clutter
     the screen once you're already in a session. It stays manually
     re-expandable afterward via `v`, for as long as the session has room
     for more players, rather than hiding for good the way the old
     permanent-hide behavior did.

   Implemented in `EntityComponentPeerConnectionUI`
   (`entity components/peer_connection.js`): `#hasAutoCollapsedOnConnect`
   guards the auto-collapse so it fires exactly once (on the 0→≥1
   transition), not every frame — without that guard, a manual re-expand via
   `v` would get silently fought and snapped shut again on the very next
   frame, since `isConnected` stays true continuously afterward. The
   connection-count indicator itself is independent of expand/collapse
   state (shown whenever connected, same as the checkmark it replaces).
   Verified: manual `^`/`v` toggle works pre-connection; auto-collapse fires
   on first connection with the indicator correctly reading `①`; manually
   re-expanding after that stays expanded (doesn't get fought); and with 3
   tabs, all three converge to showing `②` once mesh formation completes
   their second connection each.

## Status

`EntityComponentPeerConnection` (multi-connection transport + `beforeunload`
graceful close), `EntityComponentPlayerNetworkSync` (outbound `identity` +
`transform` broadcasting), `EntityComponentRemotePlayerManager` (remote
cube spawn/skin/sync/despawn), `EntityComponentPeerMeshFormation` (roster
handshake, full mesh formation), and `EntityComponentPeerConnectionUI`'s
connection-count indicator + collapse/expand UI are all implemented — see
`entity components/peer_connection.js`, `player_network_sync.js`,
`remote_player_manager.js`, and `peer_mesh_formation.js`. Verified
end-to-end: each side's remote cube exactly matches the other player's own
randomly-rolled shape, base color, and dither color (2-player case); mesh
formation verified converging correctly with 3 tabs and stress-tested with
5 tabs joining simultaneously across 3 repeated runs, with no duplicate
connections and no missed pairs; the connection-count indicator/collapse-
expand UI verified working pre- and post-connection (including that a
manual re-expand after auto-collapsing isn't fought), and converging to `②`
on all 3 tabs once mesh formation completes. TODO.md item #2 is fully done.
Interpolating remote players' position/rotation between throttled
`transform` updates (`TODO.md` item 7) is also done — see `MATH_TRICKS.md`
for the interpolation math.
