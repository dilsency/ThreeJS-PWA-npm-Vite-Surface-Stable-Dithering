// precision qualifiers are auto-provided by Three.js for non-RawShaderMaterial

#include <common>
#include <packing>

#ifdef USE_LIGHTING
#include <normal_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#endif

in vec2 vUv;
in vec4 vClipPos;

out vec4 outColor;

uniform sampler2D uMainTex;
uniform vec4 uColor1;
uniform vec4 uColor2;
uniform float uScale;
uniform vec2 uClamp;
uniform float uDotRadius;
uniform float uInputExposure;
uniform float uInputOffset;
uniform float uAASmoothness;
uniform float uAAStretch;
uniform int uLevel;
uniform bool uQuantizeDots;
uniform int uShape; // 0=circle,1=square,2=rhombus,3=pentagon,4=hexagon,5=octagon,6=star,7=moon,8=heart,9=cools
uniform bool uDebugNormals; // USE_LIGHTING only: view-space mesh normal as RGB (matches THREE.MeshNormalMaterial), bypasses dithering
uniform bool uColor1UseTexture; // when true, sample uMainTex for the background (color1) instead of the uColor1 solid color
uniform bool uColor2BlendTexture; // when true, each dot/symbol blends 50/50 with the texture color underneath it instead of a flat uColor2

// --- Bayer utilities (translated from HLSL) ---
uint spreadBits(uint x) {
    x = (x ^ (x << 8)) & 0x00ff00ffu;
    x = (x ^ (x << 4)) & 0x0f0f0f0fu;
    x = (x ^ (x << 2)) & 0x33333333u;
    x = (x ^ (x << 1)) & 0x55555555u;
    return x;
}

uint reverseBits(uint i) {
    i = ((i & 0xaaaaaaaau) >> 1) | ((i & 0x55555555u) << 1);
    i = ((i & 0xccccccccu) >> 2) | ((i & 0x33333333u) << 2);
    i = ((i & 0xf0f0f0f0u) >> 4) | ((i & 0x0f0f0f0fu) << 4);
    i = ((i & 0xff00ff00u) >> 8) | ((i & 0x00ff00ffu) << 8);
    i = (i >> 16) | (i << 16);
    return i;
}

float GetBayerFromCoordLevel_Direct(uvec2 p, uint level) {
    uint px = spreadBits(p.x);
    uint py = spreadBits(p.y);
    uint i = (px ^ py) | (px << 1u);
    i = reverseBits(i);
    uint shift = 32u - (2u * level);
    uint mask = 1u << (2u * level);
    return float(i >> shift) / float(mask);
}

// --- SDF functions (ported from SDF.hlsl) ---

float dot2(vec2 v) { return dot(v,v); }

float ndot(vec2 a, vec2 b) { return a.x * b.x - a.y * b.y; }

float SDF_Circle(vec2 p, float r) { return length(p) - r; }

float SDF_Square(vec2 p, float r) {
    vec2 d = abs(p) - r;
    return length(max(d, vec2(0.0))) + min(max(d.x,d.y), 0.0);
}

float SDF_Rhombus(vec2 p, float r) {
    vec2 p2 = vec2(r, r);
    p = abs(p);
    float h = clamp(ndot(p2 - 2.0*p, p2) / dot(p2, p2), -1.0, 1.0);
    float d = length(p - 0.5*p2*vec2(1.0 - h, 1.0 + h));
    return d * sign(p.x*p2.y + p.y*p2.x - p2.x*p2.y);
}

float SDF_Pentagon(vec2 p, float r) {
    const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
    p.x = abs(p.x);
    p -= 2.0*min(dot(vec2(-k.x,k.y), p), 0.0)*vec2(-k.x,k.y);
    p -= 2.0*min(dot(vec2( k.x,k.y), p), 0.0)*vec2( k.x,k.y);
    p -= vec2(clamp(p.x, -r*k.z, r*k.z), r);
    return length(p) * sign(p.y);
}

float SDF_Hexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0*min(dot(k.xy, p), 0.0)*k.xy;
    p -= vec2(clamp(p.x, -k.z*r, k.z*r), r);
    return length(p) * sign(p.y);
}

float SDF_Octogon(vec2 p, float r) {
    const vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
    p = abs(p);
    p -= 2.0*min(dot(vec2( k.x,k.y), p), 0.0)*vec2( k.x,k.y);
    p -= 2.0*min(dot(vec2(-k.x,k.y), p), 0.0)*vec2(-k.x,k.y);
    p -= vec2(clamp(p.x, -k.z*r, k.z*r), r);
    return length(p) * sign(p.y);
}

