# ECS messaging design — principles

Status: **design principles — the mechanism they describe is implemented,
the gameplay scenarios that motivated them (attack/Health/Shield, etc.) are
still hypothetical.** The messaging mechanism itself exists
(`classes/ECS/entity.js`/`entity_component.js`, named
`methodSendMessageWithinEntity`/`methodRegisterMessageHandlerWithinEntity`
since the rename in `TODO.md` item 8, plus the cross-entity shorthand
`methodSendMessageToEntitiesWithComponent` from `TODO.md` item 9 — see
`NAMING_CONVENTIONS.md` for the naming history), but the *principles* below
— why it should be preferred, and how components are expected to use it —
are a design conversation, recorded here so they don't need re-deriving
later. For the "how" (API mechanics, current method names) see
`CLAUDE.md`'s ECS section; for the "why hand-rolled ECS at all" see
`ARCHITECTURE.md`.

## Core idea: entities act blind to other entities

A component should not need to know, in advance, the exact set of other
entities that exist, which components any of them carry, or which specific
methods those components expose. Concretely (from the brainstorm that
produced this doc): a player character might have several different monsters
and friendly NPCs nearby at any moment — an NPC might be identifiable by,
say, a `Speaking`-type component — and *which* entities are actually nearby
changes completely as the player moves between areas. Code reacting to
"who's around me" can't assume a fixed, known guest list; it can only
reasonably query by *capability* (which components an entity happens to
carry), never by a specific expected identity.

This is also true one level down, inside a single interaction: an attacker
dealing damage doesn't need to know whether a given target has a `Shield`,
an `Alertable` monster-alert system, a hit-logging component, or none of
these — only that *some* set of components might care about "this entity
was just attacked," without the attacker enumerating them.

## Prefer messaging + handlers over direct method references

Given that blindness, the default should be: broadcast a message describing
*what happened*, rather than the sender holding a direct reference to a
specific component and calling one of its methods by name. A direct call
(`someComponent.methodDoThing()`) requires the caller to already know that
component exists and what it's called — which is exactly the assumption the
section above says not to make. Messaging removes that requirement: the
sender states a fact (or a request), and whichever components, if any,
care about it are free to react, without the sender needing to know who
they are or how many there are.

This doesn't mean *never* use direct lookup/calls — `methodGetComponent`
(same entity) and `methodGetEntitiesWithComponent` (other entities) remain
the right tool when a piece of code genuinely does need to reach one
specific, known thing (see `CLAUDE.md`'s ECS section for that distinction).
Messaging is the preferred channel specifically for the "I don't know who,
if anyone, needs to hear this" case.

## Dismissal: any component can receive any message, cheaply

The mechanism that makes "blind" senders safe: a message that reaches an
entity with no registered handler for it is a fast, harmless no-op, not an
error. `entity.js`'s dispatch already works this way —
`if(!weHaveAnInvokableHandlerThatMatchesMessage){return;}` before doing
anything else. In other words, every component is implicitly capable of
"receiving" every message; the vast majority just don't have anything
registered for the vast majority of message names, and that costs
essentially nothing to check. This is what actually enables the "blind"
sending principle above — a sender can broadcast without knowing or caring
whether anyone's listening, because a message nobody wants simply gets
dismissed as "this doesn't concern me," not treated as a mistake.

## Messaging within an entity

The existing mechanism (name pending — see `NAMING_CONVENTIONS.md`) is
scoped to a single `Entity`: a message broadcast this way only reaches
components attached to *that same entity*, never other entities. Today's
one live example: `Entity.methodSetPosition()` broadcasts `update.position`,
and whichever of that entity's own components registered a handler for it
(e.g. the camera controller) react. This is the base case everything else
builds on.

## The cross-entity case didn't need new capability, just a shorthand

Reaching a message to a *different* entity's components doesn't actually
require new machinery: since `methodGetEntitiesWithComponent` already
returns real `Entity` references, and the same-entity send method is a
plain public method on `Entity` (not restricted to "only entities can call
this about themselves"), any code holding another entity's reference can
already call that entity's own send method on it directly — e.g.
`targetEntity.methodSendMessageWithinEntity({invokableHandlerName: 'wasAttacked', invokableHandlerValue: {damage, attacker: this}})`.
That's already "sending a message within a target entity," just initiated
by outside code.

What was still worth adding was a pure **convenience/shorthand** method, not
a missing capability: one call combining (1) `methodGetEntitiesWithComponent`
to find the relevant entities, (2) looping over them, and (3) calling each
one's own within-entity send — folding a repeated 3-4 line pattern into one
call. Implemented as `methodSendMessageToEntitiesWithComponent` (see
`NAMING_CONVENTIONS.md` for the final signature) — not yet called from any
real component, since nothing in this codebase has needed a cross-entity
broadcast yet; it exists ahead of a concrete use case, ready for whenever
something like the attack/Health scenario above gets built.

## Receivers decide their own reaction — senders don't

A sender states what happened (and, optionally, extra properties the
receiver may or may not care about — e.g. an attack's special properties
riding along in the message payload) and stops there. It does not decide,
or need to know, how any given receiver responds. Concretely, from the
attack/damage brainstorm: the same "on damage taken" message might be
handled by a `Health` component that just subtracts HP, or by an entity
whose single registered handler internally looks up its own `Shield` and
`Health` components (via ordinary same-entity `methodGetComponent` lookups)
and sequences them however it needs to (mitigate, then apply) — that
sequencing is the *receiving* entity's own internal logic, not something
the sender or the messaging system dictates or needs to guarantee across
independently-registered listeners. If two reactions genuinely depend on
order, that's a sign they belong inside one coordinating handler on the
receiver, not two separately-registered handlers hoping registration order
works out.

This is also why extra message payload fields should be treated as
optional, forward-compatible information: a sender can include properties
some receivers won't understand (an attack's special damage type, for
instance), and a receiver that doesn't account for a given property should
just ignore it rather than break — the same way any loosely-coupled event
schema should tolerate fields it doesn't recognize.

## The payoff: the same message, different reactions per component

All of the above adds up to the actual design goal: broadcasting one
message (say, "this entity was attacked, for this much damage, with these
optional properties") to an entity should be able to produce *completely
different* reactions depending on which components that particular entity
happens to have — full HP loss for a plain enemy, mitigated loss for a
shielded one, an alert-and-wake-up for a sleeping monster, nothing at all
for an entity with no relevant handler — all from the one message shape,
without the sender needing a special case for any of them.
