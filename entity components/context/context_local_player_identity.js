// imports
// ECS
import {EntityComponent} from "../../classes/ECS/entity_component.js";

// Local player identity, chosen once at startup (not re-rolled per frame) -
// read by three different components on three different entities: cubeHUD
// (EntityComponentTestCubeHUD, resolved color1/color2 + shape), this
// player's own network broadcast (EntityComponentPlayerNetworkSync, the raw
// indices, sent to every connected peer so their
// EntityComponentRemotePlayerManager can skin this player's
// remote-representation cube to match - see
// MULTIPLAYER_TOPOLOGY_AND_SYNC.md), and EntityComponentRemotePlayerManager
// itself (the raw palettes, to decode *other* players' incoming indices).
// No single one of those three owns this data more than the others, so it
// lives here instead - see NAMING_CONVENTIONS.md's "Entity-component naming
// families" section for why this takes the EntityComponentContext prefix,
// and BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md/TODO.md item 6.1 for the
// fuller design history. Attached to its own dedicated entity, built by
// main.js's initLocalPlayerIdentity() before any of its three consumers.
//
// 0-9 for the shape matches uShape's full valid range (see
// shaders/Simple_FractalDithering.frag's SDF_Shape comment). The two color
// indices index into two entirely separate palettes (body vs. dither), so
// there's no "must be distinct from each other" requirement to worry about
// here - an earlier version of this comment claimed one, left over from
// before the two-palette split, and was never actually true.
export class EntityComponentContextLocalPlayerIdentity extends EntityComponent
{
    #colorPaletteBody = Object.freeze(["hsl(223, 56.6%, 26.6%)", "hsl(0, 56.6%, 27.3%)", "hsl(180, 42.8%, 26.8%)", "hsl(218, 42.8%, 10.6%)"]);
    #colorPaletteDither = Object.freeze(["hsl(37, 56%, 62.5%)", "hsl(128, 56.6%, 63.7%)", "hsl(318, 42.8%, 68%)", "hsl(74, 51.9%, 87.9%)"]);
    #shapeIndex = null;
    #colorIndex1 = null;
    #colorIndex2 = null;

    // #region lifecycle

    methodInitialize()
    {
        this.#shapeIndex = Math.floor(Math.random() * 10);
        this.#colorIndex1 = Math.floor(Math.random() * this.#colorPaletteBody.length);
        this.#colorIndex2 = Math.floor(Math.random() * this.#colorPaletteDither.length);
    }

    // #endregion lifecycle

    // #region getters

    methodGetShapeIndex(){return this.#shapeIndex;}
    methodGetColorIndex1(){return this.#colorIndex1;}
    methodGetColorIndex2(){return this.#colorIndex2;}
    methodGetColor1(){return this.#colorPaletteBody[this.#colorIndex1];}
    methodGetColor2(){return this.#colorPaletteDither[this.#colorIndex2];}
    methodGetColorPaletteBody(){return this.#colorPaletteBody;}
    methodGetColorPaletteDither(){return this.#colorPaletteDither;}

    // #endregion getters
}
