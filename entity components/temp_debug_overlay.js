// TEMPORARY - diagnosing the "can't turn camera while double-tap-walking"
// bug reported on real Android hardware (see INPUT_METHODS.md's "Native
// browser gesture recognizers compete with custom gesture detection"
// section and TODO.md item 13). Delete this whole file, and every
// debugOverlaySetLine() call site, once the bug is found and fixed - this
// exists purely to surface live internal touch state directly on-screen,
// since there's no way to attach a devtools console to the reporter's phone.

let elementOverlay = null;
const lines = new Map();

function ensureOverlay()
{
    if(elementOverlay != null){return elementOverlay;}

    elementOverlay = document.createElement("pre");
    elementOverlay.style.position = "fixed";
    elementOverlay.style.bottom = "0";
    elementOverlay.style.left = "0";
    elementOverlay.style.zIndex = "9999";
    elementOverlay.style.margin = "0";
    elementOverlay.style.padding = "4px 6px";
    elementOverlay.style.fontSize = "10px";
    elementOverlay.style.lineHeight = "1.3";
    elementOverlay.style.color = "#0f0";
    elementOverlay.style.background = "rgba(0,0,0,0.6)";
    elementOverlay.style.whiteSpace = "pre";
    elementOverlay.style.pointerEvents = "none"; // never intercepts touches meant for the game
    document.body.appendChild(elementOverlay);
    return elementOverlay;
}

export function debugOverlaySetLine(key, text)
{
    lines.set(key, text);
    const el = ensureOverlay();
    el.textContent = Array.from(lines.entries()).map(([k, v]) => `${k}: ${v}`).join("\n");
}
