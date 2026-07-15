# CDN imports vs. npm dependencies — the debate, for future reference

Status: unresolved for PeerJS specifically. **Three.js has since been migrated
off the CDN pattern this doc otherwise describes** — see "Outcome: the Three.js
migration" below before assuming the rest of this doc reflects current source.
Read this before adding any new runtime dependency (starting with PeerJS — see
`LAN_MULTIPLAYER_CONSIDERATIONS.md`).

## Outcome: the Three.js migration (this project only)

This project (the npm/Vite variant, forked from the CDN-based
`ThreeJS-PWA-ECS-Surface-Stable-Dithering-With-Vite`) actually made the switch
described hypothetically below: `npm install three` was run, all seven
`import * as THREE from "https://cdn.jsdelivr.net/..."` lines became
`import * as THREE from "three";`, and the dead import-map/alias machinery was
deleted rather than kept as a fallback. `npm run dev`, `npm run build`, and
`npm run preview` all work unchanged — this confirms the doc's prediction
below that npm-installing Three.js carries "essentially no new risk" locally
or in the `vite build` → `dist/` → GitHub Pages path.

One risk the doc below didn't anticipate, found while verifying the build
output: the commented-out `<script type="importmap">` block that used to sit
in `index.html` was **not actually inert** under this project's Vite version
(`vite@8.0.14`, which pulls in an experimental Rolldown-powered build core).
Its HTML transform mis-parses `<script>` tags nested inside an HTML comment
and resurrects them as live tags in the built `dist/index.html` — so the
"dead" CDN import map was silently shipping to production, re-pointing
`"three"` back at jsdelivr in the built HTML even after the JS source moved to
bare-specifier npm imports. Deleting that block (rather than leaving it
commented out "just in case") both removed dead weight and fixed this. Verify
with `npm run build && grep -n script dist/index.html` if anything like this
is ever reintroduced.

GitHub Pages deployment itself (pushing `dist/` and serving it) has not yet
been separately re-verified after this migration as of this writing — the
above confirms the local `npm run build`/`preview` path, which is the part
that actually determines what ships to Pages.

## The existing pattern

This project has zero runtime npm dependencies today. `package.json` only lists
`vite` as a `devDependency`. Three.js — used in every file that touches the
scene — is imported directly from a pinned jsdelivr CDN URL
(`https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js`) rather than
via `npm install three`. This is documented as deliberate in `CLAUDE.md`.

## Where this comes from

The user has prior-project experience where the CDN + browser-importmap
approach was necessary for a PWA to run smoothly — both locally under
`npm`/`npx` and once deployed to GitHub Pages. That history is the likely origin
of this project's CDN-first convention, and is why it's worth deliberately
deciding rather than defaulting to `npm install` out of habit for the next
dependency.

## Why "GitHub Pages" isn't actually the mechanism

GitHub Pages is static-file hosting — it is completely agnostic to whether a
dependency was npm-installed or CDN-loaded, because `vite build` resolves
either into plain files in `dist/` before anything is deployed. So "smooth on
GitHub Pages" isn't really about GitHub Pages itself.

The actual likely mechanism: **a PWA service worker precaching assets by
filename, while Vite renames bundled output with a content hash on every
build.** A hand-rolled service worker that hardcodes (or naively regenerates)
a list of files to cache can end up referencing stale, now-404ing hashed
filenames after a redeploy — breaking offline support, or leaving the PWA stuck
serving an old cached version until the cache-versioning is fixed. Loading a
dependency from a versioned CDN URL sidesteps this specific failure mode
entirely: it's one less bundled, hash-renamed file for a service worker to
track and get wrong.

**Where this project stands today:** `sw.js` is currently a no-op stub — it
logs on `fetch` but never calls `event.respondWith()`, so no real asset
precaching happens yet. This risk isn't actively biting right now, but becomes
live again the moment real offline-caching logic gets added to the service
worker. Worth re-reading this file at that point even if a dependency decision
was already made before then.

## What fully moving to npm installations would entail

This is the broader question, beyond just PeerJS: what if the project dropped
the CDN pattern entirely — Three.js included — and used `npm install` for
everything? Mechanically, small: each CDN import line becomes a bare-specifier
import (`import * as THREE from "three";`), each package gets added to a new
`dependencies` section in `package.json`, and the parallel machinery that
exists solely to keep the CDN/non-bundled path alive — the commented-out
import map in `index.html`, the aliases in `.vite/vite.config.js`, their
explanation in `CLAUDE.md` — could be deleted as dead weight. No Vite config
changes are needed for the npm imports themselves; Vite resolves bare
specifiers natively.

### What we'd gain

- **No third-party runtime dependency, forever.** This is easy to miss: today,
  Three.js is fetched from jsdelivr on *every single page load*, including
  local dev (`npm run dev`) and the deployed production site — not just once at
  install time. If jsdelivr has an outage, rate-limits, or is blocked by a
  network, the app doesn't run at all, anywhere, until it recovers. npm-installed
  dependencies are fetched once (at `npm install` time) and then bundled into
  the project's own output — no runtime dependency on a third party remains.
