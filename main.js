// to update node.js
//  https://stackoverflow.com/a/10076029/32604643
//  tl;dr: n stable

// https://dilsency.github.io/ThreeJS-PWA-npm-Vite-Surface-Stable-Dithering/

// imports
// base
import * as THREE from "three";
// entity-component-system (ECS)
import {EntityManager} from "./classes/ECS/entity_manager.js";
import {Entity} from "./classes/ECS/entity.js";
import {EntityComponent} from "./classes/ECS/entity_component.js";
// entity components
import {EntityComponentCameraControllerFirstPerson} from "./entity components/camera_controller_first_person.js";
import {EntityComponentCameraControllerFirstPersonInput} from "./entity components/camera_controller_first_person.js";
import {EntityComponentPlayerController} from "./entity components/player_controller.js";
import {EntityComponentPlayerControllerInput} from "./entity components/player_controller.js";
import {EntityComponentTestCube} from "./entity components/test_objects.js";
import {EntityComponentTestCubeHUD} from "./entity components/test_objects.js";
import {EntityComponentBackgroundPlane} from "./entity components/test_objects.js";
import {EntityComponentButtonPointerLock} from "./entity components/test_objects.js";
import {EntityComponentDirectionalLight} from "./entity components/lighting.js";
import {EntityComponentDirectionalLightHUD} from "./entity components/lighting.js";
import {EntityComponentLightManager} from "./entity components/lighting.js";
import {EntityComponentPeerConnection} from "./entity components/peer_connection.js";
import {EntityComponentPeerConnectionUI} from "./entity components/peer_connection.js";
import {EntityComponentPlayerNetworkSync} from "./entity components/player_network_sync.js";
import {EntityComponentRemotePlayerManager} from "./entity components/remote_player_manager.js";
import {EntityComponentPeerMeshFormation} from "./entity components/peer_mesh_formation.js";
import {EntityComponentEngineContext} from "./entity components/engine_context.js";

// bare minimum
var scene;
var sceneHUD;
var renderer;

var clock;
var clockTimeDelta = 0;
var clockTimeElapsed = 0;

var cameraPivot;
var camera;
var cameraHUD;

var cameraDirection;
var cameraPivotDirection;
var cameraFrustum;

// ECS
var entityManager;

//
var cube;

