// worker/render-worker.ts
// AvatarG Render Worker (Fly.io) — Production TypeScript Edition
import { createClient } from "@supabase/supabase-js";
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
function requireEnv(name) {
    const v = process.env[name];
    if (!v) {
        console.error(`❌ Missing env var: ${name}`);
        process.exit(1);
    }
    return v;
}
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const RENDER_JOBS_TABLE = process.env.SUPABASE_RENDER_JOBS_TABLE || "render_jobs";
const VIDEO_BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "renders";
const POLL_INTERVAL_MS = Math.max(250, Number(process.env.POLL_INTERVAL_MS || "2000"));
const IDLE_HEARTBEAT_MS = Math.max(5000, Number(process.env.IDLE_HEARTBEAT_MS || "30000"));
const MAX_BACKOFF_MS = Math.max(3000, Number(process.env.MAX_BACKOFF_MS || "30000"));
const FETCH_TIMEOUT_MS = Math.max(2000, Number(process.env.FETCH_TIMEOUT_MS || "45000"));
const FETCH_RETRIES = Math.max(0, Number(process.env.FETCH_RETRIES || "2"));
const JOB_MAX_RUNTIME_MS = Math.max(30_000, Number(process.env.JOB_MAX_RUNTIME_MS || String(25 * 60 * 1000)));
const PROGRESS_MIN_INTERVAL_MS = Math.max(250, Number(process.env.PROGRESS_MIN_INTERVAL_MS || "1500"));
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FONT_DIR = process.env.FONT_DIR || "/app/fonts";
const GEORGIAN_FONT_NAME = process.env.GEORGIAN_FONT_NAME || "Noto Sans Georgian";
const STATUS_QUEUED = process.env.STATUS_QUEUED || "queued";
const STATUS_PROCESSING = process.env.STATUS_PROCESSING || "processing";
const STATUS_COMPLETED = process.env.STATUS_COMPLETED || "completed";
const STATUS_FAILED = process.env.STATUS_FAILED || "failed";
const WORKER_ID = process.env.WORKER_ID || `worker_${Math.random().toString(36).slice(2)}_${Date.now()}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();
function safeJson(v) {
    try {
        return JSON.stringify(v);
    }
    catch {
        return String(v);
    }
}
function normalizeError(e) {
    if (!e)
        return "Unknown error";
    if (e instanceof Error)
        return e.message;
    if (typeof e === "string")
        return e;
    if (typeof e?.message === "string")
        return e.message;
    return safeJson(e);
}
function logInfo(msg) {
    console.log(`[${nowISO()}] [worker=${WORKER_ID}] ${msg}`);
}
function logWarn(msg) {
    console.warn(`[${nowISO()}] [worker=${WORKER_ID}] ⚠️ ${msg}`);
}
function logErr(msg) {
    console.error(`[${nowISO()}] [worker=${WORKER_ID}] ❌ ${msg}`);
}
function safeFileName(s) {
    return String(s || "")
        .replace(/[^a-zA-Z0-9.-]/g, "")
        .slice(0, 120);
}
function runCmd(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: "pipe", ...opts });
        let out = "";
        let err = "";
        if (p.stdout) {
            p.stdout.on("data", (d) => (out += d.toString()));
        }
        if (p.stderr) {
            p.stderr.on("data", (d) => (err += d.toString()));
        }
        p.on("error", (e) => {
            reject(new Error(`Spawn failed: ${cmd} ${args.join(" ")}\n${normalizeError(e)}`));
        });
        p.on("close", (code) => {
            if (code === 0)
                return resolve({ out, err });
            reject(new Error(`Command failed: ${cmd} ${args.join(" ")}\ncode=${code}\n${err || out}`));
        });
    });
}
async function assertFfmpeg() {
    await runCmd(FFMPEG_BIN, ["-version"]).catch((e) => {
        logErr("FFmpeg not available. Ensure Dockerfile installs ffmpeg.");
        throw e;
    });
}
function isDataAudioUrl(s) {
    return typeof s === "string" && s.startsWith("data:audio/") && s.includes("base64,");
}
function dataUrlToBuffer(dataUrl) {
    const idx = dataUrl.indexOf("base64,");
    const b64 = idx >= 0 ? dataUrl.slice(idx + "base64,".length) : dataUrl;
    return Buffer.from(b64, "base64");
}
async function fetchWithTimeout(url, opts = {}) {
    if (typeof fetch !== "function") {
        throw new Error("global fetch() not available (Node 18+ required).");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function fetchWithRetry(url, opts = {}, retries = FETCH_RETRIES) {
    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fetchWithTimeout(url, opts);
        }
        catch (e) {
            lastErr = e;
            if (i < retries)
                await sleep(500 * (i + 1));
        }
    }
    throw lastErr || new Error("fetch failed");
}
async function downloadToFile(url, destPath) {
    const res = await fetchWithRetry(url);
    if (!res.ok)
        throw new Error(`Download failed ${res.status}: ${url}`);
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    const ws = fs.createWriteStream(destPath);
    try {
        if (res.body) {
            const nodeReadable = Readable.fromWeb(res.body);
            await pipeline(nodeReadable, ws);
        }
        else {
            const ab = await res.arrayBuffer();
            await fsp.writeFile(destPath, Buffer.from(ab));
        }
    }
    catch (e) {
        try {
            ws.destroy();
        }
        catch { }
        try {
            await fsp.unlink(destPath);
        }
        catch { }
        throw e;
    }
}
function escapeForFfmpegFilterPath(p) {
    return String(p)
        .replace(/\\/g, "\\\\")
        .replace(/:/g, "\\:")
        .replace(/'/g, "\\'")
        .replace(/\n/g, "");
}
function concatFileLine(p) {
    const safe = String(p).replace(/'/g, "'\\''");
    return `file '${safe}'`;
}
function buildSrt(payload) {
    const editedScenes = payload?.edited?.scenes || [];
    const scenesKa = payload?.localized?.scenes_ka || [];
    const mapKa = new Map();
    for (const s of scenesKa) {
        if (s?.id)
            mapKa.set(s.id, s);
    }
    let t = 0;
    let idx = 1;
    const lines = [];
    function fmtTime(sec) {
        const s = Math.max(0, sec);
        const hh = String(Math.floor(s / 3600)).padStart(2, "0");
        const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
        const ss = String(Math.floor(s % 60)).padStart(2, "0");
        const ms = String(Math.floor((s - Math.floor(s)) * 1000)).padStart(3, "0");
        return `${hh}:${mm}:${ss},${ms}`;
    }
    for (const sc of editedScenes) {
        const dur = Number(sc?.durationSec || 0) || 8;
        const start = t;
        const end = t + dur;
        t = end;
        const ka = mapKa.get(sc?.id);
        const txt = (ka?.narration_ka || ka?.action_ka || "").toString().trim();
        if (!txt)
            continue;
        lines.push(String(idx++));
        lines.push(`${fmtTime(start)} --> ${fmtTime(end)}`);
        lines.push(txt);
        lines.push("");
    }
    if (lines.length === 0)
        return "1\n00:00:00,000 --> 00:00:05,000\n \n";
    return lines.join("\n");
}
const dbCaps = {
    supportsUpdatedAt: true,
    supportsWorkerId: true,
};
async function safeUpdate(jobId, patch) {
    const base = { ...patch };
    const withUpdatedAt = dbCaps.supportsUpdatedAt
        ? { ...base, updated_at: nowISO() }
        : base;
    const { error } = await supabase.from(RENDER_JOBS_TABLE).update(withUpdatedAt).eq("id", jobId);
    if (!error)
        return;
    const msg = String(error.message || "");
    if (dbCaps.supportsUpdatedAt && /column .*updated_at.* does not exist/i.test(msg)) {
        dbCaps.supportsUpdatedAt = false;
        const { error: e2 } = await supabase.from(RENDER_JOBS_TABLE).update(base).eq("id", jobId);
        if (!e2)
            return;
        throw new Error(`DB update error: ${e2.message}`);
    }
    if (dbCaps.supportsWorkerId && /column .*worker_id.* does not exist/i.test(msg)) {
        dbCaps.supportsWorkerId = false;
        const { worker_id, ...rest } = base;
        const patch2 = dbCaps.supportsUpdatedAt ? { ...rest, updated_at: nowISO() } : rest;
        const { error: e2 } = await supabase.from(RENDER_JOBS_TABLE).update(patch2).eq("id", jobId);
        if (!e2)
            return;
        throw new Error(`DB update error: ${e2.message}`);
    }
    throw new Error(`DB update error: ${error.message}`);
}
async function updateJob(jobId, patch) {
    await safeUpdate(jobId, patch);
}
async function getJobById(jobId) {
    const { data, error } = await supabase
        .from(RENDER_JOBS_TABLE)
        .select("*")
        .eq("id", jobId)
        .maybeSingle();
    if (error)
        throw new Error(`DB select error: ${error.message}`);
    return data || null;
}
async function uploadFinalVideo(localPath, objectPath) {
    const buf = await fsp.readFile(localPath);
    const { error } = await supabase.storage.from(VIDEO_BUCKET).upload(objectPath, buf, {
        contentType: "video/mp4",
        upsert: true,
    });
    if (error)
        throw new Error(`Upload error: ${error.message}`);
    const { data } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(objectPath);
    return data?.publicUrl || "";
}
async function claimNextJob() {
    try {
        const { data, error } = await supabase.rpc("claim_render_job", {
            p_worker_id: WORKER_ID,
        });
        if (error) {
            logWarn(`RPC claim_render_job failed: ${error.message}`);
            return null;
        }
        if (!data || !data.id) {
            return null;
        }
        logInfo(`🎯 Claimed job ${data.id}`);
        return data;
    }
    catch (err) {
        logErr(`Exception in claimNextJob: ${normalizeError(err)}`);
        return null;
    }
}
async function processJob(job) {
    const jobId = job?.id;
    let payload = job?.payload;
    if (!jobId) {
        logWarn("Job missing id");
        return;
    }
    if (!payload) {
        const full = await getJobById(jobId);
        payload = full?.payload;
    }
    if (!payload) {
        logErr(`Job ${jobId} has no payload. Marking as failed.`);
        try {
            await updateJob(jobId, {
                status: STATUS_FAILED,
                error_message: "Missing payload (RPC returned incomplete row)",
                finished_at: nowISO(),
                completed_at: undefined,
                progress: 0,
            });
        }
        catch { }
        return;
    }
    const requestId = payload?.requestId || payload?.input?.requestId || String(jobId);
    logInfo(`🎬 Processing job=${jobId} requestId=${requestId}`);
    const jobStart = Date.now();
    let lastProgressWrite = 0;
    const writeProgress = async (progress) => {
        const t = Date.now();
        if (t - lastProgressWrite < PROGRESS_MIN_INTERVAL_MS)
            return;
        lastProgressWrite = t;
        await updateJob(jobId, { progress });
    };
    const baseStartPatch = {
        status: STATUS_PROCESSING,
        started_at: nowISO(),
        finished_at: undefined,
        completed_at: undefined,
        error_message: undefined,
        result: undefined,
        progress: 1,
    };
    await updateJob(jobId, {
        ...baseStartPatch,
        worker_id: WORKER_ID,
    });
    const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "render-"));
    const scenesDir = path.join(workdir, "scenes");
    await fsp.mkdir(scenesDir, { recursive: true });
    try {
        await assertFfmpeg();
        const editedScenes = payload?.edited?.scenes || [];
        const videos = payload?.videos || [];
        const voiceovers = payload?.voiceovers?.voiceovers || [];
        if (!Array.isArray(editedScenes) || editedScenes.length === 0) {
            throw new Error("payload.edited.scenes is empty");
        }
        const videoMap = new Map();
        for (const v of Array.isArray(videos) ? videos : []) {
            if (v?.sceneId && v?.videoUrl)
                videoMap.set(v.sceneId, v.videoUrl);
        }
        const audioMap = new Map();
        for (const a of Array.isArray(voiceovers) ? voiceovers : []) {
            if (a?.sceneId && a?.audioUrl)
                audioMap.set(a.sceneId, a.audioUrl);
        }
        const srtPath = path.join(workdir, "subs.srt");
        await fsp.writeFile(srtPath, buildSrt(payload), "utf8");
        const segmentPaths = [];
        for (let i = 0; i < editedScenes.length; i++) {
            if (Date.now() - jobStart > JOB_MAX_RUNTIME_MS) {
                throw new Error(`Job exceeded max runtime (${JOB_MAX_RUNTIME_MS}ms)`);
            }
            const sc = editedScenes[i];
            const sceneIdRaw = sc?.id || `scene_${i + 1}`;
            const sceneId = safeFileName(sceneIdRaw);
            const dur = Number(sc?.durationSec || 8) || 8;
            const srcVideoUrl = videoMap.get(sceneIdRaw) || videoMap.get(sceneId);
            if (!srcVideoUrl)
                throw new Error(`Missing videoUrl for ${sceneIdRaw}`);
            if (typeof srcVideoUrl !== "string" || !srcVideoUrl.startsWith("http")) {
                throw new Error(`Invalid videoUrl for ${sceneIdRaw} (must be http/https)`);
            }
            const rawVideoPath = path.join(scenesDir, `${sceneId}.mp4`);
            await downloadToFile(srcVideoUrl, rawVideoPath);
            const audioUrl = audioMap.get(sceneIdRaw) || audioMap.get(sceneId) || "";
            const audioPath = path.join(scenesDir, `${sceneId}.mp3`);
            if (isDataAudioUrl(audioUrl)) {
                await fsp.writeFile(audioPath, dataUrlToBuffer(audioUrl));
            }
            else if (typeof audioUrl === "string" && audioUrl.startsWith("http")) {
                await downloadToFile(audioUrl, audioPath);
            }
            else {
                await runCmd(FFMPEG_BIN, [
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=44100:cl=stereo",
                    "-t",
                    String(dur),
                    "-q:a",
                    "9",
                    "-acodec",
                    "libmp3lame",
                    audioPath,
                ]);
            }
            const segPath = path.join(scenesDir, `${sceneId}.seg.mp4`);
            const vf = "scale=1080:1920:force_original_aspect_ratio=increase," +
                "crop=1080:1920," +
                "fps=30,format=yuv420p";
            await runCmd(FFMPEG_BIN, [
                "-y",
                "-i",
                rawVideoPath,
                "-i",
                audioPath,
                "-t",
                String(dur),
                "-vf",
                vf,
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-shortest",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "44100",
                "-ac",
                "2",
                segPath,
            ]);
            segmentPaths.push(segPath);
            const pct = Math.min(95, Math.round(((i + 1) / editedScenes.length) * 80) + 10);
            await writeProgress(pct);
            logInfo(`✅ Segment: ${sceneIdRaw} (${dur}s)`);
        }
        if (segmentPaths.length === 0)
            throw new Error("No segments produced");
        const concatListPath = path.join(workdir, "concat.txt");
        await fsp.writeFile(concatListPath, segmentPaths.map(concatFileLine).join("\n"), "utf8");
        const joinedPath = path.join(workdir, "joined.mp4");
        await runCmd(FFMPEG_BIN, [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concatListPath,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "44100",
            "-ac",
            "2",
            joinedPath,
        ]);
        const finalPath = path.join(workdir, "final.mp4");
        let canBurnSubs = true;
        try {
            await fsp.access(FONT_DIR);
        }
        catch {
            canBurnSubs = false;
            logWarn(`FONT_DIR not found: ${FONT_DIR} — exporting without subtitles`);
        }
        if (canBurnSubs) {
            const srtEsc = escapeForFfmpegFilterPath(srtPath);
            const fontDirEsc = escapeForFfmpegFilterPath(FONT_DIR);
            const subFilter = `subtitles='${srtEsc}':fontsdir='${fontDirEsc}':` +
                `force_style='FontName=${GEORGIAN_FONT_NAME},FontSize=48,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,BorderStyle=3,Outline=2,Shadow=0,MarginV=80'`;
            try {
                await runCmd(FFMPEG_BIN, [
                    "-y",
                    "-i",
                    joinedPath,
                    "-vf",
                    subFilter,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "19",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    finalPath,
                ]);
            }
            catch (e) {
                logWarn(`Subtitle burn failed, exporting without subs: ${normalizeError(e)}`);
                await runCmd(FFMPEG_BIN, [
                    "-y",
                    "-i",
                    joinedPath,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "19",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    finalPath,
                ]);
            }
        }
        else {
            await runCmd(FFMPEG_BIN, [
                "-y",
                "-i",
                joinedPath,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "19",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "44100",
                "-ac",
                "2",
                finalPath,
            ]);
        }
        const objectPath = `renders/${encodeURIComponent(requestId)}/${crypto
            .randomUUID()
            .replace(/-/g, "")}.mp4`;
        const publicUrl = await uploadFinalVideo(finalPath, objectPath);
        if (!publicUrl) {
            throw new Error("Upload ok but publicUrl empty (bucket must be PUBLIC)");
        }
        const doneAt = nowISO();
        await updateJob(jobId, {
            status: STATUS_COMPLETED,
            progress: 100,
            finished_at: doneAt,
            completed_at: doneAt,
            result: { publicUrl, bucket: VIDEO_BUCKET, objectPath, requestId },
            error_message: undefined,
        });
        logInfo(`🏁 Completed job=${jobId} -> ${publicUrl}`);
    }
    catch (err) {
        const msg = normalizeError(err);
        logErr(`Render failed job=${jobId}: ${msg}`);
        try {
            await updateJob(jobId, {
                status: STATUS_FAILED,
                error_message: msg,
                finished_at: nowISO(),
                completed_at: undefined,
                progress: 0,
            });
        }
        catch (e2) {
            logErr(`Failed to write error to DB: ${normalizeError(e2)}`);
        }
    }
    finally {
        try {
            await fsp.rm(workdir, { recursive: true, force: true });
        }
        catch { }
    }
}
let shouldStop = false;
process.on("SIGTERM", () => {
    logWarn("SIGTERM received. Finishing current work then exit.");
    shouldStop = true;
});
process.on("SIGINT", () => {
    logWarn("SIGINT received. Finishing current work then exit.");
    shouldStop = true;
});
async function main() {
    logInfo("🟢 AvatarG Render Worker started (TypeScript)");
    await assertFfmpeg();
    let backoff = POLL_INTERVAL_MS;
    let heartbeatAt = Date.now();
    while (!shouldStop) {
        try {
            const job = await claimNextJob();
            if (!job) {
                if (Date.now() - heartbeatAt > IDLE_HEARTBEAT_MS) {
                    heartbeatAt = Date.now();
                    logInfo("💤 Idle - waiting for jobs...");
                }
                await sleep(backoff);
                backoff = POLL_INTERVAL_MS;
                continue;
            }
            logInfo(`🧾 Got job=${job.id}`);
            backoff = POLL_INTERVAL_MS;
            await processJob(job);
        }
        catch (err) {
            logWarn(`Worker loop error: ${normalizeError(err)}`);
            backoff = Math.min(Math.max(backoff * 2, POLL_INTERVAL_MS), MAX_BACKOFF_MS);
            await sleep(backoff);
        }
    }
    logInfo("✅ Worker stopped gracefully.");
    process.exit(0);
}
main().catch((e) => {
    logErr(`FATAL: ${normalizeError(e)}`);
    process.exit(1);
});
