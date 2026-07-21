// imports
// base
import * as THREE from "three";
// ECS
import {EntityComponent} from "../../classes/ECS/entity_component.js";

// Horizontal alignment of cubeHUD within the viewport - CENTER keeps it
// centered (x offset 0); LEFT/RIGHT solve for an offset that puts the
// *panel's* edge (not necessarily the cube's) flush with the corresponding
// screen edge.
export const HUDCubeHorizontalAlignmentEnum = Object.freeze({
    CENTER: "CENTER",
    LEFT: "LEFT",
    RIGHT: "RIGHT",
});

// Whether the HUD panel's yaw follows cubeHUD's own yaw correction
// (MATCH_CUBE - looks like one coherent object) or stays an axis-aligned
// rectangle regardless of the cube's own yaw (RECTANGULAR).
export const HUDPanelYawBehaviorEnum = Object.freeze({
    MATCH_CUBE: "MATCH_CUBE",
    RECTANGULAR: "RECTANGULAR",
});

// Solves cubeHUD's own position/yaw and the HUD backdrop panel's
// position/size, both through cameraHUD's actual projection (see
// methodComputeLayout()'s own comments for the full derivation) rather than
// guessed world-space numbers. Read by two siblings on the "hudPanel" entity
// - EntityComponentTestCubeHUD and EntityComponentBackgroundPlane - which is
// why this lives in its own EntityComponentContext-family component (see
// NAMING_CONVENTIONS.md's "Entity-component naming families" section)
// instead of being owned by either one of them; "HUDLayout" rather than
// "CubeHUDLayout" since the panel's fit is just as much this component's job
// as the cube's own position/yaw. Formerly `computeCubeHUDLayout()`, a bare
// closure in main.js (see TODO.md item 5.2).
export class EntityComponentContextHUDLayout extends EntityComponent
{
    // Shared by both the real cube and the panel-fitting math, so changing
    // scale (size) or rotation (tiltFactor) here keeps the two in sync
    // automatically - see methodComputeLayout()'s comments for why that sync
    // has to go through the camera's actual projection rather than any
    // world-space shortcut.
    #size = {x: 0.5, y: 0.5, z: 0.5}; // ~50% of the original 1x1x1
    #half = null; // derived, see methodInitialize()
    // y is deliberately low enough that most of cubeHUD renders below the
    // visible viewport - a stand-in for the eventual person model, which
    // will only be visible from roughly the middle of the thighs up (their
    // legs won't be visible), the same way a first-person view of your own
    // body typically looks. Don't "fix" this by raising y - the partial
    // submersion is the intended look.
    #baseOffset = {y: -1.5, z: -2.0}; // x is decided by the alignment param
    #tiltFactor = 0.265;
    #tiltRadians = null; // derived, see methodInitialize()

    #panelYawBehavior = HUDPanelYawBehaviorEnum.RECTANGULAR;

    // Only depend on #size, so these are safe to compute in methodInitialize()
    // before any cube/panel exists yet.
    #referenceSize = 1;
    #panelInsetTopPx = null;
    #panelInsetSidePx = null;
    #ndcPerPixelX = null;
    #ndcPerPixelY = null;

    // Panel sits a small fixed distance behind the cube, whatever the cube's
    // own depth is, so it stays "just behind" it if #baseOffset.z ever moves.
    #panelBehindCubeDistance = 0.2;
    #panelZ = null; // derived, see methodInitialize()

    #cameraHUD = null;

    // #region lifecycle

    methodInitialize()
    {
        this.#half = {x: this.#size.x / 2, y: this.#size.y / 2, z: this.#size.z / 2};
        this.#tiltRadians = this.#baseOffset.y * this.#tiltFactor;

        const sizeScale = this.#size.x / this.#referenceSize;
        this.#panelInsetTopPx = 6 * sizeScale;
        this.#panelInsetSidePx = 38 * sizeScale;
        this.#ndcPerPixelX = 2 / window.innerWidth;
        this.#ndcPerPixelY = 2 / window.innerHeight;

        this.#panelZ = this.#baseOffset.z - this.#panelBehindCubeDistance;

        // cached here rather than looked up fresh every call - this
        // component is queried on demand (construction + the live
        // alignment-cycling tuning button), not every frame, but the
        // reference never changes after construction regardless - see
        // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md's "Caching a resolved
        // lookup is fine" section.
        this.#cameraHUD = this.methodGetCameraHUD();
    }

    // #endregion lifecycle

    // #region getters

