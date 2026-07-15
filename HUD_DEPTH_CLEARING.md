# HUD depth clearing — `renderer.clearDepth()` vs `depthTest: false`

Context: `main.js` renders two scenes per frame — `scene` (the world) then `sceneHUD`
(currently just `EntityComponentTestCubeHUD`'s cube) — with `renderer.autoClear = false`
so the second pass doesn't wipe out the first pass's color output. Right now nothing
clears the **depth buffer** between the two `renderer.render()` calls, so the HUD cube
is depth-tested against whatever depth values the world pass left behind, and can be
clipped by world geometry that's nearer to the camera than the HUD cube is to
`cameraHUD`. This doc covers the two ways to fix that, and why `renderer.clearDepth()`
is the better fit here.

## What `renderer.clearDepth()` does

Every frame, the renderer writes into two buffers per pixel: the **color buffer**
(what you see) and the **depth buffer** (how far the nearest thing drawn to that
pixel was from the camera). When a new triangle is drawn, WebGL compares its depth
to what's already in the depth buffer at that pixel and only draws it if it's closer
(this is depth testing, `depthTest: true`, the default) — that's what makes nearer
objects correctly hide farther ones.

`renderer.clearDepth()` resets every pixel of the depth buffer back to "nothing drawn
yet" (maximum depth), without touching the color buffer. Calling it between the
`scene` and `sceneHUD` render passes means the HUD pass starts with a blank depth
buffer: the HUD cube is depth-tested only against other things drawn *in the HUD
pass itself* (none, currently), never against the world pass, so it always wins and
draws on top. `renderer.clear(color, depth, stencil)` is the general form;
`clearDepth()` is shorthand for clearing only the depth channel.

This is the standard three.js technique for HUD/overlay passes (it's what
`autoClear = false` + a manual depth clear is *for* — the world scene's initial
implicit clear at the top of the frame already does color+depth+stencil via
`autoClear`'s default `true`, so we only need to insert one more depth-only clear
before the second pass).

## What `depthTest: false` would have done instead

Setting `depthTest: false` on the HUD cube's material tells WebGL to skip the
depth comparison entirely for that material — it draws unconditionally, ignoring
whatever is already in the depth buffer at each pixel it touches. This also
achieves "always on top," but the mechanism is per-material rather than per-pass.

Two related side effects to know about if this route is taken instead:
- With `depthTest: false`, `depthWrite` should also usually be set to `false`
  (it defaults to following `depthTest` in intent, but they're independent flags)
  — otherwise the HUD cube writes into the depth buffer despite skipping the read,
  which can produce odd results if anything else in the same scene/pass depth-tests
  against it.
- Because there's no depth comparison at all, draw order between multiple
  `depthTest: false` objects in the same scene is decided entirely by `renderOrder`
  (and otherwise their order of insertion/traversal), not by actual distance from
  the camera. With only one HUD object this doesn't matter; it would if the HUD
  scene grew more objects that should still occlude each other correctly.

## Why we'd go with `renderer.clearDepth()`

- **One place, not N.** `sceneHUD` currently has one mesh, but if more HUD elements
  are added later, a single `clearDepth()` call keeps all of them correctly
  depth-tested *against each other* while still ignoring the world scene — no need
  to remember to set `depthTest`/`depthWrite`/`renderOrder` on every new HUD
  material.
- **No material changes required.** `EntityComponentTestCube`'s shader material
  (`shaders/Simple_FractalDithering.js`) doesn't need new options threaded through
  just to support being used as a HUD element; the fix lives entirely in `main.js`'s
  render loop, next to the `autoClear = false` line it's already paired with.
- **Cost is negligible.** Clearing a depth buffer is a hardware-accelerated,
  resolution-scaled operation (see below), not something to trade off against the
  correctness benefit here.

`depthTest: false` is the right tool when you want a *specific object* to ignore
depth while coexisting with other depth-tested objects in the *same* scene/pass
(e.g. an outline effect, an X-ray silhouette). That's not this case — the whole
`sceneHUD` scene is conceptually "always in front," which is exactly what a
per-pass depth clear expresses directly, rather than a per-material flag repeated
on every HUD material.

## Performance

`clearDepth()` is a GPU clear operation whose cost scales with framebuffer
resolution, not scene complexity — modern GPUs have fast-clear hardware paths for
depth buffers specifically. It's the same category of operation as the implicit
clear that already happens once per frame via `autoClear`; adding one more before
the HUD pass is not measurably different from cost already being paid today.

## Status

Implemented — `main.js`'s `update()` now calls `renderer.clearDepth()` between the
two `renderer.render(...)` calls, right after `renderer.autoClear = false`.
