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
    methodGetEntitiesWithComponent(paramComponentName, paramEntityNameToExclude)
    {
        return this.#parent.methodGetEntitiesWithComponent(paramComponentName, paramEntityNameToExclude);
    }
    methodGetComponent(paramComponentName)
    {
        return this.#parent.methodGetComponent(paramComponentName);
    }
    methodGetParent(){return this.#parent;}

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