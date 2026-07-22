# Bare-minimum Three.js: exception or not?

## Glossary

Terms as used specifically in this doc — not general OOP definitions.
Alphabetical.

- **Hook method (hook)** — a method a base class calls *on itself*
  (`this.methodGetX()`) instead of inlining the logic directly, specifically
  so a subclass can override it to substitute different behavior at that one
  point, without touching the base class's private fields (which it
  structurally can't — see "Hook path"). The base class supplies a default
  implementation; the subclass only needs to override the hooks it actually
  wants to change. First introduced as `methodGetTargetScene()` (see
  "`sceneHUD` — done too" below) and reused for `methodGetShape()`/
  `methodGetColor1()`/`methodGetColor2()` (see "Player-identity hooks on
  `EntityComponentTestCube`" below). This is the classic OOP *template
  method* pattern — a fixed algorithm in the base class, with specific
  decision points left as calls to overridable methods. Every hook method,
  in every class that defines or overrides one, is wrapped in a
  `// #region overridable hook methods` / `// #endregion overridable hook
  methods` comment pair — see "Marking hook methods" below.
- **Hook path** — the specific route a value travels through a hook: the
  base class's shared logic (e.g. `methodInitialize()`) calls `this.methodGetX()`;
  because method dispatch is polymorphic, `this` may actually be a subclass
  instance, so the call resolves to whichever class's override actually
  runs, and *that* return value is what the shared logic uses. E.g. for
  cubeHUD: `EntityComponentTestCube.methodInitialize()` calls
  `this.methodGetShape()` → dispatches to `EntityComponentTestCubeHUD`'s
  override → which self-looks-up `EntityComponentContextLocalPlayerIdentity`
  and returns its shape index → that's what gets fed into
  `createFractalMaterialFromSources(...)`. Same shared algorithm either way;
  only the data source at that one decision point changes per-subclass.
- **Self-attaching sibling (Pattern C)** — a component that constructs a
  brand-new sibling component and attaches it to its own entity, from
  within its own `methodInitialize()`, via
  `this.methodGetParent().methodAddComponentWithName(name, component)` —
  rather than `main.js` ever constructing or knowing about that sibling.
  Distinct from self-lookup (Pattern A, see "Self-lookup vs.
  main.js-resolves-and-passes" below): self-lookup *finds* a component
  that already exists elsewhere in the ECS; this *creates* one that
  wouldn't otherwise exist. See "Pattern C: self-attaching sibling
  components" below for the full reasoning and the motivating
  `EntityComponentCameraControllerFirstPersonInput`/`...InputTouch` case.

Status: **resolved — the mechanism is proven and all six values are
converted, plus cameraPivot (not a Three.js value, but tightly tied to
camera in this project).** `scene` (via `EntityComponentRemotePlayerManager`),
`renderer` (via `EntityComponentButtonPointerLock`), `camera`/`cameraPivot`
(via `EntityComponentCameraControllerFirstPerson`, plus adapting
`EntityComponentLightManager` to fetch `camera` itself instead of receiving
it as a generic param), `sceneHUD` (which also resolved the reused-class
complication, via HUD-specific subclasses), and finally `cameraHUD` (once
`TODO.md` item 5.2 gave it a real consumer — see "`cameraHUD`" below) are
all converted and verified — see "A cheap way to actually find out" and the
per-value sections that follow it. What's still genuinely open is item
6.5's `entityManager`, which this conversion deliberately never covered
(different category — see that item).

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

**The question:** do we build an `EntityComponentContextEngine` (or similarly
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
    const entitiesWithEngineContext = this.methodGetEntitiesWithComponent("EntityComponentContextEngine", null);
    const componentEngineContext = entitiesWithEngineContext[0]?.methodGetComponent("EntityComponentContextEngine");
    const scene = componentEngineContext.methodGetScene();
    // ... use scene as before
}
```

This requires the `EntityComponentContextEngine`-holding entity to be
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
const componentEngineContext = this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine");
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
    return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetScene();
}
methodGetRenderer()
{
    return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetRenderer();
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
`"EntityComponentContextEngine"` were instead repeated inline across every
consuming component, renaming either string later means finding and fixing
every call site. Centralizing both literals inside these six getters means
only `EntityComponent` itself needs to know the actual names — every
consumer just calls `this.methodGetScene()` and never sees the string at
all.

**Not cached inside the getter itself.** Keep these stateless, mirroring
`methodGetComponent`/`methodGetEntitiesWithComponent`, neither of which
caches either. Whether an individual *consumer* caches the result is a
separate, settled question — see "Caching a resolved lookup is fine" below
for what that means and why it's safe.

**Failure mode stays consistent with the rest of the ECS.** If the
`"EngineContext"` entity somehow doesn't exist yet when one of these is
called (a startup-ordering bug, not an expected runtime state), the
optional-chaining just returns `undefined` — the same "no exception,
caller's job to null-check" contract `methodGetComponent` already has, not
a new failure mode to design around.

## Caching a resolved lookup is fine

Settled, and general — this isn't specific to `scene`, or to any one
consumer.

**What "caching" means here:** resolving the full lookup chain —
`this.methodGetEntityByName("EngineContext")`, then
`.methodGetComponent("EntityComponentContextEngine")`, then the specific
getter (`.methodGetScene()`, `.methodGetCamera()`, etc.) — exactly once,
typically inside a component's own `methodInitialize()`, and storing the
returned reference in a private field. Every later read (in
`methodUpdate()` or anywhere else) uses that stored field directly, instead
of re-running the lookup chain each time it's needed. This is *not* the
same thing as caching inside the shorthand getters themselves (see above,
still stateless) — it's each consumer choosing to remember the result of
one call it already made.

**Why this is safe, not just fast:** every value `EngineContext` holds
(`scene`, `renderer`, `camera`, `cameraPivot`, and whatever gets added
later) is constructed exactly once, in `main.js`'s `initBareMinimum()`,
before `EngineContext` itself is even built. Nothing anywhere in this
codebase ever constructs a *replacement* scene/renderer/camera/cameraPivot
and swaps it in later — these objects are only ever *mutated in place*
(rotated, moved, resized) for the rest of the app's lifetime, never
reassigned to point at a different object. The `"EngineContext"` entity
itself is also permanent: unlike, say, a remote player's entity (spawned
and despawned as peers connect/disconnect — caching a reference to *that*
kind of entity would be genuinely unsafe, since the cached reference could
outlive the real thing), `EngineContext` is built once during `init()` and
never removed. So a cached reference can't go stale the way a cached
reference to something temporary could — there's no scenario where the
object a component cached actually changes out from under it. (Performance
was never really the deciding factor either way, for the same reason
`LIGHT_MANAGER_COUPLING.md`'s "Performance" section gives for its own,
different lookup: a linear scan over a dozen-ish entities is a sub-millisecond,
one-time cost regardless of how often it's called — caching is about
avoiding *pointless* repeated work, not fixing something that was ever
actually slow.)

**Already applied this way:** `EntityComponentCameraControllerFirstPerson`
caches `scene`/`camera`/`cameraPivot` once in `methodInitialize()`, since it
reads and mutates them every `methodUpdate()` call; `EntityComponentLightManager`
caches `camera` (via its `sourceReferencePoint` field) the same way, for the
same reason. See "`camera`/`cameraPivot` — done too" below for both.

## Self-lookup vs. main.js-resolves-and-passes: which consumers should use which

Two genuinely different patterns exist across every `EntityComponentContext*`
consumer in this codebase, and it took a real mistake (caught and fixed) to
land on a clear rule for when to use each:

**Pattern A — self-lookup.** The consumer calls
`this.methodGetEntityByName("X")?.methodGetComponent("Y")` itself (typically
once, cached in its own `methodInitialize()` — see above), and never
receives the value through a constructor param at all. This is what the six
`EngineContext` shorthand getters (`methodGetScene()` etc.) are *for* —
every one of their callers uses this pattern.

**Pattern B — main.js resolves and passes.** `main.js` fetches the Context
component itself, calls its getters, and passes the *resolved values* into
the consumer's constructor params — the consumer never learns the Context
entity exists at all. `EntityComponentTestCubeHUD` (via the reused
`EntityComponentTestCube` base) works this way for `size`/`tiltFactor`
(from `EntityComponentContextHUDLayout`) and `color1`/`color2`/`shape`
(from `EntityComponentContextLocalPlayerIdentity`).

**The actual criterion — worked out by getting it wrong first.**
`EntityComponentPlayerNetworkSync` and `EntityComponentRemotePlayerManager`
were *originally* built using Pattern B too, uniformly with `componentCubeHUD`,
when `EntityComponentContextLocalPlayerIdentity` was introduced. That was a
mistake: the reasoning behind Pattern B — "keep the class agnostic of which
specific Context entity these values came from" — only actually applies to
`EntityComponentTestCube`/`EntityComponentTestCubeHUD`, because that class
is *reused* across multiple unrelated roles (the ground, the sun's cube,
cubeHUD, every remote player's cube). Coupling a reused, generic class to
one specific entity by name would be the wrong direction of coupling.
`EntityComponentPlayerNetworkSync`/`EntityComponentRemotePlayerManager`
aren't that kind of class at all — both are already single-purpose,
project-specific networking components, and both *already* did their own
cross-entity/sibling lookups for something else
(`EntityComponentPeerConnection`) before `LocalPlayerIdentity` ever existed.
Applying Pattern B to them wasn't protecting anything; it was just
`main.js` doing work that belonged in a class already fully willing to look
things up. Caught when asked directly "couldn't this component just get it
itself?" — corrected to Pattern A for both, which also makes `main.js`
itself cleaner (fewer resolved-getter calls cluttering its constructor
calls).

**The rule, stated positively:** use Pattern A (self-lookup) when the
consumer is already a single-purpose, project-specific component — one
that either already does cross-entity/sibling lookups for something else,
or would only ever be instantiated once, for one clear role. Use Pattern B
(main.js resolves and passes) only when the consumer is a *reused, generic*
class whose job is unrelated to any specific Context entity — where
knowing "LocalPlayerIdentity" or "HUDLayout" exists by name would be a real,
unwanted coupling, not just a convenience choice.

## Pattern C: self-attaching sibling components

Status: **done.** Implemented for choosing between
`EntityComponentCameraControllerFirstPersonInput` (mouse+keyboard) and
`EntityComponentCameraControllerFirstPersonInputTouch` (touch), both in
`entity components/camera_controller_first_person.js`. Verified via
`npm run build`, a headless-browser check confirming a plain (non-touch)
context self-attaches the mouse+keyboard class and a `hasTouch`/`isMobile`
context self-attaches the touch class, a synthetic touch-drag test
confirming the camera actually rotates from touch input end-to-end, and
the existing 2-tab PeerJS multiplayer test confirming
`EntityComponentPlayerNetworkSync` (downstream of this component) still
works correctly.

**How this differs from self-lookup (Pattern A).** Self-lookup *finds*
something that already exists elsewhere in the ECS — typically a
`EntityComponentContext*` component on a separate, well-known entity, put
there ahead of time by `main.js`. Pattern C is a different shape entirely:
a component's own `methodInitialize()` *constructs a brand-new sibling
component* and attaches it to its own entity, rather than `main.js` ever
constructing or knowing about that sibling at all.

**The motivating case.** `EntityComponentCameraControllerFirstPerson`
already hardcodes the sibling lookup string
`"EntityComponentCameraControllerFirstPersonInput"` in its own
`methodUpdate()` — it's already coupled to that name and to the exact
shape it exposes (`keys`/`mouseX`/`mouseY`/`methodResetMouse()`). Once
there are *two* concrete classes that can satisfy that shape (mouse+keyboard
vs. touch), something has to decide which one actually gets constructed.
The options considered: `main.js` branches on
`EntityComponentContextEnvironment.methodGetIsTouchPrimary()` before
constructing whichever one, or `EntityComponentCameraControllerFirstPerson`
decides and attaches its own Input sibling itself, inside its own
`methodInitialize()`. Chosen: the latter — since Logic already hardcodes
the sibling's *name* and *interface*, deciding which *concrete class*
satisfies that interface is a small, natural extension of a coupling that
already exists, not a new one. It also means `main.js` never needs to know
an Input sibling exists at all, let alone that there are two variants of
it — a stronger version of "no loose code in `main.js`" than reading a
getter to pick between two constructor calls would have been.

**The mechanics.** Nothing new has to be built to support this —
`EntityComponent.methodGetParent()` already returns the owning `Entity`,
and `Entity.methodAddComponentWithName(name, component)` (the same method
`main.js` already calls for every component) works identically no matter
who calls it:

```js
methodInitialize()
{
    // ...resolve scene/camera/cameraPivot as before...

    const componentEnvironment = this.methodGetEntityByName("Environment")?.methodGetComponent("EntityComponentContextEnvironment");
    const componentInput = componentEnvironment.methodGetIsTouchPrimary()
        ? new EntityComponentCameraControllerFirstPersonInputTouch()
        : new EntityComponentCameraControllerFirstPersonInput();
    this.methodGetParent().methodAddComponentWithName("EntityComponentCameraControllerFirstPersonInput", componentInput);

    // ...rest of methodInitialize() as before...
}
```

**No ordering hazard.** `Entity.methodAddComponentWithName()` synchronously
calls the new component's own `methodInitialize()` the moment it's
attached, and nothing reads `keys`/`mouseX`/`mouseY` until `methodUpdate()`
runs later, well after every entity across the whole init phase has
finished being built. Attaching a sibling mid-`methodInitialize()`, rather
than up front in `main.js`, changes *who* calls
`methodAddComponentWithName()`, not *when* relative to the frame loop.

**The trade-off, named plainly.** Today, swapping in a different Input
implementation (e.g. for a future test double) is a one-line change in
`main.js`. Under Pattern C, that choice is hardcoded inside
`EntityComponentCameraControllerFirstPerson` itself, so swapping it means
editing the Logic class, not `main.js`. Accepted here because this
project's own verification practice is real end-to-end browser/Playwright
runs (see `CLAUDE.md` — there is no unit-test suite doing per-component
dependency injection), so this cost is mostly theoretical rather than one
this project actually pays today.

**When to reach for Pattern C vs. Pattern A/B:** use it when a component
already owns a hardcoded sibling-name dependency (the way
`EntityComponentCameraControllerFirstPerson` already owned
`"EntityComponentCameraControllerFirstPersonInput"`), and the open question
is specifically *which concrete class* should satisfy that already-fixed
interface — not whether some *shared state* needs finding (that's still
Pattern A/B's territory, via `EntityComponentContext*` components).

**A real bug caught during implementation, worth remembering.**
`EntityComponentCameraControllerFirstPersonInput` registers its keydown/
keyup listeners on both `document` and `window`, "to be robust across
dev/preview builds" (some environments deliver keyboard events to `window`
instead of `document`, depending on focus). `EntityComponentCameraControllerFirstPersonInputTouch`
copied that same document+window pattern for its touch listeners at
first — and it silently broke touch look entirely. The difference:
`e.movementX`/`e.movementY` are deltas the *browser* already computed, so
reading the same event twice (once via each listener, since a bubbled
event fired on `document` reaches `window` too) just re-assigns the same
harmless value twice. Touch events carry only *absolute* coordinates, so
this class computes its own delta from a stored last-known position — and
firing twice per real event meant the second firing immediately
recomputed a delta of *zero* against the position the first firing just
moved to, discarding the real delta before
`EntityComponentCameraControllerFirstPerson.methodUpdate()` ever read it.
A synthetic touch-drag test caught this directly (deltas logged, but no
matching rotation ever applied) before it could ship. Fixed by listening
on `document` only — touch events bubble from wherever they were actually
touched, so there's no cross-target ambiguity here the way there is for
keyboard focus, and no window-level listener was ever needed. **The
lesson:** "register on both document and window for robustness" is safe
specifically when the value read is already fully computed by the browser
per-event; it silently corrupts anything computed by diffing against
component-held state across events, and needs re-checking case by case
rather than copied by habit.

## Player-identity hooks on `EntityComponentTestCube`

`componentCubeHUD` (the one Pattern-B holdout above) was itself converted
to self-lookup shortly after the rule above was written, once it became
clear Pattern B was solving a problem `EntityComponentTestCubeHUD` doesn't
actually have.

**The technical wrinkle.** `EntityComponentTestCube` resolves
`shape`/`color1`/`color2` synchronously in its *constructor*, into private
(`#`) fields. Two things block a subclass from just overriding that:

1. JS private fields are genuinely private, not convention-private — a
   subclass has no way to reach in and set `#shape` on its parent class,
   unlike (say) Python's single-underscore convention.
2. A subclass can't self-lookup `EntityComponentContextLocalPlayerIdentity`
   from its *own* constructor either, because `this.methodGetEntityByName`
   requires the component to already be attached to its owning `Entity` —
   and that link isn't established until *after* `new EntityComponentTestCube(...)`
   returns, when `Entity.methodAddComponentWithName` runs. This is the same
   reason `methodGetTargetScene()` (the `scene`/`sceneHUD` hook, above) is
   called from `methodInitialize()` rather than the constructor.

**How the fix solves it.** `EntityComponentTestCube` gained three more
overridable hooks — `methodGetShape()`/`methodGetColor1()`/`methodGetColor2()`,
each defaulting to the corresponding private field — and its
`methodInitialize()` now calls those hooks instead of touching `#shape`/
`#color1`/`#color2` directly, exactly mirroring the existing
`methodGetTargetScene()` pattern. `EntityComponentTestCubeHUD` overrides
all three hooks to read from `EntityComponentContextLocalPlayerIdentity`,
which it self-looks-up in its own `methodInitialize()` *before* calling
`super.methodInitialize()` (so the hooks have something to read by the
time the base class's `methodInitialize()` calls them to build the
material).

**Why not a separate `EntityComponentTestCubePlayer` superclass.** The
option on the table was a linear chain — `EntityComponentTestCube` →
`EntityComponentTestCubePlayer` (self-lookup) → `EntityComponentTestCubeHUD`
(HUD framing) — so the identity self-lookup would live in its own
dedicated class rather than directly in `EntityComponentTestCubeHUD`.
Rejected because `EntityComponentTestCubeHUD` has exactly **one**
instantiation anywhere in the codebase — `componentCubeHUD` in `main.js` —
and it is always the local player's own cube; there is no non-HUD
local-player cube anywhere to give `EntityComponentTestCubePlayer` a
second consumer (first-person means a player never sees their own body —
`EntityComponentRemotePlayerManager` explicitly never spawns one for the
local peer). A superclass that exists solely to be extended by the one
class that already needs the behavior is an extra layer of indirection
with no real second use, which runs against this project's own stated
bias against designing for hypothetical future requirements. If a genuine
second identity-driven, non-HUD cube ever shows up, the hooks added here
make lifting the self-lookup out into a shared `EntityComponentTestCubePlayer`
a small, mechanical refactor rather than a redesign — but there's no
reason to build that layer speculatively today.

## Marking hook methods: `// #region overridable hook methods`

Every hook method (see "Hook method" in the Glossary above) — in both the
base class that defines the default and any subclass that overrides it —
is wrapped in a matching pair of comments:

```js
// #region overridable hook methods

methodGetTargetScene()
{
    return this.methodGetScene();
}

// #endregion overridable hook methods
```

These are plain comments, not a build-time directive — nothing parses
`#region`/`#endregion`, they're purely a convention some editors (VS Code
among them) recognize for collapsible code folding. The point is
findability: a hook method looks exactly like any other method at a glance
(same `methodGetX()` shape as a plain getter), but it means something
structurally different — it's a point where a base class's behavior is
*meant* to be swapped out by a subclass, not just incidentally
overridable because everything in JS technically is. Marking the region
makes that boundary visible directly in the file, in both the base class
(here's what's overridable) and the subclass (here's what's actually being
overridden), rather than relying on doc comments alone to carry that
information.

**Applied to every current hook method:** `EntityComponentTestCube`/
`EntityComponentTestCubeHUD`'s `methodGetTargetScene()`/`methodGetShape()`/
`methodGetColor1()`/`methodGetColor2()` (`entity components/test_objects.js`)
and `EntityComponentDirectionalLight`/`EntityComponentDirectionalLightHUD`'s
`methodGetTargetScene()` (`entity components/lighting.js`). Any new hook
method added to any entity component should be wrapped the same way, in
every class that defines or overrides it.

The `#region`/`#endregion` convention doesn't stop at hook methods — every
other pre-existing informal section label across `entity components/` and
`classes/ECS/` (`// getters`, `// setters`, `// lifecycle`, `// construct`,
etc.) is wrapped the same way now too. See `NAMING_CONVENTIONS.md`'s
"Marking existing code sections" section for that broader sweep, the
region-boundary rule used, and why this section stays scoped to hook
methods specifically rather than covering that too.

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
why `EntityComponentContextEngine` needs to avoid this.)

