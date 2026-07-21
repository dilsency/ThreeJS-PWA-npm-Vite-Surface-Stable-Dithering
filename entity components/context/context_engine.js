// imports
// ECS
import {EntityComponent} from "../../classes/ECS/entity_component.js";

// Owns Three.js's own "bare minimum" objects - plus cameraPivot, which
// isn't a Three.js concept but is tightly tied to camera in this project's
// first-person rig (see EntityComponentCameraControllerFirstPerson), so it
// lives here alongside it rather than being split out - so other
// components can look them up through the ECS
// (EntityComponent.methodGetScene()/methodGetSceneHUD()/methodGetRenderer()/
// methodGetCamera()/methodGetCameraPivot()/methodGetCameraHUD(), and friends
// as this component grows) instead of receiving them as hard-wired
// constructor params from main.js. See
// BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md for the full design discussion -
// all six bare-minimum values are converted now.
// Attached to a single entity named "EngineContext", constructed by
// main.js's initEngineContext() before any other entity/component, so that
// every other component's methodGetX() call can rely on it already
// existing (see that doc's "Ensuring EngineContext initializes before
// everything else" section).
//
// Deliberately synchronous: methodInitialize() only ever stashes
// already-constructed object references, never awaits anything - the
// "constructed first in main.js" ordering guarantee depends on that staying
// true.
export class EntityComponentContextEngine extends EntityComponent
{
    // #region bare minimum

    #params = null; // {scene, sceneHUD, renderer, camera, cameraPivot, cameraHUD}

    //
    #scene = null;
    #sceneHUD = null;
    #renderer = null;
    #camera = null;
    #cameraPivot = null;
    #cameraHUD = null;

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
        this.#scene = this.#params.scene;
        this.#sceneHUD = this.#params.sceneHUD;
        this.#renderer = this.#params.renderer;
        this.#camera = this.#params.camera;
        this.#cameraPivot = this.#params.cameraPivot;
        this.#cameraHUD = this.#params.cameraHUD;
    }

    // #endregion lifecycle

    // #region getters

    methodGetScene(){return this.#scene;}
    methodGetSceneHUD(){return this.#sceneHUD;}
    methodGetRenderer(){return this.#renderer;}
    methodGetCamera(){return this.#camera;}
    methodGetCameraPivot(){return this.#cameraPivot;}
    methodGetCameraHUD(){return this.#cameraHUD;}

    // #endregion getters
}
