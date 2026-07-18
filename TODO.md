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

## 2. Scale multiplayer past 2 players (~6-player mesh formation)

Not yet implemented. `EntityComponentPeerMeshFormation` — the roster
handshake that lets a newly-joined player converge to a full mesh with
everyone already in a session, rather than just the one peer whose code they
typed — is fully designed but not built. See
`MULTIPLAYER_TOPOLOGY_AND_SYNC.md`'s "Mesh formation" section for the
handshake protocol, and its flagged-but-unsolved correctness issue (two
peers discovering each other from the same roster message simultaneously
both calling `peer.connect()`, opening a duplicate connection — needs a
tie-breaker before implementing). This was the agreed "step 3" in the
implementation order discussed for this feature; steps 1 (multi-connection
transport) and 2 (position/rotation sync + remote cube identity) are done.

## 3. Send `camera`/`cameraPivot` quaternions instead of derived yaw/pitch for remote-player facing

Raised as a concern, not yet changed. `EntityComponentPlayerNetworkSync`
currently sends `{type: "transform", position, yaw, pitch}` where `yaw` is
read from `cameraPivot.rotation.y` and `pitch` from `camera.rotation.x` (see
`EntityComponentCameraControllerFirstPerson.methodGetYaw()`/`methodGetPitch()`).
That works today only because the *real* rig happens to restrict itself to
exactly those two single-axis rotations — `cameraPivot` only ever
`rotateY()`s, `camera` (its child) only ever `rotateX()`s — so reading each
object's own Euler component back out happens to fully capture the
composition. But the actual facing direction the local player sees is a
product of two parent-child quaternions, not two independent numbers; the
yaw/pitch extraction is only equivalent *because* of that current
restriction, and would silently stop being correct if the rig's rotation
ever got less constrained (e.g., roll added to either object, or any
rotation not expressible as those two single-axis terms).

Proposed direction: send `cameraPivot.quaternion` and `camera.quaternion`
directly (as their four components each) instead of derived `yaw`/`pitch`
numbers, and have `EntityComponentRemotePlayerManager` apply them to the
remote cube by composing the two (e.g.
`cube.quaternion.copy(cameraPivotQuaternion).multiply(cameraQuaternion)`)
rather than reconstructing Euler angles. This is more robust regardless of
how the local rig's rotation logic evolves, and would also be the natural
place to start splitting the remote representation into separate body/head
nodes later, if the placeholder cube is ever replaced by an articulated
person model. Cost: a slightly larger `transform` payload (8 floats instead
of 2), not a concern for LAN bandwidth at ~6 players. Not implemented yet —
needs the message envelope and `methodApplyTransform` updated together with
whatever `EntityComponentPlayerNetworkSync` reads instead of
`methodGetYaw()`/`methodGetPitch()`.