- **Offline local development.** Following from the above: today, working on
  this project with no internet connection doesn't fully work, even in
  `npm run dev`, because the browser still needs to reach jsdelivr for
  Three.js. Moving to npm removes that requirement entirely.
- **Visibility to standard tooling.** CDN-loaded code is invisible to `npm
  audit`, GitHub's Dependabot security alerts, and IDE type-hints (e.g. if
  `@types/three` or bundled types were ever added) — none of that tooling can
  see a dependency that only exists as a URL string in source. Moving to npm
  makes dependency versions and known vulnerabilities trackable the normal way.
- **Less accumulated complexity**, if the non-bundled deployment path
  (see below) is judged not worth preserving — one less parallel
  configuration surface to keep in sync.
- **Marginal: version pinning.** Often cited as an npm benefit, but weak here
  specifically — the CDN URLs already pin an exact version in the URL string
  (`@0.168.0`), so this isn't a strong differentiator either way.

### Risks — would it stop working locally and/or on GitHub Pages?

**Locally (`npm run dev` / `npm run build` / `npm run preview`): essentially no
new risk.** `npm install` is already required today, just to get Vite itself —
adding a few more packages to install is completely standard Vite behavior,
needs no special config, and doesn't change how the dev server or build work.

**On GitHub Pages, via the actual current deploy process (`npm run build` →
`dist/` → deployed, per `DEPLOY_GITHUB_PAGES.md`): also no risk.** Vite already
bundles npm dependencies into `dist/assets` exactly the same way it bundles the
project's own source files. GitHub Pages serves whatever ends up in `dist/`,
completely agnostic to whether a given piece of code originally came from npm
or a CDN. The build step is what matters, and that step already happens today
regardless of this decision.

**The one genuine, concrete risk: quietly breaking the non-bundled deployment
path.** `index.html`'s comments and the `.vite/vite.config.js` aliases exist
specifically to support serving this project as raw static files with no build
step at all (a plain static server plus the browser's own import map resolving
bare specifiers directly to CDN URLs). An npm-only dependency has no meaning in
that scenario — there's no `node_modules` for a browser to reach, and no build
step to have bundled anything for it. Fully moving to npm, without also
maintaining a CDN-based import-map fallback, would silently end that
capability. Worth explicitly deciding whether that non-bundled path is actually
planned to be used, or is a "just in case" leftover that's fine to let go of —
right now it's unclear which.

**The PWA/service-worker risk is raised, not newly introduced.** The
hash-mismatch failure mode described above isn't caused by npm vs. CDN as
such — but moving more code (like Three.js) from an external, unhashed,
independently-cached CDN URL into Vite's own hashed `dist/assets` bundle does
mean *more* hashed output for a future service worker to correctly track and
version, once real offline-caching logic gets built. That raises the stakes of
the exact failure mode that caused problems in the user's prior project, even
though today's no-op `sw.js` isn't exposed to it yet.

## The two options, for PeerJS specifically

**Option A — `npm install peerjs`.** The standard way, and what virtually every
PeerJS tutorial shows:
- Adds a `dependencies` section to `package.json` (doesn't exist yet).
- `import { Peer } from "peerjs";` — a bare specifier, resolved natively by
  Vite, no config changes needed.
- Tradeoff: breaks the "everything's CDN, nothing needs `npm install`"
  character the rest of the project has, and would stop working if the
  non-bundled/importmap deployment path `index.html` keeps around were ever
  actually used.

**Option B — CDN import, matching the Three.js pattern.**
- No `npm install`. Import from jsdelivr instead, e.g.
  `import { Peer } from "https://cdn.jsdelivr.net/npm/peerjs@<version>/+esm";`
  — jsdelivr's `+esm` suffix auto-converts a package to an ES module on the fly,
  which matters here because PeerJS's own published bundle may not be natively
  ESM the way Three.js's `build/three.module.js` is (their more common CDN usage
  historically has been a plain `<script>` tag exposing a global `Peer`,
  UMD-style). **Verify this against PeerJS's actual current package contents at
  implementation time** rather than trusting this doc's assumption.
- Fallback if `+esm` doesn't convert cleanly: a plain `<script src="...">` tag
  in `index.html` (like the already-commented-out importmap sitting there)
  exposing a global `Peer`, with `peer_connection.js` referencing `window.Peer`
  directly instead of using an `import` statement.

## Current lean, and why

Lean toward **Option B**, given:
- Direct precedent already in this codebase (Three.js).
- The user's stated primary constraint — GitHub Pages working smoothly — and
  prior scar tissue on exactly this class of PWA/bundler problem.
- It keeps this whole risk category closed off for one more dependency, rather
  than needing to re-reason about it once the service worker grows real
  caching logic.

Not yet finalized as a hard decision — revisit when actually wiring up
`EntityComponentPeerConnection`'s commented-out real implementation (see
`LAN_MULTIPLAYER_CONSIDERATIONS.md`, "Phase 1 plan: the one-time code UI").
