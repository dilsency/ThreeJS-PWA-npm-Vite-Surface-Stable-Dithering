// ECS architecture
// https://keep.google.com/u/0/#NOTE/1VZcHow6i1CL34hbKCEnhdlomP1MtBxrzssvUT4wwMWJLCXrubqAjogXsTz7MCC4

// a single instance of this class is created
// and that instance has a list of instances of the entity base class
// and those instances of the entity base class...
// ...have instances of classes that extend from the entity_component class

export class EntityManager
{
    #params = null;
    #entities = null;
    #idCounter = null;
    constructor(params)
    {
        //
        //super(params);
        this.#params = params;

        // we either use an array
        // or an object
        // we know how to loop through objects now...
        // ...so perhaps that is preferable?
        // SimonDev stores both...
        // ...but initial thought: that seems unnecessary
        this.#entities = [];

        //
        this.#idCounter = 0;
    }

    // adders

    methodAddEntity(paramEntity, paramEntityName)
    {
        //
        if(!paramEntityName)
        {
            // we generate a unique name based on an increasing id count
            paramEntityName = this.methodGenerateName();
        }

        // again, either array or object
        this.#entities.push(paramEntity);

        //
        paramEntity.methodSetParent(this);
        paramEntity.methodSetName(paramEntityName);

        // this doesn't seem entirely necessary, but what's the harm?
        paramEntity.methodInitialize();
    }

    // getters

    methodGetEntityByIndex(index)
    {
        return this.#entities[index];
    }
    methodGetEntitiesWithComponent(paramComponentName, paramEntityNameToExclude)
    {
        const result = [];
        for(const iteratorEntity of this.#entities)
        {
            const a = iteratorEntity.methodGetComponent(paramComponentName);
            if(a == null || a == undefined){continue;}
            if(iteratorEntity.methodGetName() == paramEntityNameToExclude){continue;}
            result.push(iteratorEntity);
        }
        return result;
    }
    methodGetEntitiesWithComponentAndSuffix(paramComponentName, paramComponentNameSuffix, paramEntityNameToExclude)
    {
        const result = [];
        for(const iteratorEntity of this.#entities)
        {
            const a = iteratorEntity.methodGetComponentWithSuffix(paramComponentName, paramComponentNameSuffix);
            if(a == null || a == undefined){continue;}
            if(iteratorEntity.methodGetName() == paramEntityNameToExclude){continue;}
            result.push(iteratorEntity);
        }
        return result;
    }

    // lifecycle

    methodUpdate(timeElapsed, timeDelta)
    {
        // array version

        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...of
        // javascript's version of a for each loop
        for(const iteratorEntity of this.#entities)
        {
            iteratorEntity.methodUpdate(timeElapsed, timeDelta);
        }


        // object version

        // if we use Object.entries(ourInstanceOfClass) we get only iterable properties
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/entries
        // if we only need keys
        // Object.keys(ourInstanceOfClass) instead
        // if we only need property values
        // Object.values(ourInstanceOfClass) instead

        // for..in could be used, but then we get prototype properties as well, which is unneccessary
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in

        //for (const [key, value] of Object.entries(this.#entities))
        //{
        //    console.log(`${key}: ${value}`);
        //}
    }

    // "helpers" / generators

    methodGenerateName()
    {
        const name = ("entityName" + this.#idCounter);
        this.#idCounter++;
        return name;
    }
}