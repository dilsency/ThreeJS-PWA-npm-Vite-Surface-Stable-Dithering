import { defineConfig } from 'vite'

// Adjust `base` to match your GitHub Pages repo path ("/REPO_NAME/").
// If your project is published at https://<user>.github.io/<repo>/ set base to '/<repo>/'.
export default defineConfig({
  base: '/ThreeJS-PWA-npm-Vite-Surface-Stable-Dithering/',
  assetsInclude: ['**/*.frag', '**/*.vert']
})
