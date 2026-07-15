// imports
// base
import * as THREE from "three";
// ECS
import {EntityComponent} from "../classes/ECS/entity_component.js";
import { createFractalMaterial, createFractalMaterialFromSources } from "../shaders/Simple_FractalDithering.js";
// Removed Vite `?raw` static imports to avoid MIME/type module errors on
// GitHub Pages. Shaders will be loaded at runtime via fetch as a safe fallback.
// When a bundler inlines sources, `createFractalMaterialFromSources` can still
// be used by passing explicit sources. For portability, we initialize these
// to null so the runtime-fetch path is used by default.
let vertSource = null;
let fragSource = null;

//
export class EntityComponentTestCube extends EntityComponent
{
    // bare minimum
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

    // construct
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

     // lifecycle

    async methodInitialize()
    {
        //
        const name = this.methodGetName();
        const nameLastLetter = name.charAt(name.length - 1);
        this.#nameLastLetterAsInt = nameLastLetter.charCodeAt(0);

        //
            const geometry = new THREE.BoxGeometry( this.#size.x, this.#size.y, this.#size.z );

            const loader = new THREE.TextureLoader();
            // Resolve texture URL via import.meta.url so Vite will include the asset
            // in the build output. This works in dev and in the production build.
            // Vite only statically bundles `new URL(literal, import.meta.url)` asset
            // references for production builds, so each known texture file needs its
            // own literal branch here rather than a dynamically-built path.
            let texUrl;
            try {
                texUrl = this.#textureFile === 'texture_checkerboard_alphamask.png'
                    ? new URL('../textures/texture_checkerboard_alphamask.png', import.meta.url).href
                    : new URL('../textures/texture_checkerboard.png', import.meta.url).href;
            } catch (e) {
                // Fallback: use path relative to server root
                texUrl = 'textures/' + this.#textureFile;
            }
            const texture = await new Promise((res, rej) => loader.load(texUrl, res, undefined, rej));

            // Prefer bundler raw imports (Vite: ?raw) to avoid runtime fetches.
            // However, built output may sometimes emit shader assets instead of inlining
            // the raw strings. Detect that case and fall back to the runtime-fetching
            // factory if the imported sources are not plain strings.
            let material;
            try {
                const isVertString = typeof vertSource === 'string';
                const isFragString = typeof fragSource === 'string';

                // Heuristic: if the imported string looks like actual GLSL source (contains newlines
                // or shader keywords) treat it as source. If it looks like a URL/path (no newlines,
                // short, or ends with .vert/.frag), treat it as an asset URL and let the runtime fetch
                // loader load it from that URL.
                const looksLikeSource = (s) => typeof s === 'string' && (s.includes('\n') || s.includes('void main') || s.length > 500);

                if (isVertString && isFragString && looksLikeSource(vertSource) && looksLikeSource(fragSource)) {
                    // Inlined shader sources (dev or bundle-inlined)
                    material = createFractalMaterialFromSources(vertSource, fragSource, { map: texture, level: 3, shape: this.#shape, lighting: this.#lighting, debugNormals: this.#debugNormals, color1: this.#color1, color2: this.#color2, color1Texture: this.#color1Texture, color2BlendTexture: this.#color2BlendTexture });
                } else if (isVertString && isFragString) {
                    // Likely URLs emitted by the build. Use the runtime factory with explicit URLs.
                    material = await createFractalMaterial({ map: texture, level: 3, shape: this.#shape, lighting: this.#lighting, debugNormals: this.#debugNormals, color1: this.#color1, color2: this.#color2, color1Texture: this.#color1Texture, color2BlendTexture: this.#color2BlendTexture, vertUrl: vertSource, fragUrl: fragSource });
                } else {
                    // fallback: runtime fetch (works with any static server)
                    material = await createFractalMaterial({ map: texture, level: 3, shape: this.#shape, lighting: this.#lighting, debugNormals: this.#debugNormals, color1: this.#color1, color2: this.#color2, color1Texture: this.#color1Texture, color2BlendTexture: this.#color2BlendTexture });
                }
            } catch (err) {
                // If anything goes wrong, fall back to runtime-fetching factory.
                console.warn('Shader raw import failed or unavailable, using runtime fetch fallback.', err);
                material = await createFractalMaterial({ map: texture, level: 3, shape: this.#shape, lighting: this.#lighting, debugNormals: this.#debugNormals, color1: this.#color1, color2: this.#color2, color1Texture: this.#color1Texture, color2BlendTexture: this.#color2BlendTexture });
            }


            this.#cube = new THREE.Mesh(geometry, material);
            this.#cube.castShadow = true;
            this.#cube.receiveShadow = true;
            this.#params.scene.add(this.#cube);

            this.#cube.position.x += this.#positionOffset.x;
            this.#cube.position.y += this.#positionOffset.y;
            this.#cube.position.z += this.#positionOffset.z;

            this.methodRegisterInvokableHandler('update.position', (paramMessage) =>{ this.methodHandleUpdatePosition(paramMessage); });

    }

    methodUpdate(timeElapsed, timeDelta)
    {
        // early return
        if (this.#cube == null) { return; }
        if (!this.#spin) { return; }

        //
        this.#cube.rotation.y += timeDelta * (this.#nameLastLetterAsInt % 2 == 0 ? 1 : -1);
    }

    // getters

    methodGetCube(){return this.#cube;}

    // handlers

    methodHandleUpdatePosition(paramMessage)
    {
        this.#cube.position.copy(paramMessage.invokableHandlerValue);
    }
}

//
export class EntityComponentTestCubeHUD extends EntityComponentTestCube
{
    #positionOffsetY = 0;
    #tiltFactor = 0;

    // construct
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
    }

     // lifecycle

    async methodInitialize()
    {
        await super.methodInitialize();

        // Crude approximation of "face the camera": rather than an exact lookAt (which
        // aims at the camera's single point rather than the frustum ray through this
        // spot), just tilt down proportionally to how far below center it sits.
        this.methodGetCube().rotation.x += this.#positionOffsetY * this.#tiltFactor;
    }
}

//
export class EntityComponentBackgroundPlane extends EntityComponent
{
    // bare minimum
    #params = null;

    //
    #plane = null;
    #positionOffset = { x: 0, y: 0, z: 0 };
    #size = { width: 2.5, height: 2.5 };
    #color = 0x87ceeb; // sky blue
    #textureFile = null;

    // construct
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

    // lifecycle

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
        this.#params.scene.add(this.#plane);

        this.#plane.position.x += this.#positionOffset.x;
        this.#plane.position.y += this.#positionOffset.y;
        this.#plane.position.z += this.#positionOffset.z;

        this.methodRegisterInvokableHandler('update.position', (paramMessage) => { this.methodHandleUpdatePosition(paramMessage); });
    }

    methodUpdate(timeElapsed, timeDelta)
    {
    }

    // getters

    methodGetPlane(){return this.#plane;}

    // handlers

    methodHandleUpdatePosition(paramMessage)
    {
        this.#plane.position.copy(paramMessage.invokableHandlerValue);
    }
}

//
export class EntityComponentButtonPointerLock extends EntityComponent
{
    // bare minimum
    #params = null;

    //
    #elementButton = null;
    #isVisibleButton = true;

    // construct
    constructor(params)
    {
        super(params);
        this.#params = params;
    }

     // lifecycle

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

    async methodOnClickButton(e)
    {
        await this.#params.renderer.domElement.requestPointerLock();
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
        const res = (this.#params.document.pointerLockElement == null || this.#params.document.pointerLockElement == undefined || this.#params.document.pointerLockElement !== this.#params.renderer.domElement);

        return !res;
    }
}
