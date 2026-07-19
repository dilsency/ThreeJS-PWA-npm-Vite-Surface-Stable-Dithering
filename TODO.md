# TODO

Open items, roughly in the order they were raised. Each links to the doc with
the fuller context, where one exists.

## 1. Move the cubeHUD-ready `requestAnimationFrame` retry into a real Entity Component

`main.js`'s `applyDefaultPresetOnceCubeReady()` (added when preset "1" became
the startup default — see `HUD_CUBE_ORIENTATION_AND_TUNING.md`, "Live tuning
dev tool") polls via a raw `requestAnimationFrame` loop, checking
`componentCubeHUD.methodGetCube() == null` each frame outside the ECS's own
per-frame update mechanism entirely — it never goes through
`EntityManager`/`Entity`'s `methodUpdate()`, unlike everything else in this
codebase.

Flagged by the user as not fitting the ECS pattern. Proposed fix: rather than
polling from a bare closure in `main.js`, cubeHUD's "is my mesh actually
built yet" state should live on (or be queryable from) a real
`EntityComponent` — e.g. `EntityComponentTestCubeHUD` itself exposing a ready
signal, or a small dedicated component — so that whatever needs to react to
it (the tuning panel's default-preset application today, potentially other
things later) can get it via the normal `methodGetComponent` sibling lookup
and the ECS's own `methodUpdate()` cadence, instead of a parallel
`requestAnimationFrame` hookup living outside the ECS.

This is the same underlying debt already called out in
`TEMPORARY_DEV_TOOLS_VS_ECS.md` for the tuning panel as a whole (plain DOM/
closures reaching into cubeHUD directly, not through ECS) — this retry loop
is one more instance of it, not a separate problem. If/when the tuning panel
itself gets converted to a real `EntityComponent` per that doc's stated
rule, this should be folded into the same pass rather than fixed in
isolation first.

## 2. Scale multiplayer past 2 players (~6-player mesh formation) — done

`EntityComponentPeerMeshFormation` (`entity components/peer_mesh_formation.js`)
— the roster handshake that lets a newly-joined player converge to a full
mesh with everyone already in a session, rather than just the one peer whose
code they typed — is implemented and verified. See
`MULTIPLAYER_TOPOLOGY_AND_SYNC.md`'s "Mesh formation" and "Implementation
plan: mesh formation" sections for the full story, including a real
convergence bug found and fixed along the way (roster had to become
"re-broadcast on every connection-set change," not "send once per
newcomer," or peers who joined early never learned about ones that joined
later). Verified: 2-tab regression clean, 3-tab mesh formation converges
correctly with zero manual code exchange between the two non-initiating
peers, and a 5-tab simultaneous-join stress test converges with no
duplicates/missing pairs across 3 repeated runs.

**Sub-step 7 is also done**: `EntityComponentPeerConnectionUI`'s green
checkmark replaced with a live circled-digit (`①`/`②`/`③`...) connection-count
indicator, plus a `^`/`v` collapse/expand toggle for the code-entry UI
(auto-collapses once on first connection, manually re-expandable afterward
to invite more players). Verified: manual toggle works pre-connection;
auto-collapse fires exactly once on connecting and doesn't fight a manual
re-expand afterward; indicator converges to `②` on all 3 tabs once mesh
formation completes their second connection each.

