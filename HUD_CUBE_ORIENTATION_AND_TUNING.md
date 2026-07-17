# cubeHUD's orientation, alignment, and live tuning

Context: `main.js`'s `sceneHUD` setup builds `cubeHUD` (via
`EntityComponentTestCubeHUD`) as a stand-in for a person model that will
eventually replace it — see the comment on `cubeHUDBaseOffset` in `main.js`
for why it's deliberately positioned low enough that most of it renders below
the visible viewport (mimicking a first-person view of your own body, visible
only from roughly mid-thigh up). This doc covers everything about how that
cube is positioned and oriented, and the live tuning tool built to dial it in
by eye. For the separate question of how the backdrop panel fits around
whatever the cube's current position/size/rotation happen to be, see
`HUD_PANEL_CUBE_FITTING.md` — that doc's projection-based approach is what
lets everything described here (alignment, size, tilt) change without the
panel's fit needing to be hand-adjusted to match.

## Horizontal alignment

`HUDCubeHorizontalAlignmentEnum` currently has two values:

- `CENTER` — cubeHUD sits horizontally centered, `x` offset `0`. The original,
  simplest case.
- `LEFT` — the *panel's* left edge (not the cube's) sits flush against the
  screen's left edge. Solved iteratively via camera projection in
  `computeCubeHUDLayout` (see its comments for the full derivation), since the
  offset needed depends on the cube's yaw correction (below), which itself
  depends on the offset. Comparing corners by projected NDC x rather than raw
  world x turned out to matter here too, for the same reason described for
  roll option 3 below — see that comment thread in `computeCubeHUDLayout`
  directly, since (unlike the roll attempts) this fix is still live in the
  code, not reverted.

