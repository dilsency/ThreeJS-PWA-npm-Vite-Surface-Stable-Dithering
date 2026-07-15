/*
 * Copyright (c) 2025 mattdevv (https://github.com/mattdevv)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

Shader "Unlit/Simple_FractalDithering"
{
    Properties
    {
        [MainTexture] _MainTex ("Texture", 2D) = "white" {}
        _Color1 ("Color 1", Color) = (0.2, 0.2, 0.09803921, 1)
        _Color2 ("Color 2", Color) = (0.89803921, 1, 1, 1)
        
        _InputExposure ("Input Exposure", float) = 1
        _InputOffset  ("Input Offset", float) = 0
        _Clamp("Value Clamp", Vector) = (0.2, 1, 0, 0)
        
        _Scale ("Scale", float) = 3.5
        _DotRadius ("Dot Radius", Range(0, 2)) = 0.8
        [KeywordEnum(Level1, Level2, Level3, Level4, Level5, Level6, Level7, Level8)] _Bayer ("Bayer Level",int) = 2
        [Toggle(QUANTIZE_DOTS)] _QuantizeDots ("Quantize Dots", float) = 0
        
        [Min(1)] _AASmoothness ("AA Smoothness", float) = 1.5
        [Min(0)] _AAStretch ("AA Stretch", float) = 0.125
        
        [KeywordEnum(Circle, Square, Rhombus, Pentagon, Hexagon, Octogon, Star, Moon, Heart, CoolS)] _Shape ("SDF Shape", int) = 0
        [KeywordEnum(None, Luminance, Freq, UV, Cell, Bayer, SDF)] _Debug ("Debug Mode",int) = 0
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" }
        
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            
            #pragma target 4.5
            
            #pragma shader_feature _DEBUG_NONE _DEBUG_LUMINANCE _DEBUG_FREQ _DEBUG_UV _DEBUG_CELL _DEBUG_BAYER _DEBUG_SDF
            #pragma shader_feature _BAYER_LEVEL1 _BAYER_LEVEL2 _BAYER_LEVEL3 _BAYER_LEVEL4 _BAYER_LEVEL5 _BAYER_LEVEL6 _BAYER_LEVEL7 _BAYER_LEVEL8
            #pragma shader_feature _SHAPE_CIRCLE _SHAPE_SQUARE _SHAPE_RHOMBUS _SHAPE_PENTAGON _SHAPE_HEXAGON _SHAPE_OCTOGON _SHAPE_STAR _SHAPE_MOON _SHAPE_HEART _SHAPE_COOLS
            #pragma shader_feature QUANTIZE_DOTS

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            // literally all we had to to get it working on Android was add a _ as the first option lmao
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            #include "./Bayer.hlsl"
            #include "./runevision.hlsl"
            #include "./SDF.hlsl"
            
            #if   defined(_BAYER_LEVEL1)
                #define LEVEL                1
            #elif defined(_BAYER_LEVEL2)
                #define LEVEL                2
            #elif defined(_BAYER_LEVEL3)
                #define LEVEL                3
            #elif defined(_BAYER_LEVEL4)
                #define LEVEL                4
            #elif defined(_BAYER_LEVEL5)
                #define LEVEL                5
            #elif defined(_BAYER_LEVEL6)
                #define LEVEL                6
            #elif defined(_BAYER_LEVEL7)
                #define LEVEL                7
            #elif defined(_BAYER_LEVEL8)
                #define LEVEL                8
            #endif

            #define LEVEL_RESOLUTION         exp2(LEVEL)                                        // side length of bayer level
            #define LEVEL_DOTCOUNT           (LEVEL_RESOLUTION * LEVEL_RESOLUTION)              // number of dots in bayer level

            #define LEVEL_PREV               (LEVEL - 1)                                        // next lower level index
            #define LEVEL_PREV_RESOLUTION    exp2(LEVEL_PREV)                                   // side length of lower bayer level
            #define LEVEL_PREV_DOTCOUNT      (LEVEL_PREV_RESOLUTION * LEVEL_PREV_RESOLUTION)    // number of dots in lower bayer level
            
            struct appdata
            {
                float4 vertex : POSITION;
                float4 normalOS : NORMAL;
                float4 tangentOS : TANGENT;
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 clipPos    : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                float3 normalWS   : TEXCOORD2;
            };

            sampler2D _MainTex;
            float4 _MainTex_ST;

            float4 _Color1;
            float4 _Color2;
            float _Scale;
            float2 _Clamp;
            float _DotRadius;

            float _InputExposure;
            float _InputOffset;

            float _AASmoothness;
            float _AAStretch;
            
            v2f vert (appdata v)
            {
                v2f o;
                
                VertexPositionInputs positions = GetVertexPositionInputs(v.vertex.xyz);
                VertexNormalInputs normals = GetVertexNormalInputs(v.normalOS.xyz, v.tangentOS);

                o.clipPos = positions.positionCS;
                o.positionWS = positions.positionWS;
                o.normalWS = normals.normalWS;
                
                o.uv = v.uv;
                
                return o;
            }

            // this is how I was calculating freq initially
            float CalculateFreq_mattdevv(float4 screenPos)
            {
                float zdepth = LinearEyeDepth(screenPos.z, _ZBufferParams);
                return zdepth * exp2(-_Scale);
            }
            
            half4 frag (v2f i) : SV_Target
            {
                // surface properties
                float shadow = MainLightRealtimeShadow(TransformWorldToShadowCoord(i.positionWS));
                float shading = pow(saturate(dot(normalize(i.normalWS), _MainLightPosition.xyz)), .5);
                float albedo = dot(float3(0.299, 0.587, 0.114), tex2D(_MainTex, i.uv).rgb);

                // calculate brightness of fragment
                float luminance = min(shadow, shading) * albedo;
                luminance = saturate(luminance * _InputExposure + _InputOffset);
                luminance = clamp(luminance, _Clamp.x, _Clamp.y);

                // calculate 
                float4 frequencies = CalculateFrequency_Rune(i.uv, i.clipPos, ddx_fine(i.uv), ddy_fine(i.uv), LEVEL, _Scale);
                float logLevel = log2(frequencies.w / luminance);
                float floorLog = floor(logLevel);
                float fracLog = logLevel - floorLog; // same as frac(logLevel)

                // each tile contains N*N cells of Bayer pattern
                float2 tileUV = (frac(i.uv * exp2(-floorLog)));
                // each cell spans covers 1 dot but is offset by (0.5, 0.5)
                float2 cellUV = frac(tileUV * LEVEL_RESOLUTION) - 0.5;

                // Calculate 4 nearest Bayer samples for this cell
                uint2 cellCoord = (uint2)(tileUV * LEVEL_RESOLUTION);
                float4 bayer = float4(
                    GetBayerFromCoordLevel_Direct(cellCoord + uint2(0,0), LEVEL),
                    GetBayerFromCoordLevel_Direct(cellCoord + uint2(1,0), LEVEL),
                    GetBayerFromCoordLevel_Direct(cellCoord + uint2(0,1), LEVEL),
                    GetBayerFromCoordLevel_Direct(cellCoord + uint2(1,1), LEVEL));

                // number each bayer dot sequentially then subtract the count of dots on the level above. ie 2^(N-1)
                float4 bayerMask = (bayer * LEVEL_DOTCOUNT) - LEVEL_PREV_DOTCOUNT; // only want the dots that weren't on prev level

                // create a 0-1 mask for each Bayer dot that controls if it can be seen (also scales the dot in)
                const float numNewDots = LEVEL_DOTCOUNT - LEVEL_PREV_DOTCOUNT;

                // Each dot is numbered sequentially in range [0, 2^N) according to its intensity value
                // A dot will be visible if the value (fracLog*numNewDots) is greater than their value (when quantization is on, otherwise it blends in)
                // Subtract the number of dots on the previous level (ie 2^(N-1)) so that this many dots have a negative value and are always visible
                float invisible = numNewDots * (1-fracLog);
                float4 scales = invisible - bayerMask;
                #ifdef QUANTIZE_DOTS
                scales = step(1,scales); // dot only appears when value is >1
                #else
                scales = saturate(scales); // 0-1 blend in dot
                #endif

                // scale the dots cell according to their bayer value so dots scale/appear with relation to fracLog
                float4 scalar = rcp((fracLog * 0.5 + 0.5) * luminance * scales);
                float2 sample0 = (cellUV + float2(+0.5, +0.5)) * scalar.x;
                float2 sample1 = (cellUV + float2(-0.5, +0.5)) * scalar.y;
                float2 sample2 = (cellUV + float2(+0.5, -0.5)) * scalar.z;
                float2 sample3 = (cellUV + float2(-0.5, -0.5)) * scalar.w;

                // sample SDF at 4 corners of the grid
                // Each coordinates are scaled so dots not yet visible are infinitely small
                float4 SDFs = float4(
                    SDF(sample0, _DotRadius),
                    SDF(sample1, _DotRadius),
                    SDF(sample2, _DotRadius),
                    SDF(sample3, _DotRadius));

                // combine the 4 corner dot sdfs
                float minSDF = min(min(SDFs.x, SDFs.y), min(SDFs.z, SDFs.w)) ;
                
                // turn SDF into antialiased edge
                float smoothness = _AASmoothness;
                float grazingSmoothing = _AAStretch * frequencies.x / frequencies.y;
                float dots = AA_SDF(minSDF, smoothness + grazingSmoothing);

                #if _DEBUG_LUMINANCE
                return float4(luminance.xxx, 1);
                
                #elif _DEBUG_FREQ
                float4 d_color = frac(floor(logLevel) / 2) < 0.5 ? float4(1,0,0,1) : float4(0,1,0,1);
                return lerp(d_color, 0, dots/2);
                
                #elif _DEBUG_UV
                return lerp(float4(tileUV, 0 , 0), 0, dots/2);
                
                #elif _DEBUG_CELL
                return lerp(float4(cellUV, 0, 0), 0, dots/2);
                
                #elif _DEBUG_BAYER
                return lerp(bayer, 0, dots/2);
                
                #elif _DEBUG_SDF
                return minSDF;
                #endif

                // lerp in perceptual space
                return Gamma22ToLinear(lerp(LinearToGamma22(_Color1), LinearToGamma22(_Color2), dots));
            }
            ENDHLSL
        }

        Pass
        {
	        Tags { "LightMode"="ShadowCaster" }
	        
	        ZWrite On
	        ZTest LEqual
	        
            HLSLPROGRAM
	        #pragma vertex ShadowPassVertex
	        #pragma fragment ShadowPassFragment
	        
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
	        #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/CommonMaterial.hlsl"
	        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/SurfaceInput.hlsl"
	        #include "Packages/com.unity.render-pipelines.universal/Shaders/ShadowCasterPass.hlsl"
	        
	        ENDHLSL
        }
    }
    Fallback "Unlit/BasicShader"
}
