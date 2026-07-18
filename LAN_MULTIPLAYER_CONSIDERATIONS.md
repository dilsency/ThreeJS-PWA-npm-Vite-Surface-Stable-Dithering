# LAN multiplayer — considerations so far

Status: decisions below are made for a two-phase plan; the phase-1 PeerJS
pairing (one-time code, two players) is implemented and verified — see
`entity components/peer_connection.js`. For scaling that connection past two
players — topology (full mesh vs. host-relay), how a new player discovers
everyone already in a session, and how position/facing-direction gets synced
once connected — see `MULTIPLAYER_TOPOLOGY_AND_SYNC.md` instead; this doc
stays scoped to discovery/signaling (how two players first find and connect
to each other), not what happens after.

## The goal (long-term)

Seamless, LAN-only multiplayer: two people on the same WiFi should see each other
appear automatically the moment the second person loads the game — no room codes,
no manual pairing, no special input from either player.

That full goal turned out to need either a second external service stacked on top
of PeerJS (for browser-based auto-matchmaking) or a native app (for true
zero-extra-service broadcast discovery) — see below. Decision: **pursue the
native PC app as the real long-term vehicle for this goal**, and use a much
simpler browser-based version first, explicitly *not* seamless, purely to get
the actual multiplayer sync mechanics built and tested quickly.

## The core constraint: browsers can't do LAN discovery

This shaped every option below, so it's worth stating plainly: a web page has no
API for discovering other devices on the local network. No mDNS/Bonjour access, no
raw UDP broadcast/multicast, no listening sockets. This is a deliberate, long-
standing security boundary of the web platform, not a gap waiting for a clever
workaround — a "Network Service Discovery API" (mDNS/DNS-SD for the web) was
proposed around 2012–2013 and rejected by browser vendors on exactly these
grounds. The trend since has moved further in that direction: Chrome's ongoing
"Private Network Access" work is adding *more* friction (CORS preflight checks,
eventually permission prompts) before a public HTTPS page can even talk to a
private IP at all, let alone discover one blindly.

Game consoles (e.g. Nintendo Switch local wireless play) and native PC games solve
LAN discovery via UDP broadcast — "I'm hosting a game" blasted on the subnet, with
other devices passively listening. That works because native apps get raw socket
access from the OS. Browsers deliberately withhold that from arbitrary websites
(otherwise any website could silently probe every device on your home network on
page load).

## What is feasible: WebRTC for the actual gameplay traffic

Once two browsers know about each other, `RTCDataChannel` gives a real
peer-to-peer connection. On a LAN, that connection goes directly machine-to-
machine — no relay, no internet round-trip — so gameplay state (positions,
rotations, whatever gets synced) stays exactly as local as intended.

## The remaining gap: signaling

WebRTC does not specify how the initial handshake (SDP offer/answer + ICE
candidates — a few KB of text) gets from one browser to the other. That exchange
needs *some* rendezvous point reachable by both browsers before the direct
connection can be established. Three options were considered:

### 1. External relay via PeerJS

**PeerJS** wraps WebRTC and ships a free public broker (`0.peerjs.com`) built
exactly for this: anonymous, no account, no API key, no cost.

```js
const peer = new Peer(); // connects anonymously to PeerJS's public cloud broker
peer.on('open', (myId) => { /* got a random ID */ });
peer.on('connection', (conn) => { /* someone connected to us */ });
```

That gives the WebRTC connection/data-channel layer for free, with zero signup —
but it's only "connect two *known* IDs." It has no built-in matchmaking (the
public broker doesn't let clients list who else is connected, deliberately, for
the same abuse-prevention reason browsers don't expose LAN discovery). Getting
from "connect two known IDs" to "automatically pair people on the same WiFi"
needs one of:

**1a. Manual one-time code (chosen for the v1 browser build).** The "host"
player's `Peer` ID (or a short code derived from it) is shown on screen; the
joining player types/pastes it in, and calls `peer.connect(code)`. Zero accounts
anywhere, zero extra infrastructure beyond PeerJS's already-free public broker —
just not automatic. This is the deliberate, accepted tradeoff for now: it lets
the actual multiplayer sync (the ECS networking components, state
reconciliation, etc.) get built and tested immediately, without first building or
depending on any matchmaking layer. The web version stays explicitly a testing
tool under this plan, not the seamless experience described in "the goal."

**1b. Automatic public-IP pairing (deferred, not part of the v1 plan).** Group
waiting clients by the **public IP address a relay sees them connect from** —
devices on the same home WiFi share their router's public IP, so this pairs
"people on this WiFi" with no manual step. The catch that ruled this out for now:
PeerJS's public broker doesn't do this grouping itself, so it needs a *separate*
small matchmaking service (e.g. Firebase Realtime Database, or a self-hosted
broker on a free-tier host) to track who's waiting.

