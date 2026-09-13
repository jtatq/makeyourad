import { getSql } from "./db";
import { env } from "./env.server";
import { makeId } from "./ids";
import { signedFileUrl } from "./operator-auth.server";
import {
  appendEvent,
  claimOrder,
  getOrder,
  listAssets,
  listOrders,
  type OrderRow,
} from "./orders.server";
import { buildPacket, type GenerationPacket } from "./prompts/compiler";
import { TONE_PACKS } from "./prompts/tones";
import { masterClips, type SlotId } from "./recipe";
import { PRODUCTS, type Tone } from "./products";

export type GenEngine = "imagine" | "xai";
export type GenSlotStatus = "queued" | "still" | "video" | "done" | "error";

export type GenSlotState = {
  id: SlotId;
  label: string;
  duration: number | null;
  targetSeconds?: number | null;
  status: GenSlotStatus;
  stillUrl?: string;
  videoUrl?: string;
  videoRequestId?: string;
  stillPrompt?: string;
  motionPrompt?: string;
  claimedAt?: string;
  error?: string;
};

export type GenerationJob = {
  status: "idle" | "running" | "done" | "error";
  engine: GenEngine;
  startedAt: string;
  updatedAt: string;
  error?: string;
  masterUrl?: string;
  mascotUrl?: string;
  slots: GenSlotState[];
};

export type StitchRequest = {
  filename: string;
  durationSeconds: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  clips: Array<{ slotId: SlotId; seconds: number; url: string }>;
};

export type ImagineWork = {
  orderId: string;
  businessName: string;
  slotId: SlotId;
  label: string;
  phase: "still" | "video";
  duration: 6 | 10 | 15 | null;
  aspectRatio: "9:16" | "1:1" | "16:9";
  stillPrompt: string;
  motionPrompt: string;
  stillUrl?: string;
  references: Array<{ url: string; kind: string; filename: string }>;
};

const IMAGE_MODEL = "grok-imagine-image-2.0";
const VIDEO_MODEL = "grok-imagine-video-1.5";
const XAI = "https://api.x.ai/v1";
const MAX_DATA_URI = 3_500_000;
const CLAIM_MS = 8 * 60 * 1000;

function apiKey(): string | null {
  return process.env.XAI_API_KEY?.trim() || null;
}

/** Use the xAI REST API when a key is present so Generate works on Vercel. */
export function generationEngine(): GenEngine {
  if (!apiKey()) return "imagine";
  const forced = env("GENERATION_ENGINE");
  if (forced === "imagine") return "imagine";
  return "xai";
}

export function aiAvailable(): boolean {
  if (generationEngine() === "imagine") return true;
  return Boolean(apiKey());
}

function slotSeconds(duration: string): number | null {
  if (duration === "still") return null;
  const nums = duration.match(/\d+/g)?.map(Number) ?? [];
  if (nums.length === 0) return 6;
  return Math.min(15, Math.max(4, Math.max(...nums)));
}

function imagineSeconds(duration: string): 6 | 10 | 15 | null {
  const n = slotSeconds(duration);
  if (n == null) return null;
  if (n <= 6) return 6;
  if (n <= 10) return 10;
  return 15;
}

function asImagineDuration(n: number | null | undefined): 6 | 10 | 15 | null {
  if (n == null) return null;
  if (n <= 6) return 6;
  if (n <= 10) return 10;
  return 15;
}

function packetFromOrder(order: OrderRow, assets: Awaited<ReturnType<typeof listAssets>>): GenerationPacket {
  return buildPacket({
    orderId: order.id,
    productId: order.product,
    addOns: order.add_ons,
    priceCents: order.price_cents,
    intake: {
      businessName: order.business_name,
      category: order.category,
      city: order.city,
      state: order.state,
      website: order.website,
      phone: order.phone,
      email: order.email,
      brief: order.brief,
      tone: order.tone,
      platforms: order.platforms,
      mascotDescription: order.mascot_description,
      websiteProfile: order.website_profile,
    },
    assets: assets.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      kind: a.kind,
      signed_url: a.external_url || "",
    })),
  });
}

let generationColumnReady: Promise<void> | null = null;