//
init();
function init()
{
    //
    function initBareMinimum()
    {
        //
        console.log("init bare minimum");

        //
        clock = new THREE.Clock();
        clock.start();

        //
        scene = new THREE.Scene();
        scene.environment = null;

        //
        sceneHUD = new THREE.Scene();
        sceneHUD.environment = null;

        //
        cameraPivot = new THREE.Object3D();
        cameraPivot.name = "cameraPivot";
        //cameraPivot.position.z = 5;
        scene.add(cameraPivot);
        camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

        //
        cameraHUD = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
        sceneHUD.add(cameraHUD);

        //
        camera.up.set(0,1,0);

        camera.updateProjectionMatrix();
        cameraPivot.add(camera);
        cameraDirection = new THREE.Vector3();
        cameraPivotDirection = new THREE.Vector3();
        cameraFrustum = new THREE.Frustum();
        
        // default cam values
        camera.getWorldDirection(cameraDirection);
        cameraPivot.getWorldDirection(cameraPivotDirection);
        cameraFrustum.setFromProjectionMatrix(camera.projectionMatrix);

        //
        cameraHUD.up.set(0,1,0);
        cameraHUD.updateProjectionMatrix();

        //
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("webgl2");

        //
        renderer = new THREE.WebGLRenderer({ canvas, context });
        renderer.setSize( window.innerWidth, window.innerHeight );
        renderer.domElement.id = "canvas";
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild( renderer.domElement );

        // Single source of truth for the "empty space" background color:
        // read once from index.html's own CSS rule
        // (`html,body,canvas#canvas{background-color:...}`) rather than
        // hardcoding the same value again here. Both the world scene's real
        // clear color (this) and the HUD panel behind cubeHUD (main.js's
        // componentPanelHUD, which used to fall back to its own hardcoded
        // sky-blue default) derive from this one read. See TODO.md, item 4.
        // Must run after appendChild() above so the element is actually in
        // the DOM and its id selector match is reliable.
        scene.background = new THREE.Color(getComputedStyle(canvas).backgroundColor);
    }

    //
    function initECS()
    {
        //
        console.log("init ECS");

        //
        entityManager = new EntityManager(null);
    }

    //
    // Builds the "EngineContext" entity before anything else - deliberately
    // its own step, not folded into initEntityComponents(), so the ordering
    // guarantee ("EngineContext exists before any component that might call
    // this.methodGetScene()/this.methodGetRenderer()") is visible at
    // init()'s own top-level call sequence rather than depending on this
    // being the first few statements inside a much larger function. See
    // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md's "Ensuring EngineContext
    // initializes before everything else" section.
    function initEngineContext()
    {
        //
        console.log("init engine context");

        //
        const entityEngineContext = new Entity(null);
        entityManager.methodAddEntity(entityEngineContext, "EngineContext");
        entityEngineContext.methodAddComponentWithName("EntityComponentEngineContext", new EntityComponentEngineContext({scene: scene, sceneHUD: sceneHUD, renderer: renderer, camera: camera, cameraPivot: cameraPivot,}));
    }

    //
    function initEntityComponents()
    {
        //
        console.log("init Entities");

        // Local player identity, chosen once at startup (not re-rolled per
        // frame) - the cubeHUD shape/color1/color2 below, and also broadcast
        // once to every connected peer via EntityComponentPlayerNetworkSync so
        // their EntityComponentRemotePlayerManager can skin this player's
        // remote-representation cube to match (see
        // MULTIPLAYER_TOPOLOGY_AND_SYNC.md). The two color indices are
        // guaranteed distinct - rejection sampling is fine here since the
        // palette is tiny and this only runs once. 0-9 for the shape matches
        // uShape's full valid range (see
        // shaders/Simple_FractalDithering.frag's SDF_Shape comment).
        const playerColorPaletteBody = Object.freeze(["hsl(223, 56.6%, 26.6%)", "hsl(0, 56.6%, 27.3%)", "hsl(180, 42.8%, 26.8%)", "hsl(218, 42.8%, 10.6%)"]);
        const playerColorPaletteDither = Object.freeze(["hsl(37, 56%, 62.5%)", "hsl(128, 56.6%, 63.7%)", "hsl(318, 42.8%, 68%)", "hsl(74, 51.9%, 87.9%)"]);
        const localPlayerColorIndex1 = Math.floor(Math.random() * playerColorPaletteBody.length);
        let localPlayerColorIndex2 = Math.floor(Math.random() * playerColorPaletteDither.length);
        const localCubeHUDShapeIndex = Math.floor(Math.random() * 10);

        // Ground reference - defined once here and reused below for the
        // actual ground EntityComponentTestCube, so the two can never drift
        // out of sync. Used to give each player a random local spawn
        // X/Z somewhere on the ground's actual footprint rather than the
        // same hardcoded point every player used to start at (which put
        // every remote player's cube exactly on top of your own camera -
        // see MULTIPLAYER_TOPOLOGY_AND_SYNC.md). Computed from these
        // construction-time values rather than the ground's live THREE.Mesh,
        // since EntityComponentTestCube's mesh isn't built until its async
        // methodInitialize() resolves, well after this point.
        const groundSize = new THREE.Vector3(20, 0.2, 20);
        const groundPositionOffset = {x: 0, y: -1.5, z: 0};
        const groundMinX = groundPositionOffset.x - groundSize.x / 2;
        const groundMaxX = groundPositionOffset.x + groundSize.x / 2;
        const localPlayerStartX = groundMinX + Math.random() * (groundMaxX - groundMinX);
        const groundMinZ = groundPositionOffset.z - groundSize.z / 2;
        const groundMaxZ = groundPositionOffset.z + groundSize.z / 2;
        const localPlayerStartZ = groundMinZ + Math.random() * (groundMaxZ - groundMinZ);

        //
        const entityA = new Entity(null);
        entityManager.methodAddEntity(entityA, "player");
        //
        entityA.methodAddComponentWithName("EntityComponentCameraControllerFirstPerson", new EntityComponentCameraControllerFirstPerson());
        entityA.methodAddComponentWithName("EntityComponentCameraControllerFirstPersonInput", new EntityComponentCameraControllerFirstPersonInput());
        //
        entityA.methodAddComponentWithName("EntityComponentPlayerController", new EntityComponentPlayerController({cameraPivot: cameraPivot,}));
        entityA.methodAddComponentWithName("EntityComponentPlayerControllerInput", new EntityComponentPlayerControllerInput());
        //
        // LAN multiplayer (see MULTIPLAYER_TOPOLOGY_AND_SYNC.md): broadcasts this
        // player's own position/facing-direction to every connected peer.
        entityA.methodAddComponentWithName("EntityComponentPlayerNetworkSync", new EntityComponentPlayerNetworkSync({
            shapeIndex: localCubeHUDShapeIndex,
            colorIndex1: localPlayerColorIndex1,
            colorIndex2: localPlayerColorIndex2,
        }));

        entityA.methodSetPosition(new THREE.Vector3(localPlayerStartX,0.0,localPlayerStartZ));
        //

        /*
        //
        const entityB = new Entity(null);
        entityManager.methodAddEntity(entityB, "cubeCircle");
        entityB.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({scene:scene,name:"model",lighting:true,shape:0,}));

        //
        const entityBDebugNormals = new Entity(null);
        entityManager.methodAddEntity(entityBDebugNormals, "cubeDebugNormals");
        entityBDebugNormals.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({scene:scene,name:"modelDebugNormals",lighting:true,debugNormals:true,positionOffset:{x:2.5,y:0,z:0},shape:1,}));

        //
        const entityCubeC = new Entity(null);
        entityManager.methodAddEntity(entityCubeC, "cubeC");
        entityCubeC.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({scene:scene,name:"CubeC",lighting:true,positionOffset:{x:-2.5,y:0,z:0},color1:0x00008b,color2:0xff8000,shape:2,}));

        //
        const entityCubeD = new Entity(null);
        entityManager.methodAddEntity(entityCubeD, "cubeD");
        entityCubeD.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({scene:scene,name:"CubeD",lighting:true,positionOffset:{x:5,y:0,z:0},color1Texture:true,color2:0xff0000,shape:3,}));

        //
        const entityCubeE = new Entity(null);
        entityManager.methodAddEntity(entityCubeE, "cubeE");
        entityCubeE.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({scene:scene,name:"CubeE",lighting:true,positionOffset:{x:7.5,y:0,z:0},color1Texture:true,color2BlendTexture:true,color2:0xff0000,shape:4,}));

        //
        const entityCubeF = new Entity(null);
        entityManager.methodAddEntity(entityCubeF, "cubeF");
        entityCubeF.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({scene:scene,name:"CubeF",lighting:true,positionOffset:{x:10,y:0,z:0},color1Texture:true,color2:0xff0000,textureFile:'texture_checkerboard_alphamask.png',shape:5,}));
        */

        //
        const entityGround = new Entity(null);
        entityManager.methodAddEntity(entityGround, "ground");
        entityGround.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({name:"ground",lighting:true,spin:false,size:groundSize,positionOffset:groundPositionOffset,shape:6,}));

        //
        const entityLight = new Entity(null);
        entityManager.methodAddEntity(entityLight, "sun");
        const componentLightWorld = new EntityComponentDirectionalLight({position:new THREE.Vector3(5,8,5),target:new THREE.Vector3(0,0,0),});
        entityLight.methodAddComponentWithName("EntityComponentDirectionalLight", componentLightWorld);
        entityLight.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({name:"CubeG",lighting:true,positionOffset:{x:5,y:8,z:5},color1Texture:false,color2:0xffFF00,textureFile:'texture_checkerboard_alphamask.png',shape:5,}));

        //
        const entityC = new Entity(null);
        entityManager.methodAddEntity(entityC, "pointerLockButton");
        const componentPointerLockButton = new EntityComponentButtonPointerLock({document:document,});
        entityC.methodAddComponentWithName("EntityComponentButtonPointerLock", componentPointerLockButton);

        const entityD = new Entity(null);
        entityManager.methodAddEntity(entityD, "testEntityPositionOnly");
        entityD.methodSetPosition({x:-10,y:0,z:-10,});

        // sceneHUD

        const entityHUD = new Entity(null);
        entityManager.methodAddEntity(entityHUD, "hudPanel");

        // Shared by both the real cube below and the panel-fitting math, so changing
        // scale (size) or rotation (tiltFactor) here keeps the two in sync automatically
        // — see the comment block below for why that sync has to go through the
        // camera's actual projection rather than any world-space shortcut.
        const cubeHUDSize = {x:0.5, y:0.5, z:0.5}; // ~50% of the original 1x1x1
        const cubeHUDHalf = {x: cubeHUDSize.x / 2, y: cubeHUDSize.y / 2, z: cubeHUDSize.z / 2};
        // y is deliberately low enough that most of cubeHUD renders below the visible
        // viewport — a stand-in for the eventual person model, which will only be
        // visible from roughly the middle of the thighs up (their legs won't be
        // visible), the same way a first-person view of your own body typically looks.
        // Don't "fix" this by raising y — the partial submersion is the intended look.
        const cubeHUDBaseOffset = {y:-1.5, z:-2.0}; // x is decided by cubeHUDHorizontalAlignment below
        const cubeHUDTiltFactor = 0.265;
        const cubeHUDTiltRadians = cubeHUDBaseOffset.y * cubeHUDTiltFactor;

        const HUDCubeHorizontalAlignmentEnum = Object.freeze({
            CENTER: "CENTER", // unchanged from before: cubeHUD sits centered, x offset 0
            LEFT: "LEFT", // the *panel* (not the cube) sits flush with the screen's left edge
            RIGHT: "RIGHT", // mirrors LEFT: the *panel* sits flush with the screen's right edge
        });
        const cubeHUDHorizontalAlignment = HUDCubeHorizontalAlignmentEnum.LEFT;

        const HUDPanelYawBehaviorEnum = Object.freeze({
            MATCH_CUBE: "MATCH_CUBE", // default: panel skews along with cubeHUD's yaw correction (looks good)
            RECTANGULAR: "RECTANGULAR", // panel stays an axis-aligned rectangle, ignoring cubeHUD's yaw
        });
        const hudPanelYawBehavior = HUDPanelYawBehaviorEnum.RECTANGULAR;

        // Computed here (rather than down where the panel is actually built) because
        // LEFT alignment needs panelInsetSidePx to solve for the cube's offset below —
        // see that block for why. Only depends on cubeHUDSize, so this is safe to do
        // before computeCubeHUDLayout (and therefore the real cube) exist yet.
        const cubeHUDReferenceSize = 1;
        const cubeHUDSizeScale = cubeHUDSize.x / cubeHUDReferenceSize;
        const panelInsetTopPx = 6 * cubeHUDSizeScale;
        const panelInsetSidePx = 38 * cubeHUDSizeScale;
        const ndcPerPixelX = 2 / window.innerWidth;
        const ndcPerPixelY = 2 / window.innerHeight;

        // Panel sits a small fixed distance behind the cube, whatever the cube's own
        // depth is, so it stays "just behind" it if cubeHUDBaseOffset.z ever moves.
        const panelBehindCubeDistance = 0.2;
        const panelZ = cubeHUDBaseOffset.z - panelBehindCubeDistance;

        // Wrapped in a function (rather than one-shot init code) so cubeHUDHorizontalAlignment
        // can be changed live and everything downstream of it — the cube's x offset,
        // its yaw correction, and the panel's fit — recomputed and re-applied to the
        // already-created meshes, for the live alignment-cycling tuning button below.
        function computeCubeHUDLayout(alignment)
        {
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

        let cubeHUDLayout = computeCubeHUDLayout(cubeHUDHorizontalAlignment);

        const componentPanelHUD = new EntityComponentBackgroundPlane({
            positionOffset:cubeHUDLayout.panelPositionOffset,
            size:cubeHUDLayout.panelSize,
            color: scene.background, // match the main scene's background instead of the class's own sky-blue default - see TODO.md, item 4
        });
        entityHUD.methodAddComponentWithName("EntityComponentBackgroundPlane", componentPanelHUD);

        const componentCubeHUD = new EntityComponentTestCubeHUD({name:"model",
            positionOffset:cubeHUDLayout.positionOffset,
            size:cubeHUDSize,
            tiltFactor:cubeHUDTiltFactor,
            yawRadians:cubeHUDLayout.yawRadians,
            spin:false,
            lighting:true,
            shape:localCubeHUDShapeIndex,
            // base/body color and dither-dot/SDF-shape color - see the local
            // player identity block above for the palette and index rolls.
            color1:playerColorPaletteBody[localPlayerColorIndex1],
            color2:playerColorPaletteDither[localPlayerColorIndex2],
        });
        entityHUD.methodAddComponentWithName("EntityComponentTestCubeHUD", componentCubeHUD);

        // TEMP dev tool: live pitch/yaw/roll tuning inputs for cubeHUD, so the "un-skew
        // the top edge" correction can be found by eye in real time instead of guessed
        // at geometrically (see HUD_PANEL_CUBE_FITTING.md) — remove once a value is
        // settled on and baked into cubeHUDLayout's yawRadians / a permanent roll
        // constant above. The rotation inputs only touch the cube itself, not the
        // panel, since they're purely for visually judging the cube's own orientation;
        // the alignment-cycling button below does touch the panel too, since alignment
        // is the one thing that legitimately changes both.
        {
            const tuningContainer = document.createElement("div");
            tuningContainer.style.position = "fixed";
            tuningContainer.style.top = "0";
            tuningContainer.style.right = "0";
            tuningContainer.style.background = "rgba(0,0,0,0.6)";
            tuningContainer.style.color = "white";
            tuningContainer.style.font = "12px monospace";
            tuningContainer.style.padding = "6px";
            tuningContainer.style.zIndex = "1000";
            tuningContainer.style.display = "none"; // hidden by default — see the show/hide toggle buttons below

            // Collapsed by default so this dev-only tool doesn't permanently occupy
            // screen space: a small "v" button sits in its place until clicked, which
            // reveals the full panel (now with its own "^" button, prepended as the
            // panel's first child below, to collapse it again).
            const tuningShowButton = document.createElement("button");
            tuningShowButton.textContent = "v";
            tuningShowButton.style.position = "fixed";
            tuningShowButton.style.top = "0";
            tuningShowButton.style.right = "0";
            tuningShowButton.style.zIndex = "1000";
            tuningShowButton.addEventListener("click", () =>
            {
                tuningContainer.style.display = "block";
                tuningShowButton.style.display = "none";
            });
            document.body.appendChild(tuningShowButton);

            const tuningHideButton = document.createElement("button");
            tuningHideButton.textContent = "^";
            tuningHideButton.style.display = "block";
            tuningHideButton.addEventListener("click", () =>
            {
                tuningContainer.style.display = "none";
                tuningShowButton.style.display = "block";
            });
            tuningContainer.appendChild(tuningHideButton);

            const makeTuningInput = (labelText, step = 0.5) =>
            {
                const label = document.createElement("label");
                label.style.display = "block";
                label.textContent = labelText;
                const input = document.createElement("input");
                input.type = "number";
                input.step = String(step);
                input.value = "0";
                input.style.width = "70px";
                label.appendChild(input);
                tuningContainer.appendChild(label);
                return input;
            };

            const pitchOffsetInput = makeTuningInput("pitch offset (deg): ");
            const yawOffsetInput = makeTuningInput("yaw offset (deg): ");
            const rollOffsetInput = makeTuningInput("roll offset (deg): ");
            // All 6 possible shear directions for a 3D shear (each displaces one axis
            // proportionally to a different one): x per y, x per z, y per x, y per z,
            // z per x, z per y. "x per y" is the original one this was built for
            // ("further up leans left"); the other five are here for comparison, same
            // as pitch/yaw/roll's earlier live-tuning inputs.
            const shearXYInput = makeTuningInput("shear (x per y): ", 0.1);
            const shearXZInput = makeTuningInput("shear (x per z): ", 0.1);
            const shearYXInput = makeTuningInput("shear (y per x): ", 0.1);
            const shearYZInput = makeTuningInput("shear (y per z): ", 0.1);
            const shearZXInput = makeTuningInput("shear (z per x): ", 0.1);
            const shearZYInput = makeTuningInput("shear (z per y): ", 0.1);

            // cubeHUD's mesh is normally added directly to sceneHUD with its position
            // and rotation both set on itself (see EntityComponentTestCube). A shear
            // can't be layered on top of that the same way rotation offsets are above:
            // a shear matrix mixes x with y, so if it sat on the same node as the
            // cube's own position (cubeHUDBaseOffset.y = -1.5, far larger than the
            // cube's own ±0.25 half-extent), it would shift the cube's whole center
            // sideways by a large amount instead of just distorting its local shape —
            // see HUD_CUBE_ORIENTATION_AND_TUNING.md's shear section for the design
            // rationale. Fixed by splitting position and shear onto separate nodes:
            //   sceneHUD -> cubeHUDOuterNode (position only) -> cubeHUDShearWrapper
            //     (shear matrix only, matrixAutoUpdate off) -> cube (rotation + geometry,
            //     its own position reset to zero since the outer node now carries it)
            // Built lazily (once, the first time the cube mesh actually exists — its
            // async methodInitialize may not have finished yet) rather than at this
            // point in init, and reused after that.
            let cubeHUDOuterNode = null;
            let cubeHUDShearWrapper = null;
            const ensureCubeHUDShearHierarchy = () =>
            {
                if (cubeHUDOuterNode != null) { return true; }
                const cube = componentCubeHUD.methodGetCube();
                if (cube == null) { return false; } // component initialization is async and may not have finished yet

                cubeHUDOuterNode = new THREE.Object3D();
                cubeHUDOuterNode.position.copy(cube.position);

                cubeHUDShearWrapper = new THREE.Object3D();
                cubeHUDShearWrapper.matrixAutoUpdate = false; // this node only ever holds a directly-set shear matrix

                sceneHUD.remove(cube);
                cube.position.set(0, 0, 0); // position now lives on cubeHUDOuterNode instead
                sceneHUD.add(cubeHUDOuterNode);
                cubeHUDOuterNode.add(cubeHUDShearWrapper);
                cubeHUDShearWrapper.add(cube);
                return true;
            };

            const applyTuning = () =>
            {
                ensureCubeHUDShearHierarchy();
                const cube = componentCubeHUD.methodGetCube();
                if (cube == null) { return; } // component initialization is async and may not have finished yet
                const pitchOffsetRadians = THREE.MathUtils.degToRad(parseFloat(pitchOffsetInput.value) || 0);
                const yawOffsetRadians = THREE.MathUtils.degToRad(parseFloat(yawOffsetInput.value) || 0);
                const rollOffsetRadians = THREE.MathUtils.degToRad(parseFloat(rollOffsetInput.value) || 0);
                cube.rotation.x = cubeHUDTiltRadians + pitchOffsetRadians;
                cube.rotation.y = cubeHUDLayout.yawRadians + yawOffsetRadians;
                cube.rotation.z = rollOffsetRadians;
            };
            pitchOffsetInput.addEventListener("input", applyTuning);
            yawOffsetInput.addEventListener("input", applyTuning);
            rollOffsetInput.addEventListener("input", applyTuning);

            const applyShear = () =>
            {
                if (!ensureCubeHUDShearHierarchy()) { return; }
                const shearXY = parseFloat(shearXYInput.value) || 0;
                const shearXZ = parseFloat(shearXZInput.value) || 0;
                const shearYX = parseFloat(shearYXInput.value) || 0;
                const shearYZ = parseFloat(shearYZInput.value) || 0;
                const shearZX = parseFloat(shearZXInput.value) || 0;
                const shearZY = parseFloat(shearZYInput.value) || 0;
                // All 6 terms combined into one matrix at once (each occupies its own,
                // non-overlapping off-diagonal cell, so they don't interact/compound —
                // this is NOT the same as chaining 6 separate shear matrices, which
                // would introduce quadratic cross-terms between them). x per y keeps
                // its established (negated) sign convention from before ("positive
                // leans top-left/bottom-right"); the other five are new and use the
                // plain target' = target + amount*source convention, since there's no
                // prior convention of theirs to preserve. THREE.Matrix4.set(...) takes
                // arguments in row-major order.
                cubeHUDShearWrapper.matrix.set(
                    1, -shearXY, shearXZ, 0,
                    shearYX, 1, shearYZ, 0,
                    shearZX, shearZY, 1, 0,
                    0, 0, 0, 1,
                );
            };
            shearXYInput.addEventListener("input", applyShear);
            shearXZInput.addEventListener("input", applyShear);
            shearYXInput.addEventListener("input", applyShear);
            shearYZInput.addEventListener("input", applyShear);
            shearZXInput.addEventListener("input", applyShear);
            shearZYInput.addEventListener("input", applyShear);

            // Presets found to look decent by eye (pitch, yaw, roll offsets in
            // degrees, plus all 6 shear directions), so we can jump straight back to
            // one instead of re-tuning by hand each time. Add more tuples here as more
            // are found. The first entry is a deliberate all-zero "reset" preset
            // (labeled "0", see the button label below); preset "2" predates the 6
            // shear inputs, so its shear values are all 0.0 — nothing to preserve,
            // since shear didn't exist yet when it was recorded.
            const cubeHUDTuningPresets = [
                { pitch: 0.0, yaw: 0.0, roll: 0.0, shearXY: 0.0, shearXZ: 0.0, shearYX: 0.0, shearYZ: 0.0, shearZX: 0.0, shearZY: 0.0 },
                { pitch: -15.5, yaw: -8.5, roll: 8.5, shearXY: 0.1, shearXZ: 0.15, shearYX: 0.0, shearYZ: 0.0, shearZX: 0.1, shearZY: 0.0 },
                { pitch: -4.5, yaw: -8.5, roll: -1, shearXY: 0.0, shearXZ: 0.0, shearYX: 0.0, shearYZ: 0.0, shearZX: 0.0, shearZY: 0.0 },
                { pitch: -16.5, yaw: -8, roll: 10.5, shearXY: 0.0, shearXZ: 0.0, shearYX: 0.0, shearYZ: 0.0, shearZX: 0.2, shearZY: 0.0 },
            ];

            const applyPreset = (preset) =>
            {
                pitchOffsetInput.value = preset.pitch;
                yawOffsetInput.value = preset.yaw;
                rollOffsetInput.value = preset.roll;
                shearXYInput.value = preset.shearXY;
                shearXZInput.value = preset.shearXZ;
                shearYXInput.value = preset.shearYX;
                shearYZInput.value = preset.shearYZ;
                shearZXInput.value = preset.shearZX;
                shearZYInput.value = preset.shearZY;
                applyTuning();
                applyShear();
            };

            // Preset "1" is the actual startup default now (not just an
            // all-zero resting state), matching the cubeHUDHorizontalAlignment
            // default (LEFT) above in spirit. applyTuning()/applyShear() inside
            // applyPreset() no-op until cubeHUD's mesh exists (its
            // methodInitialize() is async, so it isn't ready yet at this point
            // in init) - applyPreset() still sets the input values immediately
            // regardless, and this retries each frame until the cube exists to
            // actually apply the rotation/shear to it once, matching the same
            // "guard on the cube existing, retry" pattern as
            // ensureCubeHUDShearHierarchy() above.
            applyPreset(cubeHUDTuningPresets[1]);
            const applyDefaultPresetOnceCubeReady = () =>
            {
                if (componentCubeHUD.methodGetCube() == null)
                {
                    requestAnimationFrame(applyDefaultPresetOnceCubeReady);
                    return;
                }
                applyTuning();
                applyShear();
            };
            applyDefaultPresetOnceCubeReady();

            const presetsLabel = document.createElement("div");
            presetsLabel.style.marginTop = "4px";
            presetsLabel.textContent = "presets:";
            tuningContainer.appendChild(presetsLabel);

            const presetsRow = document.createElement("div");
            cubeHUDTuningPresets.forEach((preset, presetIndex) =>
            {
                const presetButton = document.createElement("button");
                presetButton.textContent = String(presetIndex); // 0-based: the new all-zero "reset" preset is index/label 0
                presetButton.title = `pitch ${preset.pitch}, yaw ${preset.yaw}, roll ${preset.roll}, `
                    + `shearXY ${preset.shearXY}, shearXZ ${preset.shearXZ}, shearYX ${preset.shearYX}, `
                    + `shearYZ ${preset.shearYZ}, shearZX ${preset.shearZX}, shearZY ${preset.shearZY}`;
                presetButton.addEventListener("click", () => applyPreset(preset));
                presetsRow.appendChild(presetButton);
            });
            tuningContainer.appendChild(presetsRow);

            // Cycles cubeHUDHorizontalAlignment live through all three states.
            const cubeHUDAlignmentCycle = [HUDCubeHorizontalAlignmentEnum.CENTER, HUDCubeHorizontalAlignmentEnum.LEFT, HUDCubeHorizontalAlignmentEnum.RIGHT];
            let cubeHUDAlignmentCycleIndex = Math.max(0, cubeHUDAlignmentCycle.indexOf(cubeHUDHorizontalAlignment));

            const alignmentButton = document.createElement("button");
            alignmentButton.style.display = "block";
            alignmentButton.style.marginTop = "4px";
            const updateAlignmentButtonLabel = () => { alignmentButton.textContent = `align: ${cubeHUDAlignmentCycle[cubeHUDAlignmentCycleIndex]}`; };
            updateAlignmentButtonLabel();
            alignmentButton.addEventListener("click", () =>
            {
                cubeHUDAlignmentCycleIndex = (cubeHUDAlignmentCycleIndex + 1) % cubeHUDAlignmentCycle.length;
                updateAlignmentButtonLabel();

                cubeHUDLayout = computeCubeHUDLayout(cubeHUDAlignmentCycle[cubeHUDAlignmentCycleIndex]);

                const plane = componentPanelHUD.methodGetPlane();
                if (plane != null) // component initialization is async and may not have finished yet
                {
                    plane.position.set(cubeHUDLayout.panelPositionOffset.x, cubeHUDLayout.panelPositionOffset.y, cubeHUDLayout.panelPositionOffset.z);
                    plane.geometry.dispose();
                    plane.geometry = new THREE.PlaneGeometry(cubeHUDLayout.panelSize.width, cubeHUDLayout.panelSize.height);
                }

                if (ensureCubeHUDShearHierarchy()) // same as above; also sets cube.position to (0,0,0), so position must go on cubeHUDOuterNode from here on
                {
                    cubeHUDOuterNode.position.set(cubeHUDLayout.positionOffset.x, cubeHUDLayout.positionOffset.y, cubeHUDLayout.positionOffset.z);
                }

                applyTuning(); // refreshes rotation using the new base yaw plus whatever pitch/yaw/roll offsets are already dialed in
                applyShear(); // shear wrapper survives reparenting untouched, but re-apply for consistency/safety
            });
            tuningContainer.appendChild(alignmentButton);

            // Reparent the PointerLock button (created fixed/centered at the bottom of the
            // screen by EntityComponentButtonPointerLock) into the expanded tuning panel.
            // methodInitialize() there is synchronous (unlike the cube/panel's async mesh
            // setup), so the button element already exists at this point — no readiness
            // guard needed. Its click handler and pointer-lock-state-driven show/hide
            // logic (methodOnPointerLockChange) are untouched; only its own inline
            // positioning styles are cleared so it flows in the panel like the other
            // buttons instead of staying fixed to the viewport.
            const pointerLockButtonElement = componentPointerLockButton.methodGetElementButton();
            pointerLockButtonElement.style.position = "static";
            pointerLockButtonElement.style.bottom = "";
            pointerLockButtonElement.style.left = "";
            pointerLockButtonElement.style.right = "";
            pointerLockButtonElement.style.marginTop = "4px";
            tuningContainer.appendChild(pointerLockButtonElement);

            document.body.appendChild(tuningContainer);
        }

        //
        // Kept lit like the world scene's "sun" via EntityComponentLightManager below
        // rather than hardcoded matching params — initial position/target here only
        // matter until the first methodUpdate() tick synchronizes them. sceneHUD has
        // nothing worth casting/receiving a shadow map, so castShadow is off here.
        const entityLightHUD = new Entity(null);
        entityManager.methodAddEntity(entityLightHUD, "hudSun");
        entityLightHUD.methodAddComponentWithName("EntityComponentDirectionalLight", new EntityComponentDirectionalLightHUD({position:new THREE.Vector3(5,8,5),target:new THREE.Vector3(0,0,0),castShadow:false,}));
        entityLightHUD.methodAddComponentWithName("EntityComponentLightManager", new EntityComponentLightManager({
            source:componentLightWorld,
            // sourceReferencePoint is no longer passed here - EntityComponentLightManager
            // now fetches the world camera itself via methodGetCamera() (EngineContext)
            targetReferencePoint:componentCubeHUD, // HUD cube: the same offset is re-applied from here
            // facing the sun head-on should fully light the HUD cube's near (camera-facing)
            // side, not its far side — see EntityComponentLightManager's field comment.
            reverseDirection:true,
        }));

        //
        // LAN multiplayer, phase 1 (see LAN_MULTIPLAYER_CONSIDERATIONS.md): the
        // manual one-time code UI, backed by a real PeerJS connection.
        // EntityComponentPeerConnectionUI reads the local code/connection state
        // from it via the usual sibling lookup and won't mount its DOM at all when
        // run inside a future native (Electron/Tauri) build.
        const entityMultiplayer = new Entity(null);
        entityManager.methodAddEntity(entityMultiplayer, "multiplayer");
        entityMultiplayer.methodAddComponentWithName("EntityComponentPeerConnection", new EntityComponentPeerConnection());
        entityMultiplayer.methodAddComponentWithName("EntityComponentPeerConnectionUI", new EntityComponentPeerConnectionUI());
        // Roster handshake so a newly-joined player converges to a full mesh
        // with everyone already in the session, not just the one peer whose
        // code they typed - see MULTIPLAYER_TOPOLOGY_AND_SYNC.md's
        // implementation plan. Registered before EntityComponentRemotePlayerManager
        // below on purpose: both read EntityComponentPeerConnection's
        // per-frame message snapshot, and that snapshot is only populated
        // once EntityComponentPeerConnection's own methodUpdate() has run
        // this frame, which registration order (not this line's position)
        // actually guarantees - see that component's methodUpdate() comment.
        entityMultiplayer.methodAddComponentWithName("EntityComponentPeerMeshFormation", new EntityComponentPeerMeshFormation());
        // Spawns/despawns a placeholder cube per connected remote player and
        // applies their incoming position/rotation updates - see
        // MULTIPLAYER_TOPOLOGY_AND_SYNC.md.
        entityMultiplayer.methodAddComponentWithName("EntityComponentRemotePlayerManager", new EntityComponentRemotePlayerManager({entityManager: entityManager, colorPaletteBody: playerColorPaletteBody, colorPaletteDither: playerColorPaletteDither,}));
    }

    //
    initBareMinimum();

    //
    initECS();
    initEngineContext();
    initEntityComponents();

    //
    update();
}

