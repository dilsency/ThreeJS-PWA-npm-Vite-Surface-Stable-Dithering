// Compiled by Three.js as a non-RawShaderMaterial: position/uv/precision and the
// standard matrices (modelMatrix, modelViewMatrix, projectionMatrix, viewMatrix,
// normalMatrix) are auto-declared by Three.js — do not redeclare them here.

#include <common>

#ifdef USE_LIGHTING
#include <normal_pars_vertex>
#include <shadowmap_pars_vertex>
#endif

out vec2 vUv;
out vec4 vClipPos;

void main() {
    vUv = uv;

    #ifdef USE_LIGHTING
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <normal_vertex>
    #endif

    #include <begin_vertex>

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vClipPos = projectionMatrix * mvPosition;
    gl_Position = vClipPos;

    #ifdef USE_LIGHTING
    #include <worldpos_vertex>
    #include <shadowmap_vertex>
    #endif
}