A third value, `RIGHT` (mirroring `LEFT` for the screen's right edge), is
planned but not implemented yet. When it's added, it needs:
1. A new branch in `computeCubeHUDLayout` mirroring the `LEFT` iterative solve.
2. Adding `HUDCubeHorizontalAlignmentEnum.RIGHT` to the enum.
3. Adding it to `cubeHUDAlignmentCycle` in the tuning UI (see below) so the
   cycle button includes it.

`computeCubeHUDLayout(alignment)` is a function, not one-shot init code,
specifically so alignment can be changed live (by the tuning UI's cycle
button) and recomputed against the already-created panel/cube meshes rather
than requiring a page reload.

## Pitch, yaw, and roll — what's actually applied, and what was tried and reverted

**Pitch (`rotation.x`)** — a crude proportional approximation
(`positionOffsetY * tiltFactor`), not an exact `lookAt`. This predates all the
work described below and was deliberately left as an approximation (see its
comment in `entity components/test_objects.js`) rather than solved exactly,
the same way an exact yaw correction (next) was found necessary but an exact
*pitch* correction wasn't pursued.

**Yaw (`rotation.y`)** — an exact `lookAt`-derived correction (see the
`cubeHUDYawProxy`/`yawProxy` comments in `main.js`'s `computeCubeHUDLayout`),
added because a horizontally off-center cubeHUD, under a fixed wide-FOV
camera, visually reads as "turning away" even with `rotation.y` at a literal
`0` (parallel to the camera) — pure perspective parallax, not a bug. The yaw
correction deliberately trades
"parallel to camera" for "looks like it's facing the camera," which the user
confirmed was an improvement (see below for what wasn't).

**Roll (`rotation.z`)** — currently **not applied** (baseline `0`). Three
different axis choices were tried, one at a time, each solved numerically to
exactly level the cube's top-left/top-right corners on screen, and each was
rejected as looking *worse* than yaw-only once actually seen running:

1. **The cube's own forward axis** (equivalent to a plain `rotation.z` Euler
   component, confirmed mathematically identical to premultiplying a
   quaternion around the cube's current forward direction). Rejected:
   "doesn't look correct... rotated in the wrong direction."
2. **The line of sight from `cameraHUD`'s position to the cube's position.**
   Numerically almost identical to option 1 (angles differed by ~0.02°), so
   effectively the same rejected result, just derived differently.
3. **`cameraHUD`'s fixed aiming direction** (its view-plane normal,
   independent of any point) — explicitly requested as "the camera should be
   treated as a plane whose normal is its aiming direction, not a point to aim
   at." Implemented via proper quaternion composition (premultiplying around
   this fixed world-space axis, rather than setting `rotation.z` as a plain
   Euler component, since — unlike options 1/2 — this axis isn't the cube's
   own forward direction, so composing it as a further intrinsic Euler
   rotation would rotate around the wrong thing). Solving for this axis also
   surfaced a real numerical bug along the way: naively re-detecting "whichever
   corner is currently leftmost" at each trial roll angle produced a
   discontinuous function (two corners' NDC x cross over as roll increases),
   which sent the secant solver into an oscillating loop instead of
   converging — fixed by locking in which physical corner counts as
   top-left/top-right once, rather than re-detecting it every iteration. Even
   with the solver fixed, this axis was still rejected, and for a
   demonstrable reason beyond taste: leveling the *originally-identified*
   top-left/top-right corners this way required a large enough roll (~11-15°,
   notably more than options 1/2's ~6°) that a *different* corner swung past
   them and became the new visual extreme before that angle was reached — so
   the specific pair solved for did end up level, but was no longer the pair
   actually defining the visible top edge. The rendered box still looked
   slanted. (This entire roll attempt, including the fix above, was reverted —
   there's no surviving code for it; this paragraph is the only record.)

After option 3, the user's guidance was explicit: the mechanism doesn't matter
— what matters is whether it visually looks like it's facing the camera, and
none of the three did. Rather than guess a fourth axis blind, the roll
correction was reverted entirely (back to yaw-only) and replaced with the live
tuning tool below, so "does this look right" gets judged by eye in real time
instead of solved for geometrically and shown after the fact.

## Live tuning dev tool

A `TEMP dev tool` block in `main.js` (inside `initEntityComponents()`, right
after `componentCubeHUD` is created) renders a small fixed-position panel,
top-right of the viewport:

- **pitch/yaw/roll offset (deg)** — three number inputs. Each fires on
  `input` (not just `change`), so typing or using the spinner updates
  `cubeHUD`'s rotation live, with zero latency, no reload. Each is an
  *offset* added on top of the existing base values
  (`cubeHUDTiltRadians`/`cubeHUDLayout.yawRadians`), not a replacement —
  roll has no base to add to right now since it's reverted to `0`.
- **presets** — a plain array literal (`cubeHUDTuningPresets`) of
  `{pitch, yaw, roll}` tuples found to look decent by eye, each rendered as a
  numbered button that fills the three inputs and applies them immediately.
  Current presets, in degrees (pitch, yaw, roll):
  1. `(-15.5, -8.5, 8.5)`
  2. `(-4.5, -8.5, -1)`
  3. `(-18.5, -9, 10.5)`

  Add more tuples to the array as more are found; no other code changes
  needed.
- **shear (x per y) / (x per z) / (y per x) / (y per z) / (z per x) / (z per
  y)** — six number inputs, one per off-diagonal cell of a 3D shear matrix
  (see "Shear/skew" below for what these mean and why this shape of control).
  All six combine into a single matrix on `cubeHUDShearWrapper` — see below.
- **align: \<STATE\>** — cycles `cubeHUDHorizontalAlignment` live (see above),
  recomputing `computeCubeHUDLayout` and pushing the new position/panel-fit
  onto the already-created meshes, then re-applying whatever pitch/yaw/roll
  offsets — and the shear, via `applyShear()` — are currently dialed in.

This whole block is explicitly temporary — the comment marks it `TEMP dev
tool` — meant to be deleted once final pitch/yaw/roll/shear values are chosen
and baked into the permanent computation (`cubeHUDTiltFactor`,
`computeCubeHUDLayout`'s `yawRadians`, a real roll constant/formula if one is
ever settled on, and a real shear matrix/formula) rather than left as a live,
user-facing control.

## Shear/skew

Separately from pitch/yaw/roll (rigid rotations), a **shear** effect: the top
of the cube leaning one horizontal direction and the bottom leaning the
other, proportional to local Y — visually similar to what an additional roll
was reaching for, but a genuinely different transform (shear displaces each
vertex by an amount depending on its own position; rotation moves the whole
rigid body uniformly).

Key constraint driving the design: **cubeHUD will eventually be replaced by
an actual person model**, so whatever implements this must be geometry-independent
— it can't bake an offset into this specific box's vertex buffer, since that
has nothing in common with a rigged character's vertex layout.

**Implemented as a matrix-based shear**, via a dedicated wrapper `Object3D`
rather than baking anything into geometry (the vertex-shader alternative was
also considered — see below for why it wasn't chosen). The scene-graph
hierarchy for cubeHUD is now:

```
sceneHUD → cubeHUDOuterNode (position only)
         → cubeHUDShearWrapper (shear matrix only, matrixAutoUpdate = false)
         → cube (rotation + geometry, its own position reset to (0,0,0))
```

This split exists because a shear matrix mixes one axis into another based on
raw local coordinates — if it sat on the same node as the cube's own position
(`cubeHUDBaseOffset.y = -1.5`, far larger than the cube's own ±0.25
half-extent), it would shift the cube's whole center sideways by a large
amount instead of just distorting its local shape. Splitting position
(outer node) from shear (wrapper) from rotation+geometry (the cube itself)
keeps each concern independent: the tuning UI's pitch/yaw/roll inputs still
set `cube.rotation.x/y/z` directly, completely unaware the shear wrapper
exists above them; `computeCubeHUDLayout`'s position output now goes on
`cubeHUDOuterNode` instead of the cube. Built lazily
(`ensureCubeHUDShearHierarchy()`), the first time the cube mesh actually
exists (its async `methodInitialize` may not have finished yet when tuning
inputs first fire) — the panel is untouched by any of this, matching how the
rotation tuning inputs already only affect the cube.

A general 3D shear has 6 independent off-diagonal degrees of freedom — each
axis can be displaced proportionally to either of the other two:

- `x per y` — `x' = x - amount*y` (note the negation: this is the original
  input, "positive leans top-left/bottom-right", and keeps that established
  sign convention).
- `x per z`, `y per x`, `y per z`, `z per x`, `z per y` — all five use the
  plain `target' = target + amount*source` convention, since they're new and
  have no established sign to preserve.

All six are combined into **one** matrix at once (`applyShear()` in
`main.js`), each occupying its own non-overlapping cell — this is
deliberately not the same as chaining 6 separate elementary shear matrices
one after another, which would introduce quadratic cross-terms between them
that a single combined linear map doesn't have.

**Why matrix-based over a vertex shader:** the shear only needs to change
when `cubeHUDHorizontalAlignment` changes (or, right now, when a tuning input
changes) — a discrete, infrequent update, not something recalculated every
frame or driven by animation state. That's the same profile
`computeCubeHUDLayout` already has for position/yaw. A vertex-shader shear
(operating on `position.y` in the vertex stage, post-skinning if the model is
skeletally animated) is also geometry-independent and would work, but earns
its complexity only when the effect needs per-frame/continuous computation —
not the case here — and would additionally need porting into whatever
material the eventual person model uses, unlike the matrix approach, which is
material-agnostic (it's a scene-graph transform, not a shader concern).

Ruled out: baking the shear into the current `BoxGeometry`'s vertex buffer
directly (CPU-side, one-time). Works for a box, but has nothing to carry over
to a person model's vertex layout — explicitly not geometry-independent.
