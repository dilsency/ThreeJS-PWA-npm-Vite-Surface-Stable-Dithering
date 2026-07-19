# Architecture and design philosophy

This doc covers the *why* behind this project's major structural choices. For the
*how* — file layout, naming conventions, the ECS API — see `CLAUDE.md`. For deep
dives on specific decisions, see the other topic-specific `.md` files linked
throughout; this doc is the map, not a replacement for them.

## Why Vite

This project (and the sibling CDN-based project it was forked from) uses Vite as
its dev server and build tool. The reasons compound rather than standing alone:

- **Hot Module Replacement (HMR) during development.** Vite's dev server pushes
  changed modules to the running browser tab over a WebSocket connection and swaps
  them into the live page, without a full reload. For a Three.js scene specifically,
  this matters more than for typical DOM-based UI: reloading the page means
  re-initializing WebGL, re-fetching/re-decoding every texture, and recompiling
  every shader from scratch. HMR means an edit to, say, the HUD panel's fitting math
  in `main.js` (see `HUD_PANEL_CUBE_FITTING.md`) shows up in the browser in well
  under a second, with the scene still running — that tight a loop is what made the
  iterative pixel-level tuning in that doc practical at all.
- **Native ESM in dev, bundled output in production.** Vite's dev server doesn't
  bundle anything up front — it serves ES modules directly to the browser and lets
  the browser's own `import` resolution do the work, which is why the dev server
  starts near-instantly regardless of project size. `npm run build` then produces a
  genuinely bundled, tree-shaken, hashed-filename `dist/` for production — the dev
  and production code paths are different under the hood, but the source never has
  to change between them.
- **Bare npm specifiers resolved natively, no config required.** Once Three.js
  moved from a CDN URL to `npm install three` (this project's whole reason for
  existing — see `DEPENDENCY_LOADING_CDN_VS_NPM.md`), `import * as THREE from
  "three";` just works, in both dev and build, with zero Vite configuration. No
  import maps, no manual aliasing.
