// ECS architecture
// https://keep.google.com/u/0/#NOTE/1VZcHow6i1CL34hbKCEnhdlomP1MtBxrzssvUT4wwMWJLCXrubqAjogXsTz7MCC4

// should not be used on its own
// this class should always be extended from
// unlike entity, which instances are created from the base class every time

export class EntityComponent
{
    #params = null;
    #parent = null;
    constructor()
    {
        //
        //super(params);
        this.#parent = null;
    }

    // getters
    methodGetEntityByName(paramName)
    {
        return this.#parent.methodGetEntityByName(paramName);
    }
    methodGetEntitiesWithComponent(paramComponentName, paramEntityNameToExclude)
    {
        return this.#parent.methodGetEntitiesWithComponent(paramComponentName, paramEntityNameToExclude);
    }
    methodGetComponent(paramComponentName)
    {
        return this.#parent.methodGetComponent(paramComponentName);
    }
    methodGetParent(){return this.#parent;}

    // getters - shorthand for bare-minimum Three.js state owned by the
    // "EngineContext" entity's EntityComponentEngineContext - see
    // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md. `scene`/`sceneHUD`/`renderer`/
    // `camera`/`cameraPivot` exist so far; add `methodGetCameraHUD` the same
    // way once EntityComponentEngineContext grows to hold it. None of these
    // cache the lookup itself - a per-frame consumer should resolve once in
    // its own methodInitialize() and stash the result, the way
    // EntityComponentCameraControllerFirstPerson and
    // EntityComponentLightManager both already do, rather than calling
    // these fresh every frame.

    methodGetScene()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")?.methodGetScene();
    }
    methodGetSceneHUD()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")?.methodGetSceneHUD();
    }
    methodGetRenderer()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")?.methodGetRenderer();
    }
    methodGetCamera()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")?.methodGetCamera();
    }
    methodGetCameraPivot()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentEngineContext")?.methodGetCameraPivot();
    }

    // getters, but actually for the parent

    methodGetName(){return this.#parent.methodGetName();}
    methodGetPosition(){return this.#parent.methodGetPosition();}

    // setters
    methodSetParent(paramParent){this.#parent = paramParent;}

    // setters, but actually for the parent

    methodSetPosition(paramPosition)
    {
        this.#parent.methodSetPosition(paramPosition);
    }
    methodSetRotations(paramRotationA, paramRotationADelta, paramRotationB, paramRotationBDelta)
    {
        this.#parent.methodSetRotations(paramRotationA, paramRotationADelta, paramRotationB, paramRotationBDelta);
    }

    // registers

    methodRegisterMessageHandlerWithinEntity(paramInvokableHandlerName, paramInvokableHandlerValue)
    {
        this.#parent.methodRegisterMessageHandlerWithinEntity(paramInvokableHandlerName, paramInvokableHandlerValue);
    }

    // lifecycle

    methodInitialize()
    {
        //console.log("entity component initialized: base class");
    }

    methodUpdate(timeElapsed, timeDelta) { }

    // ...

    methodSendMessageWithinEntity(paramMessage)
    {
        this.#parent.methodSendMessageWithinEntity(paramMessage);
    }
    methodSendMessageToEntitiesWithComponent(paramComponentName, paramMessage, paramEntityNameToExclude)
    {
        this.#parent.methodSendMessageToEntitiesWithComponent(paramComponentName, paramMessage, paramEntityNameToExclude);
    }
}