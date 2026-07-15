// imports
// base
import {EntityComponent} from "../classes/ECS/entity_component.js";
// PeerJS is not yet a project dependency. Once it's added for real, this file
// would need something like `import { Peer } from "peerjs";` (or a CDN
// script-tag global, matching how this project currently loads Three.js) — see
// LAN_MULTIPLAYER_CONSIDERATIONS.md, "Phase 1 plan: the one-time code UI".

// Owns the PeerJS connection lifecycle and the local "one-time code" (a short,
// human-typeable id registered with PeerJS's public broker). No DOM/UI of its
// own — EntityComponentPeerConnectionUI reads from this via the normal sibling
// component lookup.
//
// The real implementation is written out below but commented out, since PeerJS
// isn't wired up yet; a fake id is used in its place so
// EntityComponentPeerConnectionUI can be built and tested without any real
// networking.
export class EntityComponentPeerConnection extends EntityComponent
{
    // bare minimum
    #params = null;

    //
    #localId = null;
    #isOpen = false;

    // construct
    constructor(params)
    {
        super(params);
        this.#params = params;
    }

    // lifecycle

    /*
    // Real implementation (commented out until PeerJS is added as a project
    // dependency and actually wired up). Would need one more field declared
    // alongside #localId/#isOpen above:
    //     #peer = null;

    methodInitialize()
    {
        this.#peer = new Peer(this.methodGenerateShortId());

        this.#peer.on('open', (id) => {
            this.#localId = id;
            this.#isOpen = true;
        });

        this.#peer.on('error', (err) => {
            // PeerJS's public broker is one global namespace shared by everyone
            // using it (not scoped to a LAN at all), so a short id can collide
            // with someone else's in-progress session - retry with a new one.
            if(err.type === 'unavailable-id')
            {
                this.#peer.destroy();
                this.methodInitialize();
                return;
            }
            console.error("EntityComponentPeerConnection error:", err);
        });

        this.#peer.on('connection', (conn) => {
            this.methodHandleConnection(conn);
        });
    }

    methodGenerateShortId()
    {
        // short, human-typeable: 4 digits
        return String(Math.floor(1000 + Math.random() * 9000));
    }

    methodConnectToRemoteId(remoteId)
    {
        if(this.#peer == null){return;}
        const conn = this.#peer.connect(remoteId);
        this.methodHandleConnection(conn);
    }

    methodHandleConnection(conn)
    {
        conn.on('open', () => {
            console.log("EntityComponentPeerConnection: connected to", conn.peer);
        });
        conn.on('data', (data) => {
            console.log("EntityComponentPeerConnection: received data:", data);
        });
    }
    */

    methodInitialize()
    {
        // TEMP: fake id/connection state, no real PeerJS wiring yet. Swap this
        // out for the commented-out real implementation above once PeerJS is
        // added as a project dependency.
        this.#localId = "TEST1234";
        this.#isOpen = true;
    }

    methodUpdate(timeElapsed, timeDelta)
    {
    }

    // getters

    methodGetLocalId(){return this.#localId;}
    methodGetIsOpen(){return this.#isOpen;}

    // actions

    methodConnectToRemoteId(remoteId)
    {
        // TEMP: no real connection yet; see the commented-out real
        // implementation above.
        console.log("EntityComponentPeerConnection: would connect to remote id:", remoteId);
    }
}

// Owns the plain-DOM one-time-code UI: a label showing the local code, and an
// input + button for entering the other player's code. Reads from
// EntityComponentPeerConnection (expected on the same entity) rather than
// owning a connection itself - mirrors how EntityComponentButtonPointerLock
// (entity components/test_objects.js) builds its own plain DOM button.
//
// Browser-only: this is specifically the "manual one-time code" strategy for
// the plain web version. Once a native Electron/Tauri build with real
// socket-based discovery exists, there is nothing to type/show, so this
// component must not mount its UI there at all - detected once at
// methodInitialize() via the presence of a native bridge global, not toggled
// via CSS on an otherwise-active component.
export class EntityComponentPeerConnectionUI extends EntityComponent
{
    // bare minimum
    #params = null;

    //
    #elementContainer = null;
    #elementLocalIdLabel = null;
    #elementRemoteIdInput = null;
    #elementConnectButton = null;
    #hasDisplayedCode = false;

    // construct
    constructor(params)
    {
        super(params);
        this.#params = params;
    }

    // lifecycle

    methodInitialize()
    {
        // early return: running inside a future native (Electron/Tauri) shell,
        // which will use real socket discovery instead - nothing to show here.
        const isRunningInsideNativeShell = (typeof window !== 'undefined') && (window.electronAPI != null || window.__TAURI__ != null);
        if(isRunningInsideNativeShell){return;}

        //
        this.#elementContainer = document.createElement("div");
        this.#elementContainer.style.position = "fixed";
        this.#elementContainer.style.top = "0";
        this.#elementContainer.style.left = "0";
        this.#elementContainer.style.padding = "6px 10px";
        this.#elementContainer.style.fontSize = "12px";
        this.#elementContainer.style.fontFamily = "sans-serif";
        this.#elementContainer.style.background = "rgba(0,0,0,0.5)";
        this.#elementContainer.style.color = "white";
        this.#elementContainer.style.zIndex = "10";

        //
        this.#elementLocalIdLabel = document.createElement("div");
        this.#elementLocalIdLabel.innerText = "connecting...";
        this.#elementContainer.appendChild(this.#elementLocalIdLabel);

        //
        this.#elementRemoteIdInput = document.createElement("input");
        this.#elementRemoteIdInput.type = "text";
        this.#elementRemoteIdInput.placeholder = "other player's code";
        this.#elementRemoteIdInput.style.marginTop = "4px";
        this.#elementRemoteIdInput.style.width = "120px";
        this.#elementContainer.appendChild(this.#elementRemoteIdInput);

        //
        this.#elementConnectButton = document.createElement("button");
        this.#elementConnectButton.innerText = "Connect";
        this.#elementConnectButton.style.marginLeft = "4px";
        this.#elementConnectButton.addEventListener("click", () => this.methodOnClickConnect());
        this.#elementContainer.appendChild(this.#elementConnectButton);

        //
        document.body.appendChild(this.#elementContainer);
    }

    methodUpdate(timeElapsed, timeDelta)
    {
        // early return: not mounted (native shell), or already displayed
        if(this.#elementLocalIdLabel == null){return;}
        if(this.#hasDisplayedCode){return;}

        //
        const componentPeerConnection = this.methodGetComponent("EntityComponentPeerConnection");
        if(componentPeerConnection == null){return;}

        //
        if(componentPeerConnection.methodGetIsOpen())
        {
            this.#elementLocalIdLabel.innerText = "your code: " + componentPeerConnection.methodGetLocalId();
            this.#hasDisplayedCode = true;
        }
    }

    // handlers

    methodOnClickConnect()
    {
        //
        const componentPeerConnection = this.methodGetComponent("EntityComponentPeerConnection");
        if(componentPeerConnection == null){return;}

        //
        const remoteId = this.#elementRemoteIdInput.value.trim();
        if(remoteId === ""){return;}

        //
        componentPeerConnection.methodConnectToRemoteId(remoteId);
    }
}