async function ensureGenerationColumn() {
  generationColumnReady ??= (async () => {
    const sql = await getSql();
    await sql.query(`alter table orders add column if not exists generation text`);
  })().catch((err) => {
    generationColumnReady = null;
    throw err;
  });
  await generationColumnReady;
}

function parseJob(raw: unknown): GenerationJob | null {
  if (!raw) return null;
  try {
    const job = (typeof raw === "string" ? JSON.parse(raw) : raw) as GenerationJob;
    if (!job || !Array.isArray(job.slots)) return null;
    if (!job.engine) {
      const hasExternal = job.slots.some((s) => {
        const u = s.stillUrl || s.videoUrl || "";
        return /^https?:\/\//.test(u);
      });
      job.engine = hasExternal ? "xai" : generationEngine();
    }
    return job;
  } catch {
    return null;
  }
}

export async function loadGeneration(orderId: string): Promise<GenerationJob | null> {
  await ensureGenerationColumn();
  const sql = await getSql();
  const rows = await sql.query<{ generation: string | null }>(`select generation from orders where id = $1`, [
    orderId,
  ]);
  return parseJob(rows[0]?.generation);
}

async function saveGeneration(orderId: string, job: GenerationJob) {
  await ensureGenerationColumn();
  const sql = await getSql();
  job.updatedAt = new Date().toISOString();
  await sql.query(`update orders set generation = $2, updated_at = now() where id = $1`, [
    orderId,
    JSON.stringify(job),
  ]);
}

