// imports
// base
import * as THREE from "three";
// ECS
import {EntityComponent} from "../classes/ECS/entity_component.js";
import { createFractalMaterialFromSources, loadFractalShaderSources } from "../shaders/Simple_FractalDithering.js";

// Shader source and texture caching (see SHADER_SOURCE_AND_TEXTURE_CACHING.md):
// every EntityComponentTestCube instance - world cubes, ground, cubeHUD, and
// remote-player cubes spawned mid-session over PeerJS - needs the same shader
// source text and (at most two) texture files, regardless of its own
// shape/color1/color2, which are runtime uniforms, not baked into that text.
// Memoizing the in-flight Promise (not just the resolved value) means
// several cubes initializing around the same time share one fetch/decode
// instead of each kicking off their own.
let cachedShaderSourcesPromise = null;
function getCachedShaderSources()
{
    if(cachedShaderSourcesPromise == null)
    {
        cachedShaderSourcesPromise = loadFractalShaderSources();
    }
    return cachedShaderSourcesPromise;
}

const cachedTexturePromises = new Map(); // textureFile -> Promise<THREE.Texture>
function getCachedTexture(textureFile)
{
    if(!cachedTexturePromises.has(textureFile))
    {
        const loader = new THREE.TextureLoader();
        // Resolve texture URL via import.meta.url so Vite will include the asset
        // in the build output. This works in dev and in the production build.
        // Vite only statically bundles `new URL(literal, import.meta.url)` asset
        // references for production builds, so each known texture file needs its
        // own literal branch here rather than a dynamically-built path.
        let texUrl;
        try {
            texUrl = textureFile === 'texture_checkerboard_alphamask.png'
                ? new URL('../textures/texture_checkerboard_alphamask.png', import.meta.url).href
                : new URL('../textures/texture_checkerboard.png', import.meta.url).href;
        } catch (e) {
            // Fallback: use path relative to server root
            texUrl = 'textures/' + textureFile;
        }
        cachedTexturePromises.set(textureFile, new Promise((res, rej) => loader.load(texUrl, res, undefined, rej)));
    }
    return cachedTexturePromises.get(textureFile);
}

//
export class EntityComponentTestCube extends EntityComponent
{
    // #region bare minimum

    #params = null;

    //
    #cube = null;
    #positionOffset = { x: 0, y: 0, z: 0 };
    #size = { x: 1, y: 1, z: 1 };
    #spin = true;
    #lighting = false;
    #debugNormals = false;
    #color1 = null;
    #color2 = null;
    #color1Texture = false;
    #color2BlendTexture = false;
    #textureFile = 'texture_checkerboard.png';
    #shape = 0; // 0=circle,1=square,2=rhombus,3=pentagon,4=hexagon,5=octagon,6=star,7=moon,8=heart,9=cools

    //
    #nameLastLetterAsInt = null;

    // #endregion bare minimum

    // #region construct

    constructor(params)
    {
        super(params);
        this.#params = params;

        //
        if(params.positionOffset != null)
        {
            this.#positionOffset = params.positionOffset;
        }
        if(params.size != null)
        {
            this.#size = params.size;
        }
        if(params.spin != null)
        {
            this.#spin = params.spin;
        }
        if(params.lighting != null)
        {
            this.#lighting = params.lighting;
        }
        if(params.debugNormals != null)
        {
            this.#debugNormals = params.debugNormals;
        }
        if(params.color1 != null)
        {
            this.#color1 = params.color1;
        }
        if(params.color2 != null)
        {
            this.#color2 = params.color2;
        }
        if(params.color1Texture != null)
        {
            this.#color1Texture = params.color1Texture;
        }
        if(params.color2BlendTexture != null)
        {
            this.#color2BlendTexture = params.color2BlendTexture;
        }
        if(params.textureFile != null)
        {
            this.#textureFile = params.textureFile;
        }
        if(params.shape != null)
        {
            this.#shape = params.shape;
        }
    }

    // #endregion construct

     // #region lifecycle

