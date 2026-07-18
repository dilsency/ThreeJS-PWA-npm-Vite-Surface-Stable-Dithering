# CDN imports vs. npm dependencies — the debate, for future reference

Status: **resolved for PeerJS too — Option A (`npm install peerjs`) chosen.**
Three.js was migrated off the CDN pattern this doc otherwise describes first
(see "Outcome: the Three.js migration" below), and that migration is what
resolved this: it verified, in production and not just in theory, that
npm + Vite carries no PWA/GitHub-Pages risk. See "Decision: PeerJS via npm"
below for the actual reasoning. Read this before adding any new runtime
dependency.

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

### GitHub Pages actually broke — and the cause wasn't Three.js or npm at all

GitHub Pages deployment was re-verified after this migration, and it broke on
the first attempt: the deployed site showed only the page's background color,
with `Uncaught TypeError: Failed to resolve module specifier "three"` in the
console. The cause had nothing to do with npm vs. CDN correctness as such —
it's the thing "On GitHub Pages... also no risk" below quietly assumed away.

**Root cause: this repo's GitHub Pages was configured to deploy straight from
the `main` branch root** (Settings → Pages → "Deploy from a branch"), i.e. it
was serving the raw, unbuilt `index.html`/`main.js` — never running
`npm run build` at all. That's exactly the "non-bundled deployment path"
discussed below, except it wasn't a deliberately-preserved fallback, it was
just how Pages happened to be configured. Serving raw source used to *work*
under the CDN pattern purely by accident: a full `https://cdn.jsdelivr.net/...`
URL is a valid ES module specifier a browser can fetch directly, with no
bundler involved. A bare specifier like `"three"` has no such luck — it only
resolves through Vite's build step — so raw-source serving broke the moment
the import changed, independent of anything else about the migration.

**The fix had three parts**, and only the first is really "about" npm vs. CDN:

1. **Actually build and deploy `dist/`.** Added
   `.github/workflows/deploy.yml`: a GitHub Actions workflow that runs
   `npm ci && npm run build` and deploys `dist/` via `actions/upload-pages-artifact`
   + `actions/deploy-pages` on every push to `main`. This also requires
   flipping the repo's Pages source from "Deploy from a branch" to
   "GitHub Actions" in Settings — a manual, one-time step outside of git.
2. **`vite.config.js`'s `base` was pointing at a different repo's name**
   (`/ThreeJS-PWA-ECS-Surface-Stable-Dithering-With-Vite/`, the sibling
   CDN-based project this one was forked from) instead of this repo's actual
   name (`/ThreeJS-PWA-npm-Vite-Surface-Stable-Dithering/`). This is a
   copy-paste leftover from forking, unrelated to the CDN/npm decision itself
   — but it would have made every asset URL 404 even with the workflow
   correctly building and deploying `dist/`, since Vite bakes `base` into every
   emitted asset path at build time.
3. **`manifest.json`'s PWA `scope` had the same copy-paste bug**, pointing at
   a *third*, still-different stale name
   (`/ThreeJS-PWA-ECS-Fractal-Dithering-With-Vite/`). Not what broke rendering,
   but worth fixing in the same pass since a wrong `scope` can affect PWA
   install/service-worker control.

**Takeaway for next time:** when forking one of these sibling projects, always
grep for the old repo's name (`grep -rn "<old-repo-name>"`) rather than
assuming a single `vite.config.js` edit catches everything — it showed up in
three unrelated files here (`vite.config.js`, `manifest.json`, plus cosmetic
references in `index.html`'s canonical link and a `main.js` comment). And more
specifically to this doc's actual subject: **"GitHub Pages already builds via
`npm run build`" is an assumption to verify per-repo, not a given** — check
Settings → Pages' source setting before trusting that `dist/` is really what's
being served.

### PWA installability broke too — static assets need to live in `public/`

Once the Pages deploy itself was fixed (previous section), the site rendered
correctly but the browser's install prompt (the icon in Chrome's address bar)
didn't appear. Direct checks against the deployed site showed why:
`manifest.json`'s two icon URLs and `sw.js` all returned real 404s in
production, even though they built and worked in `npm run preview` too — this
wasn't a Pages-specific problem, it was the build itself never producing
these files.

**Root cause: `icons/`, `manifest.json`, and `sw.js` all lived at the project
root, not inside a `public/` folder.** Vite has exactly one mechanism for
shipping a file byte-for-byte at a fixed, predictable URL without going
through JS import/bundling: put it in `public/`, and Vite copies it into
`dist/` unchanged. Nothing else triggers that — a file only gets copied if
something (an import, an `<img src>`, a recognized `<link>` tag) references
it in a way Vite's build actually resolves. `manifest.json` sort of worked by
accident: Vite's HTML plugin specially recognizes `<link rel="manifest">` and
copies+hashes *that* file — but doesn't parse the JSON *inside* it, so its own
`icons` array (relative paths like `./icons/icon_192x192.png`) still pointed
at files that were never copied anywhere, and after hashing moved
`manifest.json` itself into `dist/assets/`, those relative paths didn't even
point at the right *location* anymore. `sw.js` got no special treatment at
all — it's only ever referenced via a runtime string
(`navigator.serviceWorker.register("./sw.js")`), which Vite can't statically
see, so it was silently absent from every build.

