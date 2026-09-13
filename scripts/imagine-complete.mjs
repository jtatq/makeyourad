#!/usr/bin/env node
/**
 * Post a SuperGrok Imagine still or clip back onto an order.
 * After the last master-timeline clip, stitches the 20s/40s ad and posts it too.
 *
 *   node scripts/imagine-complete.mjs \
 *     --host https://makeyourad.com \
 *     --token makeyourad-operator \
 *     --order ord_... \
 *     --slot hook \
 *     --kind still \
 *     --file /workspace/artifacts/imagine_images/foo.png
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { stitchClips } from "./stitch-ad.mjs";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  return r.status === 0;
}

const host = arg("host").replace(/\/$/, "");
const token = arg("token", process.env.IMAGINE_WORKER_TOKEN || process.env.OPERATOR_TOKEN || "mya-imagine-supergrok");
const orderId = arg("order");
const slotId = arg("slot");
const kind = arg("kind", "still") === "video" ? "video" : "still";
let file = arg("file");
if (!host || !orderId || !slotId || !file) {
  console.error("Usage: imagine-complete.mjs --host URL --order ID --slot SLOT --kind still|video --file PATH [--token TOKEN]");
  process.exit(1);
}

let mime = kind === "video" ? "video/mp4" : "image/jpeg";
let filename = `${slotId}-gen${kind === "video" ? ".mp4" : ".jpg"}`;

if (kind === "still") {
  const jpg = file.replace(/\.[^.]+$/, "") + ".mya.jpg";
  if (runFfmpeg(["-i", file, "-q:v", "4", jpg])) {
    file = jpg;
    mime = "image/jpeg";
  } else {
    const ext = extname(file).toLowerCase();
    mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    filename = `${slotId}-gen${ext || ".jpg"}`;
  }
} else {
  const mp4 = file.replace(/\.[^.]+$/, "") + ".mya.mp4";
  if (
    runFfmpeg([
      "-i",
      file,
      "-c:v",
      "libx264",
      "-crf",
      "28",
      "-preset",
      "fast",
      "-an",
      "-movflags",
      "+faststart",
      "-vf",
      "scale=720:-2",
      mp4,
    ])
  ) {
    file = mp4;
  }
  mime = "video/mp4";
  filename = `${slotId}-gen.mp4`;
}

async function postComplete(payload) {
  const res = await fetch(`${host}/api/operator/imagine/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(res.status, text.slice(0, 500));
    process.exit(1);
  }
  try {
    return JSON.parse(text);
  } catch {
    console.log(text);
    return null;
  }
}

async function asDataUrl(path, fileMime, name) {
  let buf = await readFile(path);
  let info = await stat(path);
  if (info.size > 4_200_000 && fileMime === "video/mp4") {
    const smaller = path.replace(/\.mp4$/, ".small.mp4");
    if (
      runFfmpeg([
        "-i",
        path,
        "-c:v",
        "libx264",
        "-crf",
        "34",
        "-preset",
        "fast",
        "-an",
        "-movflags",
        "+faststart",
        "-vf",
        "scale=540:-2",
        smaller,
      ])
    ) {
      buf = await readFile(smaller);
      info = await stat(smaller);
      path = smaller;
    }
  }
  if (info.size > 4_200_000) {
    console.error(`File too large after compress (${info.size} bytes).`);
    process.exit(2);
  }
  return { dataUrl: `data:${fileMime};base64,${buf.toString("base64")}`, filename: name, path };
}

const packed = await asDataUrl(file, mime, basename(filename));
const result = await postComplete({
  orderId,
  slotId,
  kind,
  filename: packed.filename,
  mime,
  dataUrl: packed.dataUrl,
});
console.log(JSON.stringify({ ok: true, slotId, kind, stitch: Boolean(result?.stitch) }));

if (kind === "video" && result?.stitch?.clips?.length) {
  const dir = "/tmp/mya-stitch";
  await mkdir(dir, { recursive: true });
  const local = [];
  for (const clip of result.stitch.clips) {
    const dest = join(dir, `${clip.slotId}.mp4`);
    const res = await fetch(clip.url);
    if (!res.ok) {
      console.error(`Failed to fetch ${clip.slotId} for stitch (${res.status})`);
      process.exit(3);
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    local.push({ path: dest, seconds: clip.seconds });
  }
  const out = join(dir, result.stitch.filename || "master.mp4");
  const aspect = result.stitch.aspectRatio || "9:16";
  let ok = stitchClips({ clips: local, outPath: out, aspect, crf: result.stitch.durationSeconds >= 40 ? 32 : 30 });
  if (!ok) {
    console.error("ffmpeg stitch failed");
    process.exit(4);
  }
  const master = await asDataUrl(out, "video/mp4", result.stitch.filename);
  await postComplete({
    orderId,
    slotId: "master",
    kind: "video",
    filename: master.filename,
    mime: "video/mp4",
    dataUrl: master.dataUrl,
  });
  console.log(JSON.stringify({ ok: true, slotId: "master", kind: "video", filename: master.filename }));
}
