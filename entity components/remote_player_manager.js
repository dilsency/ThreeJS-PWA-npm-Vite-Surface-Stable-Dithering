// imports
// base
import {Entity} from "../classes/ECS/entity.js";
import {EntityComponent} from "../classes/ECS/entity_component.js";
import {EntityComponentTestCube} from "./test_objects.js";

// Owns one placeholder cube per connected remote peer - never for the local
// player's own entity, which is why a player never sees a body for
// themselves (their own client simply never spawns one for its own peer id).
// Spawns/despawns entities as EntityComponentPeerConnection's connection map
// changes (both expected to live on the same "multiplayer" entity - see
// main.js), and applies incoming "transform" messages (position/yaw/pitch) to
// the matching entity's cube.
//
// A remote entity gets its actual EntityComponentTestCube (shape/color1/
// color2) only once its "identity" message arrives, rather than at
// connection-open time with placeholder defaults - EntityComponentTestCube's
// shape/colors are fixed at construction (baked into its shader material),
// so there's no way to "re-skin" one after the fact, and since identity is
// sent once, immediately, on connection open (see
// EntityComponentPlayerNetworkSync), waiting for it is simpler than
// constructing a throwaway default cube and discarding it moments later.
// Until identity arrives, the entity exists (so despawn-on-disconnect still
// has something to remove) but has no visible cube - "transform" messages
// arriving in that window are silently dropped (see methodApplyTransform),
// which is fine since there's nothing on screen yet to move anyway. See
// MULTIPLAYER_TOPOLOGY_AND_SYNC.md.
export class EntityComponentRemotePlayerManager extends EntityComponent
{
    // bare minimum
    #params = null; // {scene, entityManager, colorPaletteBody, colorPaletteDither}

    //
    #remoteEntities = new Map(); // peerId -> Entity

    // construct
    constructor(params)
    {
        super(params);
        this.#params = params;
    }

    // lifecycle

    methodInitialize()
    {
    }

    methodUpdate(timeElapsed, timeDelta)
    {
        //
        const componentPeerConnection = this.methodGetComponent("EntityComponentPeerConnection");
        if(componentPeerConnection == null){return;}

        // reconcile spawned cubes against the current connection map
        const currentIds = componentPeerConnection.methodGetConnectionIds();
        const currentIdsSet = new Set(currentIds);

        for(const peerId of currentIds)
        {
            if(this.#remoteEntities.has(peerId)){continue;}
            this.methodSpawnRemotePlayer(peerId);
        }

        for(const peerId of Array.from(this.#remoteEntities.keys()))
        {
            if(currentIdsSet.has(peerId)){continue;}
            this.methodDespawnRemotePlayer(peerId);
        }

        // apply incoming messages
        const messages = componentPeerConnection.methodDrainMessages();
        for(const entry of messages)
        {
            if(entry.message == null){continue;}
            if(entry.message.type === "identity"){this.methodApplyIdentity(entry.peerId, entry.message); continue;}
            if(entry.message.type === "transform"){this.methodApplyTransform(entry.peerId, entry.message); continue;}
        }
    }

    // internal helpers

    methodSpawnRemotePlayer(peerId)
    {
        // No EntityComponentTestCube yet - added once "identity" arrives, see
        // methodApplyIdentity and the class comment above.
        const entity = new Entity(null);
        this.#params.entityManager.methodAddEntity(entity, "remotePlayer_" + peerId);
        this.#remoteEntities.set(peerId, entity);
    }

    methodApplyIdentity(peerId, message)
    {
        const entity = this.#remoteEntities.get(peerId);
        if(entity == null){return;}
        if(entity.methodGetComponent("EntityComponentTestCube") != null){return;} // already applied - identity is only ever sent once, but stay idempotent

        //
        entity.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({
            scene: this.#params.scene,
            name: "RemotePlayer" + peerId,
            lighting: true,
            spin: false,
            shape: message.shapeIndex,
            color1: this.#params.colorPaletteBody[message.colorIndex1],
            color2: this.#params.colorPaletteDither[message.colorIndex2],
        }));
    }

    methodDespawnRemotePlayer(peerId)
    {
        const entity = this.#remoteEntities.get(peerId);
        this.#remoteEntities.delete(peerId);
        if(entity == null){return;}

        //
        const componentCube = entity.methodGetComponent("EntityComponentTestCube");
        const cube = componentCube != null ? componentCube.methodGetCube() : null;
        if(cube != null)
        {
            // Geometry/material are not disposed here - no removal precedent
            // exists yet anywhere in this codebase, and at up to ~6 players
            // the leak is small. Worth revisiting if entities start
            // spawning/despawning far more often than "a player joins/leaves
            // a session."
            this.#params.scene.remove(cube);
        }

        //
        this.#params.entityManager.methodRemoveEntity(entity);
    }

    methodApplyTransform(peerId, message)
    {
        const entity = this.#remoteEntities.get(peerId);
        if(entity == null){return;}

        //
        const componentCube = entity.methodGetComponent("EntityComponentTestCube");
        if(componentCube == null){return;}
        const cube = componentCube.methodGetCube();
        if(cube == null){return;} // async init may not have finished yet

        //
        cube.position.set(message.position.x, message.position.y, message.position.z);
        cube.rotation.y = message.yaw;
        cube.rotation.x = message.pitch;
    }
}
