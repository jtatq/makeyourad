import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getAsset } from "./orders.server";

const execFileAsync = promisify(execFile);

function ffmpegBin(): string {
  try {
    const require = createRequire(import.meta.url);
    const packed = require("ffmpeg-static") as string | null;
    if (packed) return packed;
  } catch {
    /* use PATH */
  }
  return "ffmpeg";
}

async function runFfmpeg(args: string[]) {
  await execFileAsync(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    timeout: 180_000,
    maxBuffer: 8_000_000,
  });
}

function assetIdFromUrl(url: string): string | null {
  const m = url.match(/\/api\/files\/([A-Za-z0-9_:-]+)/);
  return m?.[1] ?? null;
}

async function materialize(url: string, dest: string): Promise<void> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    await writeFile(dest, Buffer.from(url.slice(comma + 1), "base64"));
    return;
  }
  const assetId = assetIdFromUrl(url);
  if (assetId) {
    const asset = await getAsset(assetId);
    if (asset?.data_url?.startsWith("data:")) {
      const comma = asset.data_url.indexOf(",");
      await writeFile(dest, Buffer.from(asset.data_url.slice(comma + 1), "base64"));
      return;
    }
    if (asset?.external_url && /^https?:\/\//.test(asset.external_url)) {
      url = asset.external_url;
    }
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Could not fetch a clip (${res.status})`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

const ASPECT: Record<string, [number, number]> = {
  "9:16": [720, 1280],
  "16:9": [1280, 720],
  "1:1": [720, 720],
};

export async function stitchMasterFile(opts: {
  clips: Array<{ url: string; seconds: number; slotId: string }>;
  aspect: "9:16" | "16:9" | "1:1";
  crf?: number;
}): Promise<Buffer> {
  if (opts.clips.length === 0) throw new Error("No clips to stitch");
  const dir = await mkdtemp(join(tmpdir(), "mya-stitch-"));
  const [w, h] = ASPECT[opts.aspect] ?? ASPECT["9:16"];
  const crf = opts.crf ?? 30;
  try {
    const parts: string[] = [];
    for (let i = 0; i < opts.clips.length; i += 1) {
      const raw = join(dir, `in-${i}.mp4`);
      const out = join(dir, `p-${i}.mp4`);
      await materialize(opts.clips[i].url, raw);
      const seconds = Math.max(1, opts.clips[i].seconds);
      try {
        await runFfmpeg([
          "-i",
          raw,
          "-t",
          String(seconds),
          "-vf",
          `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=24,format=yuv420p`,
          "-af",
          "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          String(crf),
          "-c:a",
          "aac",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-movflags",
          "+faststart",
          out,
        ]);
      } catch {
        await runFfmpeg([
          "-i",
          raw,
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-t",
          String(seconds),
          "-vf",
          `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=24,format=yuv420p`,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          String(crf),
          "-c:a",
          "aac",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-shortest",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-movflags",
          "+faststart",
          out,
        ]);
      }
      parts.push(out);
    }
    const list = join(dir, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n"));
    const master = join(dir, "master.mp4");
    await runFfmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", master]);
    return await readFile(master);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
