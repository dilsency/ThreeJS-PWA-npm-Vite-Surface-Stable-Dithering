# LightManager: direct reference vs. runtime entity-tree lookup

Context: `EntityComponentLightManager` (`entity components/lighting.js`) keeps
`hudSun`'s `EntityComponentDirectionalLight` in sync with `sun`'s every frame. Right
now it gets its "source" light the hard-coupled way — `main.js` constructs
`sun`'s light component into a local variable (`componentLightWorld`) and passes
that object straight into `EntityComponentLightManager`'s constructor params. The
alternative, which this project's ECS already supports, is a runtime lookup: have
`EntityComponentLightManager` ask the `EntityManager` for "whichever other entity
has an `EntityComponentDirectionalLight`" instead of being handed it directly.
This doc is about that choice, not a proposal to change it yet.

**Not to be confused with `sourceReferencePoint` (a different field on this
same class):** this doc is entirely about `source`/`#sourceLightComponent`
(`componentLightWorld`), which is still a direct reference, unconverted, as
described below. The *other* hand-wired field this class used to take,
`sourceReferencePoint` (always the world camera in practice), has since been
converted to a cached `EntityComponentContextEngine` lookup
(`this.methodGetCamera()`, resolved once in `methodInitialize()`) — see
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`. That was a different kind of
value (a bare-minimum Three.js singleton, not a specific other entity's
component) and a different decision from the one this doc works through;
don't read this doc's "kept direct reference for now" conclusion as also
covering `sourceReferencePoint`.

## The two approaches

**Direct reference (what we have now).** `main.js` builds `sun`'s light component,
keeps a reference to it, and threads that reference into `hudSun`'s
`EntityComponentLightManager` params:

```js
const componentLightWorld = new EntityComponentDirectionalLight({...});
entityLight.methodAddComponentWithName("EntityComponentDirectionalLight", componentLightWorld);
// ...
entityLightHUD.methodAddComponentWithName("EntityComponentLightManager", new EntityComponentLightManager({source: componentLightWorld}));
```

**Runtime lookup.** `EntityComponentLightManager` would instead search for its
source at `methodInitialize()` time, using the ECS's existing entity-tree query
(`EntityComponent.methodGetEntitiesWithComponent`, which delegates up through
`Entity` to `EntityManager.methodGetEntitiesWithComponent`):

```js
methodInitialize()
{
    const candidates = this.methodGetEntitiesWithComponent("EntityComponentDirectionalLight", this.methodGetName());
    const sourceEntity = candidates.find(e => e.methodGetName() === "sun");
    this.#sourceLightComponent = sourceEntity?.methodGetComponent("EntityComponentDirectionalLight");
}
```

## Performance: a non-issue either way

`methodGetEntitiesWithComponent` is a plain linear scan over
`EntityManager`'s flat entity array, calling `methodGetComponent` on each one. This
project has on the order of a dozen entities, and the lookup would only run once,
at `methodInitialize()` — not per frame. Even scaled up to hundreds of entities,
this is a sub-millisecond, one-time cost. Neither approach is meaningfully more
expensive than the other; performance was never the deciding factor here.

## What actually differs: coupling vs. ambiguity

**Direct reference couples `main.js`'s wiring to the LightManager's constructor
shape.** Whoever wires up entities has to know, and correctly pass, exactly which
component instance is "the source." If `main.js` reorganizes what constructs what
(e.g. lights get built somewhere else, or `sun` moves into a helper function), the
reference has to be threaded through that refactor by hand. That's the coupling
the lookup approach removes: `EntityComponentLightManager` would only need to know
a *name* ("sun"), not a live object reference — a smaller, more stable contract.

**Runtime lookup trades that coupling for ambiguity.** `methodGetEntitiesWithComponent`
filters only by component name string and "exclude my own entity name" — it can't
tell "the entity I actually want" from "any other entity that happens to have this
component." Today that's harmless because there's exactly one other
`EntityComponentDirectionalLight` in the scene. It stops being harmless the moment
a second one shows up (a fill light, a moon, a lamp entity) — the naive lookup
would return multiple candidates, and something has to disambiguate between them.
The sketch above resolves that by filtering further on entity name (`"sun"`), which
depends on every entity having a meaningful, stable name — which is exactly why
`main.js`'s entities were given explicit names (`"sun"`, `"hudSun"`, `"player"`,
etc., instead of the auto-generated `"entityName0"`, `"entityName1"`, ...) before
this doc was written, rather than after.

Also worth noting: this project's *other* disambiguation mechanism —
`methodAddComponentWithSuffix` / `methodGetComponentsWithSuffix`, meant for "more
than one component of the same kind on stuff" — currently has real bugs (see
`KNOWN_ISSUES.md`: undefined `paramComponentSuffix` in
`Entity.methodAddComponentWithSuffix`, undefined `nameExcludingSuffix` in
`Entity.methodGetComponent`). So name-based filtering on top of
`methodGetEntitiesWithComponent` is the more reliable disambiguation path available
today, not suffixes.

## Why we kept direct reference for now, and when we'd revisit it

For exactly one source and one follower, direct reference is simpler, has zero
ambiguity, and the "coupling" it introduces is just: `main.js` (which already
constructs every entity and already threads plenty of other cross-entity
references, e.g. `cameraPivot` into `EntityComponentPlayerController`) has to
build things in the right order and hand over one object. That's consistent with
how the rest of this codebase is wired, not a special case.

We'd likely switch `EntityComponentLightManager` to a name-based lookup if either
of these happens:
- **More than one "manager"/"follower" pair shows up** (e.g. a second HUD-like
  scene, or multiple lights needing to track different sources) — at that point,
  hand-threading references for every pair gets noisier than one lookup-by-name
  per manager, and the lookup's "ambiguity" problem is solved anyway (you'd be
  looking up by name, which is unambiguous).
- **`main.js`'s construction order stops being linear** (e.g. entities get built
  across multiple functions/files, lazily, or in a different order depending on
  scene/mode) — direct reference passing requires the source to exist and be
  reachable at the moment the follower is constructed; a name-based lookup only
  needs the source to exist by the time `methodInitialize()` runs, which is a
  looser and more refactor-resistant requirement.

Until then, direct reference stays: it's less code, it can't silently pick the
wrong light, and nothing about the current scene needs the extra decoupling.