    async methodInitialize()
    {
        //
        const name = this.methodGetName();
        const nameLastLetter = name.charAt(name.length - 1);
        this.#nameLastLetterAsInt = nameLastLetter.charCodeAt(0);

        //
            const geometry = new THREE.BoxGeometry( this.#size.x, this.#size.y, this.#size.z );

            // Shared across every EntityComponentTestCube instance requesting
            // the same texture file / the shader source - see
            // SHADER_SOURCE_AND_TEXTURE_CACHING.md for why this doesn't cost
            // this cube any of its own shape/color1/color2 customization: the
            // material below is still built fresh, per instance, from these
            // shared inputs.
            const texture = await getCachedTexture(this.#textureFile);
            const { vertexShader, fragmentShader } = await getCachedShaderSources();

            const material = createFractalMaterialFromSources(vertexShader, fragmentShader, { map: texture, level: 3, shape: this.methodGetShape(), lighting: this.#lighting, debugNormals: this.#debugNormals, color1: this.methodGetColor1(), color2: this.methodGetColor2(), color1Texture: this.#color1Texture, color2BlendTexture: this.#color2BlendTexture });

            this.#cube = new THREE.Mesh(geometry, material);
            this.#cube.castShadow = true;
            this.#cube.receiveShadow = true;
            this.methodGetTargetScene().add(this.#cube);

            this.#cube.position.x += this.#positionOffset.x;
            this.#cube.position.y += this.#positionOffset.y;
            this.#cube.position.z += this.#positionOffset.z;

            this.methodRegisterMessageHandlerWithinEntity('update.position', (paramMessage) =>{ this.methodHandleUpdatePosition(paramMessage); });

    }

    methodUpdate(timeElapsed, timeDelta)
    {
        // early return
        if (this.#cube == null) { return; }
        if (!this.#spin) { return; }

        //
        this.#cube.rotation.y += timeDelta * (this.#nameLastLetterAsInt % 2 == 0 ? 1 : -1);
    }

    // #endregion lifecycle

    // #region getters

    methodGetCube(){return this.#cube;}

    // #endregion getters

    // #region overridable hook methods

    // Which scene this cube's mesh belongs in - defaults to the world scene.
    // EntityComponentTestCube is reused for both world cubes (ground, the
    // sun's cube) and cubeHUD, and those need different scenes - overridden
    // by EntityComponentTestCubeHUD below rather than passed as a
    // constructor param, so each subclass states which scene it belongs to
    // once, structurally, instead of every instantiation having to say so.
    // See BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md.
    methodGetTargetScene()
    {
        return this.methodGetScene();
    }

    // Shape/color1/color2 - overridden by EntityComponentTestCubeHUD to
    // resolve the local player's identity instead of reading the raw
    // constructor params. Same reasoning as methodGetTargetScene() above:
    // a reused class exposes an overridable hook rather than baking
    // one-specific-consumer's data source into itself. See
    // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md's "Player-identity hooks on
    // EntityComponentTestCube" section.
    methodGetShape()
    {
        return this.#shape;
    }

    methodGetColor1()
    {
        return this.#color1;
    }

    methodGetColor2()
    {
        return this.#color2;
    }

    // #endregion overridable hook methods

    // #region handlers

    methodHandleUpdatePosition(paramMessage)
    {
        this.#cube.position.copy(paramMessage.invokableHandlerValue);
    }

    // #endregion handlers
}

//
export class EntityComponentTestCubeHUD extends EntityComponentTestCube
{
    #positionOffsetY = 0;
    #tiltFactor = 0;
    #yawRadians = 0;

    // EntityComponentTestCubeHUD has exactly one instantiation in the whole
    // codebase - cubeHUD, always representing the local player - so the
    // self-lookup lives directly here rather than in a separate
    // EntityComponentTestCubePlayer superclass. See
    // BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md's "Player-identity hooks on
    // EntityComponentTestCube" section for the fuller reasoning.
    #componentLocalPlayerIdentity = null;

    // #region construct

    constructor(params)
    {
        super(params);

        //
        if(params.positionOffset != null && params.positionOffset.y != null)
        {
            this.#positionOffsetY = params.positionOffset.y;
        }
        if(params.tiltFactor != null)
        {
            this.#tiltFactor = params.tiltFactor;
        }
        if(params.yawRadians != null)
        {
            this.#yawRadians = params.yawRadians;
        }
    }

    // #endregion construct

    // #region overridable hook methods

    // cubeHUD lives in sceneHUD, not the world scene - see
    // EntityComponentTestCube.methodGetTargetScene()'s comment.
    methodGetTargetScene()
    {
        return this.methodGetSceneHUD();
    }

    // Resolved from the cross-entity EntityComponentContextLocalPlayerIdentity
    // (self-looked-up in methodInitialize() below) instead of from
    // constructor params - see the class-level comment above.
    methodGetShape()
    {
        return this.#componentLocalPlayerIdentity.methodGetShapeIndex();
    }

    methodGetColor1()
    {
        return this.#componentLocalPlayerIdentity.methodGetColor1();
    }

    methodGetColor2()
    {
        return this.#componentLocalPlayerIdentity.methodGetColor2();
    }

    // #endregion overridable hook methods

     // #region lifecycle

    async methodInitialize()
    {
        // Resolved before super.methodInitialize() runs, since that's what
        // reads methodGetShape()/methodGetColor1()/methodGetColor2() to
        // build the material.
        this.#componentLocalPlayerIdentity = this.methodGetEntityByName("LocalPlayerIdentity")?.methodGetComponent("EntityComponentContextLocalPlayerIdentity");

        await super.methodInitialize();

        // Crude approximation of "face the camera": rather than an exact lookAt (which
        // aims at the camera's single point rather than the frustum ray through this
        // spot), just tilt down proportionally to how far below center it sits.
        this.methodGetCube().rotation.x += this.#positionOffsetY * this.#tiltFactor;

        // Unlike the vertical tilt above, this yaw IS an exact lookAt-derived
        // correction (computed in main.js via THREE.Object3D.lookAt against
        // cameraHUD's real position, not a proportional approximation) — it undoes
        // the perspective skew a horizontally off-center cubeHUD would otherwise show
        // under cameraHUD's wide FOV. Deliberately makes rotation.y non-zero, i.e. no
        // longer parallel to cameraHUD's forward axis: that tradeoff (skew-free look
        // vs. literal parallel-to-camera facing) is intentional — see
        // HUD_PANEL_CUBE_FITTING.md.
        this.methodGetCube().rotation.y += this.#yawRadians;
    }

    // #endregion lifecycle
}

//
export class EntityComponentBackgroundPlane extends EntityComponent
{
    // #region bare minimum

    #params = null;

    //
    #plane = null;
    #positionOffset = { x: 0, y: 0, z: 0 };
    #size = { width: 2.5, height: 2.5 };
    #color = 0x87ceeb; // sky blue
    #textureFile = null;

    // #endregion bare minimum

    // #region construct

    constructor(params)
    {
        super(params);
        this.#params = params;

        //
        if(params.positionOffset != null)
        {
            this.#positionOffset = params.positionOffset;
        }
        if(params.size != null)
        {
            this.#size = params.size;
        }
        if(params.color != null)
        {
            this.#color = params.color;
        }
        if(params.textureFile != null)
        {
            this.#textureFile = params.textureFile;
        }
    }

    // #endregion construct

    // #region lifecycle

    async methodInitialize()
    {
        //
        const geometry = new THREE.PlaneGeometry(this.#size.width, this.#size.height);

        // unlit flat color/texture: this plane is meant as a static backdrop,
        // and the scene it's used in (sceneHUD) has no lights anyway.
        var texture = null;
        if(this.#textureFile != null)
        {
            const loader = new THREE.TextureLoader();
            // Vite only statically bundles `new URL(literal, import.meta.url)` asset
            // references at build time, so each known texture file needs its own
            // literal branch here rather than a dynamically-built path (see
            // DEPLOY_GITHUB_PAGES.md and EntityComponentTestCube).
            let texUrl;
            try {
                texUrl = this.#textureFile === 'texture_checkerboard_alphamask.png'
                    ? new URL('../textures/texture_checkerboard_alphamask.png', import.meta.url).href
                    : this.#textureFile === 'texture_checkerboard.png'
                    ? new URL('../textures/texture_checkerboard.png', import.meta.url).href
                    : new URL('../textures/texture.png', import.meta.url).href;
            } catch (e) {
                texUrl = 'textures/' + this.#textureFile;
            }
            texture = await new Promise((res, rej) => loader.load(texUrl, res, undefined, rej));
        }

        //
        const material = new THREE.MeshBasicMaterial({
            color: this.#color,
            map: texture,
        });

        //
        this.#plane = new THREE.Mesh(geometry, material);
        // Always the HUD panel behind cubeHUD - unlike EntityComponentTestCube,
        // this class has exactly one instantiation in the whole codebase, so
        // there's no reused-class ambiguity to route around via an overridable
        // hook - see BARE_MINIMUM_THREEJS_EXCEPTION_OR_NOT.md.
        this.methodGetSceneHUD().add(this.#plane);

        this.#plane.position.x += this.#positionOffset.x;
        this.#plane.position.y += this.#positionOffset.y;
        this.#plane.position.z += this.#positionOffset.z;

        this.methodRegisterMessageHandlerWithinEntity('update.position', (paramMessage) => { this.methodHandleUpdatePosition(paramMessage); });
    }

    methodUpdate(timeElapsed, timeDelta)
    {
    }

    // #endregion lifecycle

    // #region getters

    methodGetPlane(){return this.#plane;}

    // #endregion getters

    // #region handlers

    methodHandleUpdatePosition(paramMessage)
    {
        this.#plane.position.copy(paramMessage.invokableHandlerValue);
    }

    // #endregion handlers
}

//
export class EntityComponentButtonPointerLock extends EntityComponent
{
    // #region bare minimum

    #params = null;

    //
    #elementButton = null;
    #isVisibleButton = true;

    // #endregion bare minimum

    // #region construct

    constructor(params)
    {
        super(params);
        this.#params = params;
    }

    // #endregion construct

     // #region lifecycle

    methodInitialize()
    {
        //
        this.#params.document.addEventListener("pointerlockchange", this.methodOnPointerLockChange.bind(this), false);
        this.#params.document.addEventListener("pointerlockerror", this.methodOnPointerLockError.bind(this), false);

        //
        this.#elementButton = this.#params.document.createElement("button");
        this.#elementButton.innerText = "PointerLock";
        this.#elementButton.style.position = "fixed";
        this.#elementButton.style.bottom = "0";
        this.#elementButton.style.left = "calc(50% - 45px)";
        this.#elementButton.style.right = "calc(50% - 45px)";
        this.#elementButton.style.width = "90px";
        this.#elementButton.style.fontSize = "11px";
        this.#elementButton.addEventListener("click", ((e) => this.methodOnClickButton(e)));
        this.#params.document.body.appendChild(this.#elementButton);
    }

    methodUpdate(timeElapsed, timeDelta)
    {
    }

    //

    methodGetElementButton()
    {
        return this.#elementButton;
    }

    async methodOnClickButton(e)
    {
        await this.methodGetRenderer().domElement.requestPointerLock();
    }

    methodOnPointerLockChange(e)
    {
        //
        const res = this.methodGetIsPointerLocked();
        if(!res)
        {
            this.#isVisibleButton = true;
            this.#elementButton.style.display = "block";
        }
        else {
            this.#isVisibleButton = false;
            this.#elementButton.style.display = "none";
        }
    }
    methodOnPointerLockError(e)
    {
        
    }

    methodGetIsPointerLocked()
    {
        const res = (this.#params.document.pointerLockElement == null || this.#params.document.pointerLockElement == undefined || this.#params.document.pointerLockElement !== this.methodGetRenderer().domElement);

        return !res;
    }

    // #endregion lifecycle
}
