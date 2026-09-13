#!/usr/bin/env node
/**
 * Concat recipe clips into a 20s or 40s master.
 *
 *   node scripts/stitch-ad.mjs \
 *     --out /tmp/master.mp4 \
 *     --aspect 9:16 \
 *     --clip hook.mp4:4 --clip body.mp4:10 --clip end.mp4:6
 */
import { spawnSync } from "node:child_process";

const ASPECT = {
  "9:16": [720, 1280],
  "16:9": [1280, 720],
  "1:1": [720, 720],
};

function argAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  return r.status === 0;
}

export function parseClip(spec) {
  const idx = spec.lastIndexOf(":");
  if (idx < 0) return { path: spec, seconds: 6 };
  const seconds = Number(spec.slice(idx + 1));
  return { path: spec.slice(0, idx), seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 6 };
}

export function stitchClips({ clips, outPath, aspect = "9:16", crf = 30, width, height }) {
  const [aw, ah] = ASPECT[aspect] || ASPECT["9:16"];
  const w = width || aw;
  const h = height || ah;
  const inputs = [];
  const filters = [];
  for (let i = 0; i < clips.length; i += 1) {
    const c = clips[i];
    inputs.push("-i", c.path);
    filters.push(
      `[${i}:v]trim=duration=${c.seconds},setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=24,format=yuv420p[v${i}]`,
    );
  }
  const concatIn = clips.map((_, i) => `[v${i}]`).join("");
  filters.push(`${concatIn}concat=n=${clips.length}:v=1:a=0[v]`);
  return runFfmpeg([
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    "-preset",
    "fast",
    "-an",
    "-movflags",
    "+faststart",
    outPath,
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = arg("out");
  const aspect = arg("aspect", "9:16");
  const clips = argAll("clip").map(parseClip);
  if (!out || clips.length === 0) {
    console.error("Usage: stitch-ad.mjs --out FILE --aspect 9:16 --clip path:seconds [...]");
    process.exit(1);
  }
  const ok = stitchClips({ clips, outPath: out, aspect, crf: Number(arg("crf", "30")) || 30 });
  process.exit(ok ? 0 : 1);
}