Concretely, what Firebase specifically would have been used for: a tiny
realtime key-value store sitting *alongside* PeerJS, not replacing it. The flow
would have been something like:

1. Each client writes a small record — its PeerJS ID, a timestamp, and its own
   detected public IP — to a `waiting/` path in Firebase (Realtime Database or
   Firestore).
2. Each client also subscribes to a realtime query for *other* `waiting/`
   entries matching its own public IP. Firebase's realtime listeners (not
   polling) mean the moment a second device on the same WiFi writes its entry,
   the first device gets pushed that update instantly.
3. On a match, each side reads the other's PeerJS ID from that record and calls
   `peer.connect(otherPeerId)` — at which point Firebase's job is done and the
   actual connection/gameplay traffic is all PeerJS/WebRTC, exactly as in 1a.
4. Security rules would need to scope reads so a client can only query entries
   matching *its own* public IP, not enumerate every waiting player globally —
   otherwise the matchmaking data itself becomes a way to see who's currently
   waiting to play, from anywhere.

Worth noting this likely wouldn't have stopped at just one extra service either:
a browser client doesn't inherently know its own public IP (Firebase's client
SDK doesn't expose the caller's IP to the caller), so step 1 would probably need
either a dedicated IP-echo lookup (e.g. a call to a service like `ipify` — a
*third* external dependency) or reusing the public ("server reflexive") address
a STUN server already reveals during ordinary WebRTC ICE gathering (STUN is at
least already inherent to how WebRTC establishes connections, so it's more
"infrastructure already in the mix" than "a new service," but it's still another
moving part). Either way, this is exactly the "stacking" the decision below
rejects — the objection was never about accounts or cost (PeerJS's own broker
needs neither), it's specifically **not wanting to depend on a second external
service on top of PeerJS**, and this Firebase-based approach could easily have
needed a third. That's exactly why the native PC app (below) became the real
target for the seamless experience instead: it gets automatic discovery with
*zero* external services of any kind, rather than trading one dependency for two
or three.

**Tradeoff (1a vs. native app):** works in any browser, zero install, right now —
at the cost of not being seamless (one manual code entry per session).

### 2. Local companion process (considered, not chosen)

One player ("host") runs a small local server; the other player's plain browser
tab would need to discover it via **subnet-scanning `fetch()`** across the likely
local IP range (e.g. `192.168.1.1`–`.254`) at a fixed port, since it can't listen
for a broadcast. This can work today, but:

- Requires the host's local server to send explicit CORS headers permitting the
  GitHub Pages origin.
- The host will very likely get an OS firewall prompt the first time the server
  starts listening.
- Relies on browsers continuing to permit public-page-to-private-IP `fetch()` at
  all — exactly the behavior Chrome's Private Network Access work is tightening.
  Works now; not guaranteed to keep working without changes.
- Asymmetric setup burden (only the "host" installs something) and meaningfully
  more code to build/maintain (a real server, cross-platform packaging so the
  host doesn't need Node installed, subnet-scan logic).

**Tradeoff vs. option 1:** keeps 100% of traffic (including the handshake) inside
the LAN, at the cost of setup asymmetry, more code, and long-term fragility as
browser security policy keeps tightening in this exact area.

### 3. Full native app (Electron/Tauri) — chosen as the long-term direction

A native shell gives real OS-level socket access, which removes the whole
matchmaking problem rather than working around it: no signaling, no relay, no
external service of any kind, anywhere. This is the reason it won out over
pushing further on browser-based auto-pairing (1b) — that path's only way to get
"automatic" was to stack a second external service on top of PeerJS, which is
explicitly off the table, whereas the native app gets genuine automatic discovery
with *zero* external dependencies at all — not even PeerJS.

Concretely:

- **Electron**: the renderer (Three.js/web code) doesn't get raw sockets
  directly; Node's `dgram` module lives in the **main process**, which opens a
  UDP socket, enables broadcast, and periodically sends/listens for a small
  "here I am" packet on the subnet. The discovered peer's IP is handed to the
  renderer via `contextBridge`/`ipcRenderer`.
- **Tauri**: same shape, but the native side is Rust (`std::net::UdpSocket`),
  exposed to the frontend via `invoke`/events. Tauri bundles are much smaller (no
  bundled Chromium; uses the OS's native WebView) at the cost of that native-side
  code being Rust rather than JS.
- Once two machines know each other's IP, gameplay sync can ride that same UDP
  socket, or a second dedicated one — a direct LAN connection, no NAT traversal
  needed since there's no NAT in the way locally.

**Real friction points, so this isn't oversold:**
- A one-time OS firewall prompt on *both* players' machines (discovery is
  symmetric here, unlike option 2's single "host") the first time each app opens
  a listening socket.
- Distributing an unsigned build triggers "Unknown publisher"/SmartScreen on
  Windows and is blocked by Gatekeeper by default on macOS (a right-click-to-open
  workaround exists). Proper code signing costs real money (a certificate, or
  Apple's $99/year developer program) — this is the native-app equivalent of a
  recurring cost, though entirely skippable if both players are fine clicking
  through a warning once.
- Broadcast discovery assumes a normal home-router subnet; it won't cross VLANs
  and fails on networks with client/AP isolation enabled (common on guest WiFi,
  some mesh systems) — a limitation inherent to *any* same-network discovery
  approach, not specific to this implementation.

This does **not** require discarding the PeerJS-based v1 implementation — see
"Future path" below for how the two coexist.

### Nintendo Switch — considered and ruled out as a near-term target

Switch development requires being a registered/licensed Nintendo developer using
the proprietary NintendoSDK under NDA, plus passing certification before anything
reaches a retail console or the eShop — there's no open toolchain path. Three.js
has no Switch export target (unlike Unity/Godot/Unreal, which do, for licensed
developers); none of this project's JS/WebGL code would run there. An unofficial
homebrew scene exists via console exploits, but that requires a modified console
and sits outside Nintendo's terms of service, so it isn't a real distribution
path to plan around. Bottom line: a Switch version would be a from-scratch
project in a different engine, where at best today's design decisions (the ECS
pattern, the shader/dithering approach — this project already has precedent for
porting shader concepts across engines, from the Unity HLSL source into Three.js
GLSL — and the general "sync via broadcast messages" networking shape) transfer,
not any of today's code.

### Android — much closer to the PC-app case than the Switch case

Unlike Switch, Android is an open platform with official, lightweight paths for
turning an existing web app into something installable, and none of them require
rewriting the Three.js/WebGL/ECS code:

- **PWA install, already works today.** This project already has a `manifest.json`
  (`display: "standalone"`, icons, `start_url`) and a service worker, which is all
  Chrome on Android needs to offer "Add to Home Screen" — an installed icon that
  launches full-screen, no browser chrome. Zero extra work; this already exists.
- **Trusted Web Activity (TWA).** Google's official way to wrap a PWA into a real,
  Play Store-publishable APK/AAB. A TWA loads the already-deployed GitHub Pages
  URL full-screen via Chrome Custom Tabs under the hood — no bundling, no code
  changes. Tooling is official and mature: **Bubblewrap** (Google's CLI) or
  **PWABuilder** (generates Android/iOS/Windows packages from a PWA manifest).
  Lighter than Electron/Tauri since it doesn't bundle a Chromium copy — it reuses
  whatever Chrome is already on the device.
- **Capacitor** (or Cordova). The Android/iOS equivalent of Electron/Tauri: wraps
  the web app's assets into a native WebView-based shell, bundled into the app
  rather than loaded from a URL (works offline, allows native plugins). This is
  the path that matters for the LAN-discovery story below.

WebGL2 (this project explicitly requires a WebGL2 context) has been solid in
Android's Chrome/WebView for years, so rendering isn't a real risk.

**Would it require starting over? No.** This is much closer to the Electron/Tauri
case above than to the Switch case: TWA/Capacitor wrap the *existing* deployed web
app rather than replacing it with a different engine's rewrite.

**What genuinely would need work, independent of packaging:** the current input
scheme (keyboard WASD/arrows, mouse via Pointer Lock) has no touchscreen
equivalent — a virtual joystick / drag-to-look scheme would need to be built for
this to be playable on a phone at all. That's a UX gap true of the plain website
on an Android browser today, not something specific to wrapping it as an app.

**LAN discovery on Android, specifically:** a TWA gets no capabilities beyond what
Chrome already exposes, so the PeerJS/WebRTC approach carries over completely
unchanged. Capacitor, like Electron/Tauri, *can* ship native plugin code alongside
the WebView — so the same progressive-enhancement discovery strategy described
below (native broadcast when available, PeerJS/WebRTC fallback otherwise) applies
to a Capacitor-wrapped Android build too. One Android-specific wrinkle: apps that
want to receive WiFi multicast/broadcast traffic need to explicitly acquire a
`WifiManager.MulticastLock`, since Android normally filters that traffic to save
battery — a well-documented API, not a platform-level blocker like the browser
sandbox is.

## Decision: two phases

**Phase 1 (v1, starting now): PeerJS in the browser, with a manual one-time
code (option 1a).** Explicitly not seamless, not inputless — the joining player
types in a code. Chosen anyway because it needs zero accounts, zero extra
infrastructure, and no native app work, so it's the fastest way to get the actual
multiplayer sync mechanics (ECS networking components, state sync/reconciliation)
built and tested against a real second player. It's a testing tool, not the
end-state described in "the goal."

**Phase 2 (later): the native PC app (option 3), with native broadcast
discovery.** This is the real vehicle for "the goal" as originally stated —
automatic, zero manual input, zero accounts. Per "Future path" below, this
doesn't discard phase 1's work; it adds a better discovery path alongside it.

## Phase 1 plan: the one-time code UI

**Approach A chosen** over an explicit Host/Join button pair: symmetric, no
up-front role decision. The moment the page loads, a short code is generated and
shown persistently on screen (alongside a brief "connecting…" state until PeerJS
confirms the ID with its broker), next to an input box + button for entering the
*other* player's code. Whichever human types is a real-world decision between the
two players, not something the UI forces a choice about. A fresh code is
generated every page load — this is session-scoped, not any kind of persistent
identity or account.

Code generation mechanics: a short, human-typeable ID (not PeerJS's default
UUID-style one) is generated client-side and passed to `new Peer(shortCode)`.
Since PeerJS's public broker is one global namespace shared by everyone using it
(not scoped to a LAN at all), a short code can collide with someone else's
in-progress session — PeerJS surfaces that as an `unavailable-id` error, handled
by generating a new random code and retrying.

**Split into separate entity components**, following the existing Input-vs-logic
split already used elsewhere in this codebase (e.g.
`EntityComponentCameraControllerFirstPersonInput` /
`EntityComponentCameraControllerFirstPerson`, `EntityComponentPlayerControllerInput`
/ `EntityComponentPlayerController`). Implemented in
`entity components/peer_connection.js` as `EntityComponentPeerConnection` (owns
the `Peer` instance/lifecycle, generates/retries the short code, exposes
connection state for other components to read/react to, no DOM/UI of its own —
currently using a hardcoded fake id, with the real PeerJS implementation written
out but commented out until PeerJS is actually added as a dependency; see
`DEPENDENCY_LOADING_CDN_VS_NPM.md` for that decision) and
`EntityComponentPeerConnectionUI` (owns the plain DOM elements — a label showing
the local code, an input + button for entering the remote code — reading from
`EntityComponentPeerConnection` rather than owning a `Peer` itself, mirroring how
`EntityComponentButtonPointerLock` in `entity components/test_objects.js` already
builds a plain DOM button and appends it to `document.body`; named "...UI" rather
than "...HUD" to avoid confusion with this project's existing `sceneHUD`/
`EntityComponentTestCubeHUD` terminology, which refers to the separate Three.js
overlay scene, not a plain DOM overlay).

**Browser-only visibility.** This code-entry HUD is specifically the "browser
strategy" half of the swappable `NetworkDiscovery`-style abstraction described in
"Future path" below — once a native PC build exists (native broadcast discovery,
phase 2), there is nothing to type and no code to show, so this HUD must not
appear there at all. This should be a decision made once at startup about
whether to *mount* the component in the first place, not a CSS visibility toggle
on an otherwise-active component. Detection mechanism: check for a native bridge
global that only exists inside the wrapped shell (e.g. an `window.electronAPI`
exposed by an Electron preload script, or Tauri's `window.__TAURI__`) — its
presence means "running inside the native shell, skip this component entirely";
its absence means "plain browser, mount it as normal."

## Future path: intermingling PeerJS with native sockets (Electron/Tauri, Capacitor)

If/when this becomes a wrapped native PC app (Electron/Tauri) or a wrapped Android
app (Capacitor), the plan is the same in both cases — **progressive enhancement,
not a rewrite**:

- Electron, Tauri, and Capacitor all embed a full browser engine, so the existing
  Three.js code, the ECS, WebRTC, and the PeerJS client all keep working unchanged
  inside the native shell.
- The native shell additionally exposes real socket access (Node's `dgram` in
  Electron; a Rust-side UDP socket surfaced to the frontend in Tauri; a native
  Java/Kotlin plugin talking `WifiManager`/multicast sockets in Capacitor), which
  can implement genuine LAN broadcast discovery — the same mechanism consoles use
  — with no signaling step required at all.
- Architecturally, this fits the existing ECS pattern as a swappable discovery
  strategy: a small abstraction (e.g. a `NetworkDiscovery`-style
  entity component) with two implementations — one using PeerJS/WebRTC signaling
  (used when running as a plain web page, where native sockets aren't available),
  one using native UDP broadcast (used when running inside a native shell,
  detected at runtime). Gameplay sync itself (whatever ends up moving player state
  around once two peers are connected) stays the same either way; only *how the
  two peers find each other* differs by environment.
- Net effect: nothing built for the web/PeerJS version becomes dead code when a
  native version arrives — each native wrapper gets a better discovery path *in
  addition to*, not instead of, the one already built, and the plain web version
  keeps working for anyone who doesn't install a native app.