    methodGetSize(){return this.#size;}
    methodGetTiltFactor(){return this.#tiltFactor;}
    methodGetTiltRadians(){return this.#tiltRadians;}

    // Wrapped in a method (rather than one-shot init code) so alignment can
    // be changed live and everything downstream of it - the cube's x
    // offset, its yaw correction, and the panel's fit - recomputed, for the
    // live alignment-cycling tuning button in main.js.
    methodComputeLayout(alignment)
    {
        const cameraHUD = this.#cameraHUD;
        const cubeHUDBaseOffset = this.#baseOffset;
        const cubeHUDTiltRadians = this.#tiltRadians;
        const cubeHUDHalf = this.#half;
        const hudPanelYawBehavior = this.#panelYawBehavior;
        const panelInsetSidePx = this.#panelInsetSidePx;
        const panelInsetTopPx = this.#panelInsetTopPx;
        const ndcPerPixelX = this.#ndcPerPixelX;
        const ndcPerPixelY = this.#ndcPerPixelY;
        const panelZ = this.#panelZ;

        let offsetX = 0;
        if (alignment === HUDCubeHorizontalAlignmentEnum.LEFT)
        {
            // Solves for offsetX AND the yaw correction (see yawRadians below)
            // together, iteratively: the yaw needed to face cameraHUD depends on
            // offsetX, but which corner ends up leftmost — and therefore the offsetX
            // that puts the panel's edge flush with the screen — depends on that same
            // yaw (yaw rotates around Y, mixing local X/Z, so it can shift which corner
            // is actually leftmost; the old "always the local x=-half.x corners" shortcut
            // only held with zero yaw). A few passes converge quickly since each
            // correction is small relative to the one before it.
            const leftAlignPanelInsetPx = 0; // 0 = panel's edge flush against the screen edge
            const targetPanelNdcX = -1 + leftAlignPanelInsetPx * ndcPerPixelX;
            const targetCubeNdcX = targetPanelNdcX - panelInsetSidePx * ndcPerPixelX;

            for (let pass = 0; pass < 6; pass++)
            {
                const yawProxy = new THREE.Object3D();
                yawProxy.position.set(offsetX, cameraHUD.position.y, cubeHUDBaseOffset.z);
                yawProxy.lookAt(cameraHUD.position);
                const yawGuess = yawProxy.rotation.y;

                // Built at the CURRENT offsetX guess (not translation-independent this
                // time) and compared by actual projected NDC x, not raw world x: with
                // tilt but no yaw, rotation about X never touches local x, so all four
                // "left" (local x = -half.x) corners share the exact same world x and
                // differ only in depth — comparing world x directly can't break that
                // tie and silently picks whichever corner iterates first, not the one
                // closest to the camera that actually projects farthest left. Comparing
                // projected NDC x instead (world x divided by depth) resolves this
                // correctly, the same way the main panel-fitting corner loop below
                // does. Uses the *panel's* yaw behavior, not necessarily the cube's own
                // yaw: this solve is for where the panel ends up flush, and if
                // hudPanelYawBehavior is RECTANGULAR the panel never applies yaw at
                // all, so solving against the cube's real yaw here would target the
                // wrong shape (see hudPanelYawBehavior below).
                const alignProxy = new THREE.Object3D();
                alignProxy.position.set(offsetX, cubeHUDBaseOffset.y, cubeHUDBaseOffset.z);
                alignProxy.rotation.x = cubeHUDTiltRadians;
                alignProxy.rotation.y = (hudPanelYawBehavior === HUDPanelYawBehaviorEnum.MATCH_CUBE) ? yawGuess : 0;
                alignProxy.updateMatrixWorld(true);

                let minNdcX = Infinity, minCornerWorldZ = 0;
                for (const signX of [-1, 1]) for (const signY of [-1, 1]) for (const signZ of [-1, 1])
                {
                    const world = new THREE.Vector3(signX * cubeHUDHalf.x, signY * cubeHUDHalf.y, signZ * cubeHUDHalf.z)
                        .applyMatrix4(alignProxy.matrixWorld);
                    const ndcX = world.clone().project(cameraHUD).x;
                    if (ndcX < minNdcX) { minNdcX = ndcX; minCornerWorldZ = world.z; }
                }

                // NDC x is linear in offsetX for a fixed corner/depth, so unprojecting
                // the current and target NDC x at that corner's depth and taking the
                // difference gives the exact offsetX correction for this pass (a single
                // Newton step) — repeated because yaw (and, in principle, which corner
                // is leftmost) can shift slightly between passes.
                const cornerNdcZ = new THREE.Vector3(0, 0, minCornerWorldZ).project(cameraHUD).z;
                const currentWorldX = new THREE.Vector3(minNdcX, 0, cornerNdcZ).unproject(cameraHUD).x;
                const targetWorldX = new THREE.Vector3(targetCubeNdcX, 0, cornerNdcZ).unproject(cameraHUD).x;

                offsetX += targetWorldX - currentWorldX;
            }
        }
        else if (alignment === HUDCubeHorizontalAlignmentEnum.RIGHT)
        {
            // Mirrors the LEFT branch above exactly, for the screen's right edge:
            // same iterative solve, same reasoning for why NDC x must be compared
            // (not raw world x) and why it targets the *panel's* edge rather than
            // the cube's own — just targeting NDC x = +1 and searching for the
            // cube's rightmost (max NDC x) corner instead of leftmost.
            const rightAlignPanelInsetPx = 0; // 0 = panel's edge flush against the screen edge
            const targetPanelNdcX = 1 - rightAlignPanelInsetPx * ndcPerPixelX;
            const targetCubeNdcX = targetPanelNdcX + panelInsetSidePx * ndcPerPixelX;

            for (let pass = 0; pass < 6; pass++)
            {
                const yawProxy = new THREE.Object3D();
                yawProxy.position.set(offsetX, cameraHUD.position.y, cubeHUDBaseOffset.z);
                yawProxy.lookAt(cameraHUD.position);
                const yawGuess = yawProxy.rotation.y;

                const alignProxy = new THREE.Object3D();
                alignProxy.position.set(offsetX, cubeHUDBaseOffset.y, cubeHUDBaseOffset.z);
                alignProxy.rotation.x = cubeHUDTiltRadians;
                alignProxy.rotation.y = (hudPanelYawBehavior === HUDPanelYawBehaviorEnum.MATCH_CUBE) ? yawGuess : 0;
                alignProxy.updateMatrixWorld(true);

                let maxNdcX = -Infinity, maxCornerWorldZ = 0;
                for (const signX of [-1, 1]) for (const signY of [-1, 1]) for (const signZ of [-1, 1])
                {
                    const world = new THREE.Vector3(signX * cubeHUDHalf.x, signY * cubeHUDHalf.y, signZ * cubeHUDHalf.z)
                        .applyMatrix4(alignProxy.matrixWorld);
                    const ndcX = world.clone().project(cameraHUD).x;
                    if (ndcX > maxNdcX) { maxNdcX = ndcX; maxCornerWorldZ = world.z; }
                }

                const cornerNdcZ = new THREE.Vector3(0, 0, maxCornerWorldZ).project(cameraHUD).z;
                const currentWorldX = new THREE.Vector3(maxNdcX, 0, cornerNdcZ).unproject(cameraHUD).x;
                const targetWorldX = new THREE.Vector3(targetCubeNdcX, 0, cornerNdcZ).unproject(cameraHUD).x;

                offsetX += targetWorldX - currentWorldX;
            }
        }
        // else: CENTER defaults to offsetX = 0.
        const positionOffset = {x: offsetX, y: cubeHUDBaseOffset.y, z: cubeHUDBaseOffset.z};

        // Exact yaw correction: a horizontally off-center cubeHUD, with rotation.y
        // left at 0, would be perfectly parallel to cameraHUD's forward axis — but a
        // fixed, wide-FOV camera views it along an angled ray, which reads visually
        // as if the cube had turned away from center (real perspective parallax, not
        // a bug; see HUD_PANEL_CUBE_FITTING.md). This deliberately trades that literal
        // parallel-to-camera facing for a skew-free look: rotate cubeHUD's yaw to
        // face cameraHUD's actual position instead. Uses THREE.Object3D.lookAt
        // against cameraHUD's real position/orientation (rather than a hand-derived
        // atan2) specifically so this keeps working if cameraHUD is ever moved or
        // reoriented, and Y is zeroed on the lookAt target so only yaw is solved for
        // — the existing vertical (rotation.x) tilt already handles the vertical
        // case separately, deliberately as a cruder approximation (see its comment).
        const yawProxy = new THREE.Object3D();
        yawProxy.position.set(positionOffset.x, cameraHUD.position.y, positionOffset.z);
        yawProxy.lookAt(cameraHUD.position);
        const yawRadians = yawProxy.rotation.y;

        // Backdrop panel sized/positioned to frame cubeHUD as actually seen through
        // cameraHUD, rather than guessed world-space numbers. cubeHUD sits low enough
        // that most of it renders below the visible viewport (by design — see the
        // sliver in HUD_DEPTH_CLEARING.md-adjacent screenshots), so matching its
        // world-space offset/size directly, or even scaling both by the depth ratio
        // between the two, doesn't reproduce "looks the same on screen": the cube's
        // world-space *center* isn't representative of its mostly-offscreen *visible*
        // extent. The only way two objects at different depths line up on screen is
        // through the camera's actual projection, not through their world-space
        // relationship — so: project cubeHUD's own 8 corners through cameraHUD to get
        // its true on-screen bounding box, then unproject an expanded version of that
        // box back out at the panel's depth to get the panel's size/position. This
        // holds regardless of cubeHUDSize or cubeHUDTiltFactor, since both feed the
        // same corner computation that actually builds the real cube below. This
        // proxy must keep replicating every rotation EntityComponentTestCubeHUD
        // actually applies (currently rotation.x's vertical tilt and rotation.y's yaw
        // correction) — if that class's rotation logic changes again, update this
        // proxy to match or the panel will fit the cube's *old* orientation instead
        // of its real one. The yaw specifically is gated by hudPanelYawBehavior:
        // MATCH_CUBE (default) mirrors yawRadians exactly, so the panel skews along
        // with the cube's yaw correction, which is what makes it look like a single
        // coherent object; RECTANGULAR zeroes it out so the panel stays an
        // axis-aligned rectangle regardless of the cube's own yaw.
        const cubeProxy = new THREE.Object3D();
        cubeProxy.position.set(positionOffset.x, positionOffset.y, positionOffset.z);
        cubeProxy.rotation.y = (hudPanelYawBehavior === HUDPanelYawBehaviorEnum.MATCH_CUBE) ? yawRadians : 0;
        cubeProxy.rotation.x = cubeHUDTiltRadians;
        cubeProxy.updateMatrixWorld(true);

        const cubeNdcXs = [], cubeNdcYs = [];
        for (const signX of [-1, 1]) for (const signY of [-1, 1]) for (const signZ of [-1, 1])
        {
            const cornerNdc = new THREE.Vector3(signX * cubeHUDHalf.x, signY * cubeHUDHalf.y, signZ * cubeHUDHalf.z)
                .applyMatrix4(cubeProxy.matrixWorld)
                .project(cameraHUD);
            cubeNdcXs.push(cornerNdc.x);
            cubeNdcYs.push(cornerNdc.y);
        }
        const cubeNdcMinX = Math.min(...cubeNdcXs), cubeNdcMaxX = Math.max(...cubeNdcXs);
        const cubeNdcMinY = Math.min(...cubeNdcYs), cubeNdcMaxY = Math.max(...cubeNdcYs);

        // Fine-tuned in pixels (at this init-time viewport size) rather than as a
        // fraction of the cube's own on-screen size: the cube's NDC bounding box is
        // dominated by its closest (bottom-front) corners — tilt pulls them nearer the
        // camera, exaggerating their perspective width beyond the cube's actual visible
        // footprint — so a ratio-based margin overshoots unevenly. Positive insets
        // shrink the panel inward from the cube's raw bounding box on that edge; the
        // bottom is left matched exactly to the cube's own bottom (already off-screen).
        const panelNdcMinX = cubeNdcMinX + panelInsetSidePx * ndcPerPixelX;
        const panelNdcMaxX = cubeNdcMaxX - panelInsetSidePx * ndcPerPixelX;
        const panelNdcMaxY = cubeNdcMaxY - panelInsetTopPx * ndcPerPixelY;
        const panelNdcMinY = cubeNdcMinY;

        const panelNdcZ = new THREE.Vector3(0, 0, panelZ).project(cameraHUD).z;
        const panelTopLeft = new THREE.Vector3(panelNdcMinX, panelNdcMaxY, panelNdcZ).unproject(cameraHUD);
        const panelBottomRight = new THREE.Vector3(panelNdcMaxX, panelNdcMinY, panelNdcZ).unproject(cameraHUD);

        return {
            positionOffset,
            yawRadians,
            panelPositionOffset: {
                x: (panelTopLeft.x + panelBottomRight.x) / 2,
                y: (panelTopLeft.y + panelBottomRight.y) / 2,
                z: panelZ,
            },
            panelSize: {
                width: panelBottomRight.x - panelTopLeft.x,
                height: panelTopLeft.y - panelBottomRight.y,
            },
        };
    }

    // #endregion getters
}
