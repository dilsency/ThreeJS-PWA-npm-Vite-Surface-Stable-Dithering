// imports
// base
import * as THREE from "three";

// dynamicInstance.mjs
//import path from 'path';
//import { fileURLToPath } from 'url';

// ECS architecture
// https://keep.google.com/u/0/#NOTE/1VZcHow6i1CL34hbKCEnhdlomP1MtBxrzssvUT4wwMWJLCXrubqAjogXsTz7MCC4

// instances of the entity base class...
// ...have instances of classes that extend from the entity_component class

// nothing inherits From entity, it seems
// we only ever create "empty" entities...
// ...and then attach components to that
// but the specific components DO inherit from the entity_component base class!

// so even a player is not an entity
// it is an "empty" entity...
// ...with a bunch of player-based components attached to it


// I guess one Could make a class that inherits from entity that just does all this attachment inside itself
// Idk
// let's just follow the tutorial

export class Entity
{
    #params = null;

    #name = null;
    #parent = null;
    #components = null;

    #position = null;
    #rotationA = null;
    #rotationB = null;

    #invokableHandlers = null;

    #onlyOnce = null;
    constructor(params)
    {
        //
        //super(params);
        this.#params = params;

        //
        this.#position = new THREE.Vector3();
        this.#rotationA = new THREE.Quaternion();
        this.#rotationB = new THREE.Quaternion();

        //
        this.#components = {};
        this.#invokableHandlers = {};

        //
        this.#onlyOnce = false;
    }

    // lifecycle

    methodInitialize()
    {
        //console.log("entity initialized (name: "+ this.#name +")");
    }

    // getters

    methodGetEntitiesWithComponent(paramComponentName, paramEntityNameToExclude)
    {
        return this.#parent.methodGetEntitiesWithComponent(paramComponentName, paramEntityNameToExclude);
    }
    methodGetEntitiesWithComponentAndSuffix(paramComponentName, paramComponentNameSuffix, paramEntityNameToExclude)
    {
        return this.#parent.methodGetEntitiesWithComponentAndSuffix(paramComponentName, paramComponentNameSuffix, paramEntityNameToExclude);
    }

