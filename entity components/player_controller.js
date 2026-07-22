import * as THREE from "three";
import {EntityComponent} from "../classes/ECS/entity_component.js";

// Double-tap timing/distance thresholds, and the max time+movement a touch
// can have and still count as a single "tap" rather than a drag/long-press -
// module-level since they're plain constants, not per-instance state.
// Seconds, not milliseconds - EntityComponentPlayerControllerInputTouch
// measures elapsed time via methodUpdate()'s own timeDelta (the ECS's
// per-frame clock, in seconds), not performance.now() - see
// INPUT_METHODS.md's "Timing source for gesture detection" section.
const DOUBLE_TAP_MAX_INTERVAL_SECONDS = 0.3;
const DOUBLE_TAP_MAX_DISTANCE_PX = 40;
const TAP_MAX_DURATION_SECONDS = 0.25;
const TAP_MAX_MOVEMENT_PX = 20;

export class EntityComponentPlayerControllerInput extends EntityComponent
{
    #params = null;
    #keys = null;
    constructor(params)
    {
        super(params);
        this.#params = params;
    }
    get keys() {return this.#keys;}
    methodInitialize()
    {
        this.#keys =
        {
            forward: false,
            backward: false,
            left: false,
            right: false,
            up: false,
            down: false,
        };
        document.addEventListener('keydown', (e) => this.methodEventOnKeyDown(e), false);
        document.addEventListener('keyup', (e) => this.methodEventOnKeyUp(e), false);
    }
    methodEventOnKeyDown(e)
    {
        switch (e.keyCode)
        {
            case 81: // letter q
                this.#keys.up = true;
                break;
            case 87: // letter w
                this.#keys.forward = true;
                break;
            case 65: // letter a
                this.#keys.left = true;
                break;
            case 69: // letter e
                this.#keys.down = true;
                break;
            case 83: // letter s
                this.#keys.backward = true;
                break;
            case 68: // letter d
                this.#keys.right = true;
                break;
        }
    }
    methodEventOnKeyUp(e)
    {
        switch (e.keyCode)
        {
            case 81: // letter q
                this.#keys.up = false;
                break;
            case 87: // letter w
                this.#keys.forward = false;
                break;
            case 69: // letter e
                this.#keys.down = false;
                break;
            case 65: // letter a
                this.#keys.left = false;
                break;
            case 83: // letter s
                this.#keys.backward = false;
                break;
            case 68: // letter d
                this.#keys.right = false;
                break;
        }
    }
}

// Touch equivalent of EntityComponentPlayerControllerInput - only forward
// movement has a touch gesture so far: double-tap-and-hold. The second tap
// of a double-tap starts walking forward, which continues for as long as
// that same finger (tracked by touch identifier, not e.touches[0] - an
// unrelated second finger touching down/lifting shouldn't affect this)
// stays on the screen, regardless of whether it moves -
// EntityComponentCameraControllerFirstPersonInputTouch keeps driving
// camera-look from the same touch independently, via its own touchmove
// listener, so aiming while walking isn't paused. backward/left/right/up/down
// have no touch equivalent yet and stay permanently false;
// EntityComponentPlayerController still reads them unconditionally, so the
// fields have to exist regardless.
export class EntityComponentPlayerControllerInputTouch extends EntityComponent
{
    #params = null;
    #keys = null;

    // Tracks whichever touch is currently a candidate for being "tap 1" of
    // a future double-tap. #candidateElapsedSeconds accumulates via
    // methodUpdate()'s timeDelta while that touch hasn't ended yet.
    #candidateTouchIdentifier = null;
    #candidateStartX = null;
    #candidateStartY = null;
    #candidateElapsedSeconds = 0;

    // The most recently completed tap, matched against the NEXT touchstart
    // to detect a double-tap. null whenever no completed tap is currently
    // waiting for a possible second tap - either because none has happened
    // yet, or because methodUpdate() already expired the window.
    #pendingTapElapsedSeconds = null;
    #pendingTapX = null;
    #pendingTapY = null;

    // Whichever touch is currently driving forward movement (the second tap
    // of a double-tap) - null when not walking.
    #walkingTouchIdentifier = null;

