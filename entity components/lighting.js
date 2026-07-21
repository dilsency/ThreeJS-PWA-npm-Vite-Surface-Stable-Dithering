// imports
// base
import * as THREE from "three";
// ECS
import {EntityComponent} from "../classes/ECS/entity_component.js";

//
export class EntityComponentDirectionalLight extends EntityComponent
{
    // #region bare minimum

    #params = null;

    //
    #light = null;

    // #endregion bare minimum

    // #region construct

    constructor(params)
    {
        super(params);
        this.#params = params;
    }

    // #endregion construct

    // #region lifecycle

    methodInitialize()
    {
        //
        const color = this.#params.color ?? 0xffffff;
        const intensity = this.#params.intensity ?? 1.0;

        //
        this.#light = new THREE.DirectionalLight(color, intensity);
        this.#light.position.copy(this.#params.position ?? new THREE.Vector3(5, 8, 5));
        this.#light.target.position.copy(this.#params.target ?? new THREE.Vector3(0, 0, 0));

        //
        // castShadow defaults to true to preserve existing (world-scene) behavior;
        // pass castShadow:false for lights that have nothing to receive/cast a
        // shadow map against (e.g. a lone HUD icon) to skip the extra render pass.
        this.#light.castShadow = this.#params.castShadow ?? true;
        if(this.#light.castShadow)
        {
            const shadowCamSize = this.#params.shadowCamSize ?? 15;
            this.#light.shadow.camera.left = -shadowCamSize;
            this.#light.shadow.camera.right = shadowCamSize;
            this.#light.shadow.camera.top = shadowCamSize;
            this.#light.shadow.camera.bottom = -shadowCamSize;
            this.#light.shadow.camera.near = 0.5;
            this.#light.shadow.camera.far = 50;
            this.#light.shadow.mapSize.set(2048, 2048);
            this.#light.shadow.bias = -0.0005;
        }

        //
        this.methodGetTargetScene().add(this.#light);
        this.methodGetTargetScene().add(this.#light.target);
    }

    methodUpdate(timeElapsed, timeDelta)
    {
    }

    // #endregion lifecycle

    // #region getters

    methodGetLight(){return this.#light;}

    // #endregion getters

    // #region overridable hook methods

    // Which scene this light belongs in - defaults to the world scene.
    // EntityComponentDirectionalLight is reused for both the world sun and
    // (via EntityComponentDirectionalLightHUD below) the HUD sun, and those
    // need different scenes - overridden the same way
    // EntityComponentTestCube/EntityComponentTestCubeHUD handle it. See
    // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md.
    methodGetTargetScene()
    {
        return this.methodGetScene();
    }

    // #endregion overridable hook methods
}

// HUD variant of EntityComponentDirectionalLight - exists purely to override
// methodGetTargetScene() below, so main.js's hudSun instantiation no longer
// needs a hard-wired `scene:sceneHUD` constructor param. Mirrors
// EntityComponentTestCubeHUD's existing role for cubeHUD - see
// BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md for why a small subclass was
// chosen here over a constructor flag.
export class EntityComponentDirectionalLightHUD extends EntityComponentDirectionalLight
{
    // #region overridable hook methods

    methodGetTargetScene()
    {
        return this.methodGetSceneHUD();
    }

    // #endregion overridable hook methods
}

// Keeps a "follower" EntityComponentDirectionalLight (e.g. one living in sceneHUD)
// in sync with a "source" one elsewhere (e.g. the world scene's sun), every frame.
// Attach this to the SAME entity as the follower light so it can be found via the
// usual sibling lookup; the source light lives on a different entity, so it's
// passed in directly instead (this project wires up such cross-entity references
// explicitly in main.js rather than doing runtime entity-tree searches for them).
//
// sceneHUD is its own coordinate space, unrelated to the world scene's — copying
// the source light's raw position/target directly (as an earlier version of this
// component did) only "worked" by coincidence, because both were hardcoded to the
// same numbers. What actually needs to carry over is the RELATIONSHIP between the
// source light and the world camera: we take
// `sourceLight.position - camera.position` in world space, rotate
// that offset into the camera's own local axes (so it's expressed
// as "how the sun currently looks relative to which way the camera is facing",
// not "where the sun is in fixed world axes" — the latter wouldn't change at all
// as the camera turns, which is the whole point: turning the main camera to face
// away from the sun should turn the HUD cube away from its light too), then
// reproduce that local-space offset relative to a target reference point in
// sceneHUD (the HUD cube), aiming the follower light at that cube. sceneHUD's own
// camera never rotates, so its local axes ARE its world axes — applying a
// camera-local offset directly as a sceneHUD-world offset is exactly the mapping
// we want.
//
// The "source reference point" used to be a generic constructor param
// (`sourceReferencePoint`, documented as "e.g. the main camera") - in
// practice this project only ever passed the world camera, so it's now
// fetched directly via `this.methodGetCamera()` (EngineContext - see
// BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md) instead of staying generic for
// a genericity nothing in this codebase actually used. `targetReferencePoint`
// (the HUD cube component) stays a constructor param - it's a real
// cross-entity component reference, not a bare-minimum Three.js object, and
// converting it is a separate matter (see TODO.md item 6.4).
export class EntityComponentLightManager extends EntityComponent
{
    // #region bare minimum

    #params = null;

    //
    #sourceLightComponent = null;
    #targetLightComponent = null;
    #sourceReferencePoint = null; // the world camera, fetched via methodGetCamera() - see class comment above
    #targetReferencePoint = null; // EntityComponentTestCube(HUD) the same offset is re-applied from (e.g. the HUD cube)
    #reverseDirection = false; // see reverseDirection param below

    // scratch vectors/quaternion, reused every frame instead of allocating new ones
    #scratchSourceReferenceWorldPos = null;
    #scratchSourceReferenceWorldQuat = null;
    #scratchTargetReferenceWorldPos = null;
    #scratchOffset = null;

    // #endregion bare minimum

    // #region construct

    constructor(params)
    {
        super(params);
        this.#params = params;

        this.#targetReferencePoint = params.targetReferencePoint;
        // A literal mapping lights the target reference's FAR side whenever the
        // source reference faces the source light head-on (the light ends up
        // "behind" the target, from the target reference's point of view). Pass
        // reverseDirection:true to flip that, so facing the source light head-on
        // instead fully lights the target reference's NEAR side. This only flips the
        // offset's local x/z (left-right and forward-back, relative to the source
        // reference point) — local y (up/down) is left alone, so a light that's
        // above the source reference point still ends up above the target reference
        // point, instead of flipping to underneath it. Off by default to keep this
        // component's general behavior a literal same-direction mapping; main.js
        // opts the HUD cube into the reversed version specifically, since seeing
        // your own HUD icon lit from the "back" whenever you face the sun reads as
        // backwards for a face-forward HUD element.
        this.#reverseDirection = params.reverseDirection ?? false;

        this.#scratchSourceReferenceWorldPos = new THREE.Vector3();
        this.#scratchSourceReferenceWorldQuat = new THREE.Quaternion();
        this.#scratchTargetReferenceWorldPos = new THREE.Vector3();
        this.#scratchOffset = new THREE.Vector3();
    }

    // #endregion construct

    // #region lifecycle

    methodInitialize()
    {
        //
        this.#sourceLightComponent = this.#params.source;
        // the light we keep in sync lives on this same entity
        this.#targetLightComponent = this.methodGetComponent("EntityComponentDirectionalLight");
        // cached here rather than looked up fresh every methodUpdate() call -
        // same reasoning as EntityComponentCameraControllerFirstPerson's own
        // cached camera/cameraPivot references
        this.#sourceReferencePoint = this.methodGetCamera();
    }

    methodUpdate(timeElapsed, timeDelta)
    {
        // early return: nothing to sync from/to
        if(this.#sourceLightComponent == null || this.#targetLightComponent == null){return;}
        if(this.#sourceReferencePoint == null || this.#targetReferencePoint == null){return;}

        const source = this.#sourceLightComponent.methodGetLight();
        const target = this.#targetLightComponent.methodGetLight();
        if(source == null || target == null){return;}

        // the HUD cube's mesh loads asynchronously (texture/shader fetch), so it may
        // not exist for the first few frames — fetch it fresh rather than caching it.
        const targetCube = this.#targetReferencePoint.methodGetCube();
        if(targetCube == null){return;}

        // color/intensity carry over directly; only positioning is remapped.
        target.color.copy(source.color);
        target.intensity = source.intensity;

        this.#sourceReferencePoint.getWorldPosition(this.#scratchSourceReferenceWorldPos);
        this.#sourceReferencePoint.getWorldQuaternion(this.#scratchSourceReferenceWorldQuat);
        targetCube.getWorldPosition(this.#scratchTargetReferenceWorldPos);

        // offset = where the source light sits, relative to the source reference point,
        // in world axes...
        this.#scratchOffset.subVectors(source.position, this.#scratchSourceReferenceWorldPos);
        // ...rotated into the source reference point's own local axes (x=right,
        // y=up, z=back, relative to the source reference point), so it tracks the
        // camera's facing instead of staying fixed to world directions...
        this.#scratchOffset.applyQuaternion(this.#scratchSourceReferenceWorldQuat.invert());
        // ...then, when reverseDirection is set, x/z are flipped but y is left alone
        // (see field comment above) — this only reverses the "facing" relationship,
        // not the "above/below" one.
        if(this.#reverseDirection)
        {
            this.#scratchOffset.x = -this.#scratchOffset.x;
            this.#scratchOffset.z = -this.#scratchOffset.z;
        }

        // reproduce that same (now rotation-aware) offset relative to the target
        // reference point, and aim the follower light at it (shadow settings are
        // intentionally left alone, since the follower may have castShadow:false
        // for a scene with nothing worth shadowing).
        target.position.copy(this.#scratchTargetReferenceWorldPos).add(this.#scratchOffset);
        target.target.position.copy(this.#scratchTargetReferenceWorldPos);
    }

    // #endregion lifecycle
}
