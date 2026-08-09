# Cinematic Crisp

Remove Digital Sharpness. Preserve Real Detail.

A real, working, client-side video processing web app. No backend server, no upload to
any cloud — everything runs in your own phone/browser using **ffmpeg.wasm**, which is the
actual FFmpeg engine compiled to WebAssembly (not a simulation).

## How to deploy (GitHub Pages)

1. Create a new GitHub repository.
2. Upload these 4 files to the repo root: `index.html`, `style.css`, `app.js`, `README.md`.
3. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/root`. Save.
4. Wait 1-2 minutes, then open the URL GitHub gives you
   (`https://<your-username>.github.io/<repo-name>/`).
5. Open that link on your phone → tap **Upload Video** → adjust **Sharpness** / choose a
   **Look** → drag the before/after line to compare → **Process Video** → **Download Video**.

No build step needed (no `npm install`, no Vite). Just static files.

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
