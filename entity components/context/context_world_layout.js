// imports
// base
import * as THREE from "three";
// ECS
import {EntityComponent} from "../../classes/ECS/entity_component.js";

// The ground's real footprint - defined once here and reused by both the
// actual ground EntityComponentTestCube's construction and player-spawn
// randomization, so the two can never drift out of sync (see
// methodGetRandomSpawnPositionXZ()'s own comment for why that matters - it
// used to put every remote player's cube exactly on top of your own camera,
// see MULTIPLAYER_TOPOLOGY_AND_SYNC.md). No single one of those two
// consumers owns this more than the other, so it lives here instead - see
// NAMING_CONVENTIONS.md's "Entity-component naming families" section for
// why this takes the EntityComponentContext prefix, and TODO.md item 6.2
// for the fuller design history. Attached to its own dedicated entity,
// built by main.js's initContextComponents() before either of its two
// consumers.
export class EntityComponentContextWorldLayout extends EntityComponent
{
    #groundSize = new THREE.Vector3(20, 0.2, 20);
    #groundPositionOffset = {x: 0, y: -1.5, z: 0};

    // #region getters

    methodGetGroundSize(){return this.#groundSize;}
    methodGetGroundPositionOffset(){return this.#groundPositionOffset;}

    // Random X/Z point somewhere on the ground's actual footprint, computed
    // from these construction-time values rather than the ground's live
    // THREE.Mesh, since EntityComponentTestCube's mesh isn't built until its
    // async methodInitialize() resolves, well after a player's spawn
    // position is needed. Owned here (rather than exposing raw min/max
    // getters for main.js to combine with Math.random() itself) since "a
    // valid random spawn point" is genuinely a world-layout concern, not
    // orchestration code.
    methodGetRandomSpawnPositionXZ()
    {
        const groundMinX = this.#groundPositionOffset.x - this.#groundSize.x / 2;
        const groundMaxX = this.#groundPositionOffset.x + this.#groundSize.x / 2;
        const groundMinZ = this.#groundPositionOffset.z - this.#groundSize.z / 2;
        const groundMaxZ = this.#groundPositionOffset.z + this.#groundSize.z / 2;
        return {
            x: groundMinX + Math.random() * (groundMaxX - groundMinX),
            z: groundMinZ + Math.random() * (groundMaxZ - groundMinZ),
        };
    }

    // #endregion getters
}