This item is fully done. Remaining follow-up work is tracked separately as
item 7 below (interpolating remote players' position/rotation, since
`transform` is throttled but rendering isn't).

## 3. Send `camera`/`cameraPivot` quaternions instead of derived yaw/pitch for remote-player facing — done

Implemented. `EntityComponentCameraControllerFirstPerson` now exposes
`methodGetCameraPivotQuaternion()`/`methodGetCameraQuaternion()` (replacing
`methodGetYaw()`/`methodGetPitch()`, which had no other callers and were
removed). `EntityComponentPlayerNetworkSync` sends both quaternions in the
`transform` message instead of derived Euler scalars, and
`EntityComponentRemotePlayerManager.methodApplyTransform` applies them to
the remote cube via `cube.quaternion.set(...cameraPivotQuaternion).multiply(new
THREE.Quaternion(...cameraQuaternion))` — the same parent-then-child
composition that produces the real rig's actual view direction, rather than
reconstructing Euler angles. See `MULTIPLAYER_TOPOLOGY_AND_SYNC.md`'s
message envelope section for the updated payload shape.

Verified: rotated the client's camera via simulated mouse-look, independently
computed the expected composed quaternion from the client's own
`cameraPivot.quaternion`/`camera.quaternion`, and confirmed it matches the
host's view of the remote cube's quaternion exactly (bit-for-bit).

## 4. Match the HUD panel's background color to the main scene's background — done

Implemented in `main.js`. `scene.background` is now set once in
`initBareMinimum()`, derived from `getComputedStyle(canvas).backgroundColor`
(reading `index.html`'s CSS rule, `html,body,canvas#canvas{background-color:
#606000;}`) instead of never being set in JS at all — this is the one
authored value now; nothing hardcodes the hex a second time.
`componentPanelHUD` (`EntityComponentBackgroundPlane`) is constructed with
`color: scene.background` instead of falling back to its own hardcoded
`0x87ceeb` sky-blue default.

Along the way, found and fixed a real bug this depended on: `update()`'s
render loop set `renderer.autoClear = false` every frame (for the HUD
overlay pass) but never reset it back to `true` before the *next* frame's
world pass, so from frame 2 onward the world scene silently stopped
clearing color/depth at all — `scene.background` would have been a no-op
without this fix. What made it invisible before now: with nothing clearing
color and `preserveDrawingBuffer` left at its WebGL default (`false`), the
browser itself clears each frame's drawing buffer to transparent between
compositing updates, and the canvas's CSS `background-color` shows through
whatever's transparent — so it *looked* like the CSS color was "the
background" via an indirect, accidental path, not because anything was
actually clearing to it. Fixed by resetting `renderer.autoClear = true`
right before the world pass each frame, so it clears normally (using
`scene.background`) before the HUD pass turns `autoClear` back off.

Verified: `scene.background` and the panel's material color match exactly
(read back and compared); moving the camera around produces no smearing/
trail artifacts, confirming the world pass is genuinely clearing every
frame now, not just relying on the browser's own implicit clear.

## 5. Non-ECS instances in `main.js` worth converting

A pass through the current `main.js` looking specifically for behavior that
lives outside the ECS pattern (not going through an `EntityComponent`'s
`methodUpdate()`, or reaching into a component's owned objects directly
instead of via `methodGetComponent`/a broadcast message). Deliberately
excludes `init()`/`initBareMinimum()`/`initECS()` and the module-level
bootstrap variables (`scene`, `renderer`, `entityManager`, etc.) — that's
the scaffolding that *builds* the ECS in the first place, not entity
behavior sitting outside it, the same way a `main()` function isn't itself
a violation of whatever architecture it sets up.

1. **The entire "TEMP dev tool" tuning-panel block** (the `{}` block in
   `initEntityComponents()` right after `componentCubeHUD` is registered) —
   by far the largest concentration: `tuningContainer` and its show/hide
   buttons, `makeTuningInput`, `ensureCubeHUDShearHierarchy()`,
   `applyTuning()`, `applyShear()`, `applyPreset()`, `cubeHUDTuningPresets`,
   and the PointerLock-button reparenting are all plain DOM/closures reaching
   directly into `componentCubeHUD`/`componentPanelHUD` rather than through
   ECS. This whole block is already the explicit subject of
   `TEMPORARY_DEV_TOOLS_VS_ECS.md` (why it's a deliberate, temporary
   exception, and the rule for converting it if ever kept permanently); item
   1 above is the one specific piece of it (the ready-state retry) already
   called out separately. Not re-litigating whether to convert it here — just
   flagging it as the single biggest instance in the file.
2. **`computeCubeHUDLayout()` and its supporting constants** (`cubeHUDSize`,
   `cubeHUDBaseOffset`, `cubeHUDTiltFactor`, `HUDCubeHorizontalAlignmentEnum`,
   `HUDPanelYawBehaviorEnum`, the `panelInset*Px` values, etc.) — a
   substantial geometry function (corner-projection solves for alignment,
   yaw correction, panel fitting) living as a bare closure in
   `initEntityComponents()`, not owned by any component.
   `EntityComponentTestCubeHUD`/`EntityComponentBackgroundPlane` only ever
   receive its output as constructor params; nothing about the computation
   itself is reachable via `methodGetComponent`.
3. **The alignment-cycling button's click handler** (inside the tuning-panel
   block, but called out separately since it's the one handler that mutates
   state *outside* cubeHUD too) — re-invokes `computeCubeHUDLayout()` and then
   directly pokes `componentPanelHUD.methodGetPlane()`'s position/geometry
   and `cubeHUDOuterNode.position` from a raw closure, rather than through a
   sibling lookup or broadcast message.
4. **`resizeRendererToMatchDisplaySize()` / `updateWindowSize()`** — on
   window resize, sets `camera.aspect`/`cameraHUD.aspect` and calls
   `updateProjectionMatrix()` directly on the module-level `camera`/
   `cameraHUD` objects, outside any component. **Not a fit for
   `EntityComponentCameraControllerFirstPerson`**, though — despite touching
   `camera`, this is a game/viewport-level concern, not a player concern: it
   also has to resize `cameraHUD`, which belongs to the HUD overlay, not the
   player at all, so routing it through the player's own camera controller
   would give that component a reason to reach outside what it actually
   owns. Should be its own dedicated component instead (e.g.
   `EntityComponentViewportResize` or similar) that owns both cameras/the
   renderer for this one purpose, separate from player input/rotation
   entirely.
5. **`update()`'s render loop** (`renderer.render(scene, camera)` /
   `renderer.render(sceneHUD, cameraHUD)`, the `autoClear`/`clearDepth()`
   sequencing) — the actual per-frame render driver, called every frame
   outside `EntityManager.methodUpdate()`. Included for completeness, but
   flagged with a real caveat unlike 1-4 above: rendering the scene graph is
   arguably infrastructure rather than entity behavior (nothing here
   represents "a thing in the world"), so this may not be a genuine
   candidate at all - worth a deliberate decision rather than converting by
   default just because it's on this list.

