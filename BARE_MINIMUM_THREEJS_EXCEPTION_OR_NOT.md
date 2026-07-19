# Bare-minimum Three.js: exception or not?

Status: **open design question, nothing decided or implemented.** This doc
lays out the question, not an answer — see `TODO.md` item 6.5, which already
tracks this exact cluster ("flagged for a deliberate decision rather than
silently excluded") without resolving it either. `TODO.md` item 10 tracks
the concrete mechanism proposed below (`methodGetEntityByName` + a named
`"EngineContext"` entity) as its own task.

## The question

`scene`, `sceneHUD`, `renderer`, `camera`, `cameraPivot`, and `cameraHUD` are
Three.js's own "bare minimum" objects — built once in `main.js`'s
`initBareMinimum()`, before the ECS even exists. Today, `initEntityComponents()`
hands them to whichever components need them as plain constructor params,
hard-wired, entity by entity:

- `EntityComponentCameraControllerFirstPerson` gets `{scene, camera, cameraPivot}`
- `EntityComponentPlayerController` gets `{cameraPivot}`
- Every `EntityComponentTestCube` (ground, the sun's cube, cubeHUD) gets `{scene}` (or `{scene: sceneHUD}` for the HUD one)
- Every `EntityComponentDirectionalLight` (world sun, HUD sun) gets `{scene}` (or `sceneHUD`)
- `EntityComponentButtonPointerLock` gets `{renderer}` (needs `renderer.domElement` to request pointer lock)
- `EntityComponentBackgroundPlane` (the HUD panel) gets `{scene: sceneHUD}`
- `EntityComponentLightManager` gets `camera` itself as its `sourceReferencePoint`
- `EntityComponentRemotePlayerManager` gets `{scene, entityManager}`

Nearly every component in the file touches at least one of these. Per
`CLAUDE.md`'s ECS section and `TEMPORARY_DEV_TOOLS_VS_ECS.md`, this is
currently treated as an accepted exception to "components look each other up
through the ECS, not through hard-wired references" — the same category of
exception as `LIGHT_MANAGER_COUPLING.md`'s `componentLightWorld` case, just
at a much larger scale (one relationship there, nearly every component here).

**The question:** do we build an `EntityComponentEngineContext` (or similarly
named) that owns `scene`/`sceneHUD`/`renderer`/`camera`/`cameraPivot`/
`cameraHUD`, attach it to one entity constructed first, and have every other
component fetch what it needs from that component via the ECS's own lookup
mechanisms (`methodGetEntitiesWithComponent` cross-entity, since none of the
consuming components would live on the same entity as it) — instead of
receiving these objects as constructor params? Or do we leave this as a
deliberate, permanent exception, the same way `LIGHT_MANAGER_COUPLING.md`
leaves `componentLightWorld` as one?

## What the conversion would actually look like

Roughly, for every component that currently takes `scene` (or another
bare-minimum object) as a constructor param:

```js
// today:
constructor(params) { this.#params = params; /* this.#params.scene used later */ }

// converted:
methodInitialize()
{
    const entitiesWithEngineContext = this.methodGetEntitiesWithComponent("EntityComponentEngineContext", null);
    const componentEngineContext = entitiesWithEngineContext[0]?.methodGetComponent("EntityComponentEngineContext");
    const scene = componentEngineContext.methodGetScene();
    // ... use scene as before
}
```

This requires the `EntityComponentEngineContext`-holding entity to be
constructed and added to `entityManager` *before* any consuming entity's own
`methodInitialize()` runs — achievable, since `main.js` already controls
construction order and could simply build that entity first. `EntityComponentTestCube`'s
own `methodInitialize()` being `async` isn't a blocker either — the lookup
itself is synchronous and can happen before any `await`.

So this isn't blocked by anything structural in the ECS; it's a matter of
whether it's worth doing, and whether the resulting shape is actually a
better fit than what's there now.

## Pro: consistency

Following the same pattern everywhere means the "how components reach each
other" story has no carve-outs left to explain — `CLAUDE.md`'s ECS section
and `TEMPORARY_DEV_TOOLS_VS_ECS.md` could both drop their bare-minimum
exception language entirely. One rule, no exceptions, is simpler to state
and simpler for a future reader to trust.

## Con: it might not work smoothly, and the lookup pattern may not fit

Two separate concerns, not one:

**Might it break something?** Plausibly, at the mechanical level — this
touches the constructor signature of nearly every `EntityComponent` in
`entity components/`, which is a wide blast radius for something that's
otherwise pure wiring, not logic. Worth doing as a small experiment on one
component first (see below) before committing to converting all of them, to
find out cheaply whether the ordering/lookup actually behaves as expected in
practice, rather than assuming it from the trace above.

**Is the lookup mechanism actually the right tool here, even if it works?**
This is the sharper question. `methodGetEntitiesWithComponent` (and the
messaging system built on top of it — see `ECS_MESSAGING_DESIGN.md`) exists
specifically for the case where the *set* of matching entities is dynamic
and unknown ahead of time — the monsters/NPCs-changing-as-you-move-areas
example that design doc is built around. `scene`/`renderer`/`camera` are the
opposite of that: there will be exactly one of each, for the entire lifetime
of the app, and every single lookup — from every component, forever — would
resolve to the literal same instance. Nothing about that is "blind" or
"loosely coupled" in the sense the ECS messaging design cares about; it's
plain dependency injection, wearing an ECS lookup as a costume. Compare
`LIGHT_MANAGER_COUPLING.md`'s own reasoning for keeping `componentLightWorld`
as a direct reference ("for exactly one source and one follower, direct
reference is simpler, has zero ambiguity") — that doc's argument applies at
least as strongly here, arguably more so: a second light source is at least
plausible future scope (a fill light, a lamp entity — that doc says as much
in its own revisit triggers); a second `scene`/`renderer` isn't really
plausible without an entirely different rendering architecture (split-screen,
multiple independent render passes with unrelated scene graphs), which isn't
remotely on this project's horizon.

## Weighed against this session's own "no free pass" stance

Worth being honest about the tension here rather than quietly resolving it
one way: elsewhere this session, hand-wiring in `main.js` was deliberately
*not* given a pass just because a relationship happens to be a fixed
singleton today (see `ARCHITECTURE.md`'s "Why a hand-rolled ECS" section —
"being a fixed singleton today doesn't make a hand-carried reference
architecturally sound, it just makes it lower-priority to fix"). By that
same standard, this cluster doesn't get to claim "it's fine, there's only
one" as a free pass either — it should stay tracked as a real, open item
(which `TODO.md` item 6.5 already does), not be dismissed here.

What that standard doesn't settle, though, is *how* to fix it, or whether
"fix" specifically means "route it through `methodGetEntitiesWithComponent`."
The con above isn't "it's a singleton so it's fine" — it's "the specific
lookup mechanism this project already has, built for dynamic/unknown sets,
may not be the right shape for a value that is definitionally never dynamic
and never plural." That leaves room for a *different* fix than the one this
doc's question proposes — e.g. some other, more DI-flavored ECS-native
mechanism — without that being the same move as excusing the status quo.

## A different fix: name the entity, look it up by name instead of by component

The "wrong tool" concern above has a real answer, not just a "some other
mechanism, TBD": give the holding entity a fixed, predictable name (e.g.
`"EngineContext"`) when it's added to `entityManager`, and look it up *by
that name* instead of by component. Today's ECS has no primitive for this —
checked (`classes/ECS/entity.js`/`entity_manager.js`): `methodGetName()`
exists on both `Entity` and `EntityComponent`, but the only place it's used
anywhere is as an *exclusion* filter inside `methodGetEntitiesWithComponent`
(`paramEntityNameToExclude`) — there's no way today to ask "give me the one
entity with this exact name." That would be a small, genuinely new addition:

```js
// EntityManager
methodGetEntityByName(paramName)
{
    return this.#entities.find((e) => e.methodGetName() === paramName) ?? null;
}
```

delegated through `Entity`/`EntityComponent` the same way
`methodGetEntitiesWithComponent` already is (`Entity.methodGetEntityByName`
calling `this.#parent.methodGetEntityByName`, and so on up).

**Why this actually resolves the sharper concern, not just works around it:**
`methodGetEntitiesWithComponent` answers "which of an unknown, possibly-empty,
possibly-plural set of entities have this capability?" — a real question,
with a real ambiguity problem, for the dynamic-set case it was built for.
A name-based lookup asks a different question entirely: "give me the one
specific entity I already know, by construction, is unique and permanent
for this app's entire lifetime." There's no candidate list to filter, so
there's no ambiguity to resolve in the first place — this isn't borrowing a
tool built for something else, it's the right-shaped tool for a
known-unique, known-permanent resource. Three.js itself already uses this
exact idiom one level down in the scene graph (`Object3D.getObjectByName`) —
finding a well-known, singular node by its given name rather than by
filtering by type — so this isn't a novel pattern being invented here, just
the ECS-level equivalent of one Three.js already relies on.

It also isn't newly risky: this ECS has never enforced entity-name
uniqueness anywhere (`methodAddEntity` stores whatever name it's handed,
no collision check) — `"player"`, `"sun"`, `"multiplayer"`, etc. are already
trusted-unique purely by convention. `methodGetEntityByName` returning the
first match (mirroring `getObjectByName`'s own semantics) rides on that same
existing convention rather than introducing a new category of trust.

Worth noting: `LIGHT_MANAGER_COUPLING.md`'s own "when we'd revisit" section
already anticipated needing exactly this — its sketch for a
name-disambiguated lookup depends on "every entity having a meaningful,
stable name," which is *why* `main.js`'s entities got explicit names in the
first place, per that doc. Building `methodGetEntityByName` as a general
ECS primitive (not a one-off hardcoded to `"EngineContext"`) would serve
both docs' future plans at once, not just this one.

Once it exists, fetching a specific bare-minimum value is a small
composition, not a special method of its own:

```js
const componentEngineContext = this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext");
const scene = componentEngineContext.methodGetScene();
```

Whether that two-line composition is worth collapsing further into one
convenience call was left as a follow-up question above — resolved next.

## Convenience getters: `methodGetScene`/`methodGetRenderer`/etc. on `EntityComponent`

Given how central `scene`/`renderer`/etc. are — nearly every component in
`entity components/` needs at least one of them, per "The question" above —
the repetition this two-line composition would create isn't speculative,
it's already known upfront. That tips the "premature abstraction" call the
other way: build the shorthand now, rather than waiting to see if enough
call sites accumulate to justify it.

**Proposal:** one small getter per bare-minimum value, added directly to
`EntityComponent` (`entity_component.js`), each composing the same two
calls:

```js
methodGetScene()
{
    return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")?.methodGetScene();
}
methodGetRenderer()
{
    return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")?.methodGetRenderer();
}
// ...and methodGetSceneHUD / methodGetCamera / methodGetCameraPivot / methodGetCameraHUD, one each
```

Every consuming component then just calls `this.methodGetScene()` instead
of repeating the `methodGetEntityByName(...)?.methodGetComponent(...)` chain
itself.

**Why `EntityComponent`, not a standalone helper function or a matching set
on `Entity`:** this ECS's base classes are already project-specific, not a
generic reusable library — `methodGetPosition`/`methodSetPosition` already
bake in this project's own conventions the same way `methodGetScene()`
would. Adding it alongside `methodGetComponent`/`methodGetEntitiesWithComponent`/
`methodGetEntityByName` is consistent with that, not a new kind of
exception. A free-standing helper function (`methodGetScene(entityComponent)`)
would break from this codebase's `this.methodX()` convention (`CLAUDE.md`'s
naming section: "methods are prefixed `method`"), so that shape isn't
proposed here. `Entity` doesn't need matching versions: only components
ever actually touch `scene`/`camera`/etc. in practice — an `Entity` itself
is just a bag of components — so there's nothing to add there without
speculative bloat.

**A real DRY win, not just convenience.** If `"EngineContext"`/
`"EntityComponentEngineContext"` were instead repeated inline across every
consuming component, renaming either string later means finding and fixing
every call site. Centralizing both literals inside these six getters means
only `EntityComponent` itself needs to know the actual names — every
consumer just calls `this.methodGetScene()` and never sees the string at
all.

**Not cached inside the getter itself.** Keep these stateless, mirroring
`methodGetComponent`/`methodGetEntitiesWithComponent`, neither of which
caches either. Whether an individual *consumer* wants to resolve `scene`
once in its own `methodInitialize()` and stash it in a private field (the
way `EntityComponentLightManager` already does for its own sibling-light
lookup) versus calling `this.methodGetScene()` fresh every frame is each
component's own call — most only need it once, at mesh-construction time,
so this rarely matters in practice. The lookup itself is cheap regardless
of how often it runs (same "non-issue" analysis as
`LIGHT_MANAGER_COUPLING.md`'s "Performance" section — a linear scan over a
dozen-ish entities, not a per-frame cost concern even if called every
frame).

**Failure mode stays consistent with the rest of the ECS.** If the
`"EngineContext"` entity somehow doesn't exist yet when one of these is
called (a startup-ordering bug, not an expected runtime state), the
optional-chaining just returns `undefined` — the same "no exception,
caller's job to null-check" contract `methodGetComponent` already has, not
a new failure mode to design around.

## Ensuring EngineContext initializes before everything else

**Decided: give it its own dedicated init step** (see below) — the
synchronous-invariant and console.error points further down are recorded
for consideration, not decided either way.

**Why this is tractable at all:** this ECS's init pipeline has no separate
"construct everything, then initialize everything" phase —
`EntityManager.methodAddEntity()` calls `entity.methodInitialize()`
immediately, synchronously, and `Entity.methodAddComponentWithName()` calls
`component.methodInitialize()` immediately too, right after attaching it.
Ordering is entirely determined by the literal, linear order of statements
in `main.js` — there's no race condition to manage, only "whichever line
runs first, runs first." (The one exception anywhere in this codebase: a
component whose *own* `methodInitialize()` is explicitly `async`, like
`EntityComponentTestCube` awaiting a texture/shader fetch — see below for
why `EntityComponentEngineContext` needs to avoid this.)

**Decided: a dedicated init step, not "the first few lines of
`initEntityComponents()`".** Add a new `initEngineContext()` function,
called in `init()` between `initBareMinimum()` and `initEntityComponents()`:

```js
initBareMinimum();
initECS();
initEngineContext();   // new - builds the "EngineContext" entity + EntityComponentEngineContext
initEntityComponents();
```

so the guarantee that EngineContext exists before anything else needs it is
visible at `init()`'s own top-level call sequence, rather than relying on a
future reader correctly noticing that the first few statements inside a
large `initEntityComponents()` happen to matter more than the rest. Given
how vital and foundational this one entity is meant to be, that visibility
is worth the one extra named function.

**For consideration, not decided:**

- **`EntityComponentEngineContext` should stay strictly synchronous** — no
  `async methodInitialize()`, no awaited resource loads. This is the actual
  invariant the "first in source order = ready" guarantee above depends on.
  It's easy to keep, since this component only ever stashes already-existing
  object references (`scene`/`renderer`/etc. are already fully constructed
  by the time `initEngineContext()` runs) — there's nothing to fetch. Worth
  stating explicitly anyway: if this component ever *did* need to await
  something later, "construct it first" would stop being sufficient on its
  own, and it would need the same kind of readiness-retry pattern `main.js`
  already uses (and is trying to get away from, per `TODO.md` item 1) for
  cubeHUD's async mesh.
- **The six shorthand getters could fail loudly instead of silently.** This
  codebase never `throw`s anywhere, and has exactly one `console.error` call
  in the whole project (a real WebRTC error in `peer_connection.js`) —
  everything else fails silently via early-return/`undefined`. Worth
  considering a deliberate exception to that for these six getters
  specifically: `console.error` (matching that one existing precedent, not
  introducing `throw` as a new pattern) before returning `undefined` if
  `EngineContext` isn't found. Unlike every other cross-entity lookup in
  this codebase — where "not found yet" is a normal, expected state (e.g. no
  peer connected yet) — `EngineContext` missing is never a valid state once
  `init()` has finished, so silently tolerating it the way `methodGetComponent`
  already does elsewhere may not actually be the right default for this one
  case. A loud console message pointing at the actual problem is a faster
  signal than a confusing `undefined` three calls deep in unrelated code, if
  the ordering invariant above is ever accidentally broken by a future edit.

## A cheap way to actually find out

Rather than converting every component at once, try it on exactly one:
pick a single, low-stakes consumer (e.g. `EntityComponentDirectionalLight`
for the world sun, or the ground's `EntityComponentTestCube`), add
`methodGetEntityByName` to the ECS classes, build a minimal
`EntityComponentEngineContext` holding just `scene` for now, add just
`EntityComponent.methodGetScene()` (the one shorthand getter this first
slice actually needs), attach the context to a new entity named
`"EngineContext"` via a minimal `initEngineContext()` step called before
`initEntityComponents()`, and convert only that one component's `scene`
access to `this.methodGetScene()`. Run `npm run dev`, confirm nothing
regresses, before deciding whether to mechanically repeat it — both the
`EntityComponentEngineContext` fields and their matching shorthand getters —
for every other component and every other bare-minimum object
(`sceneHUD`/`renderer`/`camera`/`cameraPivot`/`cameraHUD`). This answers
"does it work" cheaply, and gives a real, concrete example to judge "is the
resulting code actually better" against, rather than deciding either
question in the abstract.
