// ---------- DOM ----------
const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const gallery = document.getElementById("gallery") as HTMLDivElement;

// ---------- State ----------
let previousFrame: ImageData | null = null;
let lastCaptureCanvas: HTMLCanvasElement | null = null;

// Debounce (for non-game actions if you re-enable them later)
const lastTriggerAt: Record<string, number> = {};
const COOLDOWN_MS = 600;

// Game settings
const GAME_MODE = true;
const ROUND_MS = 2000;   // player has 2 seconds
const FLASH_MS = 500;    // flash success/fail for 0.5s

let roundActive = false;
let roundEndsAt = 0;
let targetIndex = 0;         // which button is the target
let hitRecorded = false;     // did the player hit the correct target this round?

let flashingTarget: number | null = null;
let flashEndsAt = 0;
let flashColor: "success" | "fail" | null = null;

// ---------- Buttons (Top / Left / Right) ----------
const BUTTON_SIZE = 84;
const BUTTON_PADDING = 16;
const ROW_GAP = 12;
const BTN_COLOR = "rgba(220,220,220,0.32)";
const BTN_BORDER = "rgba(255,255,255,0.65)";
const BTN_RADIUS = 12;

type Side = "top" | "left" | "right";
type Button = {
    action: "capture" | "grayscale" | "save";
    side: Side; // where the triangle is positioned relative to this button
    w: number;
    h: number;
    x: number | (() => number);
    y: number | (() => number);
};

const buttons: Button[] = [
    // Top (centered)
    { action: "capture",   side: "top",   w: BUTTON_SIZE, h: BUTTON_SIZE,
        x: () => (canvas.width - BUTTON_SIZE) / 2,
        y: () => BUTTON_PADDING },

    // Left (second row)
    { action: "grayscale", side: "left",  w: BUTTON_SIZE, h: BUTTON_SIZE,
        x: () => BUTTON_PADDING,
        y: () => BUTTON_PADDING + BUTTON_SIZE + ROW_GAP },

    // Right (second row)
    { action: "save",      side: "right", w: BUTTON_SIZE, h: BUTTON_SIZE,
        x: () => canvas.width - BUTTON_PADDING - BUTTON_SIZE,
        y: () => BUTTON_PADDING + BUTTON_SIZE + ROW_GAP },
];

// ---------- Camera ----------
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await video.play();
        startRound(); // kick off the first mini-game round
        requestAnimationFrame(processFrame);
    } catch (err) {
        console.error("Camera error:", err);
    }
}

// ---------- Game flow ----------
function startRound() {
    roundActive = true;
    hitRecorded = false;
    targetIndex = Math.floor(Math.random() * buttons.length);
    roundEndsAt = performance.now() + ROUND_MS;
    flashingTarget = null;
    flashColor = null;
}

function endRound() {
    roundActive = false;
    flashingTarget = targetIndex;
    flashColor = hitRecorded ? "success" : "fail";
    flashEndsAt = performance.now() + FLASH_MS;
}

function maybeAdvanceGameClock() {
    const now = performance.now();

    if (roundActive && now >= roundEndsAt) {
        endRound();
    }

    if (!roundActive && flashingTarget !== null && now >= flashEndsAt) {
        // flash finished, start a new round
        startRound();
    }
}

// ---------- Main loop ----------
function processFrame() {
    if (video.videoWidth === 0) {
        requestAnimationFrame(processFrame);
        return;
    }

    // Match canvas to video size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw live frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Motion detection
    if (previousFrame) {
        const diff = detectMotion(previousFrame, currentFrame);
        checkVirtualButtons(diff); // updates hitRecorded etc.
    }

    // Visuals
    drawVirtualButtons();      // buttons only (no icons/labels)
    drawTriangleIndicator();   // triangle next to target

    // Game timing transitions
    maybeAdvanceGameClock();

    previousFrame = currentFrame;
    requestAnimationFrame(processFrame);
}

// ---------- Motion detection ----------
function detectMotion(prev: ImageData, curr: ImageData): Uint8ClampedArray {
    const diff = new Uint8ClampedArray(curr.data.length);
    for (let i = 0; i < curr.data.length; i += 4) {
        const delta =
            Math.abs(curr.data[i] - prev.data[i]) +
            Math.abs(curr.data[i + 1] - prev.data[i + 1]) +
            Math.abs(curr.data[i + 2] - prev.data[i + 2]);
        const motion = delta > 50 ? 255 : 0;
        diff[i] = diff[i + 1] = diff[i + 2] = motion;
        diff[i + 3] = 255;
    }
    return diff;
}

