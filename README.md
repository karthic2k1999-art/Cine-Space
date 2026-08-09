# Cinematic Crisp

Remove Digital Sharpness. Preserve Real Detail.

A real, working, client-side video processing web app. No backend server, no upload to
any cloud — everything runs in your own phone/browser using **ffmpeg.wasm**, which is the
actual FFmpeg engine compiled to WebAssembly (not a simulation).

## How this build works now (backend, not browser-side wasm)

This frontend no longer runs FFmpeg in the browser. It uploads your video to **your own
backend server** (see `/backend` in this project — real Node + real `ffmpeg` binary) and
downloads the processed result back. You must deploy that backend once (Render.com free
tier works — see `backend/README.md`) and paste its URL into the **Backend Server** box at
the top of the site, then tap **Save**.

If the backend has been idle (Render free tier sleeps), the first request can take 30–50
seconds to wake it up — the app tells you this instead of looking stuck.

## How to deploy the frontend (GitHub Pages) — mobile-friendly, step by step

**⚠️ Important — the #1 cause of a blank page:** the 4 files (`index.html`, `style.css`,
`app.js`, `README.md`) must sit **directly in the repo root**, NOT inside a subfolder, and
you must **extract the zip first** — never upload the `.zip` file itself to GitHub.

1. On github.com (mobile browser is fine), create a **new repository** (e.g. `cinematic-crisp`).
2. On your phone, extract `cinematic-crisp.zip` using your file manager's "Extract"/"Unzip"
   option. You'll get a folder containing `index.html`, `style.css`, `app.js`, `README.md`.
3. In the new GitHub repo, tap **Add file → Upload files**, then select all 4 files from
   inside the extracted folder (not the zip, not the folder itself — the 4 files individually).
   Confirm the repo's file list shows `index.html` sitting at the top level (not inside
   `cinematic-crisp/index.html`).
4. Commit the upload.
5. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`. Save.
6. Wait 1–2 minutes for the first build (Settings → Pages will show a green "Your site is
   live at…" banner when ready — if it still says building, wait and refresh that settings
   page, don't just retry the site URL immediately).
7. Open the URL GitHub gives you: `https://<your-username>.github.io/<repo-name>/`
   — **note the trailing slash**. If you open it and it doesn't work, wait another minute
   and hard-refresh (in Chrome: menu → the page → pull down to refresh).
8. If you ever see a blank/white page: it means either the files ended up in a subfolder
   (check step 3), or the build isn't finished yet (check step 6) — it does **not** mean the
   app itself is broken, since the page has a dark background and visible upload button as
   soon as the HTML loads, before any JavaScript even runs. This build also now shows a
   visible red error box instead of ever going silently blank if something does fail.
9. Once open on your phone → tap **Upload Video** → adjust **Sharpness** / choose a
   **Look** → drag the before/after line to compare → **Process Video** → **Download Video**.

No build step needed (no `npm install`, no Vite). Just static files. This version loads the
FFmpeg engine from jsDelivr first, and automatically falls back to unpkg if jsDelivr is
blocked on your network.

## What is real here

- **Sharpness slider (-100 to +100)** actually changes real FFmpeg `unsharp` and `gblur`
  filter parameters and re-encodes the video.
- **Look profiles** (Natural, Cinematic Soft, ARRI-Inspired, IMAX-Inspired, Theatrical,
  Large Format, Organic Camera, Mobile Digital Softening) each set real starting values for
  sharpness + the advanced parameters, which you can still fine-tune afterward.
- **Advanced settings** (Edge Protection, Detail Preservation, Microcontrast, Texture
  Preservation, Softness, Highlight/Shadow Protection, Noise Protection) all feed into the
  real filter chain (`gblur`, `unsharp`, `eq`, `hqdn3d`) with bounded, safe ranges.
- **Before/After preview** shows your actual uploaded video and, after processing, the
  actual processed output — not a mock image.
- **Progress bar** comes from real FFmpeg progress events (`frame=`, `time=`), not random
  numbers.
- **Output validation**: if FFmpeg produces an empty or missing file, the app refuses to
  offer it as a successful download.
- **Original file safety**: the original file is never modified or re-uploaded; a separate
  output blob is created.
- **History**: kept locally in your browser (`localStorage`) — filename, date, look,
  sharpness, status. No video files are stored in it.

## Honest limitations (please read)

This is a **static website**, so a few things from a full desktop app are genuinely not
possible in a browser, and no working web app can honestly claim them:

- **Very large files (multi-GB, e.g. 5–10GB)**: the browser must hold the video in memory
  to process it. Practically, files much above ~500MB–1GB can fail or freeze on a phone,
  depending on your device's RAM. This is a hardware/browser limit, not a fake restriction.
- **Hardware acceleration (NVENC / Quick Sync / VAAPI / VideoToolbox)**: not available to
  WebAssembly in a browser. Encoding uses the CPU (libx264), which is why very high quality
  presets are slower on mobile.
- **Rust/Tauri desktop backend**: this repo is the **web foundation** the original spec asked
  for (see architecture notes below). Turning it into a real desktop app with native FFmpeg,
  hardware acceleration, and true 10GB+ file support requires wrapping this same UI in Tauri
  with a Rust backend that calls native `ffmpeg`/`ffprobe` binaries — that's a separate,
  larger build (happy to do that next if you want it).

If you try a very large file and it fails, that failure message is real (out-of-memory or
similar) — the app will never pretend it succeeded.

## Recommended video size for smooth mobile use

Under ~500MB works comfortably in most mobile browsers. Longer/larger 4K clips will take
longer to process and use more memory; trim/compress first if your phone struggles.
