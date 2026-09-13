#!/usr/bin/env node
/**
 * Post a SuperGrok Imagine still or clip back onto an order.
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
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

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

const buf = await readFile(file);
const info = await stat(file);
if (info.size > 4_200_000) {
  console.error(`File too large after compress (${info.size} bytes).`);
  process.exit(2);
}
const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

const res = await fetch(`${host}/api/operator/imagine/complete`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    orderId,
    slotId,
    kind,
    filename: basename(filename),
    mime,
    dataUrl,
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(res.status, text.slice(0, 500));
  process.exit(1);
}
console.log(text);