float SDF_Star5(in vec2 p, in float r, in float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-k1.x, k1.y);
    p.x = abs(p.x);
    p -= 2.0*max(dot(k1, p), 0.0)*k1;
    p -= 2.0*max(dot(k2, p), 0.0)*k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf*vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba*h) * sign(p.y*ba.x - p.x*ba.y);
}

float SDF_Moon(vec2 p, float d, float ra, float rb) {
    p.y = abs(p.y);
    float a = (ra*ra - rb*rb + d*d) / (2.0*d);
    float b = sqrt(max(ra*ra - a*a, 0.0));
    if (d*(p.x*b - p.y*a) > d*d*max(b - p.y, 0.0))
        return length(p - vec2(a, b));
    return max((length(p) - ra),
               -(length(p - vec2(d, 0.0)) - rb));
}

float sdHeart(in vec2 p) {
    p.x = abs(p.x);
    if (p.y + p.x > 1.0) return length(p - vec2(0.25,0.75)) - sqrt(2.0)/4.0;
    return sqrt(min(dot2(p - vec2(0.0,1.0)), dot2(p - 0.5*max(p.x+p.y, 0.0)))) * sign(p.x - p.y);
}

float SDF_CoolS(vec2 p) {
    float six = (p.y < 0.0) ? -p.x : p.x;
    p.x = abs(p.x);
    p.y = abs(p.y) - 0.2;
    float rex = p.x - min(round(p.x/0.4), 0.4);
    float aby = abs(p.y - 0.2) - 0.6;

    float d = dot2(vec2(six, -p.y) - clamp(0.5*(six - p.y), 0.0, 0.2));
    d = min(d, dot2(vec2(p.x, -aby) - clamp(0.5*(p.x - aby), 0.0, 0.4)));
    d = min(d, dot2(vec2(rex, p.y - clamp(p.y, 0.0, 0.4))));

    float s = 2.0*p.x + aby + abs(aby + 0.4) - 0.4;
    return sqrt(d) * sign(s);
}

float SDF(vec2 p, float radius) {
    if (uShape == 0) return SDF_Circle(p, radius);
    if (uShape == 1) return SDF_Square(p, radius);
    if (uShape == 2) return SDF_Rhombus(p, radius);
    if (uShape == 3) return SDF_Pentagon(p, radius);
    if (uShape == 4) return SDF_Hexagon(p, radius);
    if (uShape == 5) return SDF_Octogon(p, radius);
    if (uShape == 6) return SDF_Star5(p, radius, 0.5);
    if (uShape == 7) return SDF_Moon(p, radius * 0.3, radius, radius * 0.7);
    if (uShape == 8) return sdHeart(p / radius + vec2(0.0, 0.5));
    if (uShape == 9) return SDF_CoolS(p / radius);
    // fallback
    return SDF_Circle(p, radius);
}

float AA_SDF(float value, float smoothness) {
    vec2 ddist = vec2(dFdx(value), dFdy(value));
    float w = 0.5 * clamp(length(ddist), 0.0, 1.0);
    w *= smoothness;
    return smoothstep(-w, w, -value);
}

// --- Frequency calculation (Rune) simplified ---

vec4 CalculateFrequency_Rune(vec2 uv_DitherTex, vec4 screenPos, vec2 dx, vec2 dy, int level, float scale) {
    mat2 matr = mat2(dx, dy);
    vec4 vectorized = vec4(dx, dy);
    float Q = dot(vectorized, vectorized);
    float R = determinant(matr);
    float discriminantSqr = max(0.0, Q*Q - 4.0*R*R);
    float discriminant = sqrt(discriminantSqr);
    vec2 freq = sqrt(vec2(Q + discriminant, Q - discriminant) * 0.5);
    float spacing = freq.y;
    float scaleExp = exp2(scale + float(level));
    spacing *= scaleExp;
    return vec4(freq, freq * scaleExp);
}