**Why this matters specifically for PWA installability, beyond "files
404":** Chrome's install-eligibility check requires manifest icons to
actually be fetchable (at minimum a ≥192px icon; ideally a 512px `any`- or
`maskable`-purpose one too). A manifest that references icons which don't
load fails validation quietly — no console error, the omnibox install icon
just never shows up. This is a stricter, more silent failure mode than the
CDN-vs-npm module-resolution error from the previous section; that one at
least threw loudly in the console.

**The fix:** move `icons/`, `manifest.json`, and `sw.js` into a new
`public/` folder (all together, preserving their relative layout to each
other, so `manifest.json`'s existing `./icons/...` paths keep resolving
correctly). Then, in `index.html`, switch the `<link rel="manifest">` and
favicon hrefs from bare relative paths to Vite's `%BASE_URL%` placeholder
(`href="%BASE_URL%manifest.json"`) — a bare relative href on those tags makes
Vite try to resolve+hash them as a bundled asset import, which breaks once
the file only exists in `public/` and not next to `index.html` anymore;
`%BASE_URL%` expands to the configured `base` and is left untouched by Vite's
asset pipeline, which is the documented way to reference `public/` contents
from HTML. The inline service-worker registration (`register("./sw.js")`)
needed no change — a plain relative path from the page's own URL already
lands in the right place once `sw.js` is actually being served from the
site's base path.

**Separately found in the same pass:** `favicon.ico` was referenced in
`index.html` but never existed anywhere in the repo — an orphaned reference
from however this project was originally scaffolded, unrelated to the
CDN/npm migration. Fixed by pointing the favicon at the existing
`icons/icon_192x192.png` instead of adding a new file.

**Takeaway for next time:** treat "does it build?" and "does it actually ship
correctly?" as separate questions for anything that isn't a JS/CSS import —
`npm run build` succeeding, and even `npm run preview` looking right, doesn't
guarantee every file the app *references at runtime* (manifest icons, a
service worker, fonts loaded by URL, etc.) actually made it into `dist/`.
Check with `find dist -type f` against everything `index.html`/`manifest.json`
reference, or curl the deployed URLs directly, rather than trusting a clean
build log.

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

**Caveat, confirmed the hard way — see "GitHub Pages actually broke" above:**
that last sentence assumes Pages is actually configured to run the build step.
It wasn't, in this project; Pages was serving the raw `main` branch with no
build at all, which the CDN's full-URL import had been silently working around
this whole time. Verify Settings → Pages' source is "GitHub Actions" (with a
workflow that runs `npm run build`) before trusting this paragraph for any
given repo.

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

**Option A — `npm install peerjs`. Chosen — see "Decision" below.**
- Adds a `dependencies` section to `package.json` (already exists — `three` is
  there since its own npm migration).
- `import { Peer } from "peerjs";` — a bare specifier, resolved natively by
  Vite, no config changes needed.
- The tradeoff this used to carry — breaking the "everything's CDN, nothing
  needs `npm install`" character of the project, and depending on a
  non-bundled/importmap deployment path — no longer applies: that CDN
  character is already gone (Three.js moved to npm first), and the
  commented-out importmap fallback in `index.html` was deleted outright (see
  "Outcome: the Three.js migration" above), not kept as a live alternative
  path. There's nothing left for adding a second npm dependency to break.

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

## Decision: PeerJS via npm

**Option A (`npm install peerjs`) is what we're going with**, reversing this
doc's earlier lean toward Option B (CDN). What changed: the original lean was
driven entirely by risk-aversion around PWA/service-worker caching interacting
badly with a bundler's content-hashed filenames — the user's prior-project
scar tissue described throughout this doc — while npm + Vite for a real
dependency was still hypothetical here. It stopped being hypothetical once
Three.js actually made that exact move: `npm install three`, full Vite bundling,
verified working correctly both locally (`npm run dev`/`preview`) **and in
production** — deployed, installed as a PWA, and re-checked after deploy,
with the one real bug that surfaced (the resurrected CDN import map from an
HTML-comment parsing quirk — see "Outcome" above) being about a leftover
*CDN* artifact, not about npm/bundling itself. That was the specific,
previously-unverified risk this doc kept citing; it's now closed.

With that risk resolved, Option B's remaining advantages (matching a
CDN-everywhere character, avoiding a second `npm install`) aren't worth
trading away Option A's simplicity (a bare specifier, no `+esm`/UMD-global
uncertainty to verify at implementation time, consistent with how `three` is
already imported).

**Scope of this decision — browser only.** PeerJS's `RTCDataChannel`
transport is still exactly what phase 1 (`LAN_MULTIPLAYER_CONSIDERATIONS.md`)
uses for the manual one-time-code browser experience. It is **not** the
long-term answer for LAN discovery — that remains the phase-2 native
Electron app, using real OS-level sockets (Node's `dgram` in the main
process) specifically because that's the only way to get genuine
broadcast-based LAN discovery with **zero external services**, including no
dependency on PeerJS's public broker at all. PeerJS-via-npm and the future
Electron sockets path are not competing answers to the same question — they
solve different halves of "the goal" (see that doc's "Future path" section):
PeerJS gets real peer-to-peer gameplay traffic working and testable now, in
any browser; native sockets are what eventually make discovery itself
automatic and fully LAN-contained, no relay/broker of any kind.

Done: `npm install peerjs` has been run, and `entity components/peer_connection.js`'s
hardcoded fake id (`"TEST1234"`) has been replaced with the real `Peer`-based
implementation described above. Remaining testing (two real browser tabs/
machines actually pairing over PeerJS's public broker) is tracked in
`LAN_MULTIPLAYER_CONSIDERATIONS.md`, not here.
