import { safeFilename, safeMime } from "./filename.ts";
import { specFromFields, type TextOverlaySpec } from "./text-overlay.ts";
import { readVideoDirectionField } from "./video-direction.ts";

function overlayFromBody(body: Record<string, unknown>): TextOverlaySpec | undefined {
  const textOverlay = specFromFields(
    body.endCard ?? body.end_card ?? body.endCardText ?? body.end_card_text,
    body.lowerThird ?? body.lower_third ?? body.lowerThirds ?? body.lower_thirds ?? body.lowerThirdText,
  );
  return textOverlay.endCard || textOverlay.lowerThird ? textOverlay : undefined;
}

export const MAX_BOT_REFERENCES = 8;
export const MAX_REFERENCE_DATA_URL = 2_400_000;
const IMAGE_BYTES_MAX = 8_000_000;

export type ReferenceKind = "upload" | "logo";

export type ReferenceInput = {
  filename: string;
  mime?: string;
  dataUrl?: string;
  url?: string;
  kind?: ReferenceKind;
  assetId?: string;
};

export type OperatorJobPayload = {
  profile: string;
  email?: string;
  generate: boolean;
  direction?: string;
  videoDirection?: string;
  endCard?: string | string[];
  lowerThird?: string | string[];
  textOverlay?: TextOverlaySpec;
  references: ReferenceInput[];
};

const FILE_FIELD = /^(references?|photos?|images?|files?|logo|attachments?|uploads?)$/i;

export function parseGenerateFlag(value: unknown, defaultValue = true): boolean {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === false || value === 0) return false;
  if (typeof value === "string") return !/^(false|0|no|off)$/i.test(value.trim());
  return Boolean(value);
}

export function inferReferenceKind(filename: string, explicit?: string | null): ReferenceKind {
  if (explicit === "logo" || explicit === "upload") return explicit;
  return /logo/i.test(filename) ? "logo" : "upload";
}

export function looksLikeAssetId(value: string): boolean {
  return /^ast_[a-z0-9]+$/i.test(value.trim());
}

/** Accept /api/files/:id, absolute app file URLs, or a bare asset id. */
export function parseAppAssetId(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (looksLikeAssetId(raw)) return raw;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(raw, "https://mya.geotargetus.dev");
    const match = url.pathname.match(/^\/api\/files\/([^/]+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}

function normalizeOne(raw: unknown, fallbackName: string): ReferenceInput | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    if (text.startsWith("data:")) {
      return { filename: fallbackName, dataUrl: text, kind: inferReferenceKind(fallbackName) };
    }
    const assetId = parseAppAssetId(text);
    if (assetId) return { filename: fallbackName, assetId, url: text, kind: inferReferenceKind(fallbackName) };
    if (/^https?:\/\//i.test(text)) {
      return { filename: fallbackName, url: text, kind: inferReferenceKind(fallbackName) };
    }
    return null;
  }
  const rec = asRecord(raw);
  if (!rec) return null;
  const filename = readText(rec.filename) || readText(rec.name) || fallbackName;
  const mime = readText(rec.mime) || readText(rec.type);
  const dataUrl = readText(rec.dataUrl) || readText(rec.data_url);
  const url = readText(rec.url) || readText(rec.href);
  const assetId = readText(rec.assetId) || readText(rec.asset_id) || (url ? parseAppAssetId(url) : null) || undefined;
  const kind = inferReferenceKind(filename, readText(rec.kind));
  if (!dataUrl && !url && !assetId) return null;
  return {
    filename,
    mime,
    dataUrl,
    url,
    kind,
    assetId: assetId && looksLikeAssetId(assetId) ? assetId : undefined,
  };
}

export function collectReferencesFromBody(body: Record<string, unknown>): ReferenceInput[] {
  const buckets = [body.references, body.photos, body.images, body.files, body.uploads];
  const out: ReferenceInput[] = [];
  for (const bucket of buckets) {
    const items = Array.isArray(bucket) ? bucket : bucket != null ? [bucket] : [];
    for (const item of items) {
      const ref = normalizeOne(item, `photo-${out.length + 1}.jpg`);
      if (ref) out.push(ref);
      if (out.length >= MAX_BOT_REFERENCES) return out;
    }
  }
  if (out.length === 0) {
    const single = normalizeOne(body.reference ?? body.photo ?? body.image, "photo.jpg");
    if (single) out.push(single);
  }
  return out.slice(0, MAX_BOT_REFERENCES);
}

export function parseOperatorJobJson(body: Record<string, unknown>): OperatorJobPayload {
  const profile = String(body.profile ?? body.raw ?? body.brief ?? "");
  const email = typeof body.email === "string" ? body.email : undefined;
  const direction =
    typeof body.direction === "string"
      ? body.direction
      : typeof body.note === "string"
        ? body.note
        : undefined;
  const textOverlay = overlayFromBody(body);
  return {
    profile,
    email,
    generate: parseGenerateFlag(body.generate, true),
    direction,
    videoDirection: readVideoDirectionField(body),
    endCard: textOverlay?.endCard?.lines,
    lowerThird: textOverlay?.lowerThird?.lines,
    textOverlay,
    references: collectReferencesFromBody(body),
  };
}

