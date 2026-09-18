import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  hasTextOverlay,
  overlaySvgMarkup,
  overlayTiming,
  type TextOverlaySpec,
} from "./text-overlay.ts";

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

async function runFfprobe(file: string): Promise<{ width: number; height: number; duration: number }> {
  const bin = ffmpegBin().replace(/ffmpeg$/, "ffprobe");
  const probe = bin.endsWith("ffprobe") ? bin : "ffprobe";
  try {
    const { stdout } = await execFileAsync(
      probe,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
      { timeout: 30_000, maxBuffer: 2_000_000 },
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    return {
      width: stream?.width || 1080,
      height: stream?.height || 1920,
      duration: Number(parsed.format?.duration) || 0,
    };
  } catch {
    return { width: 1080, height: 1920, duration: 0 };
  }
}

function assetIdFromUrl(url: string): string | null {
  const m = url.match(/\/api\/files\/([A-Za-z0-9_:-]+)/);
  return m?.[1] ?? null;
}

export async function materializeMedia(url: string, dest: string): Promise<void> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    await writeFile(dest, Buffer.from(url.slice(comma + 1), "base64"));
    return;
  }
  const assetId = assetIdFromUrl(url);
  if (assetId) {
    const { getAsset } = await import("./orders.server");
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
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`Could not fetch media (${res.status})`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function rasterizeOverlay(
  spec: TextOverlaySpec,
  width: number,
  height: number,
  kind: "endCard" | "lowerThird" | "both",
): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const svg = overlaySvgMarkup(spec, width, height, kind);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function overlayStillBuffer(
  input: Buffer,
  spec: TextOverlaySpec,
  kind: "endCard" | "lowerThird" | "both" = "endCard",
): Promise<{ buffer: Buffer; svg: string; mime: "image/jpeg" }> {
  if (!hasTextOverlay(spec)) return { buffer: input, svg: "", mime: "image/jpeg" };
  const { default: sharp } = await import("sharp");
  const base = sharp(input, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const width = meta.width || 1080;
  const height = meta.height || 1920;
  const svg = overlaySvgMarkup(spec, width, height, kind);
  const plate = await sharp(Buffer.from(svg)).png().toBuffer();
  const buffer = await base
    .composite([{ input: plate, blend: "over" }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { buffer, svg, mime: "image/jpeg" };
}

export async function overlayStillFromUrl(
  url: string,
  spec: TextOverlaySpec,
  kind: "endCard" | "lowerThird" | "both" = "endCard",
): Promise<{ buffer: Buffer; svg: string; mime: "image/jpeg" } | null> {
  if (!hasTextOverlay(spec)) return null;
  const dir = await mkdtemp(join(tmpdir(), "mya-ov-still-"));
  const raw = join(dir, "in.bin");
  try {
    await materializeMedia(url, raw);
    const input = await readFile(raw);
    return overlayStillBuffer(input, spec, kind);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function overlayVideoBuffer(
  input: Buffer,
  spec: TextOverlaySpec,
  opts?: { durationHint?: number },
): Promise<{ buffer: Buffer; svgEnd?: string; svgLower?: string }> {
  if (!hasTextOverlay(spec)) return { buffer: input };
  const dir = await mkdtemp(join(tmpdir(), "mya-ov-vid-"));
  const raw = join(dir, "in.mp4");
  const out = join(dir, "out.mp4");
  const endPng = join(dir, "end.png");
  const lowerPng = join(dir, "lower.png");
  try {
    await writeFile(raw, input);
    const probe = await runFfprobe(raw);
    const duration = probe.duration || opts?.durationHint || 15;
    const timing = overlayTiming(duration);
    const filters: string[] = [];
    const inputs = ["-i", raw];
    let last = "0:v";
    let idx = 1;
    let svgEnd: string | undefined;
    let svgLower: string | undefined;

    if (spec.lowerThird?.lines.length) {
      const png = await rasterizeOverlay(spec, probe.width, probe.height, "lowerThird");
      svgLower = overlaySvgMarkup(spec, probe.width, probe.height, "lowerThird");
      await writeFile(lowerPng, png);
      inputs.push("-i", lowerPng);
      const next = "vlt";
      filters.push(
        `[${last}][${idx}:v]overlay=0:0:enable='between(t,${timing.lowerThirdStart.toFixed(2)},${timing.lowerThirdEnd.toFixed(2)})'[${next}]`,
      );
      last = next;
      idx += 1;
    }
    if (spec.endCard?.lines.length) {
      const png = await rasterizeOverlay(spec, probe.width, probe.height, "endCard");
      svgEnd = overlaySvgMarkup(spec, probe.width, probe.height, "endCard");
      await writeFile(endPng, png);
      inputs.push("-i", endPng);
      const next = "vec";
      filters.push(
        `[${last}][${idx}:v]overlay=0:0:enable='gte(t,${timing.endCardStart.toFixed(2)})'[${next}]`,
      );
      last = next;
    }

    if (!filters.length) return { buffer: input };

    try {
      await runFfmpeg([
        ...inputs,
        "-filter_complex",
        filters.join(";"),
        "-map",
        `[${last}]`,
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "28",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        "-shortest",
        out,
      ]);
    } catch {
      await runFfmpeg([
        ...inputs,
        "-filter_complex",
        filters.join(";"),
        "-map",
        `[${last}]`,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "28",
        "-an",
        "-movflags",
        "+faststart",
        out,
      ]);
    }
    return { buffer: await readFile(out), svgEnd, svgLower };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function overlayVideoFromUrl(
  url: string,
  spec: TextOverlaySpec,
  opts?: { durationHint?: number },
): Promise<{ buffer: Buffer; svgEnd?: string; svgLower?: string } | null> {
  if (!hasTextOverlay(spec)) return null;
  const dir = await mkdtemp(join(tmpdir(), "mya-ov-vidin-"));
  const raw = join(dir, "in.mp4");
  try {
    await materializeMedia(url, raw);
    const input = await readFile(raw);
    return overlayVideoBuffer(input, spec, opts);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function fontsReady(): Promise<boolean> {
  const regular = process.env.MYA_OVERLAY_FONT ?? "/usr/share/fonts/truetype/macos/Inter-Regular.ttf";
  try {
    await access(regular);
    return true;
  } catch {
    return false;
  }
}
