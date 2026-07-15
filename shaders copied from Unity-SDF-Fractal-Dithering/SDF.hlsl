// SDF's from
// https://iquilezles.org/articles/distfunctions2d/

#ifndef INCLUDE_SDF
#define INCLUDE_SDF

float dot2(float2 vec)
{
    return dot(vec, vec);
}

float ndot(float2 a, float2 b ) { return a.x * b.x - a.y * b.y; }

float SDF_Circle(float2 p, float r)
{
    return length(p) - r;
}

float SDF_Square(float2 p, float r)
{
    float2 d = abs(p) - r;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}

float SDF_Rhombus(float2 p, float r)
{
    float2 p2 = float2(r,r);
    p = abs(p);
    float h = clamp( ndot(p2-2.0*p,p2)/dot(p2,p2), -1.0, 1.0 );
    float d = length( p-0.5*p2*float2(1.0-h,1.0+h) );
    return d * sign( p.x*p2.y + p.y*p2.x - p2.x*p2.y );
}

float SDF_Pentagon(float2 p, float r)
{
    const float3 k = float3(0.809016994,0.587785252,0.726542528);
    p.x = abs(p.x);
    p -= 2.0*min(dot(float2(-k.x,k.y),p),0.0)*float2(-k.x,k.y);
    p -= 2.0*min(dot(float2( k.x,k.y),p),0.0)*float2( k.x,k.y);
    p -= float2(clamp(p.x,-r*k.z,r*k.z),r);    
    return length(p)*sign(p.y);
}

float SDF_Hexagon(float2 p, float r)
{
    const float3 k = float3(-0.866025404,0.5,0.577350269);
    p = abs(p);
    p -= 2.0*min(dot(k.xy,p),0.0)*k.xy;
    p -= float2(clamp(p.x, -k.z*r, k.z*r), r);
    return length(p)*sign(p.y);
}

float SDF_Octogon(float2 p, float r)
{
    const float3 k = float3(-0.9238795325, 0.3826834323, 0.4142135623 );
    p = abs(p);
    p -= 2.0*min(dot(float2( k.x,k.y),p),0.0)*float2( k.x,k.y);
    p -= 2.0*min(dot(float2(-k.x,k.y),p),0.0)*float2(-k.x,k.y);
    p -= float2(clamp(p.x, -k.z*r, k.z*r), r);
    return length(p)*sign(p.y);
}

float SDF_Star5(in float2 p, in float r, in float rf)
{
    const float2 k1 = float2(0.809016994375, -0.587785252292);
    const float2 k2 = float2(-k1.x,k1.y);
    p.x = abs(p.x);
    p -= 2.0*max(dot(k1,p),0.0)*k1;
    p -= 2.0*max(dot(k2,p),0.0)*k2;
    p.x = abs(p.x);
    p.y -= r;
    float2 ba = rf*float2(-k1.y,k1.x) - float2(0,1);
    float h = clamp( dot(p,ba)/dot(ba,ba), 0.0, r );
    return length(p-ba*h) * sign(p.y*ba.x-p.x*ba.y);
}

float SDF_Moon(float2 p, float d, float ra, float rb )
{
    p.y = abs(p.y);
    float a = (ra*ra - rb*rb + d*d)/(2.0*d);
    float b = sqrt(max(ra*ra-a*a,0.0));
    if( d*(p.x*b-p.y*a) > d*d*max(b-p.y,0.0) )
          return length(p-float2(a,b));
    return max( (length(p          )-ra),
               -(length(p-float2(d,0))-rb));
}

float sdHeart( in float2 p )
{
    p.x = abs(p.x);

    if( p.y+p.x>1.0 )
        return sqrt(dot2(p-float2(0.25,0.75))) - sqrt(2.0)/4.0;
    return sqrt(min(dot2(p-float2(0.00,1.00)),
                    dot2(p-0.5*max(p.x+p.y,0.0)))) * sign(p.x-p.y);
}

float SDF_CoolS(float2 p )
{
    float six = (p.y<0.0) ? -p.x : p.x;
    p.x = abs(p.x);
    p.y = abs(p.y) - 0.2;
    float rex = p.x - min(round(p.x/0.4),0.4);
    float aby = abs(p.y-0.2)-0.6;
    
    float d = dot2(float2(six,-p.y)-clamp(0.5*(six-p.y),0.0,0.2));
    d = min(d,dot2(float2(p.x,-aby)-clamp(0.5*(p.x-aby),0.0,0.4)));
    d = min(d,dot2(float2(rex,p.y  -clamp(p.y          ,0.0,0.4))));
    
    float s = 2.0*p.x + aby + abs(aby+0.4) - 0.4;
    return sqrt(d) * sign(s);
}

float SDF(float2 p, float radius)
{
    #if defined(_SHAPE_CIRCLE)
    return SDF_Circle(p, radius);
    #elif defined(_SHAPE_SQUARE)
    return SDF_Square(p, radius);
    #elif defined(_SHAPE_RHOMBUS)
    return SDF_Rhombus(p, radius);
    #elif defined(_SHAPE_PENTAGON)
    return SDF_Pentagon(p, radius);
    #elif defined(_SHAPE_HEXAGON)
    return SDF_Hexagon(p, radius);
    #elif defined(_SHAPE_OCTOGON)
    return SDF_Octogon(p, radius);
    #elif defined(_SHAPE_STAR)
    return SDF_Star5(p, radius, 0.5);
    #elif defined(_SHAPE_MOON)
    return SDF_Moon(p, radius * 0.3, radius, radius * 0.7);
    #elif defined(_SHAPE_HEART)
    return sdHeart((p / radius + float2(0, 0.5)) );
    #elif defined(_SHAPE_COOLS)
    return SDF_CoolS(p / radius);
    #endif
}

float AA_SDF(float value)
{
    float dist = -value;
    float2 ddist = float2(ddx(dist), ddy(dist));
    float pixelDist = dist / length(ddist);
    return saturate(pixelDist);
}

float AA_SDF(float value, float smoothness)
{
    float2 ddist = float2(ddx(value), ddy(value));
    float w = 0.5 * saturate(length(ddist));
    w *= smoothness;
    return smoothstep(-w, w, -value);
}

#endif
