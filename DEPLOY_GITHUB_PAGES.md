Deployment notes — GitHub Pages
================================

Summary
-------
- Added `vite.config.js` to set `base` and include shader files as assets.

Files changed (local only)
--------------------------
- `vite.config.js` — sets `base` to the repo path and `assetsInclude: ['**/*.frag','**/*.vert']` so Vite copies shader files into `dist/assets`.

Build & preview
-----------------
1. Build production bundle:

```bash
npm run build
```

2. Preview the production build locally (serves at the configured `base` path):

```bash
npm run preview
```

Deployment to GitHub Pages
--------------------------
- If your project is published at `https://<user>.github.io/<repo>/`, set `base` in `vite.config.js` to `'/<repo>/'`.
- Deploy the `dist` directory to GitHub Pages (gh-pages branch or the `gh-pages` action). Shaders will be available under `assets/` with hashed filenames (e.g. `assets/Simple_FractalDithering-*.frag`).

Notes on shaders
-----------------
- The project imports or fetches `.vert`/`.frag` shader files at runtime. Vite can either bundle them as plain text (using `?raw`) or copy them as assets into `dist`.
- You can alternatively place shader files into a `public/` folder to guarantee stable, unhashed URLs (e.g. `/shaders/Simple_FractalDithering.frag`). This avoids runtime lookup of hashed asset names.

Notes on texture assets
------------------------
- `entity components/test_objects.js` resolves texture files the same way the shaders are resolved above: `new URL('../textures/texture_checkerboard.png', import.meta.url)`. Vite statically scans the source code for this exact `new URL(<string literal>, import.meta.url)` pattern at *build* time and, when it finds one, copies that specific file into `dist/assets` (with a hashed name) and rewrites the literal into the correct hashed URL. This only works when the first argument is a literal string Vite can read directly out of the source — it does not evaluate any code to figure out what the string might be at runtime.
- `EntityComponentTestCube` now supports a `textureFile` option so a cube can use a texture other than the default (e.g. `texture_checkerboard_alphamask.png` for CubeF). The tempting way to write this is `new URL('../textures/' + this.#textureFile, import.meta.url)` — but that turns the argument into a *dynamic* expression, which breaks Vite's static analysis. In dev (`npm run dev`) this still works because Vite serves files straight off disk, so the bug is invisible until you run `npm run build`: the referenced texture(s) simply won't be copied into `dist/assets`, and the resulting URL will 404 in production/GitHub Pages.
- To keep both texture files bundle-safe, `methodInitialize()` instead branches on `this.#textureFile` and writes out each `new URL(...)` call with its filename as a literal:

  ```js
  texUrl = this.#textureFile === 'texture_checkerboard_alphamask.png'
      ? new URL('../textures/texture_checkerboard_alphamask.png', import.meta.url).href
      : new URL('../textures/texture_checkerboard.png', import.meta.url).href;
  ```

  This is a bit repetitive, but it guarantees every texture file we actually reference gets picked up by Vite's static analysis and survives a production build. It doesn't scale gracefully — every new texture needs its own literal branch — so if the number of textures keeps growing, it's worth switching to `import.meta.glob('../textures/*', { eager: true, query: '?url', import: 'default' })`, which asks Vite to eagerly resolve every file in the directory up front into a lookup object, so texture files can be selected by a dynamic key without losing bundling. That's more moving parts for two texture files, which is why we didn't reach for it yet.

No commits
----------
- This file is created locally. I did not perform any git commits; review and commit as you prefer.
