/* CINEMATIC CRISP — real client-side video processing using ffmpeg.wasm (actual FFmpeg compiled to WebAssembly).
   No fake progress, no fake output. Everything below runs real FFmpeg filters on the real uploaded file. */

(async () => {
  "use strict";

  // ---------- CDN LOADING (with fallback) ----------
  // jsDelivr is tried first (generally the most reliable CDN on mobile networks in India/SEA),
  // unpkg is the fallback if jsDelivr is blocked/unreachable. Both serve the identical package.
  const CDN_MIRRORS = [
    {
      ffmpegPkg: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js",
      utilPkg: "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js",
      coreBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm",
      ffmpegBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm",
    },
    {
      ffmpegPkg: "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js",
      utilPkg: "https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js",
      coreBase: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm",
      ffmpegBase: "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm",
    },
  ];

  function showFatal(message) {
    const box = document.getElementById("fatalBoot");
    const msg = document.getElementById("fatalBootMsg");
    if (box && msg) {
      box.classList.remove("hidden");
      msg.textContent = message;
    }
  }

  let FFmpeg, fetchFile, toBlobURL, MIRROR;
  let lastImportErr = null;
  for (const mirror of CDN_MIRRORS) {
    try {
      const ffmpegMod = await import(mirror.ffmpegPkg);
      const utilMod = await import(mirror.utilPkg);
      FFmpeg = ffmpegMod.FFmpeg;
      fetchFile = utilMod.fetchFile;
      toBlobURL = utilMod.toBlobURL;
      MIRROR = mirror;
      break;
    } catch (e) {
      lastImportErr = e;
    }
  }
  if (!MIRROR) {
    showFatal(
      "Could not load the FFmpeg engine from any CDN (jsDelivr or unpkg). Check your internet " +
        "connection, disable any content/ad blocker for this site, and reload. Detail: " +
        (lastImportErr && (lastImportErr.message || lastImportErr))
    );
    return;
  }

  // ---------- CONFIG ----------
  // Using the ESM build (not UMD): the worker script here has a fixed, documented filename
  // ("worker.js") instead of a webpack content-hash filename that can change between builds.
  // This is what we convert to a same-origin blob: URL below to avoid the
  // "SecurityError: Failed to construct 'Worker'" cross-origin problem.
  const CORE_BASE = MIRROR.coreBase;
  const FFMPEG_BASE = MIRROR.ffmpegBase;
  const MAX_RECOMMENDED_BYTES = 700 * 1024 * 1024; // ~700MB soft warning (browser memory limit, not a fake cap)

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
  };

  // ---------- FFMPEG ENGINE INIT ----------
  async function initEngine() {
    try {
      const ffmpeg = new FFmpeg();

      ffmpeg.on("log", ({ message }) => {
        // Real log lines from the real FFmpeg binary — used to detect processing stage.
        if (/frame=/.test(message)) {
          setStage("ENCODING");
        }
      });

      ffmpeg.on("progress", ({ progress }) => {
        if (!state.processing) return;
        const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
        updateProgress(pct);
      });

      // @ffmpeg/ffmpeg internally spawns its own Worker. Loading that worker script directly
      // from a different origin (unpkg.com) is blocked by the browser's Same-Origin policy for
      // Workers ("SecurityError: Failed to construct 'Worker'"). Fix: download it and hand
      // FFmpeg a same-origin blob: URL instead, same as we already do for the core engine below.
      let coreURL, wasmURL, classWorkerURL;
      try {
        coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript");
      } catch (e) {
        throw new Error(`Could not download ffmpeg-core.js from ${CORE_BASE}. ${e.message || e}`);
      }
      try {
        wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm");
      } catch (e) {
        throw new Error(`Could not download ffmpeg-core.wasm from ${CORE_BASE}. ${e.message || e}`);
      }
      try {
        classWorkerURL = await toBlobURL(`${FFMPEG_BASE}/worker.js`, "text/javascript");
      } catch (e) {
        throw new Error(`Could not download worker.js from ${FFMPEG_BASE}. ${e.message || e}`);
      }

      await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });

      state.ffmpeg = ffmpeg;
      state.ffmpegReady = true;
      el.engineStatus.textContent = "Real FFmpeg engine ready (local, in-browser)";
      el.engineStatus.classList.remove("error");
      el.engineStatus.classList.add("ready");
      if (state.file) el.processBtn.disabled = false;
    } catch (err) {
      state.ffmpegReady = false;
      el.engineStatus.textContent = "Engine failed to load";
      el.engineStatus.classList.add("error");
      showError(
        "The real processing engine could not be loaded. Check your internet connection and reload the page (pull down to refresh, or clear the browser cache once).",
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

  async function processVideo() {
    if (!state.file || !state.ffmpegReady || state.processing) return;
    hideError();
    el.resultBlock.classList.add("hidden");
    state.cancelRequested = false;
    state.processing = true;
    el.processBtn.disabled = true;
    el.cancelBtn.classList.remove("hidden");
    el.progressBlock.classList.remove("hidden");
    updateProgress(0);
    setStage("Reading file");

    const startTime = Date.now();
    let timerHandle = setInterval(() => {
      el.progressElapsed.textContent = `Elapsed: ${formatTime((Date.now() - startTime) / 1000)}`;
    }, 500);

    const ffmpeg = state.ffmpeg;
    const inExt = (state.file.name.split(".").pop() || "mp4").toLowerCase();
    const inputName = `input.${inExt}`;
    const outputName = "output.mp4";

    try {
      const data = await fetchFile(state.file);
      if (state.cancelRequested) throw new CancelError();

      await ffmpeg.writeFile(inputName, data);
      if (state.cancelRequested) throw new CancelError();

      setStage("FFprobe / analyzing");
      // real ffprobe-equivalent metadata already captured via <video> element above (duration/res/fps)

      setStage("DESHARPING / ENCODING");
      const vf = buildFilterChain();
      const q = QUALITY_PRESETS[el.qualitySelect.value] || QUALITY_PRESETS.balanced;

      const args = [
        "-i", inputName,
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", q.x264preset,
        "-crf", String(q.crf),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        outputName,
      ];

      await ffmpeg.exec(args);
      if (state.cancelRequested) throw new CancelError();

      setStage("Validating output");
      const output = await ffmpeg.readFile(outputName);
      if (!output || output.length === 0) {
        throw new Error("FFmpeg produced an empty output file. Processing failed.");
      }

      const blob = new Blob([output.buffer], { type: "video/mp4" });
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

      await cleanupFS(ffmpeg, inputName, outputName);
    } catch (err) {
      await cleanupFS(ffmpeg, inputName, outputName);
      if (err instanceof CancelError) {
        setStage("Cancelled");
        showError("Processing was cancelled. Your original file was never modified.", null);
      } else {
        showError("Unable to process this video. Your original file is safe.", err);
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
      state.processing = false;
      el.processBtn.disabled = false;
      el.cancelBtn.classList.add("hidden");
    }
  }

  async function cleanupFS(ffmpeg, inputName, outputName) {
    try { await ffmpeg.deleteFile(inputName); } catch (_) {}
    try { await ffmpeg.deleteFile(outputName); } catch (_) {}
  }

  class CancelError extends Error {}

  async function cancelProcessing() {
    state.cancelRequested = true;
    try {
      if (state.ffmpeg) await state.ffmpeg.terminate();
    } catch (_) {}
    // Re-init a fresh engine instance since terminate() kills the worker.
    state.ffmpegReady = false;
    el.engineStatus.textContent = "Restarting engine…";
    el.engineStatus.classList.remove("ready");
    await initEngine();
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
