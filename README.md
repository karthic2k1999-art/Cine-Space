# Cinematic Crisp — Backend (skeleton)

Real Node/Express server. Runs the **actual `ffmpeg` binary** (child_process, not a
simulation) on an uploaded video with the sharpness/look parameters your frontend already
collects, and returns the processed file. This is what fixes "Process Video" not working —
the browser-only `ffmpeg.wasm` version depends on the phone's browser memory/worker support,
which can fail on some devices; a real backend does the encoding on a server instead.

**GitHub Pages cannot run this** — Pages only serves static files (HTML/CSS/JS), it has no
server to run Node or ffmpeg. This backend needs a real Node host. Deploy it separately from
your GitHub Pages frontend.

## Endpoints

- `POST /api/process` — multipart form: `video` (file), `sharpness` (-100..100),
  `adv` (JSON string of advanced settings), `quality` (`low`/`balanced`/`high`/`maximum`).
  Returns `{ jobId }` immediately.
- `GET /api/status/:jobId` — poll this. Returns real progress from ffmpeg
  (`{ status, progress, stage, error, downloadUrl }`).
- `GET /api/download/:jobId` — streams the processed file once `status` is `"done"`.
- `GET /api/health` — confirms ffmpeg is actually installed on the server.

## Deploy (free, no card needed) — Render.com, from your phone

1. Push this `backend/` folder to a **new GitHub repo** (same phone-upload method as before —
   files must sit at repo root: `server.js`, `package.json`, `Dockerfile`, `.gitignore`).
2. Go to render.com → sign up with GitHub → **New → Web Service** → pick that repo.
3. Render will detect the `Dockerfile` automatically — leave "Docker" as the environment.
   Instance type: **Free**.
4. Deploy. First build takes a few minutes (installing ffmpeg). When done, Render gives you
   a URL like `https://cinematic-crisp-backend.onrender.com`.
5. Test it's alive by opening `https://<your-service>.onrender.com/api/health` in the
   browser — should show `{"ok":true,"ffmpeg":"ffmpeg version ..."}`.

Free tier note: the service sleeps after inactivity and takes ~30–50s to wake on the next
request — normal for free hosting, not a bug.

## Run locally (optional, to test before deploying)

```
npm install
node server.js
```
Requires `ffmpeg` + `ffprobe` installed and on PATH (`apt install ffmpeg` on Linux,
`brew install ffmpeg` on Mac).

## Wiring the frontend to this backend

The existing `app.js` (client-side `ffmpeg.wasm` version) still works standalone. To switch
`processVideo()` to call this backend instead, it needs a `fetch("https://<your-backend>/api/process", { method: "POST", body: formData })` call plus a polling loop against
`/api/status/:jobId` in place of the current `ffmpeg.exec(...)` call. Ask and I'll wire that
change into `app.js` directly, once your backend URL is live.

## What's skeleton here (on purpose)

- Jobs are tracked in memory (`Map`) — restarting the server loses in-progress job status.
  Fine for one instance; swap for Redis/a DB if you need multiple server instances.
- Files live on local disk (`/uploads`, `/outputs`) — fine for Render's free tier; swap for
  S3/object storage if you need files to survive redeploys or scale beyond one instance.
- CORS is wide open (`cors()`), quality/size limits are generous (2GB). Tighten both before
  treating this as production rather than a working skeleton.