async function xaiFetch(path: string, init: RequestInit): Promise<Response> {
  const key = apiKey();
  if (!key) throw new Error("AI is not available in this environment");
  return fetch(`${XAI}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

function pickUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.url === "string" && b.url.startsWith("http")) return b.url;
  const data = b.data;
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const u = (data[0] as { url?: string }).url;
    if (u) return u;
  }
  const video = b.video;
  if (video && typeof video === "object") {
    const u = (video as { url?: string }).url;
    if (u) return u;
  }
  return null;
}

function stillPrompt(packet: GenerationPacket, slot: GenerationPacket["recipe"]["slots"][number], ratio: string) {
  const i = packet.intake;
  const site = packet.website_profile;
  const lines = [
    `Photoreal local-business advertisement still, ${ratio}, cinematic, natural light.`,
    `Business: ${i.businessName}, ${i.category_label} in ${i.city}, ${i.state}.`,
    `Slot: ${slot.label}. ${slot.role}`,
    `Tone: ${i.tone}. ${packet.recipe.structure}`,
    i.brief ? `Customer direction: ${i.brief}` : "",
    site?.tagline ? `Tagline: ${site.tagline}` : "",
    site?.services?.length ? `Services: ${site.services.slice(0, 6).join(", ")}` : "",
    site?.about ? `About: ${site.about.slice(0, 280)}` : "",
    `Use the real business. Do not invent a different company or a celebrity.`,
    `No watermarks, no agency slogans, no UI chrome.`,
  ];
  if (slot.id === "end_card" || slot.id === "static") {
    lines.push(
      `On-screen type, clean and readable: ${i.businessName}. ${i.city}, ${i.state}. ${i.phone}. CTA: ${site?.cta || "Call today"}.`,
    );
  }
  if (slot.id === "hook") {
    lines.push(
      "Talking-head: a real owner or technician from the reference photos stands in the driveway or at the storefront, facing camera, mid-speech. Van, truck, or house from the uploads sits behind them. Match their face, shirt, and wrap — do not invent lettering.",
    );
  }
  if (slot.id === "mascot" && i.mascotDescription) lines.push(`Mascot: ${i.mascotDescription}`);
  return lines.filter(Boolean).join("\n");
}

function motionPrompt(slot: GenerationPacket["recipe"]["slots"][number], seconds: number, tone: string) {
  const talking =
    slot.id === "hook" || slot.id.startsWith("body")
      ? "The person talks to camera with natural hand gestures. Mouth moves in speech. Do not freeze the last seconds."
      : "Slow, confident camera. Keep type readable if present.";
  return [
    `Animate this advertisement frame as a ${seconds}-second ${slot.label.toLowerCase()} clip.`,
    slot.role,
    `Tone: ${tone}. ${talking}`,
    `Photoreal, no morphing logos, no extra text, no watermarks.`,
    `Hard stop at ${seconds} seconds.`,
  ].join(" ");
}

function imagineStillPrompt(
  packet: GenerationPacket,
  slot: GenerationPacket["recipe"]["slots"][number],
  ratio: string,
) {
  const i = packet.intake;
  const site = packet.website_profile;
  const tone = TONE_PACKS[i.tone];
  const parts = [
    `A photoreal ${ratio} advertisement still for ${i.businessName}, a ${i.category_label} in ${i.city}, ${i.state}.`,
    `This frame is the ${slot.label.toLowerCase()}: ${slot.role}`,
    `The look is ${i.tone}: ${tone.picture}`,
  ];
  if (i.brief.trim()) parts.push(`Customer direction: ${i.brief.trim()}`);
  if (site?.tagline) parts.push(`Their line: ${site.tagline}.`);
  if (site?.services?.length) parts.push(`Services: ${site.services.slice(0, 5).join(", ")}.`);
  if (site?.about) parts.push(site.about.slice(0, 220));
  if (slot.id === "end_card" || slot.id === "static") {
    parts.push(
      `Put clean readable type on screen: ${i.businessName}. ${i.city}, ${i.state}. ${i.phone}. ${site?.cta || "Call today"}.`,
    );
  }
  if (slot.id === "hook") {
    parts.push(
      "Talking-head still: owner or tech from the reference photos, facing camera, mid-speech, branded van or house behind them. Match face, shirt, and wrap exactly. Do not invent lettering on the van or shirt.",
    );
  }
  if (slot.id === "mascot" && i.mascotDescription) parts.push(`Mascot: ${i.mascotDescription}`);
  parts.push("Use the real business. No celebrity, no watermark, no UI chrome, no agency slogan.");
  return parts.join(" ");
}

function imagineMotionPrompt(slot: GenerationPacket["recipe"]["slots"][number], seconds: number, tone: Tone) {
  const pack = TONE_PACKS[tone];
  const talking =
    slot.id === "hook" || slot.id.startsWith("body")
      ? "The person talks to camera with natural hand gestures and a slight weight shift. Mouth moves in speech. Do not freeze the last seconds."
      : "Slow, confident camera, subject stays recognizable, type stays readable.";
  return [
    `Animate this advertisement frame as a ${seconds}-second ${slot.label.toLowerCase()} clip.`,
    slot.role,
    pack.picture,
    talking,
    "Photoreal, no morphing logos, no extra text, no watermarks.",
    `Hard stop at ${seconds} seconds.`,
  ].join(" ");
}

async function referenceUri(orderId: string, preferLogo: boolean): Promise<string | null> {
  const assets = await listAssets({ orderId });
  const usable = assets.filter((a) => a.kind === "logo" || a.kind === "upload");
  const ordered = preferLogo
    ? [...usable.filter((a) => a.kind === "logo"), ...usable.filter((a) => a.kind !== "logo")]
    : [...usable.filter((a) => a.kind !== "logo"), ...usable.filter((a) => a.kind === "logo")];
  for (const a of ordered) {
    if (a.external_url?.startsWith("http") && !a.external_url.includes("127.0.0.1")) return a.external_url;
    if (a.data_url && a.data_url.length < MAX_DATA_URI && a.data_url.startsWith("data:")) return a.data_url;
  }
  return null;
}

async function generateStill(prompt: string, ref: string | null): Promise<string> {
  const payload: Record<string, unknown> = {
    model: IMAGE_MODEL,
    prompt,
    n: 1,
    aspect_ratio: "9:16",
  };
  const path = ref ? "/images/edits" : "/images/generations";
  if (ref) payload.image = { url: ref, type: "image_url" };
  let res = await xaiFetch(path, { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok && payload.aspect_ratio) {
    delete payload.aspect_ratio;
    res = await xaiFetch(path, { method: "POST", body: JSON.stringify(payload) });
  }
  if (!res.ok && ref) {
    delete payload.image;
    res = await xaiFetch("/images/generations", { method: "POST", body: JSON.stringify(payload) });
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : `xAI image error ${res.status}`;
    throw new Error(msg.slice(0, 280));
  }
  const url = pickUrl(body);
  if (!url) throw new Error("Image generation returned no URL");
  return url;
}

async function startVideo(prompt: string, imageUrl: string, duration: number): Promise<string> {
  const payload: Record<string, unknown> = {
    model: VIDEO_MODEL,
    prompt,
    duration,
    resolution: "720p",
    image: { url: imageUrl },
  };
  let res = await xaiFetch("/videos/generations", { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) {
    delete payload.resolution;
    res = await xaiFetch("/videos/generations", { method: "POST", body: JSON.stringify(payload) });
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : `xAI video error ${res.status}`;
    throw new Error(msg.slice(0, 280));
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const id = (typeof rec.request_id === "string" && rec.request_id) || (typeof rec.id === "string" && rec.id) || "";
  if (!id) throw new Error("Video generation returned no request id");
  return id;
}

async function pollVideo(requestId: string): Promise<{ status: string; url: string | null }> {
  const res = await xaiFetch(`/videos/${requestId}`, { method: "GET" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) return { status: "failed", url: null };
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const status = typeof rec.status === "string" ? rec.status : "pending";
  return { status, url: pickUrl(body) };
}

function businessSlug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "ad";
}

function jobAspect(order: OrderRow): StitchRequest["aspectRatio"] {
  const platforms = order.platforms ?? [];
  if (platforms.includes("youtube") && !platforms.includes("instagram") && !platforms.includes("tiktok")) {
    return "16:9";
  }
  return "9:16";
}

export function stitchIfReady(order: OrderRow, job: GenerationJob): StitchRequest | null {
  if (order.product === "static") return null;
  if (job.masterUrl) return null;
  const clips = masterClips(order.product);
  if (clips.length === 0) return null;
  const ready: StitchRequest["clips"] = [];
  for (const c of clips) {
    const slot = job.slots.find((s) => s.id === c.id);
    if (!slot || slot.status !== "done" || !slot.videoUrl) return null;
    ready.push({ slotId: c.id, seconds: slot.targetSeconds || c.seconds, url: slot.videoUrl });
  }
  const durationSeconds = PRODUCTS[order.product].durationSeconds ?? clips.reduce((n, c) => n + c.seconds, 0);
  return {
    filename: `${businessSlug(order.business_name)}-${durationSeconds}s.mp4`,
    durationSeconds,
    aspectRatio: jobAspect(order),
    clips: ready,
  };
}

async function clearGenFiles(orderId: string) {
  const sql = await getSql();
  await sql.query(
    `delete from order_assets where order_id = $1 and kind in ('still','delivery')
      and (filename like '%-gen.%' or filename like '%-20s.mp4' or filename like '%-40s.mp4' or filename like '%-mascot.mp4')`,
    [orderId],
  );
}

function initJob(packet: GenerationPacket, engine: GenEngine): GenerationJob {
  const now = new Date().toISOString();
  const ratio = packet.aspect_ratio_priority[0] ?? "9:16";
  return {
    status: "running",
    engine,
    startedAt: now,
    updatedAt: now,
    slots: packet.recipe.slots.map((s) => {
      const target = slotSeconds(s.duration);
      const duration = engine === "imagine" ? imagineSeconds(s.duration) : target;
      return {
        id: s.id,
        label: s.label,
        duration,
        targetSeconds: target,
        status: "queued" as const,
        stillPrompt: engine === "imagine" ? imagineStillPrompt(packet, s, ratio) : stillPrompt(packet, s, ratio),
        motionPrompt:
          duration != null
            ? engine === "imagine"
              ? imagineMotionPrompt(s, duration, packet.intake.tone)
              : motionPrompt(s, duration, packet.intake.tone)
            : undefined,
      };
    }),
  };
}

function finishIfDone(job: GenerationJob) {
  if (job.slots.every((s) => s.status === "done")) {
    job.status = "done";
    job.error = undefined;
  } else if (
    job.slots.some((s) => s.status === "error") &&
    job.slots.every((s) => s.status === "done" || s.status === "error")
  ) {
    job.status = "error";
    job.error = job.slots.find((s) => s.error)?.error ?? "Generation failed";
  }
}

async function attachGen(
  orderId: string,
  filename: string,
  url: string | null,
  mime: string,
  kind: "still" | "delivery",
  providedDataUrl?: string,
): Promise<{ id: string }> {
  const id = makeId("ast");
  let dataUrl: string | null = providedDataUrl ?? null;
  if (!dataUrl && url && (kind === "still" || mime.startsWith("image/"))) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0 && buf.length < 2_800_000) {
          dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        }
      }
    } catch {
      dataUrl = null;
    }
  }
  const sql = await getSql();
  await sql.query(
    `insert into order_assets (id, order_id, kind, filename, mime, data_url, external_url)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, orderId, kind, filename, mime, dataUrl, url],
  );
  return { id };
}

