# Naming conventions — in-progress design discussion

Status: **method rename done (`TODO.md` item 8.1); cross-entity shorthand
implemented (`TODO.md` item 9); the `invokableHandlerName`/
`invokableHandlerValue` field rename is still open; the
`EntityComponentContext*` naming family (below) is decided and applied.**
This doc tracks ECS naming/design conversations generally — the messaging
methods (`entity.js`/`entity_component.js`), split into what's done already
and what's still genuinely undecided, and (further down) the naming
convention for entity-component *classes* that hold state shared across
multiple other components. For *why* the messaging mechanism should be
preferred over direct method calls in the first place, and the design
principles behind it, see `ECS_MESSAGING_DESIGN.md` — this doc stays scoped
to what things should be *called*, not why the mechanism works the way it
does.

## Why this came up

`methodBroadcastMessage`/`methodRegisterInvokableHandler` (as they were
originally named — since renamed, see "Done — renamed" below) were scoped to
a single `Entity` — a component can only reach *other components on the same
entity* this way, never components on a different entity (see `CLAUDE.md`'s
ECS section, which now documents this explicitly). The name "broadcast"
didn't convey that scope at all — if anything, it suggested the opposite
(project-wide, or at least wider than one entity). This isn't hypothetical:
it's exactly what caused real confusion in this same conversation, where the
same-entity-only scope had been forgotten.

Worth noting for anyone coming from another engine: Unity's own
`BroadcastMessage` specifically means "this GameObject *and its children*,"
while `SendMessage` means "this GameObject only." This project's mechanism
has no entity hierarchy at all — it's closer to Unity's `SendMessage` than
`BroadcastMessage` — so keeping the word "Broadcast" unqualified doesn't just
fail to clarify scope, it points toward the wrong external convention.

"Sibling" (already used in `CLAUDE.md` for the *direct* same-entity lookup,
`methodGetComponent`) was considered as the scope qualifier instead, but
rejected: it's a metaphor a reader has to already know ("sibling" = "same
entity"), whereas naming the constraint literally needs no learned
vocabulary at all. Candidate names built on that metaphor were considered
and dropped for the same reason before landing on the "Within Entity"
phrasing below: `methodBroadcastMessageToSiblings`,
`methodNotifySiblingComponents`, `methodDispatchWithinEntity` (this last one
already close to the winning shape, just without "Send").

## Done — renamed (`TODO.md` item 8.1)

- **`methodBroadcastMessage` → `methodSendMessageWithinEntity`.** States the
  scope directly rather than through a metaphor. Still accurately describes
  what happens (one message, potentially multiple registered handlers on
  that same entity all get invoked — see `entity.js`'s
  `methodSendMessageWithinEntity`, which loops over every handler registered
  under the matching name) — "Send" doesn't strongly convey the one-to-many
  aspect the way "Broadcast" did, but reads naturally regardless ("send a
  notification to all subscribers" is normal phrasing despite being
  fan-out), so this isn't considered a real loss.
- **`methodRegisterInvokableHandler` → `methodRegisterMessageHandlerWithinEntity`.**
  Mirrors the same `...WithinEntity` suffix for consistency with the rename
  above, rather than inventing a differently-shaped name for the two halves
  of the same mechanism.
- **Avoided `.on(...)`-style naming** for the handler-registration side (e.g.
  `methodOnSiblingMessage`) even though it's a common event-listener
  convention elsewhere — this project already uses raw `.on('data', ...)`
  for PeerJS/WebRTC events (`entity components/peer_connection.js`), and an
  ECS-level `.on(...)` too would blur exactly the distinction this renaming
  was trying to sharpen (this is our own internal same-entity messaging, not
  a raw external event system).

Renamed everywhere: `classes/ECS/entity.js`, `entity_component.js`, and the
call sites in `camera_controller_first_person.js` and `test_objects.js`
(×2). The `invokableHandlerName`/`invokableHandlerValue` message-object
field names are unchanged — see "still open" below.

