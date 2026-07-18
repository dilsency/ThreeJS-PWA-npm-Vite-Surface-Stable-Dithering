# Temporary dev tools vs. ECS

Context: `main.js`'s `TEMP dev tool` block (`initEntityComponents()`, starting
around the comment above `const tuningContainer = document.createElement("div")`)
builds a live tuning panel for cubeHUD — pitch/yaw/roll/shear inputs, alignment
cycling, presets, a collapsible show/hide toggle, and (as of the most recent
change) a reparented `PointerLock` button — entirely as plain DOM code inside a
`{}` block, not as an `EntityComponent`. This doc explains why, and states the
rule for what should happen to this code going forward.

## Why it doesn't use ECS today

1. **It's explicitly temporary.** The block is commented `TEMP dev tool` and
   documented (see `HUD_CUBE_ORIENTATION_AND_TUNING.md`) as meant to be deleted
   once final pitch/yaw/roll/shear values are chosen and baked into permanent
   constants (`cubeHUDTiltFactor`, `computeCubeHUDLayout`'s `yawRadians`, a real
   shear matrix/formula). Code with a planned deletion date doesn't earn back
   the cost of proper componentization.
2. **It doesn't fit the ECS shape functionally.** `EntityComponent` exists for
   things with a per-frame `methodUpdate(timeElapsed, timeDelta)` and/or a
   position/rotation in the scene graph that other components need to look up
   via `methodGetComponent` or react to via broadcast messages
   (`methodRegisterInvokableHandler`). The tuning panel has neither: it's pure
   event-driven DOM (`input`/`click` listeners), fires zero logic per frame,
   and has no position of its own — it's a UI overlay, not a scene entity.
3. **It reaches into other components' internals directly, by design, because
   it's throwaway.** The block closes over `componentCubeHUD`,
   `componentPanelHUD`, and (since the PointerLock button move)
   `componentPointerLockButton` as plain local variables from
   `initEntityComponents()`'s scope, and mutates `cube.rotation.x/y/z`,
   `plane.geometry`, and the button's inline styles directly — instead of
   going through `methodGetComponent` sibling lookups or broadcasting
   `invokableHandler` messages the way real cross-component communication in
   this codebase does (see `CLAUDE.md`'s ECS section). That's a deliberate
   shortcut for speed while the values are still being found by eye, not a
   pattern to imitate elsewhere.

## This is against the project's design philosophy

To be clear about the tradeoff being made here: `CLAUDE.md` establishes ECS —
entities composed of named, message-passing `EntityComponent`s — as *the*
architecture for this codebase. Everything else in `initEntityComponents()`
(the player, the cameras, every test cube, the light, the `PointerLock`
button) follows it. The tuning panel is the one piece of scene-adjacent
behavior that doesn't, and that's a real exception, not a stylistic variant —
it exists only because the code is scaffolding for finding numbers, not a
feature.

`EntityComponentButtonPointerLock` is proof this isn't a hard technical
limitation: it's a DOM button with no per-frame update and no scene position
either, and it's a perfectly normal `EntityComponent` (see
`entity components/test_objects.js`). A future `EntityComponentTuningPanel`
built the same way is entirely feasible — the tuning block just hasn't earned
that cost yet because it's still explicitly disposable.

## Shared local variables in the init pipeline are a symptom of the same problem

`initEntityComponents()` — and the init pipeline generally — freely declares
local variables (`cubeHUDSize`, `cubeHUDLayout`, `componentCubeHUD`,
`componentPanelHUD`, `componentPointerLockButton`, and so on) and lets later
code in the same function closure over them. That's exactly what lets the
tuning panel reach into other components' internals directly (point 3 above).
It's convenient, but it isn't how ECS is supposed to work, and it shouldn't
be treated as a normal way for two components to communicate.

**Entity components should be as self-contained as possible.** Each component
should declare and own its own state — private fields, constructor `params`,
`methodGetX`/`methodSetX` accessors — not read a variable that merely happens
to be sitting in `initEntityComponents()`'s scope. Cross-component
communication belongs in the ECS's actual mechanisms: `methodGetComponent`
sibling lookups and `methodRegisterInvokableHandler`/`methodBroadcastMessage`,
not shared locals threaded through closures.

**If a variable is needed by more than one entity component, that's a
signal, not a shortcut to take.** It means that value's ownership belongs in
its own entity component — a manager, helper, or reference component that the
others look up via `methodGetComponent` — rather than living as a bare local
in `initEntityComponents()` that multiple, otherwise-unrelated components
silently depend on. Concretely: don't reach for "add another local variable
in the init function and close over it from both places." Either give one of
the two components ownership and have the other look it up, or introduce a
small new component whose entire job is to own and expose that value.

Init-pipeline locals remain legitimate exactly to the extent they're doing
one-time construction-time work — parameterizing a component as it's built,
or short-lived scaffolding like the tuning panel itself. They stop being
legitimate the moment they become a de facto shared-state channel between
components at runtime, which is precisely what's happened here: the tuning
panel closing over `componentCubeHUD`/`componentPanelHUD`, and now
`componentPointerLockButton` too, is itself an instance of this exact
anti-pattern, not just an ECS-vs-plain-DOM issue. If the panel or the
PointerLock reparenting is ever made permanent, fixing *this* — replacing the
closured references with proper lookups or a dedicated component — is as
much a part of "converting it to ECS" as giving the panel its own
`methodInitialize()`.

## The rule going forward

**If any part of this dev tool is ever kept rather than deleted** — the
show/hide panel itself, the presets mechanism, or any individual control —
**convert it into a proper `EntityComponent` at that point, if at all
feasible.** Concretely, that means:

- Give it a real constructor `params` object and a `methodInitialize()` that
  builds the DOM, matching `EntityComponentButtonPointerLock`'s shape.
- Replace direct field pokes (`cube.rotation.x = ...`, `plane.geometry = ...`)
  with `methodGetComponent("EntityComponentTestCubeHUD")`-style sibling
  lookups, or route them through `methodSetRotations`/broadcast messages if
  the target component already listens for those.
- Register it via `entity.methodAddComponentWithName(...)` like every other
  piece of scene behavior, instead of living in a bare `{}` block.

The only case where staying outside ECS remains acceptable is if the tool
truly stays dev-only and disposable indefinitely (e.g., gated behind a debug
flag and never shipped) — even then, prefer converting it if the cost is low,
since consistency with the rest of the codebase has ongoing value (easier for
future readers, uniform lifecycle/debugging) beyond just "does it technically
need to be an entity."

## Status

Not yet done — the tuning panel remains a plain DOM block as of this writing,
per reasoning above. This doc exists so that decision doesn't need to be
re-litigated each time the panel grows a new control, and so that whoever
eventually decides to keep part of it permanently converts it rather than
leaving it as an ever-growing exception to the project's architecture.