function assetViewUrl(origin: string, assetId: string, dataUrl: string | null | undefined): string {
  if (dataUrl && dataUrl.startsWith("data:") && dataUrl.length < 1_500_000) return dataUrl;
  return signedFileUrl(origin, assetId, 30);
}

function claimIsFresh(slot: GenSlotState): boolean {
  if (!slot.claimedAt) return false;
  const t = Date.parse(slot.claimedAt);
  return Number.isFinite(t) && Date.now() - t < CLAIM_MS;
}

function slotPhase(slot: GenSlotState): "still" | "video" | null {
  if (slot.status === "done" || slot.status === "error") return null;
  if (slot.status === "queued" || (slot.status === "still" && !slot.stillUrl)) return "still";
  if (slot.duration && !slot.videoUrl) return "video";
  return null;
}

export async function listImagineQueue(): Promise<Array<{ orderId: string; businessName: string; job: GenerationJob }>> {
  await ensureGenerationColumn();
  const orders = await listOrders();
  const out: Array<{ orderId: string; businessName: string; job: GenerationJob }> = [];
  for (const order of orders) {
    const job = await loadGeneration(order.id);
    if (job?.status === "running" && (job.engine ?? "imagine") === "imagine") {
      out.push({ orderId: order.id, businessName: order.business_name, job });
    }
  }
  return out;
}

