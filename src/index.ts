const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const gallery = document.getElementById("gallery") as HTMLDivElement;

let previousFrame: ImageData | null = null;

// Keep reference to the most recent captured canvas
let lastCaptureCanvas: HTMLCanvasElement | null = null;

// Basic cooldown so an action doesn't trigger repeatedly in a single hover
const lastTriggerAt: Record<string, number> = {};
const COOLDOWN_MS = 600;

// Define "virtual buttons" in live canvas coordinates
const buttons = [
    { x: 50,  y: 50,  w: 120, h: 120, action: "capture",   color: "rgba(0,255,0,0.28)", label: "Capture" },
    { x: 220, y: 50,  w: 120, h: 120, action: "grayscale", color: "rgba(0,128,255,0.28)", label: "Grayscale last" },
];

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

function processFrame() {
    if (video.videoWidth === 0) {
        requestAnimationFrame(processFrame);
        return;
    }

    // Match canvas to video frame size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // If previous frame exists, compare for motion
    if (previousFrame) {
        const diff = detectMotion(previousFrame, currentFrame);
        checkVirtualButtons(diff);
    }

    // Draw virtual buttons on top
    drawVirtualButtons();

    previousFrame = currentFrame;
    requestAnimationFrame(processFrame);
}

function drawVirtualButtons() {
    ctx.save();
    buttons.forEach(btn => {
        ctx.fillStyle = btn.color;
        ctx.fillRect(btn.x, btn.y, btn.w, btn.h);

        // border
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 2;
        ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);

        // label
        ctx.fillStyle = "white";
        ctx.font = "16px system-ui, sans-serif";
        ctx.fillText(btn.label, btn.x + 8, btn.y + btn.h + 20);
    });
    ctx.restore();
}

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

function checkVirtualButtons(diff: Uint8ClampedArray) {
    buttons.forEach(btn => {
        const { x, y, w, h, action } = btn;
        let motionCount = 0;
        const totalPixels = w * h;

        for (let j = y; j < y + h; j++) {
            for (let i = x; i < x + w; i++) {
                const idx = (j * canvas.width + i) * 4;
                if (diff[idx] > 128) motionCount++;
            }
        }

        const ratio = motionCount / totalPixels;
        if (ratio > 0.15) {
            const now = performance.now();
            if (!lastTriggerAt[action] || now - lastTriggerAt[action] > COOLDOWN_MS) {
                lastTriggerAt[action] = now;
                triggerAction(action);
            }
        }
    });
}

// --- Actions now operate on captured images, not the live feed ---

function triggerAction(action: string) {
    if (action === "capture") {
        console.log("📸 Capture -> gallery");
        lastCaptureCanvas = createCaptureToGallery();
    } else if (action === "grayscale") {
        if (!lastCaptureCanvas) {
            console.log("No capture yet to grayscale.");
            return;
        }
        console.log("🎨 Grayscale last capture");
        grayscaleCanvas(lastCaptureCanvas);
    }
}

/** Draw current video frame into a new canvas and add it to the gallery. */
function createCaptureToGallery(): HTMLCanvasElement {
    const w = video.videoWidth;
    const h = video.videoHeight;

    // Create item wrapper
    const wrap = document.createElement("div");
    wrap.className = "thumb latest";

    // Remove "latest" class from previous latest
    const prevLatest = gallery.querySelector(".thumb.latest");
    if (prevLatest) prevLatest.classList.remove("latest");

    // Canvas that stores the captured frame (so we can edit it later)
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cctx = c.getContext("2d")!;
    cctx.drawImage(video, 0, 0, w, h);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = new Date().toLocaleTimeString();

    wrap.appendChild(c);
    wrap.appendChild(meta);
    gallery.prepend(wrap); // newest first

    return c;
}

/** Convert a canvas image to grayscale in-place. */
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

// Start!
startCamera();