## Done — cross-entity messaging shorthand implemented (`TODO.md` item 9)

Originally framed as "we might need a new cross-entity messaging method,"
this turned out to already be possible with zero new capability, once
worked through: `methodGetEntitiesWithComponent("EntityComponentX",
excludeName)` already returns real `Entity` references, and the
same-entity send method (`methodSendMessageWithinEntity`) is a plain public
method on `Entity` — nothing restricts it to "only an entity's own
components can trigger it about themselves." Any code already holding
another entity's reference can call
`targetEntity.methodSendMessageWithinEntity(message)` directly, today, with
the mechanism exactly as it exists now. See `ECS_MESSAGING_DESIGN.md` for
the fuller design reasoning behind why this shape (query by component/
capability, then message whatever's found) is the right one for this
project's loosely-coupled-entities intent — the short version: a sender
can't assume a fixed, known list of which entities exist nearby (they
change as a player moves between areas, for instance), so it can only
reasonably query by *capability* and message whatever matches.

Given that, what was actually left to decide was a pure **convenience/
shorthand method** — folding (1) `methodGetEntitiesWithComponent`, (2) a
loop over the results, and (3) each one's `methodSendMessageWithinEntity`
call into one combined call, purely to avoid repeating that 3-4 line
pattern everywhere it's needed. Filtered by component name (not an
unconditional "message literally every other entity" version — visiting
every entity in the scene regardless of relevance was considered and set
aside as unnecessary, given the capability/category-query approach above
already narrows things down for free).

Implemented as `methodSendMessageToEntitiesWithComponent(paramComponentName,
paramMessage, paramEntityNameToExclude)` on both `Entity`
(`classes/ECS/entity.js`) and `EntityComponent` (`entity_component.js`,
delegating to `this.#parent`, same pattern as every other cross-entity
call) — the third parameter mirrors `methodGetEntitiesWithComponent`'s own
signature rather than hardcoding self-exclusion, so a caller can still
choose to include itself if that's ever useful. Not yet called from any
real component — no code in this project has needed a cross-entity
broadcast yet, so it exists ahead of a concrete use case (the attack/Health
scenario from the original brainstorm remains hypothetical, not built).

## Still open (naming)

### `invokableHandlerName`/`invokableHandlerValue` — verbose on purpose, conditionally revisitable

Not part of the scope-confusion problem above, but raised in the same
conversation. The verbose naming here wasn't an accident or just a taste
choice — it was compensating for the underlying data types being genuinely
obtuse and unclear, which is a real, concrete problem, not a vague one.
Specifically: **the same name, `invokableHandlerValue`, means two
structurally different things depending on which method it appears in**:

- In `Entity.methodRegisterMessageHandlerWithinEntity(paramInvokableHandlerName,
  paramInvokableHandlerValue)` (`classes/ECS/entity.js`), the value is a
  **callback function** — e.g. `(paramMessage) => { this.methodHandleUpdatePosition(paramMessage); }`
  in `camera_controller_first_person.js`.
- In the message object passed to `methodSendMessageWithinEntity({invokableHandlerName,
  invokableHandlerValue})` (built by `Entity.methodSetPosition`/
  `methodSetRotation`/`methodSetRotations`), the value is **plain data** —
  a `THREE.Vector3`/`THREE.Quaternion`, or (for `methodSetRotations`) a
  plain `{rotationA, rotationADelta, rotationB, rotationBDelta}` object. Not
  a function at all.

Same field name, function in one place, data in another — that's the actual
obtuseness the verbose naming was standing in for, not just long-windedness
for its own sake.

**Condition for shortening these names:** willing to do it, but only paired
with comments near the handler-related methods
(`methodRegisterMessageHandlerWithinEntity`, `methodSendMessageWithinEntity`,
and the registration call sites) that clearly state the actual data type
expected in each position — spelling out that the registered value is
specifically a callable function (and is expected to be invoked, not just
stored/inspected), separately from the broadcast message's value being
whatever data the message actually carries. Not done as part of this
discussion — the renaming here shouldn't happen without those comments
landing at the same time, since shortening the names without adding that
clarity back would reintroduce the exact obtuseness the verbosity was
covering for.