function isFileLike(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

export async function parseOperatorJobForm(form: FormData): Promise<OperatorJobPayload> {
  const profileField = form.get("profile") ?? form.get("raw") ?? form.get("brief");
  let profile = "";
  if (typeof profileField === "string") profile = profileField;
  else if (isFileLike(profileField)) profile = await profileField.text();

  const email = readText(form.get("email"));
  const direction = readText(form.get("direction")) ?? readText(form.get("note"));
  const videoDirection =
    readText(form.get("videoDirection")) ??
    readText(form.get("video_direction")) ??
    readText(form.get("visualDirection")) ??
    readText(form.get("shotList")) ??
    readText(form.get("cameraDirection"));
  const textOverlay = overlayFromBody({
    endCard: readText(form.get("endCard")) ?? readText(form.get("end_card")),
    lowerThird: readText(form.get("lowerThird")) ?? readText(form.get("lower_third")),
  });
  const references: ReferenceInput[] = [];

  for (const [key, value] of form.entries()) {
    if (!isFileLike(value)) continue;
    if (value.size <= 0) continue;
    const imageLike = value.type.startsWith("image/") || FILE_FIELD.test(key) || /\.(jpe?g|png|webp|gif|svg)$/i.test(value.name);
    if (!imageLike) continue;
    if (references.length >= MAX_BOT_REFERENCES) break;
    const bytes = Buffer.from(await value.arrayBuffer());
    if (bytes.length === 0 || bytes.length > IMAGE_BYTES_MAX) {
      throw new Error("Each reference photo must be an image under 8MB.");
    }
    const mime = safeMime(value.type || "image/jpeg", "image/jpeg");
    const filename = safeFilename(value.name || `photo-${references.length + 1}.jpg`, "photo.jpg");
    references.push({
      filename,
      mime,
      dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      kind: inferReferenceKind(filename, key.toLowerCase() === "logo" ? "logo" : undefined),
    });
  }

  return {
    profile,
    email,
    generate: parseGenerateFlag(form.get("generate"), true),
    direction,
    videoDirection,
    endCard: textOverlay?.endCard?.lines,
    lowerThird: textOverlay?.lowerThird?.lines,
    textOverlay,
    references,
  };
}

export async function readOperatorJobRequest(request: Request): Promise<OperatorJobPayload> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    return parseOperatorJobForm(await request.formData());
  }
  const text = await request.text();
  if (!text) {
    return { profile: "", generate: true, references: [] };
  }
  try {
    return parseOperatorJobJson(JSON.parse(text) as Record<string, unknown>);
  } catch {
    return { profile: "", generate: true, references: [] };
  }
}

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

export async function compressReferenceBytes(
  bytes: Buffer,
  filename: string,
  mime: string,
  kind: ReferenceKind,
): Promise<{ filename: string; mime: string; dataUrl: string; kind: ReferenceKind }> {
  const { default: sharp } = await import("sharp");
  const img = sharp(bytes, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const maxEdge = kind === "logo" ? 900 : 1280;
  const resized = img.resize({
    width: maxEdge,
    height: maxEdge,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (kind === "logo" && meta.hasAlpha) {
    const buffer = await resized.png({ compressionLevel: 8 }).toBuffer();
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
    if (dataUrl.length > MAX_REFERENCE_DATA_URL) {
      throw new Error("That photo is too large. Try a smaller one.");
    }
    return {
      filename: safeFilename(filename.replace(/\.[^.]+$/, "") + ".png", "logo.png"),
      mime: "image/png",
      dataUrl,
      kind,
    };
  }
  let quality = kind === "logo" ? 84 : 72;
  let buffer = await resized.jpeg({ quality, mozjpeg: true }).toBuffer();
  let dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
  while (dataUrl.length > MAX_REFERENCE_DATA_URL && quality > 50) {
    quality -= 10;
    buffer = await resized.jpeg({ quality, mozjpeg: true }).toBuffer();
    dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
  }
  if (dataUrl.length > MAX_REFERENCE_DATA_URL) {
    throw new Error("That photo is too large. Try a smaller one.");
  }
  return {
    filename: safeFilename(filename.replace(/\.[^.]+$/, "") + ".jpg", kind === "logo" ? "logo.jpg" : "photo.jpg"),
    mime: "image/jpeg",
    dataUrl,
    kind,
  };
}

export async function materializeReference(input: ReferenceInput): Promise<{
  filename: string;
  mime: string;
  kind: ReferenceKind;
  dataUrl: string | null;
  externalUrl: string | null;
  assetId?: string;
}> {
  const filename = safeFilename(input.filename || "photo.jpg", "photo.jpg");
  const kind = inferReferenceKind(filename, input.kind);
  const assetId = input.assetId || (input.url ? parseAppAssetId(input.url) : null) || undefined;
  if (assetId) {
    return { filename, mime: safeMime(input.mime || "image/jpeg", "image/jpeg"), kind, dataUrl: null, externalUrl: null, assetId };
  }

  if (input.dataUrl?.startsWith("data:")) {
    const decoded = decodeDataUrl(input.dataUrl);
    if (!decoded) throw new Error(`${filename} is not a usable image.`);
    if (decoded.bytes.length > IMAGE_BYTES_MAX) throw new Error("Each reference photo must be an image under 8MB.");
    if (input.dataUrl.length <= MAX_REFERENCE_DATA_URL && /^data:image\/(jpeg|png|webp);/i.test(input.dataUrl)) {
      return {
        filename,
        mime: safeMime(decoded.mime, "image/jpeg"),
        kind,
        dataUrl: input.dataUrl,
        externalUrl: null,
      };
    }
    const compressed = await compressReferenceBytes(decoded.bytes, filename, decoded.mime, kind);
    return { ...compressed, externalUrl: null };
  }

  const url = input.url?.trim() || "";
  if (/^https?:\/\//i.test(url)) {
    return {
      filename,
      mime: safeMime(input.mime || "image/jpeg", "image/jpeg"),
      kind,
      dataUrl: null,
      externalUrl: url,
    };
  }

  throw new Error("Each reference needs a file, dataUrl, or an /api/files URL from POST /api/operator/uploads.");
}
