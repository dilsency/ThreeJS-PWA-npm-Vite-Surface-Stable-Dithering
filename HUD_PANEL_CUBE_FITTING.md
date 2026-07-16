# HUD panel-to-cube fitting — why it's projection-based, not world-space

Context: `main.js`'s `sceneHUD` setup builds a backdrop `EntityComponentBackgroundPlane`
("the panel") behind `EntityComponentTestCubeHUD` ("cubeHUD"). The panel needs to look
like a snugly-fitted frame around the cube on screen. This doc covers why that can't be
done by matching their world-space position/size directly, what the actual fix computes
instead, and what it does and doesn't stay correct under.

## Why world-space matching doesn't work

The panel and cube sit at different depths (the panel a fixed distance behind the cube,
so the cube visibly sits in front of it) and cubeHUD is deliberately positioned low
enough that most of it renders below the visible viewport, with only its upper portion
peeking up from the bottom edge — by design, not a bug.

That combination breaks the intuitive shortcuts:

- **Matching world-space position/size directly** ignores that a farther object needs
  both a proportionally larger size *and* a proportionally larger offset-from-center to
  land on the same screen position as a closer object — under a perspective camera,
  screen position is `offset / depth`, not `offset`.
- **Scaling both by the depth ratio** (`panelDepth / cubeDepth`) fixes size and looks
  correct in the simple case, but still fails here specifically because cubeHUD's
  world-space *center* isn't representative of its mostly-offscreen *visible* extent —
  aligning centers just moves the panel to be equally mostly-offscreen too, which was
  verified empirically while building this (the panel disappeared below the fold along
  with the cube).

The only thing that actually tells you "where does this object appear on screen" is the
camera's real projection matrix. So the fix goes through it directly instead of
approximating it.

## What the fix actually computes

In `main.js`, right before building `entityHUD`'s components:

1. Build a throwaway `THREE.Object3D` ("cubeHUDProxy") at cubeHUD's own position and
   `rotation.x` tilt, without needing the real mesh to exist yet (component
   initialization is async and not awaited — see `CLAUDE.md`'s ECS section).
2. Project all 8 corners of a box sized `cubeHUDSize` through `cameraHUD` to get the
   cube's **true on-screen (NDC) bounding box** — this correctly captures how tilt
   spreads the box's depth extent into the screen's vertical axis, and how the
   perspective-nearest corners dominate the apparent width.
3. Shrink that box inward by a small, fixed pixel amount per edge (`panelInsetTopPx`,
   `panelInsetSidePx` — tuned by eye, see "Tuning" below), converted to NDC via the
   viewport size at init time. The bottom is left matched exactly to the cube's own
   bottom (already off-screen, so it doesn't matter).
4. **Unproject** the resulting NDC box back out to the panel's own depth (`panelZ`) to
   get real world-space corners, then derive the panel's `size`/`positionOffset` from
   those corners.

`project()`/`unproject()` are exact inverses for a given camera, so step 4 reproduces
exactly the screen-space box chosen in step 3, just expressed in the panel's own
world-space plane instead of the cube's.

## What stays correct automatically

`cubeHUDSize` and `cubeHUDTiltFactor` are declared once and used for *both* the panel
math above and the real `EntityComponentTestCubeHUD` construction below it — not two
separately-tuned numbers that happen to match. Changing either one re-derives the
panel's fit automatically, because both feed the same corner-projection computation
that also shapes the real cube. Verified directly: temporarily set
`cubeHUDSize = {x:1.6, y:0.7, z:1.6}` and `tiltFactor = 0.45`, confirmed the panel
resized and refit around the bigger, more-tilted cube, then reverted.

`panelZ` is derived as `cubeHUDPositionOffset.z - panelBehindCubeDistance` rather than a
hardcoded literal, so moving the cube's depth keeps the panel "just behind" it too.

## What does *not* stay correct automatically

- **Rotation on any axis other than X.** `EntityComponentTestCubeHUD` only ever applies
  `rotation.x` (`this.methodGetCube().rotation.x += positionOffsetY * tiltFactor` — see
  its `methodInitialize`). `cubeHUDProxy` in `main.js` only replicates that one axis. If
  the cube's tilt logic is ever extended to rotate on Y/Z or via an arbitrary quaternion,
  the proxy needs updating to match, or the panel will fit the *old* rotation.
- **A flat panel can't perfectly hug a tilted box's silhouette at every corner.** The
  panel is a `PlaneGeometry` (a rectangle); a sufficiently tilted cube projects to a
  trapezoid. An axis-aligned bounding rectangle around a trapezoid will always leave
  small gaps at the corners the trapezoid pulls in from — this showed up as visible
  triangular slivers during the robustness test above with the more extreme 0.45 rad
  tilt. Not a bug in the fitting math; a geometric limitation of using a flat rectangle
  as the backdrop shape at all.
- **Window resize.** The corner projection and the pixel-to-NDC conversion both read
  `window.innerWidth`/`window.innerHeight` once, at init time — matching this HUD
  element's existing non-responsive behavior (it isn't recomputed in the resize
  handler). A drastically different viewport size than what the app started at would
  need the same init-time computation to be re-run, not just the aspect ratio patched.

## Tuning

`panelInsetTopPx` and `panelInsetSidePx` (currently `6` and `38`) are fixed pixel
insets, not proportional ones — chosen this way specifically because the cube's raw NDC
bounding box is already exaggerated by its closest corners (tilt pulls the bottom-front
corners nearer the camera, inflating their perspective width beyond the cube's actual
footprint), so a percentage-based margin overshot unevenly between the sides and the
top when first tried. Being in pixels also means the visual border stays a roughly
constant screen-space width as the cube's on-screen size changes, rather than growing
proportionally with it.

## Status

Implemented in `main.js`, in the `sceneHUD` setup block inside `initEntityComponents()`.