## 6. Shared variables in `main.js` that should live in their own Entity Component(s)

Per the rule already established in `TEMPORARY_DEV_TOOLS_VS_ECS.md` ("if a
variable is needed by more than one entity component, that's a signal the
value's ownership belongs in its own entity component... not a bare local
that multiple, otherwise-unrelated components silently depend on") — a pass
through `main.js` for locals that are currently read by more than one
`EntityComponent`'s construction (or reached into by more than one
component's own logic), rather than owned by a single component and looked
up by the others via `methodGetComponent`. Likely candidates end up named
something like `EntityComponentSettings`/`EntityComponentInit`/
`EntityComponentLocalPlayerIdentity` — plural, separate components where the
shared values are conceptually unrelated to each other, not one grab-bag.

1. **`playerColorPaletteBody`/`playerColorPaletteDither` and
   `localCubeHUDShapeIndex`/`localPlayerColorIndex1`/`localPlayerColorIndex2`**
   — "local player identity," read by three different places:
   `componentCubeHUD`'s construction (resolves `color1`/`color2` from the
   palettes directly), `EntityComponentPlayerNetworkSync`'s construction
   (gets the raw rolled indices), and `EntityComponentRemotePlayerManager`'s
   construction (gets the raw palettes, to decode *other* players' indices).
   Best candidate for a real `EntityComponentLocalPlayerIdentity`-style
   component: owns the palettes and the once-rolled indices, exposes
   getters, and the three consumers above look it up instead of closing
   over the same `main.js` locals.
2. **`groundSize`/`groundPositionOffset`** (plus the derived
   `groundMinX`/`groundMaxX`/`groundMinZ`/`groundMaxZ`) — shared between the
   ground's own `EntityComponentTestCube` construction and the player-spawn
   randomization math (`localPlayerStartX`/`localPlayerStartZ`, feeding
   `entityA.methodSetPosition(...)`). Not yet a second component's
   constructor param, but exactly the same shape of problem: some
   `EntityComponentWorldLayout`-ish component could own the ground's real
   footprint and be queried by whatever eventually handles player spawning,
   instead of both derived from the same bare locals only because they
   happen to sit in the same function.
3. **cubeHUD's whole layout cluster** (`cubeHUDSize`, `cubeHUDBaseOffset`,
   `cubeHUDTiltFactor`, `cubeHUDTiltRadians`,
   `HUDCubeHorizontalAlignmentEnum`/`HUDPanelYawBehaviorEnum` and their
   current values, `panelInsetTopPx`/`panelInsetSidePx`) — read by
   `computeCubeHUDLayout()`, `componentCubeHUD`'s and `componentPanelHUD`'s
   construction, and (again) the tuning panel's `applyTuning()`/alignment
   button. Same cluster flagged in item 5.1/5.2 above from the "non-ECS
   closure" angle; this is the same debt, viewed as "shared state" instead
   of "shared code."
