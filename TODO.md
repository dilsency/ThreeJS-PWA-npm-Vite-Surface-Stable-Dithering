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
2. **`computeCubeHUDLayout()` and its supporting constants — done.** Moved
   into `EntityComponentContextHUDLayout` (`entity components/context/context_hud_layout.js`),
   attached to the "hudPanel" entity (`entityHUD`) *before*
   `EntityComponentTestCubeHUD`/`EntityComponentBackgroundPlane`, since both
   need its output as constructor params — `main.js`'s own
   `computeCubeHUDLayout(alignment)` function is now
   `componentHUDLayout.methodComputeLayout(alignment)`, and the constants it
   depended on (`cubeHUDSize`, `cubeHUDBaseOffset`, `cubeHUDTiltFactor`, the
   `panelInset*Px` values, etc.) are now private fields on the component,
   with `methodGetSize()`/`methodGetTiltFactor()`/`methodGetTiltRadians()`
   getters for the two remaining external consumers
   (`EntityComponentTestCubeHUD`'s own constructor params, and the tuning
   panel's `applyTuning()`). `HUDCubeHorizontalAlignmentEnum`/
   `HUDPanelYawBehaviorEnum` are now named exports from the component's file
   rather than `main.js` locals. This also completed `cameraHUD`'s
   conversion in item 10/`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`, since
   this function was `cameraHUD`'s only real consumer — the component fetches
   and caches it via `this.methodGetCameraHUD()` in its own
   `methodInitialize()`, same pattern as every other per-call-not-per-frame
   `EngineContext` consumer. Verified via `npm run build`, screenshots
   confirming cubeHUD/the panel render identically to before the move, and
   cycling the tuning panel's alignment button through all three states
   (LEFT/RIGHT/CENTER) with the panel/cube repositioning correctly and zero
   console errors each time.
3. **The alignment-cycling button's click handler** — now calls
   `componentHUDLayout.methodComputeLayout(...)` (item 5.2, above) instead
   of a bare function, but is otherwise unchanged: still directly pokes
   `componentPanelHUD.methodGetPlane()`'s position/geometry and
   `cubeHUDOuterNode.position` from a raw closure inside the tuning-panel
   block, rather than through a sibling lookup or broadcast message.
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
   `localCubeHUDShapeIndex`/`localPlayerColorIndex1`/`localPlayerColorIndex2`
   — done.** Moved into `EntityComponentContextLocalPlayerIdentity`
   (`entity components/context/context_local_player_identity.js`, `TODO.md`
   naming per `NAMING_CONVENTIONS.md`'s "Entity-component naming families"
   section), attached to its own dedicated entity built by a new
   `initLocalPlayerIdentity()` step (same "own top-level init step" pattern
   as `initEngineContext()`, since all three consumers below need it at
   their own construction time). All three consumers now self-lookup
   `EntityComponentContextLocalPlayerIdentity` themselves — `main.js` no
   longer resolves it on anyone's behalf, and the local var that used to
   fetch it there was removed. `EntityComponentPlayerNetworkSync` and
   `EntityComponentRemotePlayerManager` — both already single-purpose,
   project-specific classes that already do their own cross-entity lookups
   for `EntityComponentPeerConnection` — self-lookup it directly in their
   own `methodInitialize()`. `componentCubeHUD` (`EntityComponentTestCubeHUD`)
   went through an extra step: since `EntityComponentTestCube` (its
   superclass, reused for the ground/sun's-cube/remote-player-cubes too)
   resolves `shape`/`color1`/`color2` from constructor params into private
   fields a subclass can't reach, `EntityComponentTestCube` gained three
   overridable hooks (`methodGetShape()`/`methodGetColor1()`/
   `methodGetColor2()`, mirroring the existing `methodGetTargetScene()`
   hook), which `EntityComponentTestCubeHUD` overrides to self-lookup
   `EntityComponentContextLocalPlayerIdentity` in its own
   `methodInitialize()` instead. See
   `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Self-lookup vs.
   main.js-resolves-and-passes" and "Player-identity hooks on
   EntityComponentTestCube" sections for the full reasoning, including why
   a separate `EntityComponentTestCubePlayer` superclass was rejected
   (`EntityComponentTestCubeHUD` has exactly one instantiation anywhere in
   the codebase, so there's no second consumer to justify the extra layer).
   Also dropped a stale comment claiming the two color indices were
   "guaranteed distinct" via rejection sampling — no such sampling was ever
   implemented, and the requirement itself is obsolete now that the two
   indices index into two entirely separate palettes (body vs. dither), not
   the same one. Verified via `npm run build`, a screenshot confirming
   cubeHUD still resolves a valid color/shape, and a 2-tab PeerJS test
   confirming identity messages (shape/color indices) still exchange
   correctly end-to-end.

   **Naming note — resolved:** `main.js`'s `initLocalPlayerIdentity()` was
   renamed to `initContextComponents()`, generalized ahead of actually
   needing it, so future `EntityComponentContext*` components (e.g. item
   6.2's `EntityComponentContextWorldLayout`) that need this same "own
   step, before `initEntityComponents()`" treatment get added inside this
   same function rather than each earning a narrowly-named `initXxx()` of
   their own. `initEngineContext()` stays separate — it already has its own
   established name/rationale, and folding it in wasn't part of this
   rename.
2. **`groundSize`/`groundPositionOffset` (plus the derived min/max bounds)
   — done, but see item 6's new sub-item below for `localPlayerStartPosition`
   specifically.** Moved into `EntityComponentContextWorldLayout`
   (`entity components/context/context_world_layout.js`), attached to its
   own dedicated `"WorldLayout"` entity, built inside the now-generalized
   `initContextComponents()` alongside `EntityComponentContextLocalPlayerIdentity`.
   `main.js` fetches it via `entityManager.methodGetEntityByName("WorldLayout")`
   and calls plain getters — the ground's own `EntityComponentTestCube`
   construction reads `methodGetGroundSize()`/`methodGetGroundPositionOffset()`,
   and player-spawn randomization calls `methodGetRandomSpawnPositionXZ()`
   (which owns the whole min/max-bounds-plus-`Math.random()` computation
   internally, rather than exposing raw bounds for `main.js` to combine
   itself — "a valid random spawn point" is a world-layout concern, not
   orchestration code). Verified via `npm run build`, a screenshot
   confirming the ground still renders at the correct size/position, and a
   2-tab PeerJS test confirming player spawn positioning still works with
   zero errors.
3. **cubeHUD's whole layout cluster — done, resolved by item 5.2.** Same
   cluster flagged in item 5.1/5.2 from the "non-ECS closure" angle; moving
   `computeCubeHUDLayout()` into `EntityComponentContextHUDLayout` resolved
   this "shared state" framing too, since the constants moved along with the
   function that used them, rather than staying behind as orphaned `main.js`
   locals. The tuning panel's `applyTuning()`/alignment button (still
   unconverted, item 5.1/5.3) now reads what it needs from the component
   (`methodGetTiltRadians()`, `methodComputeLayout()`) instead of closing
   over bare locals.
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
5. **`camera`/`cameraPivot`/`cameraHUD`/`scene`/`sceneHUD`/`renderer` — done
   (item 10); `entityManager` still open.** The first six were the core
   module-level engine singletons referenced directly by nearly every
   component constructor in the file — all now looked up through
   `EntityComponentContextEngine` instead (see item 10 and
   `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md` for the full exploration and
   verification history). `entityManager` was deliberately excluded from
   that conversion — it's a different category (the ECS's own bookkeeping
   structure, not an external engine resource like the other six), and
   remains passed by reference the way it always has been
   (`EntityComponentRemotePlayerManager`'s constructor param, for spawning/
   despawning remote-player entities). Whether `entityManager` deserves the
   same treatment is still an open, undecided question — not addressed by
   item 10's conversion.
6. **`localPlayerStartPosition` (`main.js`'s `initEntityComponents()`) —
   done.** Moved into `EntityComponentContextPlayerInitialization`
   (`entity components/context/context_player_initialization.js`), attached
   to its own dedicated `"PlayerInitialization"` entity, built inside
   `initContextComponents()` after `EntityComponentContextWorldLayout` (on
   purpose - it self-looks-up that component in its own
   `methodInitialize()`, so `WorldLayout` has to already exist first). It
   self-looks-up `EntityComponentContextWorldLayout` for the ground's
   bounds, calls `methodGetRandomSpawnPositionXZ()` once, and exposes the
   result via `methodGetSpawnPosition()`.
   `EntityComponentCameraControllerFirstPerson` self-looks up *that*
   component instead and sets `cameraPivot.position` directly in its own
   `methodInitialize()`, the same self-lookup shape as its existing
   `camera`/`cameraPivot`/`scene` caching. This is the first
   `EntityComponentContext*` component built with exactly one consumer in
   mind from the start — see `NAMING_CONVENTIONS.md`'s "A single consumer is
   fine, conditionally" section for the two conditions that justify it
   (streamlines `main.js`; encapsulates the camera controller from ever
   needing to know spawn positions come from ground bounds at all) and why
   the family's original "multiple consumers" framing needed loosening to
   allow this. `main.js` no longer computes or sets the spawn position at
   all - the `localPlayerStartPosition` local and the explicit
   `entityA.methodSetPosition(...)` spawn call were both removed. Verified
   via `npm run build`, a headless-browser check confirming the spawn
   position lands within the ground's actual bounds with zero console
   errors, and a 2-tab PeerJS test confirming movement still syncs
   correctly end-to-end.

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

## 10. `methodGetEntityByName` + a named "EngineContext" entity for bare-minimum Three.js state — done

**All six bare-minimum values converted — done.** `scene`, `sceneHUD`,
`renderer`, `camera`, `cameraPivot`, and (via item 5.2's
`EntityComponentContextHUDLayout` landing) `cameraHUD` are all now looked up
through `EntityComponentContextEngine` instead of hard-wired constructor
params. Full reasoning and status in `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`;
this item tracks the concrete mechanism that doc proposes as an answer to
item 6.5's "flagged for a deliberate decision" cluster (`scene`/`sceneHUD`/
`renderer`/`camera`/`cameraPivot`/`cameraHUD`), rather than duplicating that
item.

**Done:** `EntityManager.methodGetEntityByName`, `EntityComponentContextEngine`
(now holding `scene`/`sceneHUD`/`renderer`/`camera`/`cameraPivot`/`cameraHUD`,
`entity components/context/context_engine.js`),
`EntityComponent.methodGetScene()`/`methodGetRenderer()`/`methodGetCamera()`/
`methodGetCameraPivot()`, and `main.js`'s `initEngineContext()` step.
Converted `EntityComponentRemotePlayerManager` for `scene`,
`EntityComponentButtonPointerLock` for `renderer`, and
`EntityComponentCameraControllerFirstPerson` for `camera`/`cameraPivot`
(caching all three resolved references in `methodInitialize()`, since this
component reads/mutates them every `methodUpdate()` call — a fresh lookup
60×/sec would be wasteful, and caching is safe since neither object is ever
replaced after construction, only mutated in place). Also adapted
`EntityComponentLightManager` — its `sourceReferencePoint` constructor
param (deliberately generic, but in practice always fed the world camera)
is now fetched via `this.methodGetCamera()` internally instead; its
`targetReferencePoint` param (the HUD cube component) is untouched, since
that's a cross-entity component reference, not a bare-minimum object, and
belongs to item 6.4 instead. None of the three converted consumers were the
doc's originally-suggested test candidates
(`EntityComponentDirectionalLight`/`EntityComponentTestCube`), since both
of those are reused across `scene`- and `sceneHUD`-backed instances and
converting either outright would've broken its `sceneHUD` instantiations.
Verified via `npm run build` plus real browser tests each time: a 2-tab
PeerJS connection test for `scene` and again for `camera`/`cameraPivot`
(confirming `EntityComponentPlayerNetworkSync`'s reads of the camera
controller's getters still work end-to-end), a headless click-through of
the PointerLock button for `renderer` (which surfaced a real Pointer Lock
API rejection in headless Chromium — confirmed via `git stash`/`git stash
pop` against the last pushed commit to be a pre-existing environment
limitation, not a regression), and a mouse-look/WASD/reset-key exercise for
`camera`/`cameraPivot` covering 30+ frames of both the camera controller
and `EntityComponentLightManager`'s `methodUpdate()` — see
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s experiment sections for full
verification detail on all three.

**`sceneHUD` done too:** `EntityComponentContextEngine` now also holds
`sceneHUD`, with a matching `EntityComponent.methodGetSceneHUD()`.
Converted `EntityComponentBackgroundPlane` directly (single instantiation,
no roadblock, same shape as `scene`/`renderer`'s easy picks). For the
reused classes this conversion couldn't route around
(`EntityComponentTestCube`/`EntityComponentDirectionalLight`, both back
`scene`- and `sceneHUD`-flavored instances): gave each an overridable
`methodGetTargetScene()` hook (defaulting to `this.methodGetScene()`), with
`EntityComponentTestCubeHUD` (already existed) and the new
`EntityComponentDirectionalLightHUD` (mirrors it) each overriding just that
hook to return `this.methodGetSceneHUD()` — subclasses chosen over a
constructor flag (`{isHUD: true}`) for consistency with the existing
`EntityComponentTestCubeHUD` precedent, and because HUD-specific components
may grow their own HUD-only needs over time that a plain flag wouldn't
leave room for. Verified via `npm run build`, a screenshot confirming
cubeHUD/the HUD panel render correctly in `sceneHUD`, a second screenshot
confirming the world scene (ground, correctly lit/shadowed) still renders
correctly through the same default path, and a re-run of the 2-tab PeerJS
test confirming remote-player cube spawning still works — see
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s `sceneHUD` section for full
detail.

**`cameraHUD` done too, item 5.2 unblocked it:** `EntityComponentContextEngine`
now also holds `cameraHUD`, with a matching `EntityComponent.methodGetCameraHUD()`.
Its one real consumer, `computeCubeHUDLayout()`, became a real
`EntityComponent` (`EntityComponentContextHUDLayout`, item 5.2) in the same
pass, which is what gave `cameraHUD` something to be looked up from. Fetched
and cached in that component's own `methodInitialize()`, same
resolve-once-per-instance pattern as every other non-per-frame consumer.

This item's original open question is now fully resolved for all six
bare-minimum values — see `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md` for the
complete verification history across each one.

**The proposal:** add `EntityManager.methodGetEntityByName(paramName)` —
delegated through `Entity`/`EntityComponent` the same way
`methodGetEntitiesWithComponent` already is — and build an
`EntityComponentContextEngine` holding the bare-minimum Three.js objects,
attached to a single entity given a fixed, predictable name (`"EngineContext"`
or `"BareMinimum"`) instead of an auto-generated one. Every component that
currently receives `scene`/`camera`/etc. as constructor params would instead
fetch them via `this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")`.
Resolves the mismatch between `methodGetEntitiesWithComponent` (built for
filtering an unknown/dynamic *set* of entities) and a resource that's
known-unique and known-permanent for the app's entire lifetime — no
candidate list, no ambiguity to resolve. Real precedent for the idiom:
Three.js's own `Object3D.getObjectByName`.

**Also add matching shorthand getters on `EntityComponent`** —
`methodGetScene()`/`methodGetSceneHUD()`/`methodGetRenderer()`/
`methodGetCamera()`/`methodGetCameraPivot()`/`methodGetCameraHUD()` — each
composing the same `methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetX()`
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
keeping `EntityComponentContextEngine` itself strictly synchronous (no
async `methodInitialize()`), and whether the six shorthand getters should
`console.error` rather than silently return `undefined` if `EngineContext`
isn't found yet.

**Before converting every consumer:** try the cheap one-component
experiment from `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md` first (e.g.
convert just `EntityComponentDirectionalLight` for the world sun, or the
ground's `EntityComponentTestCube`) to confirm the lookup/ordering actually
works in practice and that the resulting code reads better, before deciding
whether to mechanically repeat it for every other bare-minimum consumer.

## 11. Overridable Context references (`refContext*` constructor params) — ongoing discussion, not decided

Status: **postponed - discussed, not decided, no implementation yet.**

Every `EntityComponent` that self-looks-up an `EntityComponentContext*`
component today does so fully hard-wired: the entity name and component
class name it looks for are both literal strings baked into its own
`methodInitialize()` (e.g.
`EntityComponentCameraControllerFirstPerson` always looks for entity
`"PlayerInitialization"` holding `"EntityComponentContextPlayerInitialization"`).
Motivation for revisiting this: the project wants multiple worlds/areas for
the player to explore eventually, which means multiple instances of the
same kind of Context data (e.g. more than one
`EntityComponentContextWorldLayout`, one per world/area) - today's
hard-wired self-lookups have no way to pick which instance a given
consumer should use.

**Proposed direction:** an optional constructor param, prefixed
`refContext` (e.g. `refContextWorldLayout`), that overrides which specific
Context entity/component a consumer's self-lookup targets, falling back to
today's hard-wired default when the param isn't passed - so existing
call sites (which don't need this yet) stay untouched.

**Open questions, not yet resolved:**

- **Does the override swap just the entity name, or the component class
  name too?** Swapping only the entity name (multiple instances of the
  *same* Context class, e.g. two `EntityComponentContextWorldLayout`s on
  two differently-named entities) is straightforward. Swapping the class
  name as well - standing in a differently-named class entirely - is a
  much bigger commitment: JS has no way to enforce that the substitute
  actually exposes the same methods the consumer expects, so this would be
  an unenforced, implicit interface. Needs a decision before implementing
  either.
- **Blast radius / cost.** Every self-lookup would need to thread an
  optional override through its own constructor instead of being a bare
  one-liner in `methodInitialize()`. Several current self-looking-up
  components (e.g. `EntityComponentCameraControllerFirstPerson`) take
  *zero* constructor params today specifically because they don't need
  any - that was a deliberate simplification (see
  `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Self-lookup vs.
  main.js-resolves-and-passes" section), and retrofitting this would
  partially undo it.
- **`EngineContext`'s six shorthand getters are a special case.** Those
  live on the `EntityComponent` *base class* itself
  (`methodGetScene()`/`methodGetCamera()`/etc. - see
  `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Convenience getters"
  section), shared by every component in the codebase. Making those
  overridable per-instance would mean every component threading this
  through `super(params)`, whether it needs the feature or not, even
  though nothing in this codebase has ever needed more than one
  `scene`/`camera`/`renderer`. Likely out of scope for this item even if
  the rest goes ahead - needs an explicit decision either way, not a
  silent omission.

No `EntityComponentContext*` component has more than one instance in the
codebase today, so this remains speculative until the multi-world/area
work actually starts - revisit this item once that work is concrete enough
to pin down the two open questions above against a real use case.

## 12. Basic mobile/Android touch controls (camera look) — done

Swipe-to-look, matching the ask: swiping either direction turns the camera
that way, mirroring mouse-look's `speedX`/`speedY` math exactly. No touch
equivalent for the arrow-key nudge/reset behavior yet - deliberately out of
scope for this first pass, since nothing asked for it and `keys` staying
permanently all-`false` on touch doesn't break
`EntityComponentCameraControllerFirstPerson`'s unconditional read of it.

New `EntityComponentCameraControllerFirstPersonInputTouch`
(`entity components/camera_controller_first_person.js`), tracks the first
touch point's position across `touchstart`/`touchmove`/`touchend` and
computes a `mouseX`/`mouseY` delta by hand each `touchmove` (touch events
carry only absolute coordinates, unlike `e.movementX`/`e.movementY` for
mouse), exposing the exact same `keys`/`mouseX`/`mouseY`/`methodResetMouse()`
shape as the existing `EntityComponentCameraControllerFirstPersonInput` so
`EntityComponentCameraControllerFirstPerson` doesn't need to know which one
is actually attached.

Also the first real use of `EntityComponentContextEnvironment`'s
`methodGetIsTouchPrimary()`, and the first implementation of "Pattern C:
self-attaching sibling components" (see
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md` and `NAMING_CONVENTIONS.md`
for both) — `EntityComponentCameraControllerFirstPerson` decides which
Input class to construct and attaches it to its own entity itself, inside
its own `methodInitialize()`, rather than `main.js` branching on which one
to build. `main.js` lost its `EntityComponentCameraControllerFirstPersonInput`
import and construction call entirely.

A real bug was caught during implementation (see
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Pattern C" section for the
full story): the new touch class initially copied
`EntityComponentCameraControllerFirstPersonInput`'s "register on both
`document` and `window`" habit, which silently discarded every real touch
delta (each event fired twice, and the second firing recomputed a delta of
zero against the position the first firing had just moved to). Fixed by
listening on `document` only. Verified via `npm run build`, a
headless-browser check confirming a non-touch context self-attaches the
mouse+keyboard class while a `hasTouch`/`isMobile` context self-attaches
the touch class, a synthetic spaced-out touch-drag test confirming the
camera actually rotates from touch deltas end-to-end (not just that deltas
were computed), and the existing 2-tab PeerJS multiplayer test confirming
`EntityComponentPlayerNetworkSync` still works correctly downstream of this
component.

## 13. Basic mobile/Android touch controls (walk forward) — done

Double-tap-and-hold to walk forward, per direct spec: the second tap of a
double-tap starts walking (as if W were held down); it continues for as
long as that same finger stays on the screen, regardless of whether it
moves; the finger lifting stops it. The whole screen is eligible, and the
same touch can keep dragging to aim the camera the entire time - walking
and camera-look both read from the same physical touch stream
independently and don't interfere with each other.

New `EntityComponentPlayerControllerInputTouch`
(`entity components/player_controller.js`), tracking whichever touch is a
candidate "first tap" (by touch identifier, position, and timing) and,
once a second touchstart lands within `DOUBLE_TAP_MAX_INTERVAL_MS`/
`DOUBLE_TAP_MAX_DISTANCE_PX` of a completed first tap, setting
`keys.forward = true` and remembering that touch's identifier as the one
driving movement - `keys.forward` only goes back to `false` when *that
specific* touch's `touchend`/`touchcancel` fires, not when it merely
moves. `backward`/`left`/`right`/`up`/`down` have no touch equivalent yet
and stay permanently `false`. Second real application of "Pattern C:
self-attaching sibling components" (see
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`) - `EntityComponentPlayerController`
decides and attaches its own Input sibling the same way
`EntityComponentCameraControllerFirstPerson` does, and `main.js` lost its
`EntityComponentPlayerControllerInput` import and construction call
entirely.

Verified via `npm run build` and a spaced-out synthetic touch sequence
(single tap alone confirmed *not* to start walking; a second tap close in
time/position confirmed to start it; simulated dragging while held
confirmed the player's position keeps advancing - correctly following the
camera's current facing as it's dragged, proving walking and aiming
genuinely coexist - not just that a flag got set; release confirmed to
stop it), plus the existing desktop-WASD and 2-tab PeerJS multiplayer
smoke tests confirming no regression.

**Update - the noted risk materialized, now fixed.** This item originally
predicted mobile browsers' native double-tap-to-zoom gesture could conflict
with this double-tap-to-walk one, and deliberately didn't act on it pending
real Android confirmation (since automated tests dispatching synthetic
`TouchEvent`s can't exercise a browser's native gesture-recognition layer
at all - only real touch input goes through it). Real testing confirmed
it: double-tap-and-hold walking worked, but the same finger could no
longer simultaneously drag to aim the camera - the native gesture
recognizer (double-tap-to-zoom, or on some Android builds,
double-tap-and-drag-to-zoom) was intercepting the drag once the
double-tap pattern was recognized, independent of whether the second tap
was quickly released or held. Fixed with `touch-action: none;` added to
`index.html`'s `html,body` CSS rule - not the narrower `manipulation`
value originally proposed, since this project is a full-screen WebGL
canvas with no scrollable content to preserve; `none` removes every native
touch gesture (scroll, pinch-zoom, double-tap-zoom) so 100% of touch
interpretation stays with this codebase's own listeners. Verified via
`npm run build` (confirmed the rule reaches `dist/index.html`) and the
full existing touch/desktop/multiplayer smoke-test suite (unaffected -
`touch-action` only changes what the *browser* does with touch input, not
how JS event listeners receive it) - the actual fix for the reported
symptom can only be confirmed by the user's own Android device, the same
way the original bug was only found there.