    constructor(params)
    {
        super(params);
        this.#params = params;
    }
    get keys() {return this.#keys;}
    methodInitialize()
    {
        this.#keys =
        {
            forward: false,
            backward: false,
            left: false,
            right: false,
            up: false,
            down: false,
        };

        // document only, not also window - see
        // EntityComponentCameraControllerFirstPersonInputTouch's own comment
        // on this: this class also computes state by tracking/diffing
        // across events rather than reading something the browser
        // pre-computes per event, so double-registering risks the same kind
        // of silent corruption caught there.
        document.addEventListener('touchstart', (e) => this.methodEventOnTouchStart(e));
        document.addEventListener('touchend', (e) => this.methodEventOnTouchEnd(e));
        document.addEventListener('touchcancel', (e) => this.methodEventOnTouchEnd(e));
    }

    methodUpdate(timeElapsed, timeDelta)
    {
        // Advances the tap-timing accumulators using the ECS's own
        // per-frame clock instead of an independent performance.now()
        // sample - see INPUT_METHODS.md's "Timing source for gesture
        // detection" section for why (one clock source for "how much time
        // has passed" everywhere, at the cost of up to ~1 frame of slop,
        // negligible against thresholds measured in hundreds of ms).
        if(this.#candidateTouchIdentifier != null)
        {
            this.#candidateElapsedSeconds += timeDelta;
        }
        if(this.#pendingTapElapsedSeconds != null)
        {
            this.#pendingTapElapsedSeconds += timeDelta;
            if(this.#pendingTapElapsedSeconds > DOUBLE_TAP_MAX_INTERVAL_SECONDS)
            {
                this.#pendingTapElapsedSeconds = null; // window expired
            }
        }
    }

    methodEventOnTouchStart(e)
    {
        for(const touch of e.changedTouches)
        {
            this.methodHandleNewTouch(touch);
        }
    }

    methodHandleNewTouch(touch)
    {
        // Is this the second tap of a double-tap? If so, start walking -
        // and don't also track it as a fresh tap candidate below, since
        // it's already been consumed as the second half of a pair. The
        // time-window check already happened in methodUpdate() above
        // (which nulls #pendingTapElapsedSeconds out once it's too old),
        // so only distance needs checking here.
        if(this.#pendingTapElapsedSeconds != null)
        {
            const distanceFromPendingTap = Math.hypot(touch.clientX - this.#pendingTapX, touch.clientY - this.#pendingTapY);
            if(distanceFromPendingTap <= DOUBLE_TAP_MAX_DISTANCE_PX)
            {
                this.#walkingTouchIdentifier = touch.identifier;
                this.#keys.forward = true;
                this.#pendingTapElapsedSeconds = null;
                return;
            }
        }

        this.#candidateTouchIdentifier = touch.identifier;
        this.#candidateStartX = touch.clientX;
        this.#candidateStartY = touch.clientY;
        this.#candidateElapsedSeconds = 0;
    }

    methodEventOnTouchEnd(e)
    {
        for(const touch of e.changedTouches)
        {
            this.methodHandleTouchEnd(touch);
        }
    }

    methodHandleTouchEnd(touch)
    {
        // Stop walking only when the SPECIFIC touch driving it lifts - an
        // unrelated second finger lifting shouldn't stop movement, and this
        // same touch may have moved a lot by now (aiming the camera while
        // walking), which is expected and doesn't disqualify it.
        if(this.#walkingTouchIdentifier === touch.identifier)
        {
            this.#walkingTouchIdentifier = null;
            this.#keys.forward = false;
            return; // a touch that just drove walking isn't itself a tap candidate
        }

        if(this.#candidateTouchIdentifier !== touch.identifier){return;}
        const candidateElapsedSeconds = this.#candidateElapsedSeconds;
        this.#candidateTouchIdentifier = null;

        // Only counts as a completed tap - and therefore a candidate "tap 1"
        // for a future double-tap - if it was quick and didn't move much;
        // otherwise it was a drag/long-press, not a tap.
        const distanceFromStart = Math.hypot(touch.clientX - this.#candidateStartX, touch.clientY - this.#candidateStartY);
        if(candidateElapsedSeconds > TAP_MAX_DURATION_SECONDS || distanceFromStart > TAP_MAX_MOVEMENT_PX){return;}

        this.#pendingTapElapsedSeconds = 0;
        this.#pendingTapX = touch.clientX;
        this.#pendingTapY = touch.clientY;
    }
}

export class EntityComponentPlayerController extends EntityComponent
{
    #params = null;
    #keys = null;
    constructor(params)
    {
        super(params);
        this.#params = params;
    }

    // #region lifecycle

    methodInitialize()
    {
        // Self-attaches its own Input sibling instead of receiving it from
        // main.js - same "Pattern C" as
        // EntityComponentCameraControllerFirstPerson (see
        // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md's "Pattern C:
        // self-attaching sibling components" section). Which concrete class
        // gets attached depends on EntityComponentContextEnvironment's
        // touch-primary detection, but main.js never needs to know that.
        const componentEnvironment = this.methodGetEntityByName("Environment")?.methodGetComponent("EntityComponentContextEnvironment");
        const componentInput = componentEnvironment.methodGetIsTouchPrimary()
            ? new EntityComponentPlayerControllerInputTouch()
            : new EntityComponentPlayerControllerInput();
        this.methodGetParent().methodAddComponentWithName("EntityComponentPlayerControllerInput", componentInput);
    }

    methodUpdate()
    {
        const componentInstanceInput = this.methodGetComponent("EntityComponentPlayerControllerInput");
        // early return: no entity component instance
        if(componentInstanceInput == null){return;}

        //
        const componentInstanceCameraControllerFirstPerson = this.methodGetComponent("EntityComponentCameraControllerFirstPerson");
        // early return: no entity component instance
        if(componentInstanceCameraControllerFirstPerson == null){return;}

        // a result variable
        // we modify this
        // and then .SetPosition in the end
        const positionResult = new THREE.Vector3();
        positionResult.copy(this.#params.cameraPivot.position);
        
        // we can use this index to determine if we should move in the first place
        // and also
        // the polarity
        var indexMovingOnForwardBackwardAxis = 0;
        if(componentInstanceInput.keys.forward == true) {indexMovingOnForwardBackwardAxis = 1;}
        else if(componentInstanceInput.keys.backward == true) {indexMovingOnForwardBackwardAxis = -1;}
        if(indexMovingOnForwardBackwardAxis != 0)
        {
            positionResult.addScaledVector(componentInstanceCameraControllerFirstPerson.directionForwardNonvertical, 0.05 * indexMovingOnForwardBackwardAxis);
            //this.#params.cameraPivot.position.addScaledVector(componentInstanceCameraControllerFirstPerson.directionForwardNonvertical, 0.05 * indexMovingOnForwardBackwardAxis);
        }



        // we can use this index to determine if we should move in the first place
        // and also
        // the polarity
        var indexMovingOnLeftRightAxis = 0;
        if(componentInstanceInput.keys.left == true) {indexMovingOnLeftRightAxis = 1;}
        else if(componentInstanceInput.keys.right == true) {indexMovingOnLeftRightAxis = -1;}
        if(indexMovingOnLeftRightAxis != 0)
        {
            positionResult.addScaledVector(componentInstanceCameraControllerFirstPerson.directionRightNonvertical, 0.05 * indexMovingOnLeftRightAxis);
            //this.#params.cameraPivot.position.addScaledVector(componentInstanceCameraControllerFirstPerson.directionRightNonvertical, 0.05 * indexMovingOnLeftRightAxis);
        }

        //
        if(componentInstanceInput.keys.up == true)
        {
            positionResult.y += 0.05;
            //this.#params.cameraPivot.position.y += 0.05;
        }
        else if(componentInstanceInput.keys.down == true)
        {
            positionResult.y -= 0.05;
            //this.#params.cameraPivot.position.y -= 0.05;
        }


        // early return: we don't do anything if we don't have anything
        const isSameX = (this.#params.cameraPivot.position.x == positionResult.x);
        const isSameY = (this.#params.cameraPivot.position.y == positionResult.y);
        const isSameZ = (this.#params.cameraPivot.position.z == positionResult.z);
        if (isSameX && isSameY && isSameZ) { return; }

        // we simply set the position once, at the end
        // this radiates to all entity_components that has registered that event
        this.methodSetPosition(positionResult);



    }

    // #endregion lifecycle
}