4. **Component instances captured and hand-carried to other entities'
   components**: `componentLightWorld` (created on `entityLight`, passed
   directly as `source:` into `EntityComponentLightManager` on the separate
   `entityLightHUD`), `componentCubeHUD` (passed as
   `targetReferencePoint:` to that same `EntityComponentLightManager`, and
   reached into throughout the tuning panel), `componentPanelHUD` (reached
   into by the alignment-cycle handler), and `componentPointerLockButton`
   (its button element reparented by the tuning panel) — all real
   `EntityComponent` instances handed across entity boundaries via plain
   closure capture rather than a cross-entity `methodGetEntitiesWithComponent`
   lookup, which is the mechanism this codebase already has for exactly this
   (see `EntityComponentPlayerNetworkSync`'s lookup of
   `EntityComponentPeerConnection` on the separate "multiplayer" entity for
   a working example already in the codebase).
5. **`camera`/`cameraPivot`/`cameraHUD`/`scene`/`sceneHUD`/`renderer`/
   `entityManager`** — the core module-level engine singletons, referenced
   directly by nearly every component constructor in the file. Named
   separately from 1-4 because these are a different category: not
   computed/derived state, but the base engine handles every visual or
   behavioral component fundamentally needs. Flagged for a deliberate
   decision rather than silently excluded (same treatment as item 5.5's
   render loop) — it's plausible these are simply infrastructure that
   should keep being passed by reference the way dependency injection
   normally works, not values that belong on a component. Full exploration
   of this specific question — pros, cons, and a cheap one-component
   experiment to test it before committing either way — is written up in
   `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`; still undecided. Item 10
   tracks the concrete mechanism that doc proposes (`methodGetEntityByName`
   + a named "EngineContext" entity).

## 7. Interpolate remote players' cube position and rotation(s) — done

Implemented in `EntityComponentRemotePlayerManager`
(`entity components/remote_player_manager.js`). `methodApplyTransform()` no
longer snaps the cube directly on each newly-received `transform` message —
it now composes the target quaternion (`cameraPivotQuaternion *
cameraQuaternion`, same composition as before) and records a per-peer
interpolation state (`#remoteTransformStates`: `startPosition`/
`targetPosition`/`startQuaternion`/`targetQuaternion`/`elapsed`), continuing
smoothly from wherever the cube is *currently displayed* rather than the
previous target if a new message arrives mid-interpolation. A peer's very
first `transform` still snaps immediately (nothing sensible to lerp in
from). A new `methodInterpolateRemoteTransforms()` step runs unconditionally
every frame (not just on frames a message arrives), advancing `elapsed` by
`timeDelta` and applying `cube.position.lerpVectors(...)`/
`cube.quaternion.slerpQuaternions(...)` at `alpha = min(elapsed/duration, 1)`,
`duration` defaulting to `1/18`s (matching `EntityComponentPlayerNetworkSync`'s
own send-throttle default, configurable via the same
`interpolationDurationSeconds` constructor param pattern). Interpolation
state is cleaned up in `methodDespawnRemotePlayer` alongside the entity
itself.

