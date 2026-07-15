# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server (opens browser, port 5173)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build locally

There is no test suite and no `lint` script. ESLint (`eslint.config.js`) is gitignored and expects a **globally** installed `eslint` binary (`eslint .` from repo root) — it is not a project devDependency. There is no CI.

## Architecture

### Three.js is an npm dependency (this project is the npm/Vite variant)

This project is a deliberate fork of the sibling project
`ThreeJS-PWA-ECS-Surface-Stable-Dithering-With-Vite` (CDN-based), created to
test whether a fully npm-installed dependency tree still works the same way
locally (`npm run dev`/`build`/`preview`) and once deployed to GitHub Pages.
`three` is a real `dependencies` entry in `package.json` (`node_modules/three`
exists); every file that needs it imports the bare specifier:

```js
import * as THREE from "three";
```

Vite resolves this natively at both dev and build time — no import map, no
Vite aliases, no CDN URL anywhere in source. The commented-out import map that
used to live in `index.html` (for a non-bundled/no-build static-serving
fallback) was deleted: besides being unused dead weight once every dependency
is npm-installed, it was also found to be **actively broken** — this project's
Vite version pulls in an experimental Rolldown-powered core whose HTML
transform mis-parses `<script>` tags sitting inside an HTML comment and
resurrects them as live tags in the built `dist/index.html`, which
re-introduced a live jsdelivr `<script type="importmap">` pointing `"three"`
back at the CDN in production output. If you ever add a commented-out
`<script>` block back to `index.html` for reference, verify with `npm run
build && grep -n script dist/index.html` that it actually stayed inert.

Read `DEPENDENCY_LOADING_CDN_VS_NPM.md` before deciding how to load any *new*
runtime dependency — it covers the CDN-vs-npm tradeoff this project exists to
test, including the PWA/service-worker/GitHub-Pages reasoning, and now also
records the outcome of actually making this switch.

### ECS layer (`classes/ECS/`)

A minimal, hand-rolled entity-component-system, not a library:

- `entity_manager.js` — `EntityManager` holds a flat array of `Entity` instances and drives them via `methodUpdate(timeElapsed, timeDelta)` each frame. Also supports name-based entity generation and lookups by component name/suffix.
- `entity.js` — `Entity` is always instantiated "empty" (`new Entity(null)`); nothing ever subclasses it. Behavior comes entirely from attaching `EntityComponent` subclasses via `methodAddComponentWithName("SomeComponentName", instance)` — the string name is the lookup key (usually `instance.constructor.name`, but callers pass it explicitly). Components are stored in a plain object keyed by that name, so **only one instance per component name per entity** unless you use `methodAddComponentWithSuffix` (which has a known bug — see below).
- `entity_component.js` — `EntityComponent` base class components extend. Most getter/setter calls (`methodGetPosition`, `methodSetPosition`, `methodRegisterInvokableHandler`, etc.) just delegate up to `this.#parent` (the owning `Entity`).
- Cross-component communication is message-based: `methodSetPosition`/`methodSetRotation(s)` on an `Entity` broadcast via `methodBroadcastMessage({invokableHandlerName, invokableHandlerValue})`; components subscribe with `methodRegisterInvokableHandler(name, callback)` in their `methodInitialize()`. A component looks up sibling components at runtime with `this.methodGetComponent("EntityComponentX")` rather than holding direct references.
- Lifecycle: `methodInitialize()` then per-frame `methodUpdate(timeElapsed, timeDelta)`, both fanned out entity → components. `EntityComponentTestCube.methodInitialize()` is `async` (it awaits texture/shader loads) — `Entity.methodAddComponentWithName` does not await it, so initialization for those components completes asynchronously after being "added."

Known bugs in this layer (see `KNOWN_ISSUES.md`, found via `eslint .`, all pre-existing/unfixed): `entity.js` has undefined-reference bugs in `methodGetComponent` (line ~89, uses `nameExcludingSuffix` instead of `paramComponentName`), `methodGetRotations`/`Rotation` getter (references bare `rotationB` instead of `this.#rotationB`), and `methodAddComponentWithSuffix` (references undefined `paramComponentSuffix`). `camera_controller_first_person.js`'s `methodHandleUpdateRotations` also references an undefined var, but that method is unreachable (early `return;` as its first statement, and the handler is never registered — the registration call is commented out).

