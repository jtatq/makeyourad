import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  coverBlurRadius,
  coverRectsFor,
  endCardCoverRect,
  hasTextOverlay,
  lowerThirdCoverRect,
  overlaySvgMarkup,
  overlayTiming,
  type CoverRect,
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

async function runFfprobe(
  file: string,
): Promise<{ width: number; height: number; duration: number }> {
  const packed = ffmpegBin().replace(/ffmpeg$/, "ffprobe");
  const candidates = packed.endsWith("ffprobe") ? [packed, "ffprobe"] : ["ffprobe"];
  for (const probe of candidates) {
    try {
      const { stdout } = await execFileAsync(
        probe,
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height:format=duration",
          "-of",
          "json",
          file,
        ],
        { timeout: 30_000, maxBuffer: 2_000_000 },
      );
      const parsed = JSON.parse(stdout) as {
        streams?: Array<{ width?: number; height?: number }>;
        format?: { duration?: string };
      };
      const stream = parsed.streams?.[0];
      const width = stream?.width || 0;
      const height = stream?.height || 0;
      if (width > 0 && height > 0) {
        return { width, height, duration: Number(parsed.format?.duration) || 0 };
      }
    } catch {
      /* try the next ffprobe */
    }
  }
  return { width: 1080, height: 1920, duration: 0 };
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

/** Blur and darken a region so model-burned titles cannot be read under the Sharp type. */
async function softenBurnedType(input: Buffer, rects: CoverRect[]): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  let current = input;
  for (const rect of rects) {
    if (rect.width < 2 || rect.height < 2) continue;
    const meta = await sharp(current).metadata();
    const width = meta.width || rect.width;
    const height = meta.height || rect.height;
    const radius = coverBlurRadius(width, height, rect);
    const blurred = await sharp(current)
      .extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
      .blur(radius)
      .modulate({ brightness: 0.68 })
      .toBuffer();
    const veil = await sharp({
      create: {
        width: rect.width,
        height: rect.height,
        channels: 4,
        background: { r: 6, g: 8, b: 12, alpha: 0.42 },
      },
    })
      .png()
      .toBuffer();
    const covered = await sharp(blurred)
      .composite([{ input: veil, blend: "over" }])
      .png()
      .toBuffer();
    current = await sharp(current)
      .composite([{ input: covered, left: rect.x, top: rect.y }])
      .png()
      .toBuffer();
  }
  return current;
}