- **Static-asset handling that matches this project's actual needs.** The dithering
  shader's `.vert`/`.frag` files and the cube textures are neither pure code nor
  content that must survive byte-identical — `vite.config.js`'s
  `assetsInclude: ['**/*.frag', '**/*.vert']` plus `new URL(literal, import.meta.url)`
  references let Vite fingerprint and correctly bundle them (see
  `DEPLOY_GITHUB_PAGES.md`'s notes on shaders and textures), while truly-static PWA
  assets (`manifest.json`, `sw.js`, the icons) live in `public/` to skip bundling
  entirely (see `DEPENDENCY_LOADING_CDN_VS_NPM.md`'s "PWA installability" section).
  One tool, two asset-handling strategies, chosen per-file rather than fought
  against.
- **A single build step is what makes GitHub Pages deployment tractable at all.**
  GitHub Pages is dumb static hosting; `vite build` is what turns a source tree with
  npm dependencies, a custom shader pipeline, and hashed cache-busting filenames
  into something that static hosting can actually serve correctly (see the GitHub
  Actions workflow in `.github/workflows/deploy.yml`, added after discovering Pages
  was serving *un-built* source — a whole class of bugs documented in
  `DEPENDENCY_LOADING_CDN_VS_NPM.md`).

None of this is unique to Three.js — it's true of Vite generally — but a
WebGL-heavy project feels the dev-loop cost (HMR vs. full reload) more acutely than
most, which is why it's listed first above.

## Why a hand-rolled ECS instead of a library (inferred, not confirmed)

`classes/ECS/` is a minimal, custom entity-component-system rather than an
existing ECS library (bitecs, ecsy, etc.) — see `CLAUDE.md`'s ECS section for
the mechanics. No source in this repo states *why* it was built this way rather
than adopting a library, so treat the following as a plausible reading of the
code, not a documented decision: this project's actual entity count is small (a
handful of test cubes, lights, the player, the HUD) with a fixed, known-up-front
component set, so the scale problems dedicated ECS libraries solve
(cache-friendly component storage for tens of thousands of entities, archetype
queries) don't obviously apply here. What the code clearly *does* get from the
ECS pattern is the decoupling: `entity_component.js`'s message-based
`methodSendMessageWithinEntity`/`methodRegisterMessageHandlerWithinEntity`
means the camera controller and player controller don't hold direct
references to each other.
Whether that was the deliberate reason for going custom, or simply how the
project happened to start, isn't recorded anywhere — worth confirming with
whoever set the original convention before treating this section as settled.

Whatever the original motivation, ECS is now treated as *the* pattern for
scene/entity behavior in this codebase, not one option among several — see
`TEMPORARY_DEV_TOOLS_VS_ECS.md` for the concrete rule this implies: temporary,
disposable code (like a dev-only tuning UI) is the one accepted exception, and
even that should be converted into a proper `EntityComponent` if it's ever
kept permanently, rather than allowed to grow as a plain-DOM/shared-local-variable
exception to the pattern.

**Any hard-wiring in `main.js` is an exception to this pattern, full stop —
not a legitimate resting state, even when it's a reasoned, permanent design
choice rather than throwaway dev-tool code.** It's tempting to grade a piece
of `main.js` wiring as "fine" because the relationship it hard-codes happens
to be a fixed one-to-one today (exactly one sun, one HUD cube, one
pointer-lock button) rather than the dynamic, unknown-set case
`ECS_MESSAGING_DESIGN.md`'s "blind entities" principle is really about. Don't
make that move: being a fixed singleton *today* doesn't make a hand-carried
reference architecturally sound, it just makes it lower-priority to fix.
`LIGHT_MANAGER_COUPLING.md` is the clearest example of this distinction in
practice — it's a carefully reasoned doc for *why* `EntityComponentLightManager`
currently takes its source light as a direct constructor reference rather
than a `methodGetEntitiesWithComponent` lookup, with explicit conditions for
when that would flip. Read that doc's conclusion as "this exception is
currently the lesser evil, and here's what would trigger revisiting it" —
never as "hand-wiring is fine here because it's a singleton." The same
applies to every hand-wired relationship `TODO.md` item 6 tracks: their
common thread is that they all live in `main.js` outside any
`EntityComponent`, and that alone is reason enough to keep tracking them as
debt, independent of whether converting each one would currently buy any
loose-coupling benefit.

## Why a custom dithering shader instead of a material library (inferred, not confirmed)

`shaders/Simple_FractalDithering.js` is a hand-written `THREE.ShaderMaterial`
ported from a Unity SDF-fractal-dithering shader (see
`shaders copied from Unity-SDF-Fractal-Dithering/`, kept for reference per
`CLAUDE.md`), rather than a Three.js built-in material or a third-party shader
library. Likely reasoning, again not stated anywhere explicitly: the specific
visual goal (surface-stable, fractal-pattern dithering rather than a
fixed-resolution screen-space dither) has no built-in Three.js equivalent, and
porting an already-working shader from its original source is more predictable
than recreating the same effect from scratch in WebGL. Same caveat as above —
this is a reading of the code, not a recorded decision.

## Why CDN vs. npm was a deliberate, revisited decision

Most Three.js starter projects default to `npm install three` without a second
thought. This project's sibling (CDN-based) started from real prior-project scar
tissue around PWA/service-worker caching interacting badly with bundler
content-hashed filenames — worth reading in full in
`DEPENDENCY_LOADING_CDN_VS_NPM.md`, since the reasoning (and the eventual outcome
of actually testing the switch, including bugs found along the way) is more
nuanced than "CDN bad, npm good" or vice versa.

## Where to go deeper

- `CLAUDE.md` — file layout, ECS API surface, naming conventions.
- `DEPENDENCY_LOADING_CDN_VS_NPM.md` — the CDN-vs-npm decision, and this project's
  actual migration outcome (GitHub Pages deploy fixes, PWA installability fixes).
- `DEPLOY_GITHUB_PAGES.md` — build/deploy mechanics, shader and texture asset
  bundling gotchas.
- `HUD_DEPTH_CLEARING.md` / `HUD_PANEL_CUBE_FITTING.md` — HUD rendering specifics.
- `LIGHT_MANAGER_COUPLING.md`, `LAN_MULTIPLAYER_CONSIDERATIONS.md`,
  `KNOWN_ISSUES.md` — other subsystem-specific decisions and known bugs.
- `TEMPORARY_DEV_TOOLS_VS_ECS.md` — why the live cubeHUD tuning panel is a
  deliberate, temporary exception to ECS, the rule for converting it (or any
  similar dev tool) to a proper `EntityComponent` if ever kept permanently,
  and the related rule against sharing local variables between components via
  the init pipeline's closures.
- `MATH_TRICKS.md` — worked, intuition-building explanations of the
  less-obvious math formulae used (or planned) in this codebase — e.g. the
  resettable interpolation-alpha ramp behind `TODO.md` item 7.
- `BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md` — open question (`TODO.md` item
  6.5): should `scene`/`renderer`/`camera`/etc. get their own `EntityComponent`
  and be looked up like everything else, or stay a hard-wired exception the
  way `LIGHT_MANAGER_COUPLING.md`'s single light pairing does?
