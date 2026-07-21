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

    // #region getters

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
    // "EngineContext" entity's EntityComponentContextEngine - see
    // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md and NAMING_CONVENTIONS.md
    // (the "EntityComponentContext*" naming family). All six bare-minimum
    // values are covered now. None of these cache the lookup itself - a
    // per-frame consumer should resolve once in its own methodInitialize()
    // and stash the result, the way EntityComponentCameraControllerFirstPerson
    // and EntityComponentLightManager both already do, rather than calling
    // these fresh every frame.

    methodGetScene()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetScene();
    }
    methodGetSceneHUD()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetSceneHUD();
    }
    methodGetRenderer()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetRenderer();
    }
    methodGetCamera()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetCamera();
    }
    methodGetCameraPivot()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetCameraPivot();
    }
    methodGetCameraHUD()
    {
        return this.methodGetEntityByName("EngineContext")?.methodGetComponent("EntityComponentContextEngine")?.methodGetCameraHUD();
    }

    // getters, but actually for the parent

    methodGetName(){return this.#parent.methodGetName();}
    methodGetPosition(){return this.#parent.methodGetPosition();}

    // #endregion getters

    // #region setters

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

    // #endregion setters

    // #region registers

    methodRegisterMessageHandlerWithinEntity(paramInvokableHandlerName, paramInvokableHandlerValue)
    {
        this.#parent.methodRegisterMessageHandlerWithinEntity(paramInvokableHandlerName, paramInvokableHandlerValue);
    }

    // #endregion registers

    // #region lifecycle

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

    // #endregion lifecycle
}
