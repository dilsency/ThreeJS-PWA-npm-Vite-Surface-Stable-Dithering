import * as THREE from "three";
import {EntityComponent} from "../classes/ECS/entity_component.js";

export class EntityComponentCameraControllerFirstPersonInput extends EntityComponent
{
    #params = null;
    #keys = null;
    #mouseX = null;
    #mouseY = null;
    constructor(params)
    {
        super(params);
        this.#params = params;
    }
    get keys() {return this.#keys;}
    get mouseX(){return this.#mouseX;}
    get mouseY(){return this.#mouseY;}
    methodInitialize()
    {
        //
        this.#keys =
        {
            up: false,
            down: false,
            left: false,
            right: false,
            reset: false,
        };

        // Attach listeners to document and window to be robust across dev/preview builds
        const keyDownHandler = (e) => this.methodEventOnKeyDown(e);
        const keyUpHandler = (e) => this.methodEventOnKeyUp(e);
        const mouseMoveHandler = (e) => this.methodEventOnMouseMove(e);

        document.addEventListener('keydown', keyDownHandler, false);
        document.addEventListener('keyup', keyUpHandler, false);
        document.addEventListener('mousemove', mouseMoveHandler, false);

        // Some environments deliver global keyboard events to window instead of document
        // (depending on focus). Listen on both to improve reliability in production builds.
        window.addEventListener('keydown', keyDownHandler, false);
        window.addEventListener('keyup', keyUpHandler, false);
        window.addEventListener('mousemove', mouseMoveHandler, false);
    }

    methodEventOnKeyDown(e)
    {
        switch (e.keyCode)
        {
            case 38: // arrow up
                this.#keys.up = true;
                break;
            case 40: // arrow down
                this.#keys.down = true;
                break;
            case 37: // arrow left
                this.#keys.left = true;
                break;
            case 39: // arrow right
                this.#keys.right = true;
                break;
            case 90: // key z
                this.#keys.reset = true;
                break;
        }
    }
    methodEventOnKeyUp(e)
    {
        switch (e.keyCode)
        {
            case 38: // arrow up
                this.#keys.up = false;
                break;
            case 40: // arrow down
                this.#keys.down = false;
                break;
            case 37: // arrow left
                this.#keys.left = false;
                break;
            case 39: // arrow right
                this.#keys.right = false;
                break;
            case 90: // key z
                this.#keys.reset = false;
                break;
        }
    }
    methodEventOnMouseMove(e)
    {
        this.#mouseX = e.movementX;
        this.#mouseY = e.movementY;
    }

    methodResetMouse()
    {
        this.#mouseX = 0;
        this.#mouseY = 0;
    }
}

export class EntityComponentCameraControllerFirstPerson extends EntityComponent
{
    // scene/camera/cameraPivot used to be constructor params - now resolved
    // once (see methodInitialize()) via EngineContext (see
    // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md) and cached here, since this
    // component reads and mutates camera/cameraPivot every single
    // methodUpdate() call - a fresh methodGetCamera()/methodGetCameraPivot()
    // lookup 60 times/sec would be wasteful, and the cached reference never
    // goes stale since neither object is ever replaced with a different one
    // after construction, only mutated in place.
    #scene = null;
    #camera = null;
    #cameraPivot = null;
    #directionForward = null;
    #directionForwardNonvertical = null;
    #directionRight = null;
    #directionRightNonvertical = null;
    constructor(params)
    {
        super(params);
    }
    get directionForward(){return this.#directionForward;}
    get directionForwardNonvertical(){return this.#directionForwardNonvertical;}
    get directionRightNonvertical(){return this.#directionRightNonvertical;}

    // For network sync (see MULTIPLAYER_TOPOLOGY_AND_SYNC.md). Exposes each
    // object's own quaternion rather than a derived yaw/pitch scalar pair -
    // the real facing direction the local player sees is
    // cameraPivot.quaternion (parent) composed with camera.quaternion
    // (child), and sending each object's actual quaternion stays correct
    // regardless of how their rotation logic evolves, unlike extracting
    // yaw/pitch Euler components, which only worked because cameraPivot
    // currently only ever rotates on Y and camera only ever rotates on X
    // (see TODO.md's now-resolved item 3 for the full reasoning).
    methodGetPosition(){return this.#cameraPivot.position;}
    methodGetCameraPivotQuaternion(){return this.#cameraPivot.quaternion;}
    methodGetCameraQuaternion(){return this.#camera.quaternion;}
    methodInitialize()
    {
        this.#scene = this.methodGetScene();
        this.#camera = this.methodGetCamera();
        this.#cameraPivot = this.methodGetCameraPivot();

        this.#directionForward = new THREE.Vector3(0,0,-1);
        this.#directionForwardNonvertical = new THREE.Vector3(0,0,-1);
        this.#directionRight = new THREE.Vector3(1,0,0);
        this.#directionRightNonvertical = new THREE.Vector3(1,0,0);

        // once at start, we update perpendiculars
        this.methodUpdatePerpendiculars();

        // register handlers

        this.methodRegisterMessageHandlerWithinEntity('update.position', (paramMessage) => { this.methodHandleUpdatePosition(paramMessage); });
        //this.methodRegisterMessageHandlerWithinEntity('update.rotations', (paramMessage) => { this.methodHandleUpdateRotations(paramMessage); });
    }
    methodUpdate()
    {
        //
        const componentInstanceInput = this.methodGetComponent("EntityComponentCameraControllerFirstPersonInput");
        // early return: no entity component instance
        if(componentInstanceInput == null){return;}


        // sort of early return
        // if reset is pressed we don't need to do anything below
        if(componentInstanceInput.keys.reset == true)
        {
            //
            this.#camera.rotation.set(0,0,0);
            this.#cameraPivot.rotation.set(0,0,0);
            // update perpendiculars
            this.methodUpdatePerpendiculars();
            //
            return;
        }

        // speeds
        var speedX = 0;
        var speedY = 0;

        // keyboard support
        if(componentInstanceInput.keys.left){speedX = 0.02;}
        else if(componentInstanceInput.keys.right){speedX = -0.02;}
        else {speedX = componentInstanceInput.mouseX * -0.001;}
        //
        if(componentInstanceInput.keys.up){speedY = 0.02;}
        else if(componentInstanceInput.keys.down){speedY = -0.02;}
        else{speedY = componentInstanceInput.mouseY * -0.001;}

        // early return: we don't do anything if we don't have anything
        if(speedX == 0 && speedY == 0){return;}

        //
        this.#camera.rotateX(speedY);
        this.#cameraPivot.rotateY(speedX);


        // IF we want to broadcast to other components that we have changed rotation

        //
        const resultRotationCamera = new THREE.Quaternion().copy(this.#camera.quaternion);
        const resultRotationCameraPivot = new THREE.Quaternion().copy(this.#cameraPivot.quaternion);
        // in order to broadcast to other components that we have changed rotation
        this.methodSetRotations(resultRotationCameraPivot, speedX, resultRotationCamera, speedY);

        // when we are done with using mouse
        // we reset it
        componentInstanceInput.methodResetMouse();

        // update perpendiculars
        this.methodUpdatePerpendiculars();
    }

    methodUpdatePerpendiculars()
    {
        // we use the cross product
        // of our camera's forward direction
        // and the current up direction (which is not changing in this project)
        // to get the right direction

        // update directionForward
        // with our camera's current direction
        this.#camera.getWorldDirection(this.#directionForward);
        // we need a version of directionForward
        // that has no vertical component
        this.#directionForwardNonvertical.copy(this.#directionForward);
        this.#directionForwardNonvertical.y = 0;
        this.#directionForwardNonvertical.normalize();

        // when will we use the unformatted version of directionRight? idk, but here it is
        this.#directionRight.crossVectors(this.#scene.up, this.#directionForward);
        this.#directionRightNonvertical.crossVectors(this.#scene.up, this.#directionForwardNonvertical);
    }

    // handlers

    methodHandleUpdatePosition(paramMessage)
    {
        // important to remember that we are sent the entire message, not Just the value
        this.#cameraPivot.position.copy(paramMessage.invokableHandlerValue);
    }
    methodHandleUpdateRotations(paramMessage)
    {
        return;
        this.#camera.quaternion.copy(paramMessage.invokableHandlerValue.rotationB);
        this.#cameraPivot.quaternion.copy(resultRotationCamera.invokableHandlerValue.rotationA);
    }
}