### Entity components (`entity components/` — note the space in the directory name)

Each file exports one or more `EntityComponent` subclasses, split "Input"-vs-"logic" for controllers:

- `camera_controller_first_person.js` — `EntityComponentCameraControllerFirstPersonInput` (raw keyboard/mouse state) + `EntityComponentCameraControllerFirstPerson` (applies it to `camera`/`cameraPivot`, exposes `directionForwardNonvertical`/`directionRightNonvertical` for movement code).
- `player_controller.js` — `EntityComponentPlayerControllerInput` (WASD+QE key state) + `EntityComponentPlayerController` (reads that input plus the camera controller's direction vectors, moves `cameraPivot` by calling `methodSetPosition`, which broadcasts the change).
- `test_objects.js` — `EntityComponentTestCube` (a shaded/dithered box; owns shape/color/texture/lighting options — see below), `EntityComponentTestCubeHUD` (extends it, tilts to face the camera, used for `sceneHUD`), `EntityComponentButtonPointerLock` (DOM pointer-lock button).
- `lighting.js` — `EntityComponentDirectionalLight` (directional light + shadow camera setup).

`main.js` wires everything up by hand in `init()` → `initBareMinimum()` (renderer/scene/camera/`sceneHUD`+`cameraHUD` for a HUD overlay rendered in a second pass), `initECS()`, `initEntityComponents()` (constructs every `Entity` + component for the demo scene), then a `requestAnimationFrame` `update()` loop that renders `scene` then `sceneHUD` on top (`renderer.autoClear = false`).

### Dithering shader (`shaders/`)

`Simple_FractalDithering.js` is an async factory (`createFractalMaterial(opts)`) that builds a `THREE.ShaderMaterial` (`glslVersion: THREE.GLSL3`, requires a WebGL2 context) from `Simple_FractalDithering.vert`/`.frag`. It fetches shader source at runtime by default (`fetch`) rather than relying on bundler raw-imports, specifically to avoid MIME/import issues on GitHub Pages static hosting; `createFractalMaterialFromSources` is the sync alternative when sources are already in hand. Ported from the Unity shaders under `shaders copied from Unity-SDF-Fractal-Dithering/` (kept for reference/diffing, not built).

Key options (see `shaders/USAGE.md` for full detail): `lighting` (unlit texture-driven dither vs. lit half-lambert using the scene's first directional light + its shadow map), `debugNormals`, `color1`/`color2`, `color1Texture`/`color2BlendTexture`, `shape` (0–9, circle/square/rhombus/pentagon/hexagon/octagon/star/moon/heart/cools). The texture's **alpha channel doubles as a per-pixel dither mask** (alpha 0 = show plain texture color, no dithering) — deliberately chosen over a separate mask texture since nothing in this project uses real alpha transparency yet.

**Vite asset gotcha**: texture/shader URLs are resolved via `new URL('../textures/literal.png', import.meta.url)`. Vite only statically bundles this pattern when the string argument is a literal it can read at build time — a dynamically built string (e.g. `'../textures/' + this.#textureFile`) works in `npm run dev` (files served straight off disk) but silently 404s in `npm run build`/production because Vite never copies the file into `dist/assets`. `EntityComponentTestCube` handles its two known texture files via an explicit ternary branching on literal strings for this reason (see `DEPLOY_GITHUB_PAGES.md`); add new textures the same way (one more literal branch) rather than building the path dynamically, unless you switch the whole scheme to `import.meta.glob`.

### Naming/style conventions to follow

- Methods are prefixed `method` (`methodUpdate`, `methodGetComponent`, ...); plain `get x()` accessors are used only for a few read-only properties.
- Private class fields (`#field`) are the norm; components typically store their constructor `params` in `#params` and pull specific fields into their own private fields.
- Components are registered under an explicit string name (`entity.methodAddComponentWithName("EntityComponentFoo", new EntityComponentFoo(...))`) rather than always relying on `constructor.name`, so sibling-lookup via `methodGetComponent("EntityComponentFoo")` matches the registration string, not necessarily the class name.