async function referencePayload(orderId: string, origin: string): Promise<ImagineWork["references"]> {
  const assets = await listAssets({ orderId });
  const usable = assets.filter((a) => a.kind === "logo" || a.kind === "upload");
  const refs: ImagineWork["references"] = [];
  for (const a of usable.slice(0, 3)) {
    const url =
      a.external_url && /^https?:\/\//.test(a.external_url) && !a.external_url.includes("127.0.0.1")
        ? a.external_url
        : signedFileUrl(origin, a.id, 2);
    refs.push({ url, kind: a.kind, filename: a.filename });
  }
  return refs;
}

export async function claimNextImagineWork(origin: string): Promise<ImagineWork | null> {
  const queue = await listImagineQueue();
  for (const item of queue) {
    const slot = item.job.slots.find((s) => slotPhase(s) && !claimIsFresh(s));
    if (!slot) continue;
    const phase = slotPhase(slot);
    if (!phase) continue;
    slot.claimedAt = new Date().toISOString();
    slot.status = phase === "still" ? "still" : "video";
    slot.error = undefined;
    await saveGeneration(item.orderId, item.job);
    const order = await getOrder(item.orderId);
    const platforms = order?.platforms ?? [];
    const aspectRatio: ImagineWork["aspectRatio"] =
      platforms.includes("youtube") && !platforms.includes("instagram") && !platforms.includes("tiktok")
        ? "16:9"
        : "9:16";
    return {
      orderId: item.orderId,
      businessName: item.businessName,
      slotId: slot.id,
      label: slot.label,
      phase,
      duration: asImagineDuration(slot.duration),
      aspectRatio,
      stillPrompt: slot.stillPrompt || `${item.businessName} advertisement still, ${slot.label}`,
      motionPrompt: slot.motionPrompt || `Animate this ${slot.label.toLowerCase()} advertisement frame.`,
      stillUrl: slot.stillUrl,
      references: await referencePayload(item.orderId, origin),
    };
  }
  return null;
}

