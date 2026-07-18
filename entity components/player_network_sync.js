// imports
// base
import {EntityComponent} from "../classes/ECS/entity_component.js";

// Reads the local player's own position/facing-direction (from its sibling
// EntityComponentCameraControllerFirstPerson, on the same "player" entity)
// and broadcasts it to every connected peer at a throttled rate, via
// EntityComponentPeerConnection (found by cross-entity lookup, since it lives
// on the separate "multiplayer" entity). Also sends this player's identity
// (cubeHUD shape/color indices, chosen once at startup in main.js) to each
// new connection exactly once, since - unlike position/facing - it never
// changes for the lifetime of a connection. Outbound-only: never touches
// incoming messages or remote representations - that's
// EntityComponentRemotePlayerManager's job. See
// MULTIPLAYER_TOPOLOGY_AND_SYNC.md for why these stay separate components.
export class EntityComponentPlayerNetworkSync extends EntityComponent
{
    // bare minimum
    #params = null;

    //
    #sendIntervalSeconds = null;
    #secondsSinceLastSend = 0;

    //
    #identitySentToIds = new Set();

    // construct
    constructor(params)
    {
        super(params);
        this.#params = params ?? {};
        this.#sendIntervalSeconds = this.#params.sendIntervalSeconds ?? (1 / 18); // ~18Hz, within the 15-20/sec target
    }

    // lifecycle

    methodInitialize()
    {
    }

    methodUpdate(timeElapsed, timeDelta)
    {
        //
        const entitiesWithConnection = this.methodGetEntitiesWithComponent("EntityComponentPeerConnection", null);
        if(entitiesWithConnection.length === 0){return;}
        const componentPeerConnection = entitiesWithConnection[0].methodGetComponent("EntityComponentPeerConnection");
        if(componentPeerConnection == null){return;}

        // Identity: checked every frame (cheap - a handful of ids), not
        // throttled like transform, so a newly-connected peer learns this
        // player's shape/colors as soon as possible rather than waiting on
        // the transform interval.
        for(const peerId of componentPeerConnection.methodGetConnectionIds())
        {
            if(this.#identitySentToIds.has(peerId)){continue;}
            componentPeerConnection.methodSendToId(peerId, {
                type: "identity",
                shapeIndex: this.#params.shapeIndex,
                colorIndex1: this.#params.colorIndex1,
                colorIndex2: this.#params.colorIndex2,
            });
            this.#identitySentToIds.add(peerId);
        }

        // Transform: throttled, resent continuously for as long as connected.
        this.#secondsSinceLastSend += timeDelta;
        if(this.#secondsSinceLastSend < this.#sendIntervalSeconds){return;}
        this.#secondsSinceLastSend = 0;

        //
        const componentCamera = this.methodGetComponent("EntityComponentCameraControllerFirstPerson");
        if(componentCamera == null){return;}
        if(!componentPeerConnection.methodGetIsConnected()){return;}

        //
        const position = componentCamera.methodGetPosition();
        componentPeerConnection.methodSendToAll({
            type: "transform",
            position: {x: position.x, y: position.y, z: position.z},
            yaw: componentCamera.methodGetYaw(),
            pitch: componentCamera.methodGetPitch(),
        });
    }
}
