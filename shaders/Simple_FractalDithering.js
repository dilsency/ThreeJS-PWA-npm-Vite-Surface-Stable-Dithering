// Simple_FractalDithering ShaderMaterial factory for Three.js (WebGL2 / GLSL3)
// Note: .vert/.frag files are plain text assets; importing them as modules requires
// bundler configuration (raw loader). To avoid MIME/import issues in the browser,
// this module fetches the shader sources at runtime by default.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js";// import * as THREE from "three";

async function loadText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load shader: ${url}`);
  return await r.text();
}

// Accepts a THREE.Color, THREE.Vector4, [r,g,b,(a)] array, hex number (0xff8800),
// or CSS color string ("orange"); falls back to `fallback` (a THREE.Vector4) when unset.
function toColorVec4(value, fallback) {
  if (value == null) return fallback;
  if (value.isVector4) return value;
  if (value.isColor) return new THREE.Vector4(value.r, value.g, value.b, 1.0);
  if (Array.isArray(value)) return new THREE.Vector4(value[0], value[1], value[2], value[3] ?? 1.0);
  const c = new THREE.Color(value);
  return new THREE.Vector4(c.r, c.g, c.b, 1.0);
}

// opts.lighting: false (default) = unlit, dither driven by texture albedo only.
//                true = dither driven by the scene's first directional light
//                (half-lambert shading) combined with its shadow map.
function buildMaterial(vertexShader, fragmentShader, opts) {
  const ownUniforms = {
    uMainTex: { value: opts.map || new THREE.Texture() },
    uColor1: { value: toColorVec4(opts.color1, new THREE.Vector4(0.2, 0.2, 0.098, 1.0)) },
    uColor2: { value: toColorVec4(opts.color2, new THREE.Vector4(0.898, 1.0, 1.0, 1.0)) },
    uScale: { value: opts.scale ?? 3.5 },
    uClamp: { value: opts.clamp ?? new THREE.Vector2(0.2, 1.0) },
    uDotRadius: { value: opts.dotRadius ?? 0.8 },
    uInputExposure: { value: opts.inputExposure ?? 1.0 },
    uInputOffset: { value: opts.inputOffset ?? 0.0 },
    uAASmoothness: { value: opts.aaSmoothness ?? 1.5 },
    uAAStretch: { value: opts.aaStretch ?? 0.125 },
    uLevel: { value: opts.level ?? 3 },
    uQuantizeDots: { value: !!opts.quantizeDots },
    uShape: { value: opts.shape ?? 0 },
    uDebugNormals: { value: !!opts.debugNormals },
    uColor1UseTexture: { value: !!opts.color1Texture },
    uColor2BlendTexture: { value: !!opts.color2BlendTexture }
  };

  // Three.js does not auto-merge its light/shadow uniforms into a custom
  // ShaderMaterial's `uniforms` — with `lights: true` it expects them to
  // already be present (it just assigns .value on them each frame), so we
  // have to bring in UniformsLib.lights ourselves for the lit variant.
  const uniforms = opts.lighting
    ? THREE.UniformsUtils.merge([THREE.UniformsLib.lights, ownUniforms])
    : ownUniforms;

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    defines: opts.lighting ? { USE_LIGHTING: '' } : {},
    lights: !!opts.lighting,
    glslVersion: THREE.GLSL3,
    transparent: false,
  });
}

// Create material by fetching shader files relative to this module when not provided.
// Options:
// - map: THREE.Texture
// - vertexShader / fragmentShader: strings (sources)
// - vertUrl / fragUrl: URLs to fetch shader sources
// Returns Promise<THREE.ShaderMaterial>
export async function createFractalMaterial(opts = {}) {

    var vertSource = "";
    var fragSource = "";

    try {
        // changed
        //new URL('./Simple_FractalDithering.vert', import.meta.url)
        //new URL('./Simple_FractalDithering.frag', import.meta.url)
        // to
        //new URL('./Simple_FractalDithering.vert?raw', import.meta.url)
        //new URL('./Simple_FractalDithering.frag?raw', import.meta.url)

        vertSource = opts.vertexShader || opts.vertexShaderSource ||
            (opts.vertUrl ? await loadText(opts.vertUrl) : await loadText(new URL('./Simple_FractalDithering.vert?raw', import.meta.url)));
        fragSource = opts.fragmentShader || opts.fragmentShaderSource ||
            (opts.fragUrl ? await loadText(opts.fragUrl) : await loadText(new URL('./Simple_FractalDithering.frag?raw', import.meta.url)));
    }
    catch (e) {
        console.error(e);
        throw new Error('Failed to load shader sources. Check console for details.');
    }


  return buildMaterial(vertSource, fragSource, opts);
}

// Synchronous helper when you already have shader sources as strings.
export function createFractalMaterialFromSources(vertexSource, fragmentSource, opts = {}) {
  return buildMaterial(vertexSource, fragmentSource, opts);
}
