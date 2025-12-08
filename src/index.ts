// --- Elements
const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const gallery = document.getElementById("gallery") as HTMLDivElement;

// --- State
let previousFrame: ImageData | null = null;
let lastCaptureCanvas: HTMLCanvasElement | null = null;
const lastTriggerAt: Record<string, number> = {};
const COOLDOWN_MS = 600;

// --- Buttons (Top / Left / Right) — light gray, rounded, no labels
const BUTTON_SIZE = 84;
const BUTTON_PADDING = 16;
const ROW_GAP = 12;
const BTN_COLOR = "rgba(220,220,220,0.32)";
const BTN_BORDER = "rgba(255,255,255,0.65)";
const BTN_RADIUS = 12;

type Button = {
    action: "capture" | "grayscale" | "save";
    w: number;
    h: number;
    x: number | (() => number);
    y: number | (() => number);
};

const buttons: Button[] = [
    // Top (centered) -> CAPTURE
    {
        action: "capture",
        w: BUTTON_SIZE, h: BUTTON_SIZE,
        x: () => (canvas.width - BUTTON_SIZE) / 2,
        y: () => BUTTON_PADDING
    },
    // Left (second row) -> GRAYSCALE LAST
    {
        action: "grayscale",
        w: BUTTON_SIZE, h: BUTTON_SIZE,
        x: () => BUTTON_PADDING,
        y: () => BUTTON_PADDING + BUTTON_SIZE + ROW_GAP
    },
    // Right (second row) -> SAVE LAST
    {
        action: "save",
        w: BUTTON_SIZE, h: BUTTON_SIZE,
        x: () => canvas.width - BUTTON_PADDING - BUTTON_SIZE,
        y: () => BUTTON_PADDING + BUTTON_SIZE + ROW_GAP
    },
];

// --- Camera
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await video.play();
        requestAnimationFrame(processFrame);
    } catch (err) {
        console.error("Camera error:", err);
    }
}

// --- Main loop
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

    if (previousFrame) {
        const diff = detectMotion(previousFrame, currentFrame);
        checkVirtualButtons(diff);
    }

    drawVirtualButtons();
    previousFrame = currentFrame;
    requestAnimationFrame(processFrame);
}

// --- Motion detection (simple frame diff)
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

// --- Buttons: draw (rounded, with icons)
function drawVirtualButtons() {
    ctx.save();
    buttons.forEach(btn => {
        const x = resolve(btn.x);
        const y = resolve(btn.y);

        // fill + border
        roundRect(ctx, x, y, btn.w, btn.h, BTN_RADIUS);
        ctx.fillStyle = BTN_COLOR; ctx.fill();
        ctx.strokeStyle = BTN_BORDER; ctx.lineWidth = 2; ctx.stroke();

        // icon
        if (btn.action === "capture") drawIconCapture(ctx, x, y, btn.w, btn.h);
        else if (btn.action === "grayscale") drawIconGrayscale(ctx, x, y, btn.w, btn.h);
        else if (btn.action === "save") drawIconSave(ctx, x, y, btn.w, btn.h);
    });
    ctx.restore();
}

// --- Buttons: detect activation
function checkVirtualButtons(diff: Uint8ClampedArray) {
    buttons.forEach(btn => {
        const x = resolve(btn.x);
        const y = resolve(btn.y);

        let motionCount = 0;
        const totalPixels = btn.w * btn.h;

        for (let j = y; j < y + btn.h; j++) {
            for (let i = x; i < x + btn.w; i++) {
                const idx = (j * canvas.width + i) * 4;
                if (diff[idx] > 128) motionCount++;
            }
        }

        const ratio = motionCount / totalPixels;
        if (ratio > 0.15) {
            const now = performance.now();
            if (!lastTriggerAt[btn.action] || now - lastTriggerAt[btn.action] > COOLDOWN_MS) {
                lastTriggerAt[btn.action] = now;
                triggerAction(btn.action);
            }
        }
    });
}

// --- Actions operate on captures (not live feed)
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

// --- Gallery helpers
function createCaptureToGallery(): HTMLCanvasElement {
    const w = video.videoWidth, h = video.videoHeight;

    // wrapper
    const wrap = document.createElement("div");
    wrap.className = "thumb latest";
    const prevLatest = gallery.querySelector(".thumb.latest");
    if (prevLatest) prevLatest.classList.remove("latest");

    // canvas for persistent capture
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

    // allow selecting a different "latest" by click
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

// --- Drawing utilities
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

function drawIconCapture(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.save();
    const cx = x + w/2, cy = y + h/2;
    const rOuter = Math.min(w, h) * 0.32;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.stroke();

    // small "viewfinder" notches
    const s = Math.min(w, h) * 0.28;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx - s + 12, cy - s);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx + s - 12, cy - s);
    ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx - s + 12, cy + s);
    ctx.moveTo(cx + s, cy + s); ctx.lineTo(cx + s - 12, cy + s);
    ctx.stroke();
    ctx.restore();
}

function drawIconGrayscale(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.save();
    const cx = x + w/2, cy = y + h/2;
    const r = Math.min(w, h) * 0.32;

    // Left half filled, right half outlined -> conveys "grayscale"
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI/2, Math.PI*3/2);
    ctx.lineTo(cx, cy - r);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // small checker hint
    const sq = r * 0.4;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(cx + r*0.15 - sq/2, cy - sq/2, sq, sq);
    ctx.restore();
}

function drawIconSave(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    const cx = x + w/2, cy = y + h/2;

    // Arrow down
    const aH = Math.min(w, h) * 0.22;
    ctx.beginPath();
    ctx.moveTo(cx, cy - aH);
    ctx.lineTo(cx, cy + aH);
    ctx.moveTo(cx - aH * 0.7, cy + aH * 0.2);
    ctx.lineTo(cx, cy + aH);
    ctx.lineTo(cx + aH * 0.7, cy + aH * 0.2);
    ctx.stroke();

    // Tray
    const tw = Math.min(w, h) * 0.6;
    const th = Math.min(w, h) * 0.22;
    ctx.beginPath();
    ctx.rect(cx - tw/2, y + h - th - 14, tw, th);
    ctx.stroke();
    ctx.restore();
}

// --- Helpers
function resolve(v: number | (() => number)): number {
    return (typeof v === "function") ? v() : v;
}

// Kick off
startCamera();
