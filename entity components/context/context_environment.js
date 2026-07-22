// imports
// ECS
import {EntityComponent} from "../../classes/ECS/entity_component.js";

// Owns environment-detection state that would otherwise end up duplicated
// as ad-hoc inline checks scattered across whichever component happens to
// need one first - EntityComponentPeerConnectionUI used to run its own
// inline native-shell check before this component existed; it now
// self-looks this one up instead (see entity components/peer_connection.js).
//
// Deliberately combines two unrelated-seeming axes - touch-vs-pointer
// input, and native-shell-vs-browser - into one component rather than two
// separate ones: neither axis has enough consumer-specific complexity
// today to justify splitting them apart, and doing so preemptively would
// be exactly the kind of premature abstraction this project avoids
// elsewhere (see NAMING_CONVENTIONS.md's "Entity-component naming
// families" section for the fuller reasoning, including an explicit note
// to revisit this decision if that ever changes).
export class EntityComponentContextEnvironment extends EntityComponent
{
    // #region bare minimum

    #isTouchPrimary = false;
    #isNativeShell = false;

    // #endregion bare minimum

    // #region lifecycle

    methodInitialize()
    {
        // Feature detection, not navigator.userAgent sniffing - a
        // touchscreen laptop should still get touch controls, and UA
        // strings are unreliable/spoofable in ways touch capability isn't.
        this.#isTouchPrimary = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

        // Matches EntityComponentPeerConnectionUI's former own inline
        // check exactly (see that file's methodInitialize()).
        this.#isNativeShell = (typeof window !== 'undefined') && (window.electronAPI != null || window.__TAURI__ != null);
    }

    // #endregion lifecycle

    // #region getters

    methodGetIsTouchPrimary(){return this.#isTouchPrimary;}
    methodGetIsNativeShell(){return this.#isNativeShell;}

    // #endregion getters
}
