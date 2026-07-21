// imports
// base
import {EntityComponent} from "../classes/ECS/entity_component.js";
import {Peer} from "peerjs";

// Owns the PeerJS connection lifecycle and the local "one-time code" (a short,
// human-typeable id registered with PeerJS's public broker). No DOM/UI of its
// own — EntityComponentPeerConnectionUI reads from this via the normal sibling
// component lookup. See LAN_MULTIPLAYER_CONSIDERATIONS.md, "Phase 1 plan: the
// one-time code UI", and DEPENDENCY_LOADING_CDN_VS_NPM.md's "Decision: PeerJS
// via npm" for why this is npm (`import {Peer} from "peerjs"`) rather than a
// CDN script tag.
//
// Holds a map of connections (peerId -> DataConnection) rather than a single
// connection, since a full-mesh session (see MULTIPLAYER_TOPOLOGY_AND_SYNC.md)
// means one player can end up directly connected to several others at once —
// this component only owns that transport, not mesh-formation policy or
// gameplay state, which belong in their own components per that doc.
export class EntityComponentPeerConnection extends EntityComponent
{
    // #region bare minimum

    #params = null;

    //
    #peer = null;
    #localId = null;
    #isOpen = false;

    //
    #connections = new Map(); // peerId -> DataConnection
    #connectionIsHost = new Map(); // peerId -> boolean
    #pendingMessages = []; // [{peerId, message}], written by conn.on('data', ...); moved into #messagesThisFrame once per frame by our own methodUpdate()
    #messagesThisFrame = []; // this frame's batch - read non-destructively by any number of sibling components (see methodGetMessagesThisFrame())

    // #endregion bare minimum

    // #region construct

