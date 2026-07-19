# Naming conventions — in-progress design discussion

Status: **method rename done (`TODO.md` item 8.1); cross-entity shorthand
implemented (`TODO.md` item 9); the `invokableHandlerName`/
`invokableHandlerValue` field rename is still open.** This doc tracks a
naming/design conversation about the ECS's messaging methods (`entity.js`/
`entity_component.js`), split into what's done already and what's still
genuinely undecided. For *why* this messaging mechanism should be
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
