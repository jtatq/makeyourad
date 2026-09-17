/** Reference-photo ranking and xAI /images/edits payload policy. */

export const MAX_XAI_EDIT_IMAGES = 5;
export const MAX_MODEL_DATA_URI = 700_000;

export type ImageRef = { url: string; type: "image_url" };

export type ImageGenAttempt = {
  path: "/images/edits" | "/images/generations";
  image?: ImageRef | ImageRef[];
  aspectRatio?: string;
  resolution?: string;
};

export function imageRef(url: string): ImageRef {
  return { url, type: "image_url" };
}

export function rankReferenceAssets<T extends { kind: string; filename: string }>(
  assets: T[],
  preferLogo: boolean,
): T[] {
  const usable = assets.filter((a) => a.kind === "logo" || a.kind === "upload");
  const score = (a: T) => {
    const n = a.filename.toLowerCase();
    let s = 0;
    if (/owner|face|portrait|head|person|talent|selfie/i.test(n)) s += 100;
    if (/pool|job|site|yard|house|patio|deck|work/i.test(n)) s += 50;
    if (/van|truck|wrap|vehicle/i.test(n)) s += 40;
    if (a.kind === "logo") s += preferLogo ? 80 : -20;
    return s;
  };
  return [...usable].sort((a, b) => score(b) - score(a));
}

/** Prefer stored bytes over a signed /api/files URL xAI may not be able to fetch. */
export function preferredRefSource(asset: {
  data_url?: string | null;
  external_url?: string | null;
}): "data" | "http" | null {
  if (asset.data_url?.startsWith("data:")) return "data";
  if (asset.external_url?.startsWith("http") && !asset.external_url.includes("127.0.0.1")) return "http";
  return null;
}

export function imageGenerationAttempts(refs: string[]): ImageGenAttempt[] {
  if (refs.length === 0) {
    return [
      { path: "/images/generations", aspectRatio: "9:16", resolution: "2k" },
      { path: "/images/generations", resolution: "2k" },
    ];
  }
  const uniqueLengths = [...new Set([Math.min(refs.length, MAX_XAI_EDIT_IMAGES), Math.min(refs.length, 3), 1])];
  const attempts: ImageGenAttempt[] = [];
  for (const n of uniqueLengths) {
    const set = refs.slice(0, n);
    const image = set.length === 1 ? imageRef(set[0]) : set.map(imageRef);
    attempts.push({ path: "/images/edits", image, aspectRatio: "9:16", resolution: "2k" });
    attempts.push({ path: "/images/edits", image, resolution: "2k" });
  }
  return attempts;
}

export function keepsReferences(attempt: ImageGenAttempt): boolean {
  if (attempt.path === "/images/generations") return false;
  if (!attempt.image) return false;
  return Array.isArray(attempt.image) ? attempt.image.length > 0 : Boolean(attempt.image.url);
}

export function referencePromptBlock(assets: Array<{ kind: string; filename: string }>): string {
  if (!assets.length) return "";
  const listed = assets
    .map((a, i) => `Image ${i + 1} (${a.kind}): ${a.filename} — reproduce this real subject.`)
    .join(" ");
  return [
    "REFERENCE PHOTOS ARE ATTACHED TO THIS IMAGE REQUEST. You must use them.",
    "Do not invent a different person, vehicle, pool, house, or job site.",
    listed,
    "If the photos show a rectangular in-ground pool, do not invent a round above-ground pool.",
    "If they show a person, use that exact face and clothing.",
    "If they do not show a branded van, do not add one.",
  ].join(" ");
}

export async function compactDataUrlForModel(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("data:") && dataUrl.length <= MAX_MODEL_DATA_URI) return dataUrl;
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return dataUrl.length <= MAX_MODEL_DATA_URI ? dataUrl : "";
  const bytes = Buffer.from(match[2], "base64");
  try {
    const { default: sharp } = await import("sharp");
    let quality = 68;
    let edge = 960;
    let out = dataUrl;
    while (quality >= 44) {
      const buffer = await sharp(bytes, { failOn: "none" })
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      out = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      if (out.length <= MAX_MODEL_DATA_URI) return out;
      quality -= 8;
      edge = Math.max(640, Math.round(edge * 0.85));
    }
    return out.length <= MAX_MODEL_DATA_URI ? out : "";
  } catch {
    return dataUrl.length <= MAX_MODEL_DATA_URI ? dataUrl : "";
  }
}