void main() {
    // sample texture and compute luminance
    vec4 texSample = texture(uMainTex, vUv);
    vec3 tex = texSample.rgb;
    // the texture's alpha channel doubles as a per-region dither mask: 1 = fully
    // dithered (the default for opaque textures with no alpha data), 0 = show the
    // plain texture color untouched. See USAGE.md for why alpha was chosen here.
    float ditherMask = texSample.a;
    float albedo = dot(vec3(0.299,0.587,0.114), tex);

    float luminance;
    #ifdef USE_LIGHTING
        // half-lambert shading from the scene's first directional light, matching
        // Unity's single "main light" concept; getShadowMask() combines shadows
        // from all directional lights that cast them.
        vec3 N = normalize(vNormal);

        if (uDebugNormals) {
            outColor = vec4(N * 0.5 + 0.5, 1.0);
            return;
        }

        float shading = 0.0;
        #if NUM_DIR_LIGHTS > 0
        float ndotl = clamp(dot(N, directionalLights[0].direction), 0.0, 1.0);
        float lightLuma = dot(directionalLights[0].color, vec3(0.2126, 0.7152, 0.0722));
        shading = pow(ndotl, 0.5) * lightLuma;
        #endif
        float shadow = getShadowMask();
        luminance = min(shadow, shading) * albedo;
    #else
        luminance = albedo;
    #endif
    luminance = clamp(luminance * uInputExposure + uInputOffset, uClamp.x, uClamp.y);

    float LEVEL = exp2(float(uLevel));
    float LEVEL_RESOLUTION = LEVEL;
    float LEVEL_PREV = float(max(0, uLevel - 1));
    float LEVEL_PREV_RESOLUTION = exp2(LEVEL_PREV);
    float LEVEL_DOTCOUNT = LEVEL_RESOLUTION * LEVEL_RESOLUTION;
    float LEVEL_PREV_DOTCOUNT = LEVEL_PREV_RESOLUTION * LEVEL_PREV_RESOLUTION;

    vec4 frequencies = CalculateFrequency_Rune(vUv, vClipPos, dFdx(vUv), dFdy(vUv), uLevel, uScale);
    float logLevel = log2(frequencies.w / max(luminance, 1e-6));
    float floorLog = floor(logLevel);
    float fracLog = fract(logLevel);

    vec2 tileUV = fract(vUv * exp2(-floorLog));
    vec2 cellUV = fract(tileUV * LEVEL_RESOLUTION) - 0.5;

    uvec2 cellCoord = uvec2(floor(tileUV * LEVEL_RESOLUTION));
    float b0 = GetBayerFromCoordLevel_Direct(cellCoord + uvec2(0u,0u), uint(uLevel));
    float b1 = GetBayerFromCoordLevel_Direct(cellCoord + uvec2(1u,0u), uint(uLevel));
    float b2 = GetBayerFromCoordLevel_Direct(cellCoord + uvec2(0u,1u), uint(uLevel));
    float b3 = GetBayerFromCoordLevel_Direct(cellCoord + uvec2(1u,1u), uint(uLevel));
    vec4 bayer = vec4(b0, b1, b2, b3);

    vec4 bayerMask = (bayer * LEVEL_DOTCOUNT) - LEVEL_PREV_DOTCOUNT;
    float numNewDots = LEVEL_DOTCOUNT - LEVEL_PREV_DOTCOUNT;
    float invisible = numNewDots * (1.0 - fracLog);
    vec4 scales = vec4(invisible) - bayerMask;
    if (uQuantizeDots) {
        scales = step(vec4(1.0), scales);
    } else {
        scales = clamp(scales, 0.0, 1.0);
    }

    vec4 scalar = vec4(1.0) / max((fracLog * 0.5 + 0.5) * luminance * scales, vec4(1e-6));
    vec2 sample0 = (cellUV + vec2(+0.5, +0.5)) * scalar.x;
    vec2 sample1 = (cellUV + vec2(-0.5, +0.5)) * scalar.y;
    vec2 sample2 = (cellUV + vec2(+0.5, -0.5)) * scalar.z;
    vec2 sample3 = (cellUV + vec2(-0.5, -0.5)) * scalar.w;

    vec4 SDFs = vec4(
        SDF(sample0, uDotRadius),
        SDF(sample1, uDotRadius),
        SDF(sample2, uDotRadius),
        SDF(sample3, uDotRadius)
    );

    float minSDF = min(min(SDFs.x, SDFs.y), min(SDFs.z, SDFs.w));
    float smoothness = uAASmoothness;
    float grazingSmoothing = uAAStretch * frequencies.x / max(frequencies.y, 1e-6);
    float dots = AA_SDF(minSDF, smoothness + grazingSmoothing);

    // lerp in perceptual (gamma) space, matching Unity's Gamma22ToLinear(lerp(LinearToGamma22(...)))
    vec3 color1Rgb = uColor1UseTexture ? tex : uColor1.rgb;
    vec3 gammaColor1 = pow(max(color1Rgb, vec3(0.0)), vec3(1.0 / 2.2));
    vec3 gammaColor2 = pow(max(uColor2.rgb, vec3(0.0)), vec3(1.0 / 2.2));
    if (uColor2BlendTexture) {
        // blend each dot/symbol with the texture color underneath it, instead of a flat color2
        vec3 gammaTex = pow(max(tex, vec3(0.0)), vec3(1.0 / 2.2));
        gammaColor2 = mix(gammaTex, gammaColor2, 0.5);
    }
    vec3 color = pow(mix(gammaColor1, gammaColor2, dots), vec3(2.2));

    // gate the whole dithered look by the alpha-channel mask: regions with
    // ditherMask < 1 fall back toward the plain texture color instead.
    vec3 finalColor = mix(tex, color, ditherMask);
    outColor = vec4(finalColor, 1.0);
}