export async function overlayStillBuffer(
  input: Buffer,
  spec: TextOverlaySpec,
  kind: "endCard" | "lowerThird" | "both" = "endCard",
): Promise<{ buffer: Buffer; svg: string; mime: "image/jpeg" }> {
  if (!hasTextOverlay(spec)) return { buffer: input, svg: "", mime: "image/jpeg" };
  const { default: sharp } = await import("sharp");
  const oriented = sharp(input, { failOn: "none" }).rotate();
  const meta = await oriented.metadata();
  const width = meta.width || 1080;
  const height = meta.height || 1920;
  let base = await oriented.png().toBuffer();
  try {
    base = Buffer.from(await softenBurnedType(base, coverRectsFor(width, height, spec, kind)));
  } catch {
    /* exact type still composites if the cover pass fails */
  }
  const svg = overlaySvgMarkup(spec, width, height, kind);
  const plate = await sharp(Buffer.from(svg)).png().toBuffer();
  const buffer = await sharp(base)
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
    const inputs = ["-i", raw];
    let idx = 1;
    let svgEnd: string | undefined;
    let svgLower: string | undefined;

    const coverFilters: string[] = [];
    const covers: Array<{ rect: CoverRect; enable: string }> = [];
    if (spec.lowerThird?.lines.length) {
      covers.push({
        rect: lowerThirdCoverRect(probe.width, probe.height),
        enable: `between(t,${timing.lowerThirdStart.toFixed(2)},${timing.lowerThirdEnd.toFixed(2)})`,
      });
    }
    if (spec.endCard?.lines.length) {
      covers.push({
        rect: endCardCoverRect(probe.width, probe.height),
        enable: `gte(t,${timing.endCardStart.toFixed(2)})`,
      });
    }
    let covered = "0:v";
    covers.forEach((cover, i) => {
      const radius = coverBlurRadius(probe.width, probe.height, cover.rect);
      const src = `csrc${i}`;
      const blur = `cblur${i}`;
      const base = `base${i}`;
      const next = `vcov${i}`;
      coverFilters.push(`[${covered}]split[${base}][${src}]`);
      coverFilters.push(
        `[${src}]crop=${cover.rect.width}:${cover.rect.height}:${cover.rect.x}:${cover.rect.y},boxblur=${radius}:2:${radius}:2,eq=brightness=-0.22:saturation=0.75[${blur}]`,
      );
      coverFilters.push(
        `[${base}][${blur}]overlay=${cover.rect.x}:${cover.rect.y}:enable='${cover.enable}'[${next}]`,
      );
      covered = next;
    });

    const typeFilters: string[] = [];
    let typed = covered;
    if (spec.lowerThird?.lines.length) {
      const png = await rasterizeOverlay(spec, probe.width, probe.height, "lowerThird");
      svgLower = overlaySvgMarkup(spec, probe.width, probe.height, "lowerThird");
      await writeFile(lowerPng, png);
      inputs.push("-i", lowerPng);
      const next = "vlt";
      typeFilters.push(
        `[${typed}][${idx}:v]overlay=0:0:enable='between(t,${timing.lowerThirdStart.toFixed(2)},${timing.lowerThirdEnd.toFixed(2)})'[${next}]`,
      );
      typed = next;
      idx += 1;
    }
    if (spec.endCard?.lines.length) {
      const png = await rasterizeOverlay(spec, probe.width, probe.height, "endCard");
      svgEnd = overlaySvgMarkup(spec, probe.width, probe.height, "endCard");
      await writeFile(endPng, png);
      inputs.push("-i", endPng);
      const next = "vec";
      typeFilters.push(
        `[${typed}][${idx}:v]overlay=0:0:enable='gte(t,${timing.endCardStart.toFixed(2)})'[${next}]`,
      );
      typed = next;
    }

    if (!typeFilters.length && !coverFilters.length) return { buffer: input };

    const plainType = typeFilters.map((line) =>
      line.replaceAll("[vcov0]", "[0:v]").replaceAll("[vcov1]", "[0:v]"),
    );
    const graphs = coverFilters.length
      ? [
          { filters: [...coverFilters, ...typeFilters], map: typed, audio: true },
          { filters: [...coverFilters, ...typeFilters], map: typed, audio: false },
          { filters: plainType, map: typed.replace(/vcov\d+/, "0:v"), audio: true },
          { filters: plainType, map: typed.replace(/vcov\d+/, "0:v"), audio: false },
        ]
      : [
          { filters: typeFilters, map: typed, audio: true },
          { filters: typeFilters, map: typed, audio: false },
        ];

    let encoded = false;
    let lastErr: unknown;
    for (const graph of graphs) {
      if (!graph.filters.length) continue;
      try {
        await runFfmpeg([
          ...inputs,
          "-filter_complex",
          graph.filters.join(";"),
          "-map",
          `[${graph.map}]`,
          ...(graph.audio ? ["-map", "0:a?", "-c:a", "copy"] : ["-an"]),
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "28",
          "-movflags",
          "+faststart",
          ...(graph.audio ? ["-shortest"] : []),
          out,
        ]);
        encoded = true;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!encoded) throw lastErr instanceof Error ? lastErr : new Error("Overlay encode failed");
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
  const regular =
    process.env.MYA_OVERLAY_FONT ?? "/usr/share/fonts/truetype/macos/Inter-Regular.ttf";
  try {
    await access(regular);
    return true;
  } catch {
    return false;
  }
}
