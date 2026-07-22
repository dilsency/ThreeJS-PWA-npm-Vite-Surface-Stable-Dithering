# Input methods

This doc is the project's home for how the input system works generally -
the Input-vs-Logic split every controller follows, how a controller ends up
with a mouse+keyboard implementation and a touch implementation that are
interchangeable, and open design questions specific to input handling (like
this doc's own current discussion: what should drive gesture-timing
measurements). For the general "self-attaching sibling" mechanism a
controller uses to pick which Input class it gets, see
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Pattern C: self-attaching
sibling components" section - this doc stays scoped to input specifically,
not ECS patterns in general.

## The Input-vs-Logic split

Every controller in this ECS splits into two components:

- An **Input** component - owns nothing but raw, source-specific state
  (which keys are down, how far the mouse/finger moved since last read) and
  the event listeners that produce it. Doesn't know or care what that state
  is used for.
- A **Logic** component - reads that state each `methodUpdate()` and applies
  it (rotates the camera, moves `cameraPivot`). Doesn't know or care *how*
  the state it's reading was produced, only the shape it exposes.

Two controllers exist today, both in `entity components/`:

- `camera_controller_first_person.js` - `EntityComponentCameraControllerFirstPerson`
  (Logic) reads `keys.up/down/left/right/reset` and `mouseX`/`mouseY`/
  `methodResetMouse()` off whichever Input sibling is attached, to drive
  camera look.
- `player_controller.js` - `EntityComponentPlayerController` (Logic) reads
  `keys.forward/backward/left/right/up/down` off whichever Input sibling is
  attached, to move `cameraPivot`.

## Two interchangeable Input sources per controller: mouse+keyboard and touch

Each controller has exactly two concrete Input classes today, both exposing
the *identical* shape, so the Logic component genuinely cannot tell which
one is attached without checking:

| Controller | Mouse+keyboard | Touch |
|---|---|---|
| Camera look | `EntityComponentCameraControllerFirstPersonInput` | `EntityComponentCameraControllerFirstPersonInputTouch` (swipe to turn) |
| Player movement | `EntityComponentPlayerControllerInput` | `EntityComponentPlayerControllerInputTouch` (double-tap-and-hold to walk forward) |

Which one gets constructed is decided by
`EntityComponentContextEnvironment.methodGetIsTouchPrimary()` (feature
detection - `'ontouchstart' in window`/`navigator.maxTouchPoints > 0` - not
`navigator.userAgent` sniffing; see
`entity components/context/context_environment.js`). Each Logic component
self-attaches whichever Input class it needs to its own entity, inside its
own `methodInitialize()` - `main.js` never constructs an Input component for
either controller, and never knows two variants of either one exist. See
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Pattern C" section for the
full mechanics and why this shape was chosen over `main.js` branching on
which class to build.

Both touch classes stay permanently `false`/unused on whichever fields have
no touch gesture yet (`keys.reset`/arrow-nudge for camera look; all of
`backward`/`left`/`right`/`up`/`down` for player movement) - the Logic
components read those fields unconditionally, so the fields have to exist
regardless of whether touch actually drives them.

## Touch gesture detection: identifier-scoped, not `touches[0]`

Both touch Input classes track specific touches by `Touch.identifier`, not
just `e.touches[0]` - so an unrelated second finger touching down or
lifting can't interfere with an already-in-progress gesture (an ongoing
camera drag, or an ongoing walk-hold).

**A real bug already caught here, worth remembering generally:** registering
touch listeners on *both* `document` and `window` - mirroring the
mouse+keyboard Input classes' own "robust across dev/preview builds" habit
for `keydown`/`keyup` - silently corrupts any state computed by *diffing
across events* (a drag delta, a tap's elapsed duration), since a bubbled
event reaches both listeners and the second firing recomputes against state
the first firing just updated a moment earlier. It's harmless for state the
browser already computed per-event (`e.movementX`), since re-reading the
same event twice just re-assigns the same value twice - the risk is specific
to hand-computed, cross-event state. Both touch Input classes register on
`document` only for this reason. Full story in
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Pattern C" section.

## Timing source for gesture detection: `performance.now()` vs. the ECS clock

Status: **done.** `EntityComponentPlayerControllerInputTouch` (`entity
components/player_controller.js`) measures elapsed time via
`methodUpdate(timeElapsed, timeDelta)` accumulators now, not
`performance.now()`.

**What it replaced.** Double-tap-and-hold detection needs two durations:
how long a candidate touch has been down (to tell a tap from a
drag/long-press), and how much time has passed since the last completed tap
(to detect a double-tap). Both used to be measured by sampling
`performance.now()` directly inside the `touchstart`/`touchend` DOM event
handlers and diffing two timestamps.

**How it works now.** The ECS's own `methodUpdate(timeElapsed, timeDelta)` -
called once per rendered frame, cascading `EntityManager` → `Entity` →
`EntityComponent`, the same clock every other component's `methodUpdate()`
already receives - drives two accumulators instead: `#candidateElapsedSeconds`
resets to `0` when a candidate touch begins and accumulates `timeDelta`
every frame while that touch hasn't ended yet;
`#pendingTapElapsedSeconds` resets to `0` when a tap completes, accumulates
`timeDelta` every frame, and is nulled out by `methodUpdate()` itself once
it exceeds the double-tap window - so the window expiring is a fact
`methodUpdate()` establishes proactively, not something re-derived
reactively inside the next `touchstart` handler. The threshold constants
changed from milliseconds to seconds to match (`THREE.Clock`'s
`getDelta()`/`getElapsedTime()` are in seconds).

- **Pro, realized:** one clock source for "how much time has passed"
  everywhere in the codebase, instead of two (the ECS's per-frame clock,
  and an independent wall-clock sample taken ad hoc inside DOM event
  handlers).
- **Con, accepted:** touch events fire asynchronously, whenever the browser
  dispatches them - not on the `requestAnimationFrame` schedule
  `methodUpdate()` runs on. The accumulators are therefore only as fresh as
  the last frame that actually ran - up to ~16ms of slop (at 60fps) in
  either direction, versus `performance.now()`'s true wall-clock precision.
  Against this feature's actual thresholds (a few hundred milliseconds
  each), that's under 1% error and has been imperceptible in testing.

**Verified** via `npm run build`, the existing double-tap-and-hold
end-to-end test (unaffected - same behavior, different timing source), and
a new test specifically for window expiry: two taps spaced 600ms apart
(beyond the 300ms window) correctly did *not* trigger walking, confirming
`methodUpdate()`'s own expiry logic actually works, not just the
happy-path trigger.

**The general preference this instance establishes:** prefer the existing
ECS lifecycle methods - `methodInitialize()`, and especially
`methodUpdate(timeElapsed, timeDelta)`'s own clock - over an independent,
adjacent mechanism, whenever the ECS's own facilities can actually do the
job. `performance.now()` and `methodUpdate()`'s `timeDelta` both
ultimately trace back to the same underlying browser clock, so reaching for
`performance.now()` here wasn't solving a problem the ECS clock couldn't -
it was just a second "how much time has passed" mechanism sitting alongside
one the codebase already had, for every other component, everywhere else.
See `ARCHITECTURE.md`'s "Why a hand-rolled ECS instead of a library"
section for the broader version of this same principle applied to
structure rather than timing specifically.