    // vite preview
    // the names will be re-generated and searching by name will not match... what to do?
    // we could loop through all components and check their parameters?
    methodGetComponent(paramComponentName)
    {
        // we COULD assume the component could have a suffix
        if(paramComponentName.includes("__"))
        {
            const split = nameExcludingSuffix.split("__");
            return this.methodGetComponentsWithSuffix(split[0], split[1]);
        }

        // this is the normal one
        return this.#components[paramComponentName];
    }
    methodGetComponentWithSuffix(paramComponentName, paramComponentNameSuffix)
    {
        // here we return specifically that component
        return this.#components[paramComponentName + "__" + paramComponentNameSuffix];
    }
    methodGetComponentsWithSuffix(paramComponentName, paramComponentNameSuffix)
    {
        // here we need to loop through all components that match
        // and return a list
        // EXCLUDING suffix
        var nameExcludingSuffix = paramComponentName;
        if(nameExcludingSuffix.includes("__"))
        {
            nameExcludingSuffix = nameExcludingSuffix.split("__")[0];
        }
        const res = [];
        // javascript version of foreach loop
        for(const iterator of this.#components)
        {
            if(iterator == nameExcludingSuffix)
            {
                res.push(iterator);
            }
        }
        return res;
    }
    methodGetParent(){return this.#parent;}
    methodGetName(){return this.#name;}
    methodGetPosition(){return this.#position;}
    methodGetRotations(){return {rotationA: this.#rotationA, rotationB: rotationB};}

    get Parent(){return this.#parent;}
    get Name(){return this.#name;}
    get Position(){return this.#position;}
    get Rotation(){return {rotationA: this.#rotationA, rotationB: rotationB};}

    // setters

    // could we use the set keyword for this?
    // probably not, since our properties are private
    // and we usually don't like the look of setting properties that directly, outside of the class
    methodSetParent(paramParent) { this.#parent = paramParent; }
    methodSetName(paramName) { this.#name = paramName; }
    methodSetPosition(paramPosition)
    {
        this.#position.copy(paramPosition);
            // supposedly this lets us trickle down our position to each entity_component that needs it
        this.methodSendMessageWithinEntity({
            invokableHandlerName: 'update.position',
            invokableHandlerValue: this.#position,
        });
    }
    methodSetRotation(paramRotation){
        this.#rotationA.copy(paramRotation);
            // supposedly this lets us trickle down our rotation to each entity_component that needs it
        this.methodSendMessageWithinEntity({
            invokableHandlerName: 'update.rotation',
            invokableHandlerValue: this.#rotationA,
        });
    }
    methodSetRotations(paramRotationA, paramRotationADelta, paramRotationB, paramRotationBDelta){
        this.#rotationA.copy(paramRotationA);
        this.#rotationB.copy(paramRotationB);
            // supposedly this lets us trickle down our rotation to each entity_component that needs it
        this.methodSendMessageWithinEntity({
            invokableHandlerName: 'update.rotations',
            invokableHandlerValue: {rotationA: this.#rotationA, rotationADelta: paramRotationADelta, rotationB: this.#rotationB, rotationBDelta: paramRotationBDelta},
        });
    }

    // adders

    methodAddComponent(paramComponent)
    {
        // add it at the correct index
        // note that we can only have 1 component instance of each component class this way...
        // ...which seems to be fine ?
        // we make new components that are lists of other components, instead
        // semi-clunky, but easier with searches and such
        const name = paramComponent.constructor.name;
        this.methodAddComponentWithName(name, paramComponent);
    }
    methodAddComponentWithName(paramComponentName, paramComponent)
    {
        console.log("add new component");
        console.log("\t" + paramComponentName);

        // first, we update the parent prop of the component, to be this
        paramComponent.methodSetParent(this);

        // add it at the correct index
        this.#components[paramComponentName] = paramComponent;

        // debug: log component addition (helps detect missing initializations in production builds)
        /*try {
            console.log(`Entity.methodAddComponent: adding component ${paramComponent.constructor.name} to entity ${this.#name}`);
        } catch (e) {
            console.log('Entity.methodAddComponent: added component (name unavailable)');
        }*/

        // then we can initialize the component
        paramComponent.methodInitialize();
    }

    methodAddComponentWithSuffix(paramComponent, paramComponentNameSuffix)
    {
        // in case we do want multiples of each
        // BUT
        // this will completely break methodGetComponent and methodGetEntitiesWithComponent
        // they will need to take this suffix into account

        // oh well

        paramComponent.methodSetParent(this);
        this.#components[paramComponent.constructor.name + "__" + paramComponentSuffix] = paramComponent;
        paramComponent.methodInitialize();
    }

    // registers

    methodRegisterMessageHandlerWithinEntity(paramInvokableHandlerName, paramInvokableHandlerValue)
    {
        //console.log("register invokable handler!");
        console.log("register " + paramInvokableHandlerName);

        // if we do not have an array at that index
        // we need to create it
        // so that we can push to it
        const nameIsInInvokableHandlers = (paramInvokableHandlerName in this.#invokableHandlers);
        if(!nameIsInInvokableHandlers)
        {
            this.#invokableHandlers[paramInvokableHandlerName] = [];
        }

        // now we know we have a list at that index
        // so we can push
        this.#invokableHandlers[paramInvokableHandlerName].push(paramInvokableHandlerValue);
    }

    // lifecycle

    methodUpdate(timeElapsed, timeDelta)
    {
        /*
        if (this.#onlyOnce == true)
        {
            return;
        }
        this.#onlyOnce = true;

        console.log(".#components :");
        console.log(this.#components);*/

        for (const [key, value] of Object.entries(this.#components))
        {
            /*console.log("key and value : ");
            console.log(key);
            console.log(value);

            console.log("value.methodUpdate : ");
            console.log(value.methodUpdate);

            console.log("attempt : ");*/
            value.methodUpdate(timeElapsed, timeDelta);
        }
    }

    // ...

    methodSendMessageWithinEntity(paramMessage)
    {
        // early return: we need to have a handler that matches message
        const weHaveAnInvokableHandlerThatMatchesMessage = (paramMessage.invokableHandlerName in this.#invokableHandlers);
        if(!weHaveAnInvokableHandlerThatMatchesMessage){return;}

        // javascript version of for each
        // iterates over
        // invokable handler functions that matches message
        for(const iteratorInvokableHandlerInvoke of this.#invokableHandlers[paramMessage.invokableHandlerName])
        {
            // our iterator variable is now an invokable function!
            // we actually invoke it right now
            // I dearly wish the syntax was more obvious on this
            // tried to mitigate the confusion with verbose naming

            // todo

            // we may or may not want to rename .invokableHandlerName into .messageName
            // and .invokableHandlerValue into .messageValue
            // because the entire message is passed on, name and value both
            // so when we register it later in a component, the naming does become confusing
            // though it kind of makes sense in this moment

            iteratorInvokableHandlerInvoke(paramMessage);
        }
    }

    methodSendMessageToEntitiesWithComponent(paramComponentName, paramMessage, paramEntityNameToExclude)
    {
        // convenience/shorthand, not new capability:
        // methodGetEntitiesWithComponent already returns real Entity references,
        // and methodSendMessageWithinEntity is a plain public method on Entity,
        // so this is just those two combined via a loop
        const entitiesWithComponent = this.methodGetEntitiesWithComponent(paramComponentName, paramEntityNameToExclude);
        for(const iteratorEntity of entitiesWithComponent)
        {
            iteratorEntity.methodSendMessageWithinEntity(paramMessage);
        }
    }
}