export async function completeImagineSlot(opts: {
  orderId: string;
  slotId: string;
  kind: "still" | "video";
  filename: string;
  mime: string;
  dataUrl?: string;
  url?: string;
  origin: string;
}): Promise<{ job: GenerationJob; order: OrderRow; stitch: StitchRequest | null }> {
  const order = await getOrder(opts.orderId);
  if (!order) throw new Error("Order not found");
  const job = await loadGeneration(opts.orderId);
  if (!job) throw new Error("No generation in progress");
  if (!opts.dataUrl && !opts.url) throw new Error("Provide dataUrl or url");

  const mime = opts.mime || (opts.kind === "video" ? "video/mp4" : "image/jpeg");
  const slug = businessSlug(order.business_name);

  if (opts.slotId === "master") {
    const filename =
      opts.filename.replace(/[^\w.\-]+/g, "-").slice(0, 120) ||
      `${slug}-${PRODUCTS[order.product].durationSeconds ?? 20}s.mp4`;
    const attached = await attachGen(opts.orderId, filename, opts.url ?? null, mime, "delivery", opts.dataUrl);
    job.masterUrl = assetViewUrl(opts.origin, attached.id, opts.dataUrl);
    job.updatedAt = new Date().toISOString();
    await appendEvent(
      opts.orderId,
      "generate",
      `Master stitched · ${PRODUCTS[order.product].durationSeconds ?? 20}s.`,
      "grok",
    );
    finishIfDone(job);
    if (job.status === "done") {
      await appendEvent(opts.orderId, "generate", "All slots generated. QC next.", "grok");
    }
    await saveGeneration(opts.orderId, job);
    return { job, order: (await getOrder(opts.orderId))!, stitch: null };
  }

  const slot = job.slots.find((s) => s.id === opts.slotId);
  if (!slot) throw new Error("Unknown slot");

  const filename = opts.filename.replace(/[^\w.\-]+/g, "-").slice(0, 120) || `${slot.id}-gen.bin`;

  if (opts.kind === "still") {
    const attached = await attachGen(
      opts.orderId,
      filename.endsWith(".jpg") || filename.endsWith(".png") || filename.endsWith(".webp")
        ? filename
        : `${slot.id}-gen.jpg`,
      opts.url ?? null,
      mime,
      slot.duration ? "still" : "delivery",
      opts.dataUrl,
    );
    slot.stillUrl = assetViewUrl(opts.origin, attached.id, opts.dataUrl);
    slot.claimedAt = undefined;
    slot.error = undefined;
    if (!slot.duration) {
      slot.status = "done";
      await appendEvent(opts.orderId, "generate", `Still ready · ${slot.label}.`, "grok");
    } else {
      slot.status = "still";
      await appendEvent(opts.orderId, "generate", `Still ready · ${slot.label}. Animating next.`, "grok");
    }
  } else {
    const outName =
      slot.id === "mascot"
        ? `${slug}-mascot.mp4`
        : filename.endsWith(".mp4")
          ? filename
          : `${slot.id}-gen.mp4`;
    const attached = await attachGen(opts.orderId, outName, opts.url ?? null, mime, "delivery", opts.dataUrl);
    slot.videoUrl = assetViewUrl(opts.origin, attached.id, opts.dataUrl);
    slot.status = "done";
    slot.claimedAt = undefined;
    slot.error = undefined;
    if (slot.id === "mascot") job.mascotUrl = slot.videoUrl;
    await appendEvent(
      opts.orderId,
      "generate",
      slot.id === "mascot" ? "Mascot extra video ready." : `Clip ready · ${slot.label}.`,
      "grok",
    );
  }

  finishIfDone(job);
  if (job.status === "done") {
    await appendEvent(opts.orderId, "generate", "All slots generated. QC next.", "grok");
  }
  await saveGeneration(opts.orderId, job);
  const fresh = (await getOrder(opts.orderId))!;
  return { job, order: fresh, stitch: opts.kind === "video" ? stitchIfReady(fresh, job) : null };
}