function update()
{
    // must be first
    requestAnimationFrame((t) => {
        update();
      });

    //
    clockTimeDelta = clock.getDelta();
    clockTimeElapsed = clock.getElapsedTime();

    // https://threejs.org/manual/#en/responsive
    updateWindowSize();

    //
    updateEntityComponentSystem();

    // must be last
    // autoClear is reset to true here every frame: the previous frame left it
    // false (below), so without this the world pass would silently stop
    // clearing color/depth from the 2nd frame onward and scene.background
    // would never actually get drawn - HUD_DEPTH_CLEARING.md's "the world
    // scene's initial implicit clear... via autoClear's default true" only
    // actually held for frame 1 before this fix. See TODO.md, item 4.
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.clearDepth(); // HUD always draws on top of `scene` — see HUD_DEPTH_CLEARING.md
    renderer.render(sceneHUD, cameraHUD);
}

function resizeRendererToMatchDisplaySize(renderer)
{
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
        renderer.setSize(width, height, false);
    }
    return needResize;
}

function updateWindowSize()
{
    if(resizeRendererToMatchDisplaySize(renderer))
    {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
        // cameraHUD
        cameraHUD.aspect = canvas.clientWidth / canvas.clientHeight;
        cameraHUD.updateProjectionMatrix();
    }
}

function updateEntityComponentSystem()
{
    entityManager.methodUpdate(clockTimeElapsed, clockTimeDelta);
}