## Entity-component naming families: `EntityComponentContext*`

Status: **decided.** A different naming topic from the messaging-method
renames above (component *class* naming, not method naming) — recorded here
since this doc is this project's established home for ECS naming decisions.

**The shape being named:** an `EntityComponent` whose job is to hold (or
compute) state read by other components — sibling or cross-entity — rather
than to drive its own independent per-frame behavior. Originally framed as
state read by *multiple* other components specifically; see "A single
consumer is fine, conditionally" below for why that was loosened.
`EntityComponentEngineContext` (since renamed — see below) is the first
example: it passively holds already-constructed Three.js objects
(`scene`/`renderer`/`camera`/`cameraPivot`/`sceneHUD`) so other components
can fetch them, rather than owning any behavior of its own. The planned
`computeCubeHUDLayout()` conversion (`TODO.md` item 5.2) is the second: it
actively *computes* cubeHUD/panel-fitting geometry, consumed by two sibling
components (`EntityComponentTestCubeHUD`, `EntityComponentBackgroundPlane`).
Passive-holder and active-computer are genuinely different in what they
*do*, but the same in the trait that actually matters for naming: neither
has independent behavior of its own, and both exist to be read by others.

**Why `Context`, not `Helper`/`Resource`/`Shared`/`Controller`/`Manager`:**