export async function tickGeneration(
  orderId: string,
  opts: { action: "start" | "tick"; force?: boolean },
): Promise<{ job: GenerationJob; order: OrderRow }> {
  const engine = generationEngine();
  if (engine === "xai" && !apiKey()) {
    throw new Error("AI is not available in this environment");
  }
  let order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "delivered" || order.status === "refunded") {
    throw new Error(`Cannot generate a ${order.status} order`);
  }

  let job = await loadGeneration(orderId);

  if (opts.action === "start") {
    if (job?.status === "running" && !opts.force) {
      // fall through
    } else {
      if (order.status === "paid") {
        order = await claimOrder(orderId, "grok");
      }
      const assets = (await listAssets({ orderId })).filter((a) => a.kind !== "delivery" && a.kind !== "still");
      const packet = packetFromOrder(order, assets);
      await clearGenFiles(orderId);
      job = initJob(packet, engine);
      await saveGeneration(orderId, job);
      const via = engine === "imagine" ? "SuperGrok Imagine" : "xAI API";
      await appendEvent(orderId, "generate", `Started generation · ${job.slots.length} slots · ${via}.`, "grok");
    }
  }

  if (!job) throw new Error("No generation in progress");
  if (job.status === "done" && opts.action === "tick") {
    return { job, order: (await getOrder(orderId))! };
  }

  const activeEngine = job.engine ?? engine;
  if (activeEngine === "imagine" && engine === "xai") {
    job.engine = "xai";
  }
  if ((job.engine ?? engine) === "imagine") {
    finishIfDone(job);
    await saveGeneration(orderId, job);
    return { job, order: (await getOrder(orderId))! };
  }

  if (!apiKey()) {
    throw new Error("AI is not available in this environment");
  }

  const packetAssets = (await listAssets({ orderId })).filter((a) => a.kind !== "delivery" && a.kind !== "still");
  const packet = packetFromOrder(order, packetAssets);
  const ratio = packet.aspect_ratio_priority[0] ?? "9:16";

  const slot = job.slots.find((s) => s.status !== "done" && s.status !== "error");
  if (!slot) {
    finishIfDone(job);
    await saveGeneration(orderId, job);
    return { job, order: (await getOrder(orderId))! };
  }

  const recipeSlot = packet.recipe.slots.find((s) => s.id === slot.id);
  if (!recipeSlot) {
    slot.status = "error";
    slot.error = "Missing recipe slot";
    finishIfDone(job);
    await saveGeneration(orderId, job);
    throw new Error(slot.error);
  }

  try {
    if (slot.status === "queued" || (slot.status === "still" && !slot.stillUrl)) {
      slot.status = "still";
      await saveGeneration(orderId, job);
      const ref = await referenceUri(orderId, slot.id === "end_card" || slot.id === "static");
      const url = await generateStill(stillPrompt(packet, recipeSlot, ratio), ref);
      slot.stillUrl = url;
      await attachGen(orderId, `${slot.id}-gen.jpg`, url, "image/jpeg", slot.duration ? "still" : "delivery");
      if (!slot.duration) {
        slot.status = "done";
        await appendEvent(orderId, "generate", `Still ready · ${slot.label}.`, "grok");
      }
    } else if (slot.status === "still" && slot.stillUrl) {
      if (!slot.duration) {
        slot.status = "done";
      } else {
        const vidId = await startVideo(
          motionPrompt(recipeSlot, slot.duration, order.tone),
          slot.stillUrl,
          slot.duration,
        );
        slot.videoRequestId = vidId;
        slot.status = "video";
        await appendEvent(orderId, "generate", `Animating ${slot.label} (${slot.duration}s).`, "grok");
      }
    } else if (slot.status === "video") {
      if (!slot.videoRequestId) {
        if (!slot.stillUrl) throw new Error("Missing still for video");
        slot.videoRequestId = await startVideo(
          motionPrompt(recipeSlot, slot.duration ?? 6, order.tone),
          slot.stillUrl,
          slot.duration ?? 6,
        );
      } else {
        const last = await pollVideo(slot.videoRequestId);
        const done = last.status === "done" || last.status === "completed" || last.status === "succeeded";
        if (done && last.url) {
          slot.videoUrl = last.url;
          slot.status = "done";
          await attachGen(orderId, `${slot.id}-gen.mp4`, last.url, "video/mp4", "delivery");
          await appendEvent(orderId, "generate", `Clip ready · ${slot.label}.`, "grok");
        } else if (last.status === "failed" || last.status === "expired") {
          throw new Error(`Video ${last.status} for ${slot.label}`);
        }
      }
    }
  } catch (err) {
    slot.status = "error";
    slot.error = err instanceof Error ? err.message : "Generation failed";
    job.status = "error";
    job.error = slot.error;
    await saveGeneration(orderId, job);
    await appendEvent(orderId, "generate", `Failed · ${slot.label}: ${slot.error}`, "grok");
    throw new Error(slot.error);
  }

  finishIfDone(job);
  if (job.status === "done") {
    await appendEvent(orderId, "generate", "All slots generated. QC next.", "grok");
  }
  await saveGeneration(orderId, job);
  return { job, order: (await getOrder(orderId))! };
}
