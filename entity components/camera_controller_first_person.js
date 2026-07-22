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

// Touch equivalent of EntityComponentCameraControllerFirstPersonInput -
// exposes the exact same shape (keys/mouseX/mouseY/methodResetMouse()) so
// EntityComponentCameraControllerFirstPerson doesn't need to know which of
// the two is actually attached (see BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md's
// "Pattern C: self-attaching sibling components" section for how that
// choice gets made). No touch equivalent for the arrow-key nudge/reset
// behavior yet - keys stays permanently all-false, since there's no
// keyboard on a touch device; EntityComponentCameraControllerFirstPerson
// still reads it unconditionally, so the field has to exist regardless.
// Only the first touch point drives look - no pinch/multi-finger gestures
// in this first pass.
export class EntityComponentCameraControllerFirstPersonInputTouch extends EntityComponent
{
    #params = null;
    #keys = null;
    #mouseX = null;
    #mouseY = null;
    #lastTouchX = null;
    #lastTouchY = null;
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
        this.#mouseX = 0;
        this.#mouseY = 0;

        // document only, deliberately NOT also window (unlike
        // EntityComponentCameraControllerFirstPersonInput's keydown/keyup
        // listeners) - touch events are dispatched based on which element
        // was actually touched and bubble up through the DOM tree, so a
        // document-level listener already catches every one of them;
        // there's no cross-target focus ambiguity here the way there is for
        // keyboard events (see that class's own comment). Registering on
        // window too would mean this class's own delta computation runs
        // twice per real event (both catch the same bubbled event) - each
        // touchmove computes its delta from a stored last-position field
        // (not an already-computed browser delta like e.movementX), so a
        // second run immediately after the first would just recompute a
        // delta of 0 against the position the first run just moved to,
        // discarding the real one before EntityComponentCameraControllerFirstPerson's
        // methodUpdate() ever gets a chance to read it.
        //
        // {passive: false} so methodEventOnTouchMove() below can call
        // e.preventDefault() - touch listeners default to passive (unable
        // to preventDefault()) for scroll performance, and without this,
        // dragging to look around would also scroll/pinch-zoom the page
        // underneath it.
        document.addEventListener('touchstart', (e) => this.methodEventOnTouchStart(e), {passive: false});
        document.addEventListener('touchmove', (e) => this.methodEventOnTouchMove(e), {passive: false});
        document.addEventListener('touchend', (e) => this.methodEventOnTouchEnd(e), {passive: false});
        document.addEventListener('touchcancel', (e) => this.methodEventOnTouchEnd(e), {passive: false});
    }

    methodEventOnTouchStart(e)
    {
        const touch = e.touches[0];
        if(touch == null){return;}
        this.#lastTouchX = touch.clientX;
        this.#lastTouchY = touch.clientY;
    }

    methodEventOnTouchMove(e)
    {
        const touch = e.touches[0];
        if(touch == null){return;}
        if(this.#lastTouchX == null || this.#lastTouchY == null){return;} // no prior touchstart to diff against

        e.preventDefault();

        // Delta since the last touchmove/touchstart - mirrors
        // e.movementX/e.movementY's "moved since last event" semantics for
        // mouse (see EntityComponentCameraControllerFirstPersonInput.methodEventOnMouseMove()
        // above), just computed by hand since touch events carry absolute
        // coordinates, not a ready-made delta.
        this.#mouseX = touch.clientX - this.#lastTouchX;
        this.#mouseY = touch.clientY - this.#lastTouchY;

        this.#lastTouchX = touch.clientX;
        this.#lastTouchY = touch.clientY;
    }

    methodEventOnTouchEnd(e)
    {
        // Clears tracking so the next touchstart doesn't diff against a
        // stale position left over from this now-ended touch.
        this.#lastTouchX = null;
        this.#lastTouchY = null;
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
        // Self-attaches its own Input sibling instead of receiving it from
        // main.js - see BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md's "Pattern
        // C: self-attaching sibling components" section. Which concrete
        // class actually gets attached depends on
        // EntityComponentContextEnvironment's touch-primary detection, but
        // main.js never needs to know that, or that there are two classes
        // to choose between at all.
        const componentEnvironment = this.methodGetEntityByName("Environment")?.methodGetComponent("EntityComponentContextEnvironment");
        const componentInput = componentEnvironment.methodGetIsTouchPrimary()
            ? new EntityComponentCameraControllerFirstPersonInputTouch()
            : new EntityComponentCameraControllerFirstPersonInput();
        this.methodGetParent().methodAddComponentWithName("EntityComponentCameraControllerFirstPersonInput", componentInput);

        this.#scene = this.methodGetScene();
        this.#camera = this.methodGetCamera();
        this.#cameraPivot = this.methodGetCameraPivot();

        // Local player spawn position - self-looked-up rather than received
        // via constructor params, the same self-lookup shape as
        // camera/cameraPivot/scene above, just one level further out (this
        // component doesn't need to know spawn positions come from ground
        // bounds at all - EntityComponentContextPlayerInitialization owns
        // that). See NAMING_CONVENTIONS.md's "A single consumer is fine,
        // conditionally" section and TODO.md item 6's sub-item 6.
        const componentPlayerInitialization = this.methodGetEntityByName("PlayerInitialization")?.methodGetComponent("EntityComponentContextPlayerInitialization");
        const spawnPosition = componentPlayerInitialization.methodGetSpawnPosition();
        this.#cameraPivot.position.set(spawnPosition.x, 0, spawnPosition.z);

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

    // #region handlers

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

    // #endregion handlers
}