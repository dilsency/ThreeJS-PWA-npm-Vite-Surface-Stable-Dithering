# Shader source and texture caching

Context: every `EntityComponentTestCube` instance (`entity components/test_objects.js`)
— world cubes, the ground, cubeHUD, and now remote-player cubes spawned
mid-session over PeerJS (see `MULTIPLAYER_TOPOLOGY_AND_SYNC.md`) — currently
redoes two async network-bound steps from scratch in its `methodInitialize()`,
every single time: fetching the dithering shader's `.vert`/`.frag` source, and
loading/decoding its texture image. This doc covers what can actually be
cached across instances without losing any per-cube customization, and why it
matters most for the newest use case: a remote player's cube only starts
being constructed once their `identity` message arrives mid-session, so any
latency in this path directly delays how soon a newly-connected player
becomes visible to you.

## What's currently repeated, and why

`test_objects.js` already declares module-level `let vertSource = null; let
fragSource = null;` at the top of the file — but a comment right above them
says this is deliberate: "we initialize these to null so the runtime-fetch
path is used by default." Because they're never actually populated,
`EntityComponentTestCube.methodInitialize()` always calls the async
`createFractalMaterial(opts)` (`shaders/Simple_FractalDithering.js`), which
internally `fetch()`es the shader source fresh, every time, for every cube.
Separately, `methodInitialize()` also calls `new THREE.TextureLoader().load(texUrl)`
fresh every time — no dedup across cubes requesting the same texture file.

Neither of these costs is huge in isolation, but they're real, and they stack:
a `fetch()` (even one that hits the browser's HTTP cache) still costs a
promise round trip, and decoding a texture image is genuine CPU work that
doesn't get any cheaper by having done it a moment ago for a different cube.
This was directly observed while testing remote-player cube spawning:
confirming a newly-created remote cube's mesh actually existed sometimes
required polling for several seconds.

## What can be cached without losing shape/color customization

The key fact making this safe: `shape`, `color1`, `color2`, `debugNormals`,
and `color1Texture`/`color2BlendTexture` are all wired as plain runtime
`uniform`s in the shader (`uShape`, `uColor1`, `uColor2`, `uDebugNormals`,
`uColor1UseTexture`, ...), branched with `if` inside the GLSL itself — not
baked into the shader source text via `#define` or string templating. The
*text* of `Simple_FractalDithering.vert`/`.frag` is byte-for-byte identical
regardless of what shape or colors a given cube ends up rendering. That means:

- **Shader source text is fully cacheable, no loss.** Fetch it once, reuse
  the same string for every subsequent cube. Concretely: populate
  `test_objects.js`'s already-declared `vertSource`/`fragSource` on the first
  successful load, then have subsequent `EntityComponentTestCube` instances
  call the already-existing `createFractalMaterialFromSources(vertSource,
  fragSource, opts)` — the synchronous alternative that's explicitly designed
  for "sources already in hand" (see `CLAUDE.md`) — instead of re-triggering
  `createFractalMaterial`'s internal fetch. Each cube still builds its own
  `opts` (its own shape/color1/color2/etc.), so nothing about per-cube
  appearance changes; only *how the GLSL text arrives* changes.
- **Texture image is fully cacheable, no loss.** There are only two known
  texture files in this project (`texture_checkerboard.png`,
  `texture_checkerboard_alphamask.png`), and the texture's alpha channel
  (the per-pixel dither mask, per `CLAUDE.md`) is applied identically
  regardless of which `color1`/`color2` a given cube uses — the texture is a
  shared dither-mask input, layered under independently-chosen colors, not
  something that encodes color itself. Caching one loaded `THREE.Texture` per
  filename (a small `Map<filename, THREE.Texture>`, or simply setting
  `THREE.Cache.enabled = true` to let Three's own built-in loader cache dedupe
  by URL) removes the repeat decode cost, with zero effect on what any given
  cube looks like.
- **The compiled GPU shader program is very likely already shared, for
  free, with zero code changes needed.** Checked directly in
  `shaders/Simple_FractalDithering.js`: only `opts.lighting` affects
  compile-time behavior (`defines: opts.lighting ? { USE_LIGHTING: '' } : {}`,
  plus `lights: !!opts.lighting`) — everything else customizable is a runtime
  uniform, not a define. Since every `EntityComponentTestCube` call site in
  this project currently passes `lighting:true` consistently, every cube
  already compiles to the *same* GLSL program, and Three.js's own internal
  `WebGLPrograms` cache already reuses a compiled program across `ShaderMaterial`
  instances that hash to the same defines/`lights` combination. Worth stating
  explicitly here so it doesn't get rediscovered or redundantly reimplemented
  later — this one is Three.js's own existing behavior, not something this
  project needs to build. (If a cube ever passes `lighting:false`, that
  *would* fork a second compiled program — still fine, just the boundary of
  what's shared.)

## What can't be shared

The actual `THREE.ShaderMaterial` *instance* — the object holding a specific
cube's `uShape`/`uColor1`/`uColor2` uniform values — can't be shared across
cubes with different appearances; a Material's uniforms are shared by every
mesh using that exact instance, so two differently-colored/shaped cubes need
two different Material objects regardless of caching. That's not a cost worth
avoiding, though: once the source text and texture are already in memory,
constructing a new `ShaderMaterial` from them is fast, synchronous, in-process
work — no network, no decode — so the fact that it still happens once per
cube doesn't reintroduce the delay this doc is about.

## Why this matters now specifically

Every cost described above already existed for the world's own cubes (ground,
cubeHUD, any decorative cubes), but it was invisible before now — they're all
constructed once, up front, during initial page load, before there's anyone
to notice a delay. `EntityComponentRemotePlayerManager` changed that: a remote
player's `EntityComponentTestCube` is deliberately deferred until their
`identity` message arrives, which can happen at any point *during* an
already-running session (see `MULTIPLAYER_TOPOLOGY_AND_SYNC.md`) — so its
async `methodInitialize()` latency is now something a player actually
perceives as "why didn't their cube show up right away," not just background
startup cost. The useful side effect once this is implemented: since the
world's own cubes already construct (and would warm the cache) well before
any second player connects, remote-player cubes would very likely find the
shader source and texture already cached by the time they're needed, and
skip straight to the synchronous path with no visible delay at all.

## Status

Implemented in `entity components/test_objects.js`: `getCachedShaderSources()`
memoizes the in-flight `Promise` from the new `loadFractalShaderSources()`
(`shaders/Simple_FractalDithering.js`), and `getCachedTexture(textureFile)`
memoizes one `Promise<THREE.Texture>` per distinct filename in a `Map`.
`methodInitialize()` now awaits both and calls the synchronous
`createFractalMaterialFromSources` — the old dead "raw import" heuristic
(three near-identical branches guessing whether `vertSource`/`fragSource`
were real source strings, which they never were, since those module
variables were always left `null`) was deleted entirely rather than kept
alongside the new caching path.

Verified: fetching the shader source and each texture file happens exactly
once regardless of how many cubes need them (checked via network request
interception across the world's ground/cubeHUD/decorative cubes at startup);
connecting a second player and spawning their remote cube triggers *zero*
additional shader/texture requests, since the world's own cubes already
warmed the cache before any peer connects; and shape/color1/color2 stay
fully independent per cube, confirmed by re-running the identity-sync
end-to-end check from `MULTIPLAYER_TOPOLOGY_AND_SYNC.md` — both directions
still matched exactly after this refactor.
