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
import {EntityComponentLightManager} from "./entity components/lighting.js";
import {EntityComponentPeerConnection} from "./entity components/peer_connection.js";
import {EntityComponentPeerConnectionUI} from "./entity components/peer_connection.js";

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
    function initEntityComponents()
    {
        //
        console.log("init Entities");

        //
        const entityA = new Entity(null);
        entityManager.methodAddEntity(entityA, "player");
        //
        entityA.methodAddComponentWithName("EntityComponentCameraControllerFirstPerson", new EntityComponentCameraControllerFirstPerson({scene: scene, camera: camera, cameraPivot: cameraPivot,}));
        entityA.methodAddComponentWithName("EntityComponentCameraControllerFirstPersonInput", new EntityComponentCameraControllerFirstPersonInput());
        //
        entityA.methodAddComponentWithName("EntityComponentPlayerController", new EntityComponentPlayerController({cameraPivot: cameraPivot,}));
        entityA.methodAddComponentWithName("EntityComponentPlayerControllerInput", new EntityComponentPlayerControllerInput());

        entityA.methodSetPosition(new THREE.Vector3(0.0,0.0,5.0));
        //

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

        //
        const entityGround = new Entity(null);
        entityManager.methodAddEntity(entityGround, "ground");
        entityGround.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({scene:scene,name:"ground",lighting:true,spin:false,size:new THREE.Vector3(20,0.2,20),positionOffset:{x:0,y:-1.5,z:0},shape:6,}));

        //
        const entityLight = new Entity(null);
        entityManager.methodAddEntity(entityLight, "sun");
        const componentLightWorld = new EntityComponentDirectionalLight({scene:scene,position:new THREE.Vector3(5,8,5),target:new THREE.Vector3(0,0,0),});
        entityLight.methodAddComponentWithName("EntityComponentDirectionalLight", componentLightWorld);
        entityLight.methodAddComponentWithName("EntityComponentTestCube", new EntityComponentTestCube({scene:scene,name:"CubeG",lighting:true,positionOffset:{x:5,y:8,z:5},color1Texture:false,color2:0xffFF00,textureFile:'texture_checkerboard_alphamask.png',shape:5,}));

        //
        const entityC = new Entity(null);
        entityManager.methodAddEntity(entityC, "pointerLockButton");
        entityC.methodAddComponentWithName("EntityComponentButtonPointerLock", new EntityComponentButtonPointerLock({document:document,renderer:renderer,}));

        const entityD = new Entity(null);
        entityManager.methodAddEntity(entityD, "testEntityPositionOnly");
        entityD.methodSetPosition({x:-10,y:0,z:-10,});

        // sceneHUD

        const entityHUD = new Entity(null);
        entityManager.methodAddEntity(entityHUD, "hudPanel");
        entityHUD.methodAddComponentWithName("EntityComponentBackgroundPlane", new EntityComponentBackgroundPlane({scene:sceneHUD,
            positionOffset:{x:0.0,y:-1.5,z:-2.2},
        }));
        const componentCubeHUD = new EntityComponentTestCubeHUD({scene:sceneHUD,name:"model",
            positionOffset:{x:0.0,y:-1.5,z:-2.0},
            tiltFactor:0.265,
            spin:false,
            lighting:true,
            shape:7,
        });
        entityHUD.methodAddComponentWithName("EntityComponentTestCubeHUD", componentCubeHUD);

        //
        // Kept lit like the world scene's "sun" via EntityComponentLightManager below
        // rather than hardcoded matching params — initial position/target here only
        // matter until the first methodUpdate() tick synchronizes them. sceneHUD has
        // nothing worth casting/receiving a shadow map, so castShadow is off here.
        const entityLightHUD = new Entity(null);
        entityManager.methodAddEntity(entityLightHUD, "hudSun");
        entityLightHUD.methodAddComponentWithName("EntityComponentDirectionalLight", new EntityComponentDirectionalLight({scene:sceneHUD,position:new THREE.Vector3(5,8,5),target:new THREE.Vector3(0,0,0),castShadow:false,}));
        entityLightHUD.methodAddComponentWithName("EntityComponentLightManager", new EntityComponentLightManager({
            source:componentLightWorld,
            sourceReferencePoint:camera, // main scene camera: the sun's offset is measured from here
            targetReferencePoint:componentCubeHUD, // HUD cube: the same offset is re-applied from here
            // facing the sun head-on should fully light the HUD cube's near (camera-facing)
            // side, not its far side — see EntityComponentLightManager's field comment.
            reverseDirection:true,
        }));

        //
        // LAN multiplayer, phase 1 (see LAN_MULTIPLAYER_CONSIDERATIONS.md): the
        // manual one-time code UI. EntityComponentPeerConnection currently uses a
        // fake id/no real PeerJS connection; EntityComponentPeerConnectionUI reads
        // from it via the usual sibling lookup and won't mount its DOM at all when
        // run inside a future native (Electron/Tauri) build.
        const entityMultiplayer = new Entity(null);
        entityManager.methodAddEntity(entityMultiplayer, "multiplayer");
        entityMultiplayer.methodAddComponentWithName("EntityComponentPeerConnection", new EntityComponentPeerConnection());
        entityMultiplayer.methodAddComponentWithName("EntityComponentPeerConnectionUI", new EntityComponentPeerConnectionUI());
    }

    //
    initBareMinimum();

    //
    initECS();
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