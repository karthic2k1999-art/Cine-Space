/**
 * CINEMATIC CRISP — real backend (skeleton)
 * ------------------------------------------------------------------
 * A minimal, real Node/Express server that:
 *   1. Accepts an uploaded video file (multipart/form-data, field "video")
 *   2. Runs the ACTUAL ffmpeg binary on it (child_process.spawn — not a
 *      simulation, not fake progress) using the same sharpness/look
 *      parameters the frontend already collects
 *   3. Streams real ffmpeg progress back to the browser over
 *      Server-Sent-Events-like polling (simple job-status endpoint)
 *   4. Returns the processed file for download
 *
 * This is intentionally a SKELETON: one file, no database, jobs kept in
 * memory, files kept on local disk under /uploads and /outputs. Good
 * enough to prove real server-side processing end-to-end; swap the
 * in-memory job map for Redis/a queue and local disk for S3 if you need
 * this to survive server restarts or scale past one instance.
 *
 * REQUIRES: the `ffmpeg` binary must be installed and on PATH on
 * whatever machine/container runs this server (see Dockerfile).
 * GitHub Pages CANNOT run this — it only serves static files. Deploy
 * this folder to a Node host that lets you install ffmpeg (Render,
 * Railway, Fly.io, a VPS, etc. — see README.md).
 */

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "outputs");
for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// In-memory job tracking. Skeleton only — replace with a real store for production.
const jobs = new Map(); // jobId -> { status, progress, stage, error, inputPath, outputPath, outputName }

app.use(cors()); // skeleton: wide open. Lock this down to your frontend's origin before going live.
app.use(express.json());

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const id = crypto.randomUUID();
      const ext = path.extname(file.originalname) || ".mp4";
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB soft cap — real limit is your server's disk/RAM
});

// ---------- FILTER CHAIN (same logic as the client build, kept in sync on purpose) ----------
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function buildFilterChain(sharpness, adv) {
  const s = sharpness / 100; // -1..1
  const filters = [];

  if (s < 0 || adv.softness > 0) {
    const negPart = Math.max(0, -s);
    const softFromAdv = adv.softness / 100;
    const sigma = clamp(0.15 + negPart * 2.2 + softFromAdv * 1.1, 0, 3.5);
    filters.push(`gblur=sigma=${sigma.toFixed(2)}:steps=1`);
  }

  const detailFactor = 0.6 + (adv.detail / 100) * 0.8;
  const unsharpAmount = clamp(s * 1.6 * detailFactor, -1.8, 1.8);
  const edgeSize = adv.edgeProtect > 66 ? 3 : adv.edgeProtect > 33 ? 5 : 7;
  filters.push(
    `unsharp=luma_msize_x=${edgeSize}:luma_msize_y=${edgeSize}:luma_amount=${unsharpAmount.toFixed(
      2
    )}:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0.0`
  );

  if (adv.noise > 0) {
    const denoiseStrength = (adv.noise / 100) * (1 - adv.texture / 200);
    const luma = clamp(denoiseStrength * 4, 0, 4);
    filters.push(
      `hqdn3d=${luma.toFixed(2)}:${(luma * 0.7).toFixed(2)}:${(luma * 0.6).toFixed(2)}:${(luma * 0.6).toFixed(2)}`
    );
  }

  return filters.join(",");
}

const QUALITY_PRESETS = {
  low: { preset: "ultrafast", crf: 23 },
  balanced: { preset: "medium", crf: 20 },
  high: { preset: "slow", crf: 18 },
  maximum: { preset: "veryslow", crf: 16 },
};

// ---------- Probe duration first, so progress % is real (based on -progress time vs total duration) ----------
function probeDuration(filePath) {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      (err, stdout) => {
        if (err) return resolve(0);
        const d = parseFloat(stdout);
        resolve(isNaN(d) ? 0 : d);
      }
    );
  });
}

function timeStringToSeconds(str) {
  // ffmpeg -progress emits out_time=HH:MM:SS.microseconds
  const m = /(\d+):(\d+):(\d+\.?\d*)/.exec(str);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ---------- POST /api/process — start a real ffmpeg job ----------
app.post("/api/process", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video file uploaded (field name must be 'video')." });

  let sharpness = 0;
  let adv = { edgeProtect: 50, detail: 50, softness: 0, texture: 50, noise: 0 };
  let quality = "balanced";
  try {
    if (req.body.sharpness) sharpness = Number(req.body.sharpness);
    if (req.body.adv) adv = { ...adv, ...JSON.parse(req.body.adv) };
    if (req.body.quality) quality = req.body.quality;
  } catch (_) {
    // fall back to defaults on bad JSON rather than failing the whole job
  }

  const jobId = crypto.randomUUID();
  const inputPath = req.file.path;
  const outputName = `${path.parse(req.file.originalname).name}_cinematic-crisp.mp4`;
  const outputPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);

  jobs.set(jobId, {
    status: "processing",
    progress: 0,
    stage: "Analyzing",
    error: null,
    inputPath,
    outputPath,
    outputName,
  });

  res.json({ jobId }); // respond immediately; client polls /api/status/:jobId

  const duration = await probeDuration(inputPath);
  const job = jobs.get(jobId);
  job.stage = "Encoding";

  const q = QUALITY_PRESETS[quality] || QUALITY_PRESETS.balanced;
  const vf = buildFilterChain(sharpness, adv);

  const args = [
    "-y",
    "-i", inputPath,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", q.preset,
    "-crf", String(q.crf),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    outputPath,
  ];

  const proc = spawn("ffmpeg", args);

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    const timeMatch = /out_time=([\d:.]+)/.exec(text);
    if (timeMatch && duration > 0) {
      const cur = timeStringToSeconds(timeMatch[1]);
      job.progress = clamp(Math.round((cur / duration) * 100), 0, 99);
    }
  });

  let stderrTail = "";
  proc.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000); // keep last 4KB for error reporting
  });

  proc.on("close", (code) => {
    fs.unlink(inputPath, () => {}); // clean up upload regardless of outcome
    if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      job.status = "done";
      job.progress = 100;
      job.stage = "Done";
    } else {
      job.status = "error";
      job.error = `ffmpeg exited with code ${code}. ${stderrTail.trim().slice(-500)}`;
    }
  });

  proc.on("error", (err) => {
    job.status = "error";
    job.error = `Could not start ffmpeg: ${err.message}. Is ffmpeg installed on this server?`;
  });
});

// ---------- GET /api/status/:jobId — poll for real progress ----------
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Unknown job id." });
  res.json({
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    downloadUrl: job.status === "done" ? `/api/download/${req.params.jobId}` : null,
  });
});

// ---------- GET /api/download/:jobId — stream the real processed file ----------
app.get("/api/download/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== "done") return res.status(404).json({ error: "File not ready or unknown job id." });
  res.download(job.outputPath, job.outputName, (err) => {
    if (!err) {
      // clean up after a successful download to avoid filling server disk
      fs.unlink(job.outputPath, () => {});
      jobs.delete(req.params.jobId);
    }
  });
});

app.get("/api/health", (_req, res) => {
  execFile("ffmpeg", ["-version"], (err, stdout) => {
    res.json({ ok: !err, ffmpeg: err ? null : stdout.split("\n")[0] });
  });
});

app.listen(PORT, () => {
  console.log(`Cinematic Crisp backend listening on port ${PORT}`);
});
