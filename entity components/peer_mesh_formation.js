// imports
// base
import {EntityComponent} from "../classes/ECS/entity_component.js";

// Owns the roster handshake that converges a full mesh once more than 2
// players are connected (see MULTIPLAYER_TOPOLOGY_AND_SYNC.md, "Mesh
// formation" and "Implementation plan: mesh formation"). Expected to live on
// the same "multiplayer" entity as EntityComponentPeerConnection (sibling
// lookup, not cross-entity). Policy about *which connections should exist*,
// deliberately kept separate from EntityComponentPeerConnection's job of
// *managing whatever connections already exist*.
export class EntityComponentPeerMeshFormation extends EntityComponent
{
    // bare minimum
    #params = null;

    //
    #lastKnownIdsSorted = []; // last roster we actually broadcast, to detect when it's changed

    // construct
    constructor(params)
    {
        super(params);
        this.#params = params ?? {};
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

        // Roster: re-broadcast to EVERY currently-connected peer whenever our
        // own connection set changes, not just once to a newcomer at the
        // moment their connection opens. A one-time send-on-connect isn't
        // enough: a peer that connected to us early would otherwise never
        // learn about a peer that connects to us later, since its own
        // roster snapshot was frozen at whatever we knew the moment *it*
        // connected - this was verified to actually break convergence under
        // a stress test (5 peers joining one hub in quick succession left
        // several pairs never discovering each other). Comparing against
        // the last broadcast set (rather than re-sending every frame
        // unconditionally) keeps this cheap once the mesh is stable.
        const currentIds = componentPeerConnection.methodGetConnectionIds();
        const currentIdsSorted = [...currentIds].sort();
        const rosterChanged = JSON.stringify(currentIdsSorted) !== JSON.stringify(this.#lastKnownIdsSorted);
        if(rosterChanged)
        {
            this.#lastKnownIdsSorted = currentIdsSorted;
            for(const peerId of currentIds)
            {
                componentPeerConnection.methodSendToId(peerId, {
                    type: "roster",
                    peerIds: currentIds.filter((id) => id !== peerId),
                });
            }
        }

        // Incoming roster messages - non-destructive read, shared with
        // EntityComponentRemotePlayerManager's own read of the same batch
        // (see EntityComponentPeerConnection.methodGetMessagesThisFrame()).
        const localId = componentPeerConnection.methodGetLocalId();
        const messages = componentPeerConnection.methodGetMessagesThisFrame();
        for(const entry of messages)
        {
            if(entry.message == null || entry.message.type !== "roster"){continue;}
            this.methodHandleRoster(componentPeerConnection, localId, entry.message);
        }
    }

    // internal helpers

    methodHandleRoster(componentPeerConnection, localId, message)
    {
        if(localId == null){return;} // our own Peer isn't open yet - shouldn't normally happen, since a connection already had to exist to receive this

        //
        const knownIds = new Set(componentPeerConnection.methodGetConnectionIds());
        for(const remoteId of message.peerIds)
        {
            if(remoteId === localId){continue;} // that's us
            if(knownIds.has(remoteId)){continue;} // already connected
            // Tie-breaker: two peers who each discover the other from the
            // same roster message at roughly the same time could both
            // initiate at once, opening a duplicate connection for that
            // pair - only the numerically smaller id is allowed to
            // initiate; the other side just waits to receive the incoming
            // connection. Which side "wins" has no lasting effect once the
            // mesh converges (see MULTIPLAYER_TOPOLOGY_AND_SYNC.md's
            // implementation plan), it just has to be decided consistently
            // by both sides without them talking to each other first.
            if(!(Number(localId) < Number(remoteId))){continue;}
            componentPeerConnection.methodConnectToRemoteId(remoteId);
        }
    }
}