// ---------- Button hit test / triggering ----------
function checkVirtualButtons(diff: Uint8ClampedArray) {
    buttons.forEach((btn, idx) => {
        const x = resolve(btn.x);
        const y = resolve(btn.y);
        let motionCount = 0;
        const totalPixels = btn.w * btn.h;

        for (let j = y; j < y + btn.h; j++) {
            for (let i = x; i < x + btn.w; i++) {
                const di = (j * canvas.width + i) * 4;
                if (diff[di] > 128) motionCount++;
            }
        }

        const ratio = motionCount / totalPixels;

        // In game mode: only record hits, don't run actions
        if (GAME_MODE && roundActive && idx === targetIndex && ratio > 0.15) {
            hitRecorded = true; // user hit the correct button during the 2s window
        }

        // To also trigger original actions while playing, you could add that here.
    });
}

// ---------- Drawing: buttons (with game feedback colors) ----------
function drawVirtualButtons() {
    const now = performance.now();
    buttons.forEach((btn, idx) => {
        const x = resolve(btn.x);
        const y = resolve(btn.y);

        // Determine fill color:
        let fill = BTN_COLOR;

        // During flash window, tint the target button green/red
        if (!roundActive && flashingTarget === idx && now < flashEndsAt) {
            fill = flashColor === "success" ? "rgba(38,201,64,0.45)" : "rgba(230,67,67,0.45)";
        }

        // Draw rounded rect (no icons/labels)
        roundRect(ctx, x, y, btn.w, btn.h, BTN_RADIUS);
        ctx.fillStyle = fill; ctx.fill();

        // Border: brighten the active target during the round
        let border = BTN_BORDER;
        if (roundActive && idx === targetIndex) border = "rgba(255,255,255,0.95)";
        ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.stroke();
    });
}

// ---------- Drawing: triangle next to target button (bigger + new positions) ----------
function drawTriangleIndicator() {
    if (!roundActive) return;

    const btn = buttons[targetIndex];
    const x = resolve(btn.x);
    const y = resolve(btn.y);

    const size = 36;   // 2x bigger (was 18)
    const gap  = 12;   // distance from button edge

    // Place the triangle so its TIP is outside the button, pointing INTO it
    let tipX = x, tipY = y, angle = 0;

    if (btn.side === "top") {
        // Triangle BELOW the top button, pointing UP toward it
        tipX = x + btn.w / 2;
        tipY = y + btn.h + gap;
        angle = -Math.PI / 2; // up
    } else if (btn.side === "left") {
        // Triangle to the RIGHT of the left button, pointing LEFT
        tipX = x + btn.w + gap;
        tipY = y + btn.h / 2;
        angle = Math.PI; // left
    } else if (btn.side === "right") {
        // Triangle to the LEFT of the right button, pointing RIGHT
        tipX = x - gap;
        tipY = y + btn.h / 2;
        angle = 0; // right
    }

    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(angle);

    // Slight shadow for visibility
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    // Draw filled triangle (tip at 0,0)
    ctx.beginPath();
    ctx.moveTo(0, 0);               // tip toward the button
    ctx.lineTo(-size,  size / 1.6);
    ctx.lineTo(-size, -size / 1.6);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();

    ctx.restore();
}

// ---------- Original actions (used if GAME_MODE is false) ----------
function triggerAction(action: Button["action"]) {
    if (action === "capture") {
        lastCaptureCanvas = createCaptureToGallery();
    } else if (action === "grayscale") {
        if (!lastCaptureCanvas) { console.log("No capture yet to grayscale."); return; }
        grayscaleCanvas(lastCaptureCanvas);
    } else if (action === "save") {
        if (!lastCaptureCanvas) { console.log("No capture yet to save."); return; }
        const a = document.createElement("a");
        a.download = `capture-${Date.now()}.png`;
        a.href = lastCaptureCanvas.toDataURL("image/png");
        a.click();
    }
}

// ---------- Gallery helpers ----------
function createCaptureToGallery(): HTMLCanvasElement {
    const w = video.videoWidth, h = video.videoHeight;

    const wrap = document.createElement("div");
    wrap.className = "thumb latest";
    const prevLatest = gallery.querySelector(".thumb.latest");
    if (prevLatest) prevLatest.classList.remove("latest");

    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const cctx = c.getContext("2d")!;
    cctx.drawImage(video, 0, 0, w, h);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = new Date().toLocaleTimeString();

    wrap.appendChild(c);
    wrap.appendChild(meta);
    gallery.prepend(wrap);

    c.addEventListener("click", () => {
        const old = gallery.querySelector(".thumb.latest");
        if (old) old.classList.remove("latest");
        wrap.classList.add("latest");
        lastCaptureCanvas = c;
    });

    return c;
}

function grayscaleCanvas(target: HTMLCanvasElement) {
    const gctx = target.getContext("2d")!;
    const img = gctx.getImageData(0, 0, target.width, target.height);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = data[i + 1] = data[i + 2] = avg;
    }
    gctx.putImageData(img, 0, 0);
}

// ---------- Drawing utilities ----------
function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number
) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

// ---------- Helpers ----------
function resolve(v: number | (() => number)): number {
    return (typeof v === "function") ? v() : v;
}

// ---------- Start ----------
startCamera();
