/*
 * Copyright (c) 2025 Rune Skovbo Johansen
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#ifndef INCLUDE_RUNEVISION
#define INCLUDE_RUNEVISION

float4 CalculateFrequency_Rune(float2 uv_DitherTex, float4 screenPos, float2 dx, float2 dy, int level, float scale)
{    
    #if (RADIAL_COMPENSATION)
        // Make screenPos have 0,0 in the center of the screen.
        float2 screenP = (screenPos.xy / screenPos.w - 0.5) * 2.0;
        // Calculate view direction projected onto camera plane.
        float2 viewDirProj = float2(
            screenP.x /  UNITY_MATRIX_P[0][0],
            screenP.y / -UNITY_MATRIX_P[1][1]);
        // Calculate how much dots should be larger towards the edges of the screen.
        // This is meant to keep dots completely stable under camera rotation.
        // Currently it doesn't entirely work but is more stable than no compensation.
        float radialCompensation = dot(viewDirProj, viewDirProj) + 1;
        dx *= radialCompensation;
        dy *= radialCompensation;
    #endif
    
    // Get frequency based on singular value decomposition.
    // A simpler approach would have been to use fwidth(uv_DitherTex).
    // However:
    //  1) fwidth is not accurate and produces axis-aligned biases/artefacts.
    //  2) We need both the minimum and maximum rate of change.
    //     These can be along any directions (orthogonal to each other),
    //     not necessarily aligned with x, y, u or v.
    //     So we use (a subset of) singular value decomposition to get these.
    float2x2 matr = { dx, dy };
    float4 vectorized = float4(dx, dy);
    float Q = dot(vectorized, vectorized);
    float R = determinant(matr); //ad-bc
    float discriminantSqr = max(0, Q*Q-4*R*R);
    float discriminant = sqrt(discriminantSqr);

    // "freq" here means rate of change of the UV coordinates on the screen.
    // Something smaller on the screen has a larger rate of change of its
    // UV coordinates from one pixel to the next.
    //
    // The freq variable: (max-freq, min-freq)
    //
    // If a surface has non-uniform scaling, or is seen at an angle,
    // or has UVs that are stretched more in one direction than the other,
    // the min and max frequency won't be the same.
    float2 freq = sqrt(float2(Q + discriminant, Q - discriminant) * 0.5);

    // We define a spacing variable which linearly correlates with
    // the average distance between dots.
    // For this dot spacing, we use the smaller frequency, which
    // corresponds to the largest amount of stretching.
    // This for example means that dots seen at an angle will be
    // compressed in one direction rather than enlarged in the other.
    float spacing = freq.y;

    // Scale the spacing by the specified input (power of two) scale.
    float scaleExp = exp2(scale + level);
    spacing *= scaleExp;
    
    return float4(freq, freq * scaleExp);
}

#endif