**Decided: a dedicated init step, not "the first few lines of
`initEntityComponents()`".** Add a new `initEngineContext()` function,
called in `init()` between `initBareMinimum()` and `initEntityComponents()`:

```js
initBareMinimum();
initECS();
initEngineContext();   // new - builds the "EngineContext" entity + EntityComponentContextEngine
initEntityComponents();
```

so the guarantee that EngineContext exists before anything else needs it is
visible at `init()`'s own top-level call sequence, rather than relying on a
future reader correctly noticing that the first few statements inside a
large `initEntityComponents()` happen to matter more than the rest. Given
how vital and foundational this one entity is meant to be, that visibility
is worth the one extra named function.

**For consideration, not decided:**

- **`EntityComponentContextEngine` should stay strictly synchronous** — no
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

## A cheap way to actually find out — done, for `scene` and `renderer`

Implemented and verified. What actually got built, and one deliberate
deviation from the plan above:

- `EntityManager.methodGetEntityByName(paramName)` (`classes/ECS/entity_manager.js`),
  delegated through `Entity`/`EntityComponent` the same way
  `methodGetEntitiesWithComponent` already is.
- A minimal `EntityComponentContextEngine` (`entity components/context/context_engine.js`)
  holding just `scene` for now, with a deliberately synchronous
  `methodInitialize()` (see "Ensuring EngineContext initializes before
  everything else" above).
- `EntityComponent.methodGetScene()` — the one shorthand getter this first
  slice needs.
- `main.js`'s `initEngineContext()`, called between `initECS()` and
  `initEntityComponents()`, builds the `"EngineContext"` entity first.

**Deviation from the original plan:** the doc originally suggested
`EntityComponentDirectionalLight` or the ground's `EntityComponentTestCube`
as the one component to convert. Both turned out to be a worse fit than
they looked — both classes are *reused* across multiple instantiations that
need different scenes (`EntityComponentTestCube` backs the ground/sun-cube
with `scene` but cubeHUD with `sceneHUD`; `EntityComponentDirectionalLight`
backs the world sun with `scene` but the HUD sun with `sceneHUD`). Converting
either class outright would've broken its `sceneHUD` instantiations, since
`EntityComponentContextEngine` only holds `scene` at this stage. Converted
`EntityComponentRemotePlayerManager` instead — it has exactly one
instantiation in the whole codebase, and it only ever means the world
`scene`, so there's no ambiguity to work around.

**Verified:** `npm run build` clean. A real 2-tab PeerJS connection test
(headless Chromium, both tabs exchanging live `"identity"`/`transform`
messages — the exact path that calls `EntityComponentRemotePlayerManager.methodApplyIdentity()`,
which is where the converted `this.methodGetScene()` call actually lives)
produced zero console errors on either side, confirming the lookup resolves
correctly at runtime, not just at build time.

## `renderer` — done too

Converted next, same pattern: `EntityComponentContextEngine` now also holds
`renderer` (set in the same synchronous `methodInitialize()`), with a
matching `EntityComponent.methodGetRenderer()` shorthand getter.
`EntityComponentButtonPointerLock` (`requestPointerLock()`/checking
`pointerLockElement` against `renderer.domElement`) is the converted
consumer — chosen because, unlike `scene`'s candidates, it turned out to be
the *right* shape on the first check: it has exactly one instantiation in
the whole codebase (`main.js`'s `"pointerLockButton"` entity), so there was
no reused-class ambiguity to route around this time.

**Verified, with one real caveat.** `npm run build` clean. A headless
Chromium test clicked the button and called `requestPointerLock()` through
the converted `this.methodGetRenderer().domElement` — the call reached the
browser's real Pointer Lock API (not a `TypeError`/`undefined` failure),
but Chromium rejected it with `"The root document of this element is not
valid for pointer lock."` To rule out a regression, the identical test was
run against the last pushed commit (`bcd401a`, before any `EngineContext`
work existed at all, `renderer` still passed as a raw hard-wired
constructor param) via `git stash`/`git stash pop` — the exact same
rejection occurs there too. This confirms it's a pre-existing limitation of
requesting pointer lock from an automated/headless browser context, not
something this conversion introduced; genuine pointer-lock behavior is
untested by either version's automated suite and would need a real,
interactive browser to verify.

## `camera`/`cameraPivot` — done too, with two real roadblocks worked through

Unlike `scene`/`renderer`, `camera` didn't have a clean, no-wrinkle consumer
to pick — every real consumer had a wrinkle, discussed and resolved before
implementing:

1. **Its main consumer (`EntityComponentCameraControllerFirstPerson`) reads
   *and mutates* it every single `methodUpdate()` call, not just at
   construction.** Resolved by caching: `methodInitialize()` now resolves
   `this.#camera`/`this.#cameraPivot`/`this.#scene` once via
   `methodGetCamera()`/`methodGetCameraPivot()`/`methodGetScene()`, and
   every per-frame read/mutation uses the cached field, mirroring how
   `EntityComponentLightManager` already cached its own sibling lookup.
   Confirmed safe to cache: the underlying object is only ever mutated in
   place (rotated, position changed) — `main.js` never constructs a
   *replacement* camera/cameraPivot object after `initBareMinimum()`, so a
   cached reference never goes stale.
2. **`cameraPivot` isn't a Three.js concept, but is tightly tied to `camera`
   in this project's first-person rig.** Rather than converting `camera`
   alone and leaving `cameraPivot` as a lingering hard-wired param (a
   partially-converted, inconsistent-looking constructor), both were added
   to `EntityComponentContextEngine` together, alongside `scene`, so
   `EntityComponentCameraControllerFirstPerson`'s constructor needs zero
   bare-minimum params at all now (`new EntityComponentCameraControllerFirstPerson()`).
3. **`EntityComponentLightManager` received `camera` through a deliberately
   generic `sourceReferencePoint` constructor param, not a camera-specific
   one** — its own doc comment described it as "the source offset is
   measured from (e.g. the main camera)," implying genericity. Converting
   this consumer meant choosing between hardcoding "the reference point is
   always the camera" into a class designed to accept any `THREE.Object3D`,
   or leaving it hand-wired. Decided (with explicit sign-off, since this
   class's original generic design was never actually exercised by more
   than one real usage): adapt `EntityComponentLightManager` itself —
   `sourceReferencePoint` is no longer a constructor param; `methodInitialize()`
   now fetches `this.methodGetCamera()` directly and caches it, same as the
   camera controller. `targetReferencePoint` (the HUD cube component
   reference) stays a constructor param — it's a real cross-entity
   component reference, not a bare-minimum Three.js object, and converting
   it is `TODO.md` item 6.4's separate matter, not touched here.

**Verified.** `npm run build` clean. Two real-browser tests: (1) a single-page
test exercising mouse-look (`rotateX`/`rotateY` on the newly-cached
`camera`/`cameraPivot`), WASD movement, and the reset key (`camera.rotation.set(0,0,0)`)
for 30+ frames — zero console errors, which also exercises
`EntityComponentLightManager`'s `methodUpdate()` running every one of those
frames against its newly-cached camera reference; (2) the same 2-tab PeerJS
connection test used for `scene`, confirming `EntityComponentPlayerNetworkSync`
(which reads the camera controller's `methodGetPosition()`/
`methodGetCameraPivotQuaternion()`/`methodGetCameraQuaternion()` getters,
themselves now backed by the cached fields) still produces correct,
error-free `transform` messages end-to-end.

## `sceneHUD` — done too, resolving the reused-class problem via subclasses

Unlike `camera`, which sidestepped the reused-class problem entirely
(`EntityComponentLightManager` was adapted instead of routing through
`EntityComponentTestCube`/`EntityComponentDirectionalLight`), `sceneHUD`
couldn't route around it: `EntityComponentTestCubeHUD` (cubeHUD) and the HUD
sun's `EntityComponentDirectionalLight` instance both genuinely need
`sceneHUD`, and both underlying classes are also genuinely reused with
`scene` for other instances (ground/the sun's cube; the world sun).

**Decided approach: an overridable hook method, not a constructor flag.**
Both `EntityComponentTestCube` and `EntityComponentDirectionalLight` gained
a `methodGetTargetScene()` method, defaulting to `this.methodGetScene()`,
called instead of touching `scene` directly. Each class's HUD-specific
subclass overrides just that one method to return `this.methodGetSceneHUD()`
instead:

- `EntityComponentTestCubeHUD` already existed (cubeHUD's own subclass) —
  it just gained the override.
- `EntityComponentDirectionalLightHUD` is new, created purely to hold this
  one override, mirroring `EntityComponentTestCubeHUD`'s existing role —
  `main.js`'s hudSun instantiation now uses it instead of the base
  `EntityComponentDirectionalLight`.

This was the explicit decision on the subclass-vs-flag question raised
earlier: subclasses were chosen over a boolean constructor param
(`{isHUD: true}`) for consistency with the precedent `EntityComponentTestCubeHUD`
already set, and because HUD-specific components may reasonably grow their
own HUD-only needs/methods over time that a plain flag wouldn't give room
for — a real subclass leaves that room open by construction. Ground/the
sun's cube/the world sun (direct instances of the base classes) needed zero
changes; only the two HUD subclasses override anything.

**`EntityComponentBackgroundPlane`** (the HUD panel) was the one clean,
no-roadblock consumer, same shape as `scene`'s/`renderer`'s earlier picks —
exactly one instantiation, always `sceneHUD`, converted directly with no
hook needed.

**Verified.** `npm run build` clean. Two real-browser checks: a screenshot
after loading and looking around confirmed cubeHUD and the HUD panel render
correctly in `sceneHUD` (matching background color, correct position) with
zero console errors; a second screenshot looking down at the ground
confirmed the world scene (ground, correctly lit and shadowed by the world
sun) still renders correctly through the same `methodGetTargetScene()`
default path. The 2-tab PeerJS connection test was re-run too, confirming
remote-player cube spawning (`EntityComponentRemotePlayerManager`, itself
already converted for `scene`) still works — its now-redundant explicit
`scene: this.methodGetScene()` param was removed as part of this pass,
since `EntityComponentTestCube` resolves its own target scene internally by
default now.

## `cameraHUD` — done, once item 5.2 gave it a real consumer

Originally surveyed as having **no consumer at all** — unlike the other
five values, no `EntityComponent` anywhere received `cameraHUD` as a
hard-wired constructor param; every real usage lived inside `main.js`
itself, mostly in `computeCubeHUDLayout()` (the geometry function solving
cubeHUD's yaw correction and the HUD panel's fit via
`cameraHUD.project()`/`.unproject()`/`.lookAt()`), which was itself a bare
closure, not an `EntityComponent`. So `cameraHUD`'s conversion was never
blocked by a technical roadblock like `scene`'s reused-class problem or
`camera`'s per-frame-mutation/generic-param issues — it was gated on a
*sequencing* dependency: `computeCubeHUDLayout()` needed to become a real
component first (`TODO.md` item 5.2).

**That happened.** `computeCubeHUDLayout()` is now
`EntityComponentContextHUDLayout.methodComputeLayout()`
(`entity components/context/context_hud_layout.js`), attached to the "hudPanel"
entity *before* `EntityComponentTestCubeHUD`/`EntityComponentBackgroundPlane`
(both need its output as constructor params). `EntityComponentContextEngine`
now also holds `cameraHUD`, with a matching
`EntityComponent.methodGetCameraHUD()`; the new component fetches and
caches it once in its own `methodInitialize()` (it's called on demand — at
construction, and again by the live alignment-cycling tuning button — not
every frame, but the reference never changes regardless, so caching once
is still the right call per "Caching a resolved lookup is fine" above).

The constants `computeCubeHUDLayout()` depended on (`cubeHUDSize`,
`cubeHUDBaseOffset`, `cubeHUDTiltFactor`, the `panelInset*Px` values, etc.)
moved into the component as private fields alongside it, with
`methodGetSize()`/`methodGetTiltFactor()`/`methodGetTiltRadians()` getters
for the two remaining external readers (`EntityComponentTestCubeHUD`'s own
constructor params, and the tuning panel's `applyTuning()`).
`HUDCubeHorizontalAlignmentEnum`/`HUDPanelYawBehaviorEnum` are now named
exports from the component's file rather than `main.js` locals.

**Verified.** `npm run build` clean. A screenshot of the default layout
matched the pre-move screenshots pixel-for-pixel in position/shape,
confirming the math transcribed correctly rather than just "didn't throw."
Cycling the tuning panel's alignment button through all three states
(LEFT → RIGHT → CENTER → back to LEFT) repositioned the cube/panel
correctly at each step with zero console errors, exercising both branches
of the iterative corner-projection solve plus the CENTER default. A 2-tab
PeerJS connection test confirmed nothing multiplayer-related regressed from
touching `entityHUD`'s construction order.
