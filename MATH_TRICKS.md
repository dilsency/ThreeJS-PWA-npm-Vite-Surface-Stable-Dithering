# Math tricks and formulae

This doc collects worked explanations of the less-obvious math patterns used
(or planned for use) in this codebase — written to build intuition for *why*
a formula works, not just to state it. Add a new section per technique as
they come up, rather than trying to be exhaustive up front.

## Interpolation alpha: a resettable linear ramp

**Where:** `EntityComponentRemotePlayerManager`
(`entity components/remote_player_manager.js`) — `methodApplyTransform()`
(sets `start`/`target`) and `methodInterpolateRemoteTransforms()` (advances
`elapsed` and applies the lerp/slerp every frame). Implements `TODO.md`
item 7.

**The problem:** `EntityComponentPlayerNetworkSync` only sends a `"transform"`
message ~18 times per second (throttled — see `MULTIPLAYER_TOPOLOGY_AND_SYNC.md`),
but rendering happens ~60 times per second. Snapping the remote cube straight
to each new message the instant it arrives makes it visibly jump between
positions instead of moving smoothly. The fix is to interpolate: keep moving
the cube gradually from where it last was toward the newest received value,
rather than teleporting to it.

**The formula:**

```js
state.elapsed += timeDelta;                              // every frame
const alpha = Math.min(state.elapsed / duration, 1);      // every frame
cube.position.lerpVectors(state.startPosition, state.targetPosition, alpha);
cube.quaternion.slerpQuaternions(state.startQuaternion, state.targetQuaternion, alpha);
```

with `state.elapsed` reset to `0` (and `start`/`target` re-pinned) only when
a fresh `"transform"` message actually arrives, and `duration` a fixed
constant matching the sender's throttle interval (`1/18` seconds).

**Why `elapsed / duration` smoothly ramps from 0 to 1:**

- `elapsed` only ever grows between resets — `timeDelta` (from
  `THREE.Clock.getDelta()`) is always a small positive number, and `+=`
  never lets it decrease. So `elapsed` traces a straight, monotonically
  increasing line in real time: `dt₁`, `dt₁+dt₂`, `dt₁+dt₂+dt₃`, ...
- `alpha` is just that same line rescaled by a constant (`1/duration`), so
  it's also a straight, monotonically increasing ramp — not a curve, not a
  step function jumping straight from 0 to 1.
- How many *rendered frames* that ramp actually spans depends on the ratio
  of `duration` to the frame's `timeDelta`. At `duration = 1/18 ≈ 0.056s`
  and a typical ~60fps (`timeDelta ≈ 0.0167s`), the ramp crosses from 0 to 1
  over roughly 3-4 rendered frames (something like `0.30 → 0.60 → 0.90 →
  1.0`) — several small steps, not one abrupt jump. That's the actual
  source of the smoothness: messages arrive roughly every 3-4 render
  frames, and the ramp is tuned to take about that long to complete.
- `Math.min(..., 1)` clamps the ramp once it reaches the target, so the cube
  holds still at `target` — rather than overshooting past it — for however
  long it takes the *next* message to arrive and restart the ramp from
  `elapsed = 0` again.

**Edge case: what if a single frame's `timeDelta` is bigger than `duration`?**
(E.g. the browser tab was backgrounded and JS execution paused, so the next
`getDelta()` call returns several seconds of backlog at once.) Then `alpha`
jumps straight from `0` to the clamped `1` in a single step — no visible
interpolation happens for that segment at all. This isn't a bug: it's the
ramp gracefully degenerating to "just snap to the correct position," which
is exactly the right behavior when there's no sensible way to animate
through however many seconds just elapsed.

**Why position uses `lerp` but rotation needs `slerp`, specifically:**
`Vector3.lerpVectors` (plain linear interpolation, component-by-component)
is fine for position — any weighted average of two points in space is
itself a valid point. Quaternions don't have that property: linearly
interpolating a rotation's `x/y/z/w` components component-by-component does
not, in general, produce another *unit-length* quaternion, so the result
wouldn't represent a valid rotation at all without renormalizing, and even
renormalized it wouldn't move at a constant angular speed. `slerp`
("**s**pherical **l**inear interpolation") instead walks along the shortest
arc on the unit hypersphere of rotations, so every intermediate value is
automatically a valid rotation and the rotation speed stays constant across
the whole interpolation — which is what actually looks physically correct
for something spinning smoothly from one orientation to another.

**Why `start` is reset to "wherever the cube currently is," not "the old
target":** if a new message arrives *before* the previous interpolation
segment finished (`alpha` hadn't yet reached `1`), re-pinning `start` to the
old target would cause a visible pop back to that old target before the new
segment begins. Reading the cube's actual current displayed position/
rotation instead means the new segment continues smoothly from wherever the
cube visually already is, with no discontinuity — only the object's
*position* stays continuous this way, not necessarily its *velocity* (the
rate of motion can visibly change between segments), but a velocity kink is
imperceptible over the small timing jitter this actually happens under.

**Special case: a peer's very first `"transform"` message.** With no prior
interpolation state to read a `start` from, the cube would otherwise lerp in
from whatever position `EntityComponentTestCube`'s constructor happened to
spawn it at (unrelated to the sender's real position). The fix is to detect
"no existing state for this peer yet" and snap immediately instead — set
`start = target` and `elapsed = duration` (i.e., already fully arrived) —
rather than running the ramp on the very first sample.