The full reasoning behind the alpha-ramp math (why it climbs smoothly from
0 to 1, the degenerate single-frame-jump edge case, why position needs only
`lerp` but rotation needs `slerp`, and why composing the two source
quaternions first then slerping the single result was chosen over
interpolating them separately) is written up in `MATH_TRICKS.md`'s
"Interpolation alpha" section. `npm run build` verified clean after
implementing.

## 8. Rename the ECS's same-entity messaging methods

1. **Done: `methodBroadcastMessage` → `methodSendMessageWithinEntity`,
   `methodRegisterInvokableHandler` → `methodRegisterMessageHandlerWithinEntity`**
   (`classes/ECS/entity.js`/`entity_component.js`, plus every call site —
   `camera_controller_first_person.js`, `test_objects.js` (×2), and the
   `methodSetPosition`/`methodSetRotation`/`methodSetRotations` senders
   in `entity.js` itself — docs updated too: `CLAUDE.md`,
   `ARCHITECTURE.md`, `TEMPORARY_DEV_TOOLS_VS_ECS.md`,
   `ECS_MESSAGING_DESIGN.md`, `NAMING_CONVENTIONS.md`). Purely a rename, no
   behavior change: states the same-`Entity`-only scope directly in the name
   instead of via "sibling," a metaphor that already caused real confusion
   earlier this session (see `NAMING_CONVENTIONS.md`'s "Why this came up").
   Also avoided any `.on(...)`-style naming for the handler-registration
   side, since this project already uses raw `.on('data', ...)` for
   PeerJS/WebRTC events and an ECS-level `.on(...)` too would blur that
   distinction.
2. **Rename `invokableHandlerName`/`invokableHandlerValue` — gated on
   comments, not just a rename.** Per the user's explicit condition, only do
   this paired with comments near the handler-related methods (the
   renamed-in-8.1 pair, plus registration call sites) that spell out what
   `invokableHandlerValue` actually is in each position — a **callback
   function** when passed to the handler-registration method, but **plain
   data** (`THREE.Vector3`/`THREE.Quaternion`/a plain object) when it's a
   field in the broadcast message object built by `methodSetPosition`/
   `methodSetRotation`/`methodSetRotations`. Don't shorten the names without
   those comments landing at the same time — see
   `NAMING_CONVENTIONS.md`'s "verbose on purpose" section for why the
   verbosity existed in the first place.

## 9. Add a cross-entity messaging shorthand method — done

Implemented as `methodSendMessageToEntitiesWithComponent(paramComponentName,
paramMessage, paramEntityNameToExclude)` on both `Entity`
(`classes/ECS/entity.js`) and `EntityComponent` (`entity_component.js`,
delegating to `this.#parent`). Per `ECS_MESSAGING_DESIGN.md`'s "cross-entity
case" section and `NAMING_CONVENTIONS.md`: this wasn't new capability (any
code already holding another entity's reference could call
`targetEntity.methodSendMessageWithinEntity(message)` directly), just a
convenience method folding (1) `methodGetEntitiesWithComponent`, (2) a loop
over the results, and (3) each one's own within-entity send into a single
call — filtered by component name, not an unconditional "message every
entity" version. `npm run build` verified clean after adding it.

Not yet called from any real component — nothing in this codebase has a
concrete cross-entity messaging need yet (the attack/Health scenario that
motivated it in `ECS_MESSAGING_DESIGN.md` remains hypothetical), so this
exists ahead of a use case rather than being exercised by anything today.

## 10. `methodGetEntityByName` + a named "EngineContext" entity for bare-minimum Three.js state

Not yet implemented — still an open design question, not a decision. Full
reasoning in `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`; this item tracks
the concrete mechanism that doc proposes as an answer to item 6.5's
"flagged for a deliberate decision" cluster (`scene`/`sceneHUD`/`renderer`/
`camera`/`cameraPivot`/`cameraHUD`), rather than duplicating that item.