- **`Helper`** was rejected as the weakest option — a well-known naming
  smell in general OOP practice (a "helper class" usually means "I
  couldn't decide where this really belongs," not a real, nameable role).
  It also says nothing about *what kind* of thing the component is, only
  that it exists to assist something — true of every component in this ECS.
- **`Resource`** fits a passive reference-holder like `EngineContext`
  reasonably well, but reads oddly for something that *actively derives* a
  value (the cubeHUD-layout case) — a "resource" is usually fetched/held,
  not computed. It also risks colliding with the standard game-engine
  meaning of "resource" (loaded assets: textures, models, audio).
- **`Shared`** is honest about the *grouping criterion* (multiple
  consumers) but says nothing about *what role* the component plays —
  unlike `Controller`/`Manager`, which each name a specific behavior.
- **`Controller`** and **`Manager`** were both rejected because they
  already carry specific, established meanings in this codebase:
  `EntityComponentCameraControllerFirstPerson`/`EntityComponentPlayerController`
  ("Controller" = drives real-time, input-driven behavior) and
  `EntityComponentLightManager`/`EntityComponentRemotePlayerManager`
  ("Manager" = owns an ongoing sync relationship or a dynamic
  spawn/despawn lifecycle). Neither fits "passive/derived shared state,
  looked up by siblings" — reusing either word for this new role would
  blur two conventions that already mean something specific.
- **`Context`** (the winning choice) is a real, well-established pattern
  name for exactly this role in software generally — dependency-injection
  "context objects," React's `Context`, ASP.NET's `HttpContext` — all mean
  "ambient state made available to consumers without being threaded
  through constructor params," which is precisely what `EngineContext` was
  built to do, and fits the cubeHUD-layout case too (components read the
  computed layout rather than compute it themselves). It also already
  matched the shipped `EntityComponentEngineContext` name, so adopting it
  cost nothing.

**Placement: prefix, not suffix — a deliberate break from
`Controller`/`Manager`'s pattern.** `Controller` and `Manager` are always
suffixes in this codebase (`CameraController`, `PlayerController`,
`LightManager`, `RemotePlayerManager` — domain word, then role word).
`Context` components instead put the role word right after
`EntityComponent`, *before* the domain word: `EntityComponentContextEngine`,
`EntityComponentContextHUDLayout`. This is intentional,
not an inconsistency: putting the shared role word first makes every
`Context`-family component cluster together — alphabetically, in a file
listing, in an IDE's autocomplete — right where `EntityComponent` already
is, readable as one family at a glance. Suffix placement (like
`Controller`/`Manager`) doesn't give you that: you have to read to the end
of two different names to discover they share a role.

**Applied beyond this one component** — see the built instances below, items
6.1 and 6.2 both made the jump from prediction to practice.

**Renamed:** `EntityComponentEngineContext` → `EntityComponentContextEngine`
(`entity components/engine_context.js` → `entity components/context/context_engine.js`)
— the first real instance of this family. See
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md` for that component's own design
history, unaffected by this rename since it's purely cosmetic.

**Second instance, built (not just proposed):** `EntityComponentContextHUDLayout`
(`entity components/context/context_hud_layout.js`, `TODO.md` item 5.2) — solves
cubeHUD's position/yaw and the HUD panel's fit, read by two siblings
(`EntityComponentTestCubeHUD`/`EntityComponentBackgroundPlane`). Confirms
the "applies beyond this one component" prediction above in practice, not
just in theory.

**Third instance, built:** `EntityComponentContextLocalPlayerIdentity`
(`entity components/context/context_local_player_identity.js`, `TODO.md`
item 6.1) — owns the local player's rolled shape/color indices and color
palettes, read by three components across three different entities
(`EntityComponentTestCubeHUD`, `EntityComponentPlayerNetworkSync`,
`EntityComponentRemotePlayerManager`) with no single one of them a more
natural owner than the others. Chosen over `EntityComponentSettings*` as
the family prefix for this one specifically: "Settings" would have
described the same role a second, redundant way (this data isn't
user-adjustable — it's rolled once at random, with no settings UI — so it
wouldn't even have been a semantic fit), fragmenting the at-a-glance
clustering `Context` exists to provide.

**Fourth instance, built:** `EntityComponentContextWorldLayout`
(`entity components/context/context_world_layout.js`, `TODO.md` item 6.2)
— owns the ground's real footprint (`groundSize`/`groundPositionOffset`),
read by the ground's own `EntityComponentTestCube` construction and by
player-spawn randomization (`main.js`, via
`methodGetRandomSpawnPositionXZ()`). This one also went into the same
`initContextComponents()` step `EntityComponentContextLocalPlayerIdentity`
already uses — the first real test of that function's generalized name
(see `TODO.md` item 6.1's "naming note").

## A single consumer is fine, conditionally

Status: **decided.** Loosens "The shape being named" above: a
`EntityComponentContext*` component no longer needs *multiple* consumers to
justify its existence, provided it satisfies **both** of these conditions:

- **It makes a `main.js` function more streamlined** — the value/logic it
  owns would otherwise sit as a bare local/closure inside a `main.js`
  init function (or be computed there and threaded through as a resolved
  constructor param), the same category of thing `TODO.md` item 5 already
  tracks as worth pulling out of `main.js` regardless of consumer count.
- **It encapsulates code within entity components** — the component's one
  consumer becomes more self-contained by depending on it (a single
  self-lookup call) than it would be computing/holding the value itself,
  and it leaves room for the same component to grow more state/logic later
  without that consumer's own self-lookups multiplying one-by-one as each
  new thing gets added.

Both conditions have to hold — a component satisfying only one (e.g.
something that shortens `main.js` but wouldn't actually make its one
consumer any more self-contained) doesn't qualify on this basis alone.

**Why the original "multiple consumers" framing needed loosening:** the
family's first four instances (above) all happened to arrive with two or
three real, concrete consumers already in hand — never speculative. That
made "multiple consumers" *look* like the defining criterion, but it was
really a proxy for a deeper one: is this state's ownership genuinely
independent of any single consumer, such that bolting it onto one specific
consumer would be the wrong direction of coupling? A single-consumer
component can satisfy that same deeper criterion, provided it's judged by
the two conditions above rather than nothing — otherwise this loosening
would just be a license for premature abstraction, which this project
otherwise deliberately avoids (see `EntityComponentTestCubePlayer`'s
rejection in `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md`'s "Player-identity
hooks on `EntityComponentTestCube`" section — a single-consumer subclass
rejected for having no real second use *and* not satisfying either
condition above, since it wouldn't have streamlined `main.js` or added any
encapsulation beyond what its one consumer already had).

**First instance under this rule:** `EntityComponentContextPlayerInitialization`
(`entity components/context/context_player_initialization.js`, `TODO.md`
item 6's sub-item 6 — done) — owns the local player's spawn position (self-looking-up
`EntityComponentContextWorldLayout` for the ground's bounds, then exposing
`methodGetSpawnPosition()`), with `EntityComponentCameraControllerFirstPerson`
as its one consumer. Satisfies both conditions: `main.js` loses the
`localPlayerStartPosition` local and its explicit `methodSetPosition(...)`
call (streamlines `initEntityComponents()`), and the camera controller only
ever needs to ask "where do I start" rather than knowing spawn positions
come from ground bounds at all (encapsulation - and leaves room for other
player-init-time properties to land in the same component later without
the camera controller's own self-lookups growing one-by-one).

## Marking existing code sections: `// #region <label>`

Status: **decided and applied project-wide.** A different kind of
convention from everything else in this doc — code layout, not naming —
but recorded here since this is the project's established home for ECS
structural conventions.

Every entity component (`entity components/**/*.js`) and every ECS base
class (`classes/ECS/*.js`) already grouped its methods under short,
consistent bare-comment labels — `// bare minimum`, `// construct`,
`// lifecycle`, `// getters`, `// setters`, `// adders`, `// removers`,
`// registers`, `// actions`, `// internal helpers`, `// handlers` — before
any of this session's `#region` work began. That was a real, pre-existing,
already-consistent convention across essentially every file in both
directories, not something invented for this. Every one of those labels is
now wrapped in a matching `// #region <label>` / `// #endregion <label>`
comment pair, e.g.:

```js
// #region getters

methodGetCube(){return this.#cube;}

// #endregion getters
```

Same rationale as "Marking hook methods" in
`BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md` (that section covers the
narrower, semantically-loaded case of hook methods specifically — a hook
method looks like any other method but means something structurally
different, so it earns a region on that basis alone; this section covers
the broader, already-existing informal-section case, where the value is
navigability/folding in editors that support the convention, not marking a
hidden semantic distinction). These are plain comments, not a build-time
directive — nothing parses `#region`/`#endregion`, they're purely an
editor-folding convention (VS Code among others).

**Region boundaries:** a region starts at an existing label and ends at
the next recognized label, or at the closing brace of the class if no
further label appears — mechanical, not judgment-based. A bare separator
comment that isn't one of the established labels above (e.g. a lone `//`,
or `// ...`) does **not** end a region; the region it's nested inside just
continues past it. This occasionally produces a region that's broader than
its name would suggest in isolation — e.g. `Entity`'s and
`EntityComponent`'s final `// lifecycle` region also contains
`methodSendMessageWithinEntity()`/`methodSendMessageToEntitiesWithComponent()`,
since no further label follows `methodUpdate()` before the closing brace —
but keeping the boundary rule purely mechanical was deliberately chosen
over re-deriving "better" boundaries by hand, since the existing labels
were never meant to be a fully-partitioned taxonomy in the first place.

**One stale label removed, not wrapped:** `EntityComponentTestCubeHUD`
(`entity components/test_objects.js`) had a `// getters` label immediately
followed by the `// #region overridable hook methods` block, with nothing
of its own in between — a leftover from before its getters were converted
to hook-method overrides. An empty `#region`/`#endregion` pair around
nothing would have added noise without meaning, so that stale label was
removed outright rather than wrapped.

**Applied to:** every file in `entity components/` (including
`entity components/context/`) and `classes/ECS/`. Any new informal section
label added to an entity component going forward should be wrapped the
same way from the start, rather than added as a bare comment and converted
later.
