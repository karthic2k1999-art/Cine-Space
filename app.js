/* CINEMATIC CRISP — real video processing via a real backend server (Node + actual ffmpeg
   binary running server-side). No fake progress, no fake output, no client-side wasm engine —
   this build talks to the Cinematic Crisp backend (see /backend in the project) over HTTP. */

(async () => {
  "use strict";

  function showFatal(message) {
    const box = document.getElementById("fatalBoot");
    const msg = document.getElementById("fatalBootMsg");
    if (box && msg) {
      box.classList.remove("hidden");
      msg.textContent = message;
    }
  }

  // ---------- BACKEND CONNECTION ----------
  const BACKEND_KEY = "cinematic_crisp_backend_url";
  function getBackendUrl() {
    return (localStorage.getItem(BACKEND_KEY) || "").replace(/\/+$/, "");
  }
  function setBackendUrl(url) {
    localStorage.setItem(BACKEND_KEY, url.replace(/\/+$/, ""));
  }

  const MAX_RECOMMENDED_BYTES = 700 * 1024 * 1024; // ~700MB soft warning (upload size / server memory, not a fake cap)

  // ---------- LOOK PROFILES ----------
  // Every profile maps to REAL ffmpeg filter parameters. sharpness is the default position
  // of the -100..100 slider for that look; adv holds the advanced-setting defaults it applies.
  const LOOKS = [
    { id: "original", name: "Original", desc: "No change", sharpness: 0,
      adv: { edgeProtect: 50, detail: 50, microcontrast: 0, texture: 50, softness: 0, highlight: 0, shadow: 0, temporal: 0, noise: 0 } },
    { id: "natural", name: "Natural", desc: "Balanced de-sharpen, strong detail", sharpness: -22,
      adv: { edgeProtect: 65, detail: 70, microcontrast: 5, texture: 60, softness: 20, highlight: 10, shadow: 5, temporal: 10, noise: 15 } },
    { id: "cinematic_soft", name: "Cinematic Soft", desc: "Organic softness, no obvious blur", sharpness: -38,
      adv: { edgeProtect: 55, detail: 60, microcontrast: 10, texture: 55, softness: 40, highlight: 15, shadow: 10, temporal: 15, noise: 20 } },
    { id: "arri", name: "ARRI-Inspired Softness", desc: "Restrained edges, natural skin (not exact ARRI match)", sharpness: -48,
      adv: { edgeProtect: 70, detail: 68, microcontrast: 14, texture: 62, softness: 48, highlight: 25, shadow: 15, temporal: 15, noise: 25 } },
    { id: "imax", name: "IMAX-Inspired Theatre", desc: "Clean detail, no halos, refined microcontrast", sharpness: -12,
      adv: { edgeProtect: 80, detail: 85, microcontrast: 18, texture: 75, softness: 15, highlight: 30, shadow: 20, temporal: 20, noise: 20 } },
    { id: "theatrical", name: "Theatrical Look", desc: "Controlled sharpness, smooth transitions", sharpness: -28,
      adv: { edgeProtect: 60, detail: 62, microcontrast: 12, texture: 58, softness: 32, highlight: 20, shadow: 12, temporal: 12, noise: 18 } },
    { id: "large_format", name: "Large Format Look", desc: "Big-sensor rendering feel", sharpness: -18,
      adv: { edgeProtect: 68, detail: 74, microcontrast: 16, texture: 68, softness: 24, highlight: 18, shadow: 14, temporal: 10, noise: 15 } },
    { id: "organic", name: "Organic Camera Look", desc: "Film-like, least digital", sharpness: -55,
      adv: { edgeProtect: 58, detail: 55, microcontrast: 8, texture: 50, softness: 55, highlight: 20, shadow: 15, temporal: 18, noise: 30 } },
    { id: "mobile_soften", name: "Mobile Digital Softening", desc: "Strong fix for harsh phone sharpening", sharpness: -70,
      adv: { edgeProtect: 45, detail: 45, microcontrast: 5, texture: 45, softness: 70, highlight: 10, shadow: 10, temporal: 20, noise: 25 } },
    { id: "custom", name: "Custom", desc: "Manual control", sharpness: 0,
      adv: { edgeProtect: 50, detail: 50, microcontrast: 0, texture: 50, softness: 0, highlight: 0, shadow: 0, temporal: 0, noise: 0 } },
  ];

  const ADV_FIELDS = [
    { key: "edgeProtect", label: "Edge Protection" },
    { key: "detail", label: "Detail Preservation" },
    { key: "microcontrast", label: "Microcontrast" },
    { key: "texture", label: "Texture Preservation" },
    { key: "softness", label: "Softness" },
    { key: "highlight", label: "Highlight Protection" },
    { key: "shadow", label: "Shadow Protection" },
    { key: "temporal", label: "Temporal Stability" },
    { key: "noise", label: "Noise Protection" },
  ];

  const QUALITY_PRESETS = {
    low:      { x264preset: "ultrafast", crf: 23 },
    balanced: { x264preset: "medium",    crf: 20 },
    high:     { x264preset: "slow",      crf: 18 },
    maximum:  { x264preset: "veryslow",  crf: 16 },
  };

  // ---------- STATE ----------
  const state = {
    file: null,
    fileURL: null,
    outputURL: null,
    look: "original",
    sharpness: 0,
    adv: { ...LOOKS[0].adv },
    duration: 0,
    width: 0,
    height: 0,
    fps: 0,
    ffmpeg: null,
    ffmpegReady: false,
    processing: false,
    cancelRequested: false,
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    engineStatus: $("engineStatus"),
    uploadBtn: $("uploadBtn"),
    fileInput: $("fileInput"),
    previewPanel: $("previewPanel"),
    beforeVideo: $("beforeVideo"),
    afterVideo: $("afterVideo"),
    afterClip: $("afterClip"),
    compareLine: $("compareLine"),
    previewWrap: $("previewWrap"),
    playBtn: $("playBtn"),
    previewMeta: $("previewMeta"),
    looksGrid: $("looksGrid"),
    sharpSlider: $("sharpSlider"),
    sharpVal: $("sharpVal"),
    advGrid: $("advGrid"),
    qualitySelect: $("qualitySelect"),
    processBtn: $("processBtn"),
    cancelBtn: $("cancelBtn"),
    progressBlock: $("progressBlock"),
    progressStage: $("progressStage"),
    progressPercent: $("progressPercent"),
    progressFill: $("progressFill"),
    progressElapsed: $("progressElapsed"),
    progressEta: $("progressEta"),
    resultBlock: $("resultBlock"),
    resultList: $("resultList"),
    downloadBtn: $("downloadBtn"),
    errorBlock: $("errorBlock"),
    errorMessage: $("errorMessage"),
    errorDetail: $("errorDetail"),
    historyPanel: $("historyPanel"),
    historyList: $("historyList"),
    backendUrlInput: $("backendUrlInput"),
    backendSaveBtn: $("backendSaveBtn"),
    backendHint: $("backendHint"),
  };

  // ---------- BACKEND ENGINE (real server, real ffmpeg) ----------
  el.backendUrlInput.value = getBackendUrl();

  el.backendSaveBtn.addEventListener("click", () => {
    const url = el.backendUrlInput.value.trim();
    if (!/^https?:\/\/.+/.test(url)) {
      el.backendHint.textContent = "Enter a full URL starting with https:// (e.g. https://your-app.onrender.com)";
      el.backendHint.style.color = "var(--danger)";
      return;
    }
    setBackendUrl(url);
    el.backendHint.style.color = "";
    initEngine();
  });

  async function initEngine() {
    const backend = getBackendUrl();
    if (!backend) {
      state.ffmpegReady = false;
      el.engineStatus.textContent = "No backend set";
      el.engineStatus.classList.remove("ready");
      el.engineStatus.classList.add("error");
      el.backendHint.textContent = "Paste your Render backend URL above and tap Save to connect.";
      return;
    }
    el.engineStatus.textContent = "Connecting to backend…";
    el.engineStatus.classList.remove("ready", "error");
    try {
      // Render free tier sleeps after inactivity — first request can take 30-50s to wake it up.
      // This is the server actually booting, not a stuck request, so we give it a long timeout
      // and say so in the UI instead of failing fast and looking broken.
      el.backendHint.textContent = "Waking up server… this can take up to 50s if it's been idle (Render free tier).";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const res = await fetch(`${backend}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Health check returned HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error("Server responded but ffmpeg is not installed there.");

      state.ffmpegReady = true;
      el.engineStatus.textContent = "Backend connected — real ffmpeg ready";
      el.engineStatus.classList.remove("error");
      el.engineStatus.classList.add("ready");
      el.backendHint.textContent = `Connected: ${data.ffmpeg || "ffmpeg ready"}`;
      if (state.file) el.processBtn.disabled = false;
    } catch (err) {
      state.ffmpegReady = false;
      el.engineStatus.textContent = "Backend not reachable";
      el.engineStatus.classList.remove("ready");
      el.engineStatus.classList.add("error");
      showError(
        "Could not reach the backend server. Check the URL is correct and the service is deployed " +
          "and running (Render dashboard → your service → should say 'Live'), then tap Save again.",
        err
      );
    }
  }

  // ---------- LOOKS UI ----------
  function renderLooks() {
    el.looksGrid.innerHTML = "";
    LOOKS.forEach((look) => {
      const card = document.createElement("button");
      card.className = "look-card" + (look.id === state.look ? " active" : "");
      card.innerHTML = `<b>${look.name}</b><span>${look.desc}</span>`;
      card.addEventListener("click", () => applyLook(look.id, true));
      el.looksGrid.appendChild(card);
    });
  }

  // IMPORTANT: the Sharpness slider is a fully independent control. Selecting a Look or moving
  // an Advanced setting NEVER changes the Sharpness number — only dragging the Sharpness slider
  // itself does. Each Look still has its own visible character (softness, detail, etc.) through
  // the advanced parameters, applied on top of whatever sharpness value you currently have.
  function applyLook(lookId, isUpload) {
    const look = LOOKS.find((l) => l.id === lookId) || LOOKS[0];
    state.look = look.id;
    state.adv = { ...look.adv };
    if (isUpload || look.id === "original") {
      // On first upload, or when explicitly choosing "Original" (= no change), reset to 0.
      state.sharpness = 0;
    }
    el.sharpSlider.value = state.sharpness;
    el.sharpVal.textContent = state.sharpness;
    renderLooks();
    renderAdvanced();
  }

  // ---------- ADVANCED SETTINGS UI ----------
  function renderAdvanced() {
    el.advGrid.innerHTML = "";
    ADV_FIELDS.forEach((f) => {
      const row = document.createElement("div");
      row.className = "adv-row";
      row.innerHTML = `
        <label>${f.label} <b>${state.adv[f.key]}</b></label>
        <input type="range" min="0" max="100" value="${state.adv[f.key]}" data-key="${f.key}" />
      `;
      row.querySelector("input").addEventListener("input", (e) => {
        state.adv[f.key] = Number(e.target.value);
        row.querySelector("b").textContent = state.adv[f.key];
        markCustom();
      });
      el.advGrid.appendChild(row);
    });
  }

  function markCustom() {
    if (state.look !== "custom") {
      state.look = "custom";
      renderLooks();
    }
  }

  // ---------- SHARPNESS SLIDER ----------
  el.sharpSlider.addEventListener("input", (e) => {
    state.sharpness = Number(e.target.value);
    el.sharpVal.textContent = state.sharpness;
    markCustom();
  });

  // ---------- UPLOAD ----------
  el.uploadBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  function handleFile(file) {
    resetOutputUI();
    state.file = file;
    if (state.fileURL) URL.revokeObjectURL(state.fileURL);
    state.fileURL = URL.createObjectURL(file);

    el.beforeVideo.src = state.fileURL;
    el.afterVideo.src = state.fileURL;
    el.beforeVideo.load();
    el.afterVideo.load();

    el.beforeVideo.addEventListener(
      "loadedmetadata",
      () => {
        state.duration = el.beforeVideo.duration;
        state.width = el.beforeVideo.videoWidth;
        state.height = el.beforeVideo.videoHeight;
        el.previewMeta.textContent = `${state.width}×${state.height} · ${formatTime(state.duration)} · ${formatBytes(file.size)}`;
      },
      { once: true }
    );

    el.previewPanel.classList.remove("hidden");
    el.historyPanel.classList.remove("hidden");
    applyLook("original", true);
    el.processBtn.disabled = !state.ffmpegReady;

    if (file.size > MAX_RECOMMENDED_BYTES) {
      showError(
        `This file is ${formatBytes(file.size)}. Browser-based processing works best under ~${formatBytes(
          MAX_RECOMMENDED_BYTES
        )} because the whole video must fit in your phone/browser memory. Processing may still work but could run out of memory on very large files — this is a browser limitation, not a fake restriction.`,
        null,
        true
      );
    }
  }

  // ---------- BEFORE/AFTER COMPARE SLIDER ----------
  let dragging = false;
  function setCompareAt(clientX) {
    const rect = el.previewWrap.getBoundingClientRect();
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    el.afterClip.style.clipPath = `inset(0 0 0 ${pct}%)`;
    el.compareLine.style.left = `${pct}%`;
  }
  function startDrag(e) {
    dragging = true;
    setCompareAt((e.touches ? e.touches[0].clientX : e.clientX));
  }
  function moveDrag(e) {
    if (!dragging) return;
    setCompareAt((e.touches ? e.touches[0].clientX : e.clientX));
  }
  function endDrag() { dragging = false; }
  el.previewWrap.addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", moveDrag);
  window.addEventListener("mouseup", endDrag);
  el.previewWrap.addEventListener("touchstart", startDrag, { passive: true });
  window.addEventListener("touchmove", moveDrag, { passive: true });
  window.addEventListener("touchend", endDrag);

  el.playBtn.addEventListener("click", () => {
    if (el.beforeVideo.paused) {
      el.beforeVideo.currentTime = el.afterVideo.currentTime = 0;
      el.beforeVideo.play();
      el.afterVideo.play();
      el.playBtn.textContent = "⏸ Pause";
    } else {
      el.beforeVideo.pause();
      el.afterVideo.pause();
      el.playBtn.textContent = "▶ Play";
    }
  });
  // keep both videos in sync
  el.beforeVideo.addEventListener("timeupdate", () => {
    if (Math.abs(el.beforeVideo.currentTime - el.afterVideo.currentTime) > 0.15) {
      el.afterVideo.currentTime = el.beforeVideo.currentTime;
    }
  });

  // ---------- FILTER CHAIN (REAL FFMPEG FILTERS) ----------
  // Maps the -100..+100 sharpness value plus advanced settings to real, bounded FFmpeg filter params.
  function buildFilterChain() {
    const s = state.sharpness / 100; // -1..1
    const adv = state.adv;
    const filters = [];

    // Softness / de-sharpen path: real gaussian blur scaled by softness + negative range,
    // followed by a small protective unsharp pass driven by Edge Protection / Detail Preservation
    // so we don't destroy real texture (hair, skin, foliage) while removing digital sharpening halos.
    if (s < 0 || adv.softness > 0) {
      const negPart = Math.max(0, -s); // 0..1
      const softFromAdv = adv.softness / 100; // 0..1
      const sigma = clamp(0.15 + negPart * 2.2 + softFromAdv * 1.1, 0, 3.5);
      filters.push(`gblur=sigma=${sigma.toFixed(2)}:steps=1`);
    }

    // Core sharpness control (positive = crisper, negative = mild counter-sharpen to protect real edges).
    const detailFactor = 0.6 + (adv.detail / 100) * 0.8; // 0.6..1.4, higher detail preservation = stronger protective pass
    const unsharpAmount = clamp(s * 1.6 * detailFactor, -1.8, 1.8);
    const edgeSize = adv.edgeProtect > 66 ? 3 : adv.edgeProtect > 33 ? 5 : 7;
    filters.push(
      `unsharp=luma_msize_x=${edgeSize}:luma_msize_y=${edgeSize}:luma_amount=${unsharpAmount.toFixed(
        2
      )}:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0.0`
    );

    // NOTE: an earlier version of this app applied a contrast/gamma (`eq`) pass here driven by
    // Microcontrast/Highlight/Shadow Protection. Every Look preset other than "Original" sets
    // those above 0 by default, so it was silently darkening/contrast-boosting the video even
    // when you only touched the Sharpness slider. Removed on purpose — brightness and contrast
    // of your original footage are now always left untouched. Only real sharpness/softness
    // (unsharp + blur) and noise reduction (below) are applied.

    // Noise protection: light temporal-safe denoise (hqdn3d), scaled, texture-aware.
    if (adv.noise > 0) {
      const denoiseStrength = (adv.noise / 100) * (1 - adv.texture / 200); // texture preservation reduces denoise
      const luma = clamp(denoiseStrength * 4, 0, 4);
      filters.push(`hqdn3d=${luma.toFixed(2)}:${(luma * 0.7).toFixed(2)}:${(luma * 0.6).toFixed(2)}:${(luma * 0.6).toFixed(2)}`);
    }

    return filters.join(",");
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ---------- PROCESS ----------
  el.processBtn.addEventListener("click", processVideo);
  el.cancelBtn.addEventListener("click", cancelProcessing);

  let currentJobId = null;
  let pollHandle = null;

  async function processVideo() {
    if (!state.file || !state.ffmpegReady || state.processing) return;
    const backend = getBackendUrl();
    if (!backend) {
      showError("No backend server connected. Paste your backend URL above and tap Save first.", null);
      return;
    }

    hideError();
    el.resultBlock.classList.add("hidden");
    state.cancelRequested = false;
    state.processing = true;
    el.processBtn.disabled = true;
    el.cancelBtn.classList.remove("hidden");
    el.progressBlock.classList.remove("hidden");
    updateProgress(0);
    setStage("Uploading to server");

    const startTime = Date.now();
    let timerHandle = setInterval(() => {
      el.progressElapsed.textContent = `Elapsed: ${formatTime((Date.now() - startTime) / 1000)}`;
    }, 500);

    try {
      const form = new FormData();
      form.append("video", state.file, state.file.name);
      form.append("sharpness", String(state.sharpness));
      form.append("adv", JSON.stringify(state.adv));
      form.append("quality", el.qualitySelect.value);

      const startRes = await fetch(`${backend}/api/process`, { method: "POST", body: form });
      if (!startRes.ok) {
        const body = await startRes.text().catch(() => "");
        throw new Error(`Server rejected the upload (HTTP ${startRes.status}). ${body.slice(0, 300)}`);
      }
      const { jobId, error: startErr } = await startRes.json();
      if (startErr) throw new Error(startErr);
      if (!jobId) throw new Error("Server did not return a job id.");
      currentJobId = jobId;

      setStage("Analyzing / encoding on server");

      // Real progress: poll the backend, which reports actual ffmpeg -progress output.
      const finalStatus = await new Promise((resolve, reject) => {
        pollHandle = setInterval(async () => {
          if (state.cancelRequested) {
            clearInterval(pollHandle);
            reject(new CancelError());
            return;
          }
          try {
            const statusRes = await fetch(`${backend}/api/status/${jobId}`);
            if (!statusRes.ok) throw new Error(`Status check failed (HTTP ${statusRes.status})`);
            const s = await statusRes.json();
            updateProgress(s.progress || 0);
            setStage(s.stage || "Processing");
            if (s.status === "done") {
              clearInterval(pollHandle);
              resolve(s);
            } else if (s.status === "error") {
              clearInterval(pollHandle);
              reject(new Error(s.error || "Server-side processing failed."));
            }
          } catch (e) {
            clearInterval(pollHandle);
            reject(e);
          }
        }, 1500);
      });

      setStage("Downloading result");
      const dlRes = await fetch(`${backend}${finalStatus.downloadUrl}`);
      if (!dlRes.ok) throw new Error(`Could not download processed file (HTTP ${dlRes.status})`);
      const blob = await dlRes.blob();
      if (!blob || blob.size === 0) throw new Error("Server returned an empty file.");

      if (state.outputURL) URL.revokeObjectURL(state.outputURL);
      state.outputURL = URL.createObjectURL(blob);

      // Update AFTER preview with the real processed output.
      el.afterVideo.src = state.outputURL;
      el.afterVideo.load();

      const outName = buildOutputFilename(state.file.name);
      el.downloadBtn.href = state.outputURL;
      el.downloadBtn.setAttribute("download", outName);

      const lookName = LOOKS.find((l) => l.id === state.look)?.name || "Custom";
      el.resultList.innerHTML = `
        <li><b>File:</b> ${outName}</li>
        <li><b>Size:</b> ${formatBytes(blob.size)}</li>
        <li><b>Resolution:</b> ${state.width}×${state.height} (preserved)</li>
        <li><b>Duration:</b> ${formatTime(state.duration)} (preserved)</li>
        <li><b>Look:</b> ${lookName}</li>
        <li><b>Sharpness:</b> ${state.sharpness}</li>
      `;
      el.resultBlock.classList.remove("hidden");
      updateProgress(100);
      setStage("Done");

      saveHistory({
        filename: state.file.name,
        date: new Date().toISOString(),
        look: lookName,
        sharpness: state.sharpness,
        status: "success",
        outputName: outName,
      });
    } catch (err) {
      if (err instanceof CancelError) {
        setStage("Cancelled");
        showError("Processing was cancelled. Your original file was never modified.", null);
      } else {
        showError("Unable to process this video on the server. Your original file is safe.", err);
        saveHistory({
          filename: state.file.name,
          date: new Date().toISOString(),
          look: LOOKS.find((l) => l.id === state.look)?.name || "Custom",
          sharpness: state.sharpness,
          status: "failed",
          outputName: "-",
        });
      }
    } finally {
      clearInterval(timerHandle);
      clearInterval(pollHandle);
      state.processing = false;
      el.processBtn.disabled = false;
      el.cancelBtn.classList.add("hidden");
    }
  }

  class CancelError extends Error {}

  async function cancelProcessing() {
    state.cancelRequested = true;
    clearInterval(pollHandle);
    // Note: this stops the browser from waiting on the job; the server-side ffmpeg process for
    // that job id keeps running to completion in this skeleton (no server-side kill wired up yet).
  }

  function updateProgress(pct) {
    el.progressFill.style.width = pct + "%";
    el.progressPercent.textContent = pct + "%";
  }
  function setStage(stage) {
    el.progressStage.textContent = stage;
  }

  // ---------- ERRORS ----------
  function showError(message, err, isWarning) {
    el.errorBlock.classList.remove("hidden");
    el.errorMessage.textContent = message;
    el.errorDetail.textContent = err ? (err.stack || err.message || String(err)) : "";
    el.errorBlock.style.borderColor = isWarning ? "var(--accent)" : "var(--danger)";
  }
  function hideError() {
    el.errorBlock.classList.add("hidden");
  }
  function resetOutputUI() {
    el.resultBlock.classList.add("hidden");
    el.progressBlock.classList.add("hidden");
    hideError();
  }

  // ---------- HISTORY (local only, no video files stored) ----------
  const HISTORY_KEY = "cinematic_crisp_history";
  function saveHistory(entry) {
    try {
      const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      list.unshift(entry);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
      renderHistory();
    } catch (_) {}
  }
  function renderHistory() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (_) {}
    el.historyList.innerHTML = list.length
      ? list
          .map(
            (h) => `
        <div class="history-item">
          <span><b>${escapeHTML(h.filename)}</b><br>${new Date(h.date).toLocaleString()} · ${h.look} · Sharpness ${h.sharpness}</span>
          <span style="color:${h.status === "success" ? "var(--good)" : "var(--danger)"}">${h.status}</span>
        </div>`
          )
          .join("")
      : `<div class="history-item"><span>No history yet</span></div>`;
  }
  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- HELPERS ----------
  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }
  function formatTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function buildOutputFilename(originalName) {
    const base = originalName.replace(/\.[^/.]+$/, "");
    const lookId = state.look;
    return `${base}_cinematic-crisp_${lookId}_s${state.sharpness}.mp4`;
  }

  // ---------- INIT ----------
  renderLooks();
  renderAdvanced();
  renderHistory();
  initEngine();
})();
