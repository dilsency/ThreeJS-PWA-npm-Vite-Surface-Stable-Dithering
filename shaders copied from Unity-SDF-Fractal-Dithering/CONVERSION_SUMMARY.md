GitHub Copilot

Summary of what I changed when converting the Unity shader to Three.js-compatible files:

Files added
- shaders/Simple_FractalDithering.vert — GLSL vertex shader (passes uv and clip pos to fragment).
- shaders/Simple_FractalDithering.frag — GLSL fragment shader (port of the HLSL logic).
- shaders/Simple_FractalDithering.js — Three.js factory: async createFractalMaterial(...) + helper createFractalMaterialFromSources(...).
- shaders/USAGE.md — usage notes and quick example.
- shaders/example.js — runnable ES-module example (creates WebGL2 renderer, loads texture, displays shader).

High-level translation steps
- HLSL/Unity → GLSL:
  - Converted HLSL types and intrinsics to GLSL equivalents (float4→vec4, float2→vec2, tex2D→texture, lerp→mix, saturate→clamp, etc.).
  - Replaced Unity vertex/appdata/v2f pipeline with GLSL attributes/inputs and varyings.
  - Removed Unity URP lighting/shadow includes and simplified to an unlit path (texture luminance used). Lighting/shadows were not reimplemented (left as a future option).
- Shader struct / semantics:
  - Replaced semantics (POSITION, TEXCOORD0, SV_POSITION) with standard attribute/varying usage.
  - Exposed shader parameters as uniforms (prefixed with u* in GLSL) and wired them in the JS factory.
- Ported shader helpers:
  - Bayer.hlsl: ported bit-manipulation Bayer functions into GLSL (uint/uvec2 helpers and a reverseBits implementation). These use GLSL3/WebGL2 unsigned int ops.
  - SDF.hlsl: ported key SDF functions (circle, square, heart; left others as fallbacks to keep the port minimal — can expand later).
  - runevision.hlsl: ported frequency calculation (CalculateFrequency_Rune) to GLSL (simplified as in original).
  - AA_SDF: ported antialiasing helper using dFdx/dFdy.
- Safety and numeric tweaks:
  - Added small epsilons and max() guards where division could be unsafe (avoid NaNs).
  - Replaced some HLSL-specific ops (reversebits builtin) with GLSL-compatible implementations.
- Debug/keywords:
  - Removed Unity shader_feature/multi_compile debug paths and shadow features for the initial port (keeps core look intact). These can be restored if you want debug modes or shadow/light uniforms wired from Three.js.
- GLSL version handling:
  - Removed explicit #version directives from the .vert/.frag so Three.js can insert the correct header; the material is created with glslVersion: THREE.GLSL3 which requires WebGL2.
- Three.js integration:
  - Created createFractalMaterial(...) which fetches the .vert/.frag at runtime (avoids bundler MIME import errors). Also provided createFractalMaterialFromSources(...) for bundler workflows where you import shader text directly.
  - Material uses THREE.RawShaderMaterial and glslVersion: THREE.GLSL3.
  - Example code and usage doc show how to create a WebGL2 renderer and instantiate the material.
- Error handling & dev ergonomics:
  - Addressed the '#version must occur before anything else' issue by removing #version lines.
  - Addressed the browser MIME/ES module import error (when importing .vert/.frag) by switching to runtime fetch in the factory and documenting bundler alternatives (?raw, raw-loader).

Important constraints / notes
- Requires WebGL2 (GLSL ES 3.00) because of unsigned int bit ops and certain GLSL features used in the port. Use a WebGL2 context for the renderer.
- The current shader is unlit — full parity with Unity URP lighting/shadows would require passing lights/shadow maps and re-implementing the lighting model in GLSL or using Three.js lighting + custom material layers.
- I implemented a minimal set of SDF shapes; adding the rest from SDF.hlsl is straightforward if you want exact feature parity (I can add them).
- For bundlers: you can instead import shader files as raw strings (Vite ?raw, webpack raw-loader) and use createFractalMaterialFromSources to avoid runtime fetch.

If you want, I can next:
- Add the remaining SDF shapes and debug modes,
- Reintroduce lighting/shadows (wire Three.js light/shadow uniforms),
- Produce a WebGL1 fallback (replace bit ops with look-up/dither texture),
- Or inline/embedd shaders into a single JS module to remove runtime fetch.

Which of those would you like me to do next?