    constructor(params)
    {
        super(params);
        this.#params = params;

        // A tab closing/refreshing/navigating away sends no WebRTC teardown
        // signal on its own, so the remote side's connection 'close' event
        // can go unfired for a long time (observed: still not fired 60s
        // later in testing) - explicitly destroying the peer here closes
        // every connection right away so the remote side's cube despawns
        // promptly. Registered once, in the constructor rather than
        // methodInitialize (which can re-run on an 'unavailable-id' retry -
        // see below), and reads `this.#peer` at actual unload time, not
        // registration time, so it always targets whichever peer is current.
        // This only covers a clean close/navigate, not a real crash or
        // network drop - see MULTIPLAYER_TOPOLOGY_AND_SYNC.md.
        window.addEventListener('beforeunload', () => {
            if(this.#peer != null){this.#peer.destroy();}
        });
    }

    // #endregion construct

    // #region lifecycle

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
            // someone connected to us using our own code - we're the host
            this.methodHandleConnection(conn, true);
        });
    }

    methodUpdate(timeElapsed, timeDelta)
    {
        // Drained exactly once per frame, here - not by whichever sibling
        // component happens to call a getter first. More than one sibling
        // now needs to see the same incoming messages each frame
        // (EntityComponentRemotePlayerManager for "identity"/"transform",
        // EntityComponentPeerMeshFormation for "roster"), so this has to be
        // a non-destructive snapshot they can all read, not a destructive
        // pull - the old methodDrainMessages() was exactly that, and would
        // have silently handed a whole frame's messages to whichever
        // consumer called it first, leaving the other with nothing. Relies
        // on this component being registered before its message-consuming
        // siblings on the same entity (see main.js's "multiplayer" entity),
        // since Entity.methodUpdate() runs components in registration
        // order (Object.entries() preserves string-key insertion order).
        this.#messagesThisFrame = this.#pendingMessages;
        this.#pendingMessages = [];
    }

    // #endregion lifecycle

    // #region getters

    methodGetLocalId(){return this.#localId;}
    methodGetIsOpen(){return this.#isOpen;}
    methodGetConnectionIds(){return Array.from(this.#connections.keys());}
    methodGetIsHostForId(peerId){return this.#connectionIsHost.get(peerId) === true;}

    // Convenience aggregates over the map, for the current 2-player UI (see
    // EntityComponentPeerConnectionUI) which only ever needs to reflect "the"
    // one connection. Once mesh formation (MULTIPLAYER_TOPOLOGY_AND_SYNC.md)
    // can produce more than one connection, showing per-connection state
    // properly is a UI change of its own, not something these two need to
    // solve - until then, "first" and "only" are the same connection.
    methodGetIsConnected(){return this.#connections.size > 0;}
    methodGetIsHost()
    {
        const firstId = this.#connections.keys().next().value;
        if(firstId == null){return false;}
        return this.methodGetIsHostForId(firstId);
    }

    // #endregion getters

    // #region actions

    methodConnectToRemoteId(remoteId)
    {
        if(this.#peer == null){return;}
        if(this.#connections.has(remoteId)){return;} // already connected
        const conn = this.#peer.connect(remoteId);
        // we typed someone else's code and initiated - we're the client
        this.methodHandleConnection(conn, false);
    }

    methodSendToId(peerId, message)
    {
        const conn = this.#connections.get(peerId);
        if(conn == null){return;}
        conn.send(message);
    }

    methodSendToAll(message)
    {
        for(const conn of this.#connections.values())
        {
            conn.send(message);
        }
    }

    // Returns this frame's batch of received messages, across all
    // connections - the same array for every caller this frame, safe for
    // any number of sibling components to read (see methodUpdate() above
    // for why this must be non-destructive).
    methodGetMessagesThisFrame()
    {
        return this.#messagesThisFrame;
    }

    // #endregion actions

    // #region internal helpers

    methodGenerateShortId()
    {
        // short, human-typeable: 4 digits
        return String(Math.floor(1000 + Math.random() * 9000));
    }

    methodHandleConnection(conn, isHost)
    {
        conn.on('open', () => {
            console.log("EntityComponentPeerConnection: connected to", conn.peer);
            this.#connections.set(conn.peer, conn);
            this.#connectionIsHost.set(conn.peer, isHost);
        });
        conn.on('data', (data) => {
            this.#pendingMessages.push({peerId: conn.peer, message: data});
        });
        conn.on('close', () => {
            this.#connections.delete(conn.peer);
            this.#connectionIsHost.delete(conn.peer);
        });
    }

    // #endregion internal helpers
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
//
// The code-entry input/Connect button have their own collapse/expand toggle
// (a `^` button collapses them; a `v` button, shown only while collapsed,
// expands them again) - two separate, single-purpose buttons rather than one
// button swapping its own label/handler, mirroring the cubeHUD tuning
// panel's existing v/^ mechanic in main.js (see
// MULTIPLAYER_TOPOLOGY_AND_SYNC.md's "Implementation plan: mesh formation,"
// sub-step 7, for the full reasoning). The panel auto-collapses the moment
// this player makes their first connection, but only once - after that it's
// just a manual toggle, so more players can still be invited later by
// expanding it again, rather than the old behavior of hiding the code-entry
// UI for good the instant any connection existed.
export class EntityComponentPeerConnectionUI extends EntityComponent
{
    // #region bare minimum

    #params = null;

    //
    #elementContainer = null;
    #elementLocalIdLabel = null;
    #elementRemoteIdInput = null;
    #elementConnectButton = null;
    #elementCollapseButton = null;
    #elementExpandButton = null;
    #elementConnectionCountIndicator = null;
    #hasDisplayedCode = false;

    //
    #isExpanded = true; // default: input/button/^ visible, v hidden
    #hasAutoCollapsedOnConnect = false;

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
        this.#elementCollapseButton = document.createElement("button");
        this.#elementCollapseButton.textContent = "^";
        this.#elementCollapseButton.style.marginLeft = "4px";
        this.#elementCollapseButton.addEventListener("click", () => { this.#isExpanded = false; });
        this.#elementContainer.appendChild(this.#elementCollapseButton);

        //
        this.#elementExpandButton = document.createElement("button");
        this.#elementExpandButton.textContent = "v";
        this.#elementExpandButton.style.display = "none"; // starts expanded, so nothing to expand from yet
        this.#elementExpandButton.addEventListener("click", () => { this.#isExpanded = true; });
        this.#elementContainer.appendChild(this.#elementExpandButton);

        //
        this.#elementConnectionCountIndicator = document.createElement("span");
        this.#elementConnectionCountIndicator.style.color = "limegreen";
        this.#elementConnectionCountIndicator.style.fontSize = "16px";
        this.#elementConnectionCountIndicator.style.fontWeight = "bold";
        this.#elementConnectionCountIndicator.style.marginLeft = "4px";
        this.#elementConnectionCountIndicator.style.display = "none";
        this.#elementContainer.appendChild(this.#elementConnectionCountIndicator);

        //
        document.body.appendChild(this.#elementContainer);
    }

    methodUpdate(timeElapsed, timeDelta)
    {
        // early return: not mounted (native shell)
        if(this.#elementLocalIdLabel == null){return;}

        //
        const componentPeerConnection = this.methodGetComponent("EntityComponentPeerConnection");
        if(componentPeerConnection == null){return;}

        //
        if(!this.#hasDisplayedCode && componentPeerConnection.methodGetIsOpen())
        {
            this.#elementLocalIdLabel.innerText = "your code: " + componentPeerConnection.methodGetLocalId();
            this.#hasDisplayedCode = true;
        }

        //
        const connectionCount = componentPeerConnection.methodGetConnectionIds().length;
        const isConnected = connectionCount > 0;
        const isHost = componentPeerConnection.methodGetIsHost();

        // Auto-collapse the join UI the first time this player connects to
        // anyone - once, not every frame, so a manual re-expand afterward
        // (to invite more players) isn't immediately fought and snapped back
        // shut on the very next frame.
        if(isConnected && !this.#hasAutoCollapsedOnConnect)
        {
            this.#isExpanded = false;
            this.#hasAutoCollapsedOnConnect = true;
        }

        this.#elementRemoteIdInput.style.display = this.#isExpanded ? "" : "none";
        this.#elementConnectButton.style.display = this.#isExpanded ? "" : "none";
        this.#elementCollapseButton.style.display = this.#isExpanded ? "" : "none";
        this.#elementExpandButton.style.display = this.#isExpanded ? "none" : "";

        // Connection-count indicator: independent of expand/collapse state
        // (same as the checkmark it replaces, which was always shown once
        // connected regardless of anything else) - a circled-digit character
        // (①, ②, ③, ...) matching the current connection count, re-evaluated
        // every frame so it updates live as players join or leave, unlike the
        // old checkmark's fixed two-state flip. Unicode U+2460 upward is
        // consecutive per digit, so this covers 1-10 with no lookup table;
        // clamped defensively even though this project's target is ~6 players.
        if(isConnected)
        {
            const clampedCount = Math.min(connectionCount, 10);
            this.#elementConnectionCountIndicator.textContent = String.fromCodePoint(0x2460 + clampedCount - 1);
        }
        this.#elementConnectionCountIndicator.style.display = isConnected ? "inline" : "none";

        // The host (the one whose code was used to connect) keeps its own
        // code visible; the client (the one who typed a code in) doesn't need
        // to show its own code to anyone, so it's hidden.
        this.#elementLocalIdLabel.style.display = (isConnected && !isHost) ? "none" : "";
    }

    // #endregion lifecycle

    // #region handlers

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

    // #endregion handlers
}