**The proposal:** add `EntityManager.methodGetEntityByName(paramName)` —
delegated through `Entity`/`EntityComponent` the same way
`methodGetEntitiesWithComponent` already is — and build an
`EntityComponentEngineContext` holding the bare-minimum Three.js objects,
attached to a single entity given a fixed, predictable name (`"EngineContext"`
or `"BareMinimum"`) instead of an auto-generated one. Every component that
currently receives `scene`/`camera`/etc. as constructor params would instead
fetch them via `this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")`.
Resolves the mismatch between `methodGetEntitiesWithComponent` (built for
filtering an unknown/dynamic *set* of entities) and a resource that's
known-unique and known-permanent for the app's entire lifetime — no
candidate list, no ambiguity to resolve. Real precedent for the idiom:
Three.js's own `Object3D.getObjectByName`.

**Also add matching shorthand getters on `EntityComponent`** —
`methodGetScene()`/`methodGetSceneHUD()`/`methodGetRenderer()`/
`methodGetCamera()`/`methodGetCameraPivot()`/`methodGetCameraHUD()` — each
composing the same `methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")?.methodGetX()`
chain internally, so consumers call e.g. `this.methodGetScene()` directly
rather than repeating that chain (and the two literal name strings) at
every call site. Worth building alongside the lookup itself rather than
waiting for repetition to justify it, since nearly every component needs at
least one of these — see `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s
"Convenience getters" section for the full reasoning (why `EntityComponent`
specifically, why not cached internally, and the DRY argument for
centralizing the name strings in one place).

**The "almost like a Singleton" nuance, worth deciding explicitly:** unlike
a classic Singleton (which *enforces* its own uniqueness — a private
constructor plus a static accessor that makes a second instance impossible
to create), nothing here would actually enforce that only one
`"EngineContext"`-named entity ever exists. `EntityManager.methodAddEntity`
doesn't check for name collisions today, for any entity — `"player"`,
`"sun"`, `"multiplayer"`, etc. are already unique purely by convention/
discipline, not by any runtime guard, and `methodGetEntityByName` as sketched
would just return the first match, same as `Object3D.getObjectByName`.
Given how central and singular this one entity is meant to be, worth
deciding during implementation whether it deserves an actual safeguard
(e.g. `methodAddEntity` warning/throwing on a duplicate name, or
`methodGetEntityByName` asserting exactly one match instead of silently
taking the first) — or whether relying on the same informal
unique-by-convention approach already used everywhere else in this ECS is
consistent and good enough, and a real enforcement mechanism would be
solving a problem that has never actually occurred in this codebase.

**Decided: give EngineContext its own dedicated init step** — a new
`initEngineContext()` function, called in `init()` between
`initBareMinimum()` and `initEntityComponents()`, rather than just being
the first few statements inside `initEntityComponents()` itself. Since this
ECS's init pipeline is fully synchronous (`EntityManager.methodAddEntity`/
`Entity.methodAddComponentWithName` both call `methodInitialize()`
immediately, no deferred phase), ordering is entirely determined by literal
statement order in `main.js` — a dedicated step just makes that ordering
guarantee visible at `init()`'s own top-level call sequence instead of
relying on a future reader noticing it. See
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Ensuring EngineContext
initializes before everything else" section for the full reasoning,
including two related points still open for consideration (not decided):
keeping `EntityComponentEngineContext` itself strictly synchronous (no
async `methodInitialize()`), and whether the six shorthand getters should
`console.error` rather than silently return `undefined` if `EngineContext`
isn't found yet.

**Before converting every consumer:** try the cheap one-component
experiment from `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md` first (e.g.
convert just `EntityComponentDirectionalLight` for the world sun, or the
ground's `EntityComponentTestCube`) to confirm the lookup/ordering actually
works in practice and that the resulting code reads better, before deciding
whether to mechanically repeat it for every other bare-minimum consumer.
