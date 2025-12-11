// ---------- DOM
const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const gallery = document.getElementById("gallery") as HTMLDivElement;

// ---------- State
let previousFrame: ImageData | null = null;
let lastCaptureCanvas: HTMLCanvasElement | null = null;

const lastTriggerAt: Record<string, number> = {};
const COOLDOWN_MS = 600;

// Game settings
const GAME_MODE = true;
const ROUND_MS = 2000;   // player has 2 seconds
const FLASH_MS = 500;    // flash success/fail for 0.5s

// Lives / Game Over
const MAX_HP = 3;
let hp = MAX_HP;
let gameOver = false;

let roundActive = false;
let roundEndsAt = 0;
let targetIndex = 0;
let hitRecorded = false;

let flashingTarget: number | null = null;
let flashEndsAt = 0;
let flashColor: "success" | "fail" | null = null;

let lastActivatedIndex: number | null = null;

// ---------- Buttons
const BUTTON_SIZE = 84;
const BUTTON_PADDING = 16;
const ROW_GAP = 12;
const BTN_COLOR = "rgba(220,220,220,0.32)";
const BTN_BORDER = "rgba(255,255,255,0.65)";
const BTN_RADIUS = 12;

type Side = "top" | "left" | "right";
type Button = {
    action: "capture" | "grayscale" | "save";
    side: Side; // triangle positioning relative to this button
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




// ---------- Knight Images
const knightTop = new Image();
knightTop.src = "assets/Oben.png";

const knightLeft = new Image();
knightLeft.src = "assets/Links.png";

const knightRight = new Image();
knightRight.src = "assets/Rechts.png";

const knightNeutral = new Image();
knightNeutral.src = "assets/Neutral.png";

// ---------- Choose correct pose
function getKnightPose(): HTMLImageElement {
    if (!roundActive) return knightNeutral; // default when no round active

    const side = buttons[targetIndex].side;
    if (side === "top")  return knightTop;
    if (side === "left") return knightLeft;
    if (side === "right") return knightRight;

    return knightNeutral;
}

// ---------- Draw knight background
function drawKnightBackground() {
    const img = getKnightPose();

    const scale = 1.3;
    const w = canvas.width * scale;
    const h = canvas.height * scale;

    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
}

// ---------- Camera
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await video.play();
        startRound();
        requestAnimationFrame(processFrame);
    } catch (err) {
        console.error("Camera error:", err);
    }
}

// ---------- Game flow
function startRound() {
    if (gameOver) return;
    roundActive = true;
    hitRecorded = false;
    lastActivatedIndex = null; // reset the "last touched" for the new round
    targetIndex = Math.floor(Math.random() * buttons.length);
    roundEndsAt = performance.now() + ROUND_MS;
    flashingTarget = null;
    flashColor = null;
}

function endRound() {
    roundActive = false;

    // Success ONLY if the last activated button matches the target
    hitRecorded = (lastActivatedIndex === targetIndex);

    flashingTarget = targetIndex;
    flashColor = hitRecorded ? "success" : "fail";
    flashEndsAt = performance.now() + FLASH_MS;

    // Lose a life if failed
    if (!hitRecorded) {
        hp = hp-1;
        if (hp === 0) gameOver = true;
    }
}

function maybeAdvanceGameClock() {
    const now = performance.now();
    if (!gameOver && roundActive && now >= roundEndsAt) endRound();
    if (!gameOver && !roundActive && flashingTarget !== null && now >= flashEndsAt) startRound();
}

// ---------- Main loop
function processFrame() {
    if (video.videoWidth === 0) {
        requestAnimationFrame(processFrame);
        return;
    }

    // Canvas size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the video mirrored
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Read the mirrored frame for motion detection
    const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Draw knight
    drawKnightBackground();

    // Motion detection
    if (previousFrame) {
        const diff = detectMotion(previousFrame, currentFrame);
        if (!gameOver) checkVirtualButtons(diff);
    }

    // Draw HUD/UI
    drawVirtualButtons();
    if (!gameOver) drawTriangleIndicator();
    drawHearts();
    if (gameOver) drawGameOver();

    // Game timing transitions
    if (!gameOver) maybeAdvanceGameClock();

    previousFrame = currentFrame;
    requestAnimationFrame(processFrame);
}

// ---------- Motion detection
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

// ---------- Button hit test
function checkVirtualButtons(diff: Uint8ClampedArray) {
    const THRESHOLD = 0.15;
    let frameLast: number | null = null;

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
        if (roundActive && ratio > THRESHOLD) {
            frameLast = idx; // track the most recent active button in this frame
        }
    });

    if (frameLast !== null) {
        lastActivatedIndex = frameLast;
    }
}

// ---------- Draw: buttons
function drawVirtualButtons() {
    const now = performance.now();
    buttons.forEach((btn, idx) => {
        const x = resolve(btn.x);
        const y = resolve(btn.y);

        let fill = BTN_COLOR;

        // During flash window, tint the target button green/red
        if (!roundActive && flashingTarget === idx && now < flashEndsAt) {
            fill = flashColor === "success" ? "rgba(38,201,64,0.45)" : "rgba(230,67,67,0.45)";
        }

        roundRect(ctx, x, y, btn.w, btn.h, BTN_RADIUS);
        ctx.fillStyle = fill;
        ctx.fill();

        // Border: brighten the active target during the round
        let border = BTN_BORDER;
        if (!gameOver && roundActive && idx === targetIndex) border = "rgba(255,255,255,0.95)";
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        ctx.stroke();

        // subtle colourchange for selected button
        if (roundActive && lastActivatedIndex === idx) {
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fill();
        }
    });
}

// ---------- Draw Indicator
function drawTriangleIndicator() {
    if (!roundActive) return;

    const btn = buttons[targetIndex];
    const x = resolve(btn.x);
    const y = resolve(btn.y);

    const size = 36; // bigger
    const gap  = 12;

    let tipX = x, tipY = y, angle = 0;

    if (btn.side === "top") {
        // Triangle BELOW the top button, pointing UP
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

    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    ctx.beginPath();
    ctx.moveTo(0, 0);               // tip
    ctx.lineTo(-size,  size / 1.6);
    ctx.lineTo(-size, -size / 1.6);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();

    ctx.restore();
}

// ---------- HUD: hearts
function drawHearts() {
    const x0 = 12, y0 = 12, gap = 10, size = 16;
    for (let i = 0; i < MAX_HP; i++) {
        const filled = i < hp;
        drawHeart(x0 + i * (size + gap), y0, size, filled);
    }
}
function drawHeart(x: number, y: number, size: number, filled: boolean) {
    const w = size, h = size * 0.9;
    const cx1 = x + w * 0.25, cx2 = x + w * 0.75, cy = y + h * 0.35;
    const bottomX = x + w * 0.5, bottomY = y + h;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bottomX, bottomY);
    ctx.bezierCurveTo(x + w, y + h * 0.7, x + w * 0.9, y + h * 0.2, cx2, cy);
    ctx.arc(cx2, cy, w * 0.25, 0, Math.PI, true);
    ctx.arc(cx1, cy, w * 0.25, 0, Math.PI, true);
    ctx.bezierCurveTo(x + w * 0.1, y + h * 0.2, x, y + h * 0.7, bottomX, bottomY);
    ctx.closePath();

    if (filled) {
        ctx.fillStyle = "rgba(255,70,90,0.95)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
    } else {
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
    }
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

// ---------- GAME OVER
function drawGameOver() {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = "bold 48px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2);
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("Refresh to play again", canvas.width / 2, canvas.height / 2 + 40);
    ctx.restore();
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

// ---------- Helpers
function resolve(v: number | (() => number)): number {
    return (typeof v === "function") ? v() : v;
}

// ---------- Start ----------
startCamera();
