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
import { masterClips, type SlotId } from "./recipe";
import { inspectClip, pronunciationNote, type AutoQcResult } from "./auto-qc.server";
import { extractProductScript, slotScriptLine } from "./script";
import { PRODUCTS } from "./products";
import { stitchMasterFile } from "./stitch.server";
import { classifyXaiPath, readLimitHeaders, recordXaiCall, runWithOrder } from "./xai-limits.server";
import { addImage, addVideo, emptyCost, estimateJobCost, type CostTally } from "./xai-cost";
import {
  detectGenerationTimeout,
  jobStopped,
  markJobCancelled,
  markJobFailed,
  orderOpenForGeneratePump,
  VIDEO_WAIT_MS,
} from "./generation-progress";
import { directionShownToModel, shouldReinitGeneration } from "./generate-direction";
import {
  hasTextOverlay,
  resolveTextOverlay,
  shouldOverlayStill,
  shouldOverlayVideo,
  videoDirectionForModel,
  type TextOverlaySpec,
} from "./text-overlay";
import {
  composeImagineStillPrompt,
  composeMotionPrompt,
  composeStillPrompt,
  type PromptPacket,
} from "./generate-prompts";
import { overlayStillFromUrl, overlayVideoFromUrl } from "./text-overlay.server";
import { applyVideoDirection, resolveVideoDirection } from "./video-direction";
import {
  compactDataUrlForModel,
  imageGenerationAttempts,
  MAX_XAI_EDIT_IMAGES,
  preferredRefSource,
  rankReferenceAssets,
  referencePromptBlock,
} from "./generate-refs";

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
  videoStartedAt?: string;
  stillPrompt?: string;
  motionPrompt?: string;
  claimedAt?: string;
  error?: string;
  qc?: "pass" | "fix";
  qcNote?: string;
  autoQc?: AutoQcResult;
  assetIds?: string[];
  remakes?: number;
  overlaysApplied?: boolean;
};

export type TimelineClip = {
  id: string;
  slotId: string;
  label: string;
  url: string;
  stillUrl?: string;
  seconds: number;
};

export type GenerationJob = {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  engine: GenEngine;
  startedAt: string;
  updatedAt: string;
  error?: string;
  masterUrl?: string;
  mascotUrl?: string;
  assembleRequested?: boolean;
  timeline?: TimelineClip[];
  direction?: string;
  videoDirection?: string;
  textOverlay?: TextOverlaySpec;
  cost?: CostTally;
  floor?: { status: "watching" | "remaking" | "ready" | "needs_human"; note: string; remakes: number };
  slots: GenSlotState[];
};

export type StitchRequest = {
  filename: string;
  durationSeconds: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  clips: Array<{ slotId: string; seconds: number; url: string }>;
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
const CLAIM_MS = 8 * 60 * 1000;
const XAI_GET_MS = 30_000;
const XAI_POST_MS = 120_000;

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
  return Math.min(40, Math.max(4, Math.max(...nums)));
}

/** xAI video accepts 6 / 10 / 15. 20s masters pad the last frame after the 15s take. */
function apiVideoSeconds(target: number | null): number {
  if (target == null) return 15;
  if (target <= 6) return 6;
  if (target <= 10) return 10;
  return 15;
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

function persistFailedJob(job: GenerationJob, message: string, slotId?: string): GenerationJob {
  return markJobFailed(job, message, slotId) as GenerationJob;
}

export async function failTimedOutGeneration(orderId: string, message?: string): Promise<GenerationJob | null> {
  const job = await loadGeneration(orderId);
  if (!job || jobStopped(job.status)) return job;
  const hit = detectGenerationTimeout(job);
  if (!hit && !message) return job;
  const next = persistFailedJob(job, message || hit?.message || "Generation timed out", hit?.slotId);
  await saveGeneration(orderId, next);
  await appendEvent(orderId, "generate", `Failed · ${next.error}`, "system");
  return next;
}

export async function cancelGeneration(
  orderId: string,
  actor = "bot",
  reason = "Cancelled by operator",
): Promise<{ job: GenerationJob; order: OrderRow }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const job = await loadGeneration(orderId);
  if (!job) throw new Error("No generation in progress");
  if (job.status === "done") throw new Error("Job already finished");
  if (job.status === "cancelled") return { job, order };
  const next = markJobCancelled(job, reason) as GenerationJob;
  await saveGeneration(orderId, next);
  await appendEvent(orderId, "generate", `Cancelled · ${reason}`, actor);
  return { job: next, order: (await getOrder(orderId))! };
}

async function enqueueSlotVideo(
  order: OrderRow,
  job: GenerationJob,
  slot: GenSlotState,
  recipeSlot: GenerationPacket["recipe"]["slots"][number],
  packet: GenerationPacket,
): Promise<void> {
  if (!slot.stillUrl) throw new Error("Missing still for video");
  if (!slot.duration) {
    slot.status = "done";
    await qcAndFloor(order, job, slot);
    return;
  }
  if (slot.videoRequestId) {
    slot.status = "video";
    return;
  }
  slot.status = "video";
  slot.claimedAt = new Date().toISOString();
  slot.videoStartedAt = slot.claimedAt;
  slot.error = undefined;
  await saveGeneration(order.id, job);
  const vidId = await startVideo(
    applyVideoDirection(
      slot.motionPrompt ||
        composeMotionPrompt(
          toPromptPacket(packet, slot.id),
          recipeSlot,
          slot.duration,
          spokenForSlot(packet, slot.id),
          job.direction,
          job.videoDirection,
          job.textOverlay,
        ),
      "video",
      videoDirectionForModel(job.videoDirection, job.textOverlay),
    ),
    slot.stillUrl,
    slot.duration,
  );
  slot.videoRequestId = vidId;
  slot.videoStartedAt = slot.videoStartedAt || new Date().toISOString();
  job.cost = addVideo(job.cost ?? emptyCost(), slot.duration ?? 15);
  await appendEvent(order.id, "generate", `Animating ${slot.label} (${slot.duration}s API take).`, "grok");
}

async function xaiFetch(path: string, init: RequestInit, attempt = 0): Promise<Response> {
  const key = apiKey();
  if (!key) throw new Error("AI is not available in this environment");
  const method = (init.method || "GET").toUpperCase();
  const started = Date.now();
  const timeoutMs = method === "GET" ? XAI_GET_MS : XAI_POST_MS;
  let res: Response;
  try {
    res = await fetch(`${XAI}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    recordXaiCall({
      kind: classifyXaiPath(path, method),
      path,
      method,
      status: 0,
      ms: Date.now() - started,
      retryAfter: null,
      remaining: null,
      limit: null,
      reset: null,
      error: timedOut ? `timeout ${Math.round(timeoutMs / 1000)}s` : "network",
    });
    if (timedOut) throw new Error(`xAI ${method} ${path} timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  }
  const limits = readLimitHeaders(res);
  let error: string | null = null;
  if (!res.ok) error = `${res.status}`;
  if (res.status === 429) error = `429${limits.retryAfter ? ` retry-after ${limits.retryAfter}s` : ""}`;
  recordXaiCall({
    kind: classifyXaiPath(path, method),
    path,
    method,
    status: res.status,
    ms: Date.now() - started,
    retryAfter: limits.retryAfter,
    remaining: limits.remaining,
    limit: limits.limit,
    reset: limits.reset,
    error,
  });
  if (res.status === 429 && method === "GET" && attempt < 1) {
    const wait = Math.min(8, Math.max(1, Number(limits.retryAfter) || 2));
    await new Promise((r) => setTimeout(r, wait * 1000));
    return xaiFetch(path, init, attempt + 1);
  }
  return res;
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

function spokenForSlot(packet: GenerationPacket, slotId: string): string {
  if (slotId === "mascot" || slotId === "static" || slotId === "end_card") {
    return slotScriptLine(packet.intake.brief, packet.product, slotId);
  }
  return extractProductScript(packet.intake.brief, packet.product);
}

function toPromptPacket(packet: GenerationPacket, slotId?: string): PromptPacket {
  return {
    intake: packet.intake,
    website_profile: packet.website_profile,
    recipe: packet.recipe,
    assets: packet.assets,
    script: slotId ? spokenForSlot(packet, slotId) : extractProductScript(packet.intake.brief, packet.product),
  };
}

async function assetToModelUri(a: {
  data_url: string | null;
  external_url: string | null;
  mime: string;
}): Promise<string | null> {
  const source = preferredRefSource(a);
  let dataUrl: string | null = null;
  if (source === "data" && a.data_url) dataUrl = a.data_url;
  else if (source === "http" && a.external_url) {
    try {
      const res = await fetch(a.external_url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0 && buf.length < 8_000_000) {
          const mime = res.headers.get("content-type") || a.mime || "image/jpeg";
          dataUrl = `data:${mime.split(";")[0]};base64,${buf.toString("base64")}`;
        }
      }
    } catch {
      dataUrl = null;
    }
  }
  if (!dataUrl) return null;
  const compact = await compactDataUrlForModel(dataUrl);
  return compact || null;
}

async function loadReferenceImages(
  orderId: string,
  preferLogo: boolean,
): Promise<{ uris: string[]; used: Array<{ kind: string; filename: string }> }> {
  const assets = await listAssets({ orderId });
  const ranked = rankReferenceAssets(assets, preferLogo);
  const uris: string[] = [];
  const used: Array<{ kind: string; filename: string }> = [];
  for (const a of ranked) {
    const uri = await assetToModelUri(a);
    if (!uri) continue;
    uris.push(uri);
    used.push({ kind: a.kind, filename: a.filename });
    if (uris.length >= MAX_XAI_EDIT_IMAGES) break;
  }
  return { uris, used };
}

async function generateStill(prompt: string, refs: string[]): Promise<string> {
  const attempts = imageGenerationAttempts(refs);
  let lastMsg = "xAI image error";
  for (const attempt of attempts) {
    const payload: Record<string, unknown> = {
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      resolution: attempt.resolution ?? "2k",
    };
    if (attempt.aspectRatio) payload.aspect_ratio = attempt.aspectRatio;
    if (attempt.image) payload.image = attempt.image;
    const res = await xaiFetch(attempt.path, { method: "POST", body: JSON.stringify(payload) });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const url = pickUrl(body);
      if (url) return url;
      lastMsg = "Image generation returned no URL";
      continue;
    }
    lastMsg =
      body && typeof body === "object" && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : `xAI image error ${res.status}`;
  }
  throw new Error(lastMsg.slice(0, 280));
}

async function startVideo(prompt: string, imageUrl: string, duration: number): Promise<string> {
  const cap = apiVideoSeconds(duration);
  const payload: Record<string, unknown> = {
    model: VIDEO_MODEL,
    prompt,
    duration: cap,
    resolution: "1080p",
    image: { url: imageUrl },
  };
  let res = await xaiFetch("/videos/generations", { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) {
    delete payload.resolution;
    res = await xaiFetch("/videos/generations", { method: "POST", body: JSON.stringify(payload) });
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const id = (typeof rec.request_id === "string" && rec.request_id) || (typeof rec.id === "string" && rec.id) || "";
    if (id) return id;
    throw new Error("Video generation returned no request id");
  }
  const lastMsg =
    body && typeof body === "object" && "error" in body
      ? JSON.stringify((body as { error: unknown }).error)
      : `xAI video error ${res.status}`;
  throw new Error(lastMsg.slice(0, 280));
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
  const ready: StitchRequest["clips"] = [];
  if (job.timeline) {
    if (job.timeline.length === 0) return null;
    for (const c of job.timeline) {
      if (!c.url) continue;
      ready.push({ slotId: c.slotId, seconds: c.seconds, url: c.url });
    }
  } else {
    for (const c of masterClips(order.product)) {
      const slot = job.slots.find((s) => s.id === c.id);
      if (!slot?.videoUrl) continue;
      ready.push({ slotId: c.id, seconds: slot.targetSeconds || c.seconds, url: slot.videoUrl });
    }
  }
  if (ready.length === 0) return null;
  const durationSeconds = PRODUCTS[order.product].durationSeconds ?? ready.reduce((n, c) => n + c.seconds, 0);
  return {
    filename: `${businessSlug(order.business_name)}-${durationSeconds}s.mp4`,
    durationSeconds,
    aspectRatio: jobAspect(order),
    clips: ready,
  };
}

export async function saveTimeline(
  orderId: string,
  clips: TimelineClip[],
): Promise<{ job: GenerationJob; order: OrderRow }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const job = await loadGeneration(orderId);
  if (!job) throw new Error("No clips to sequence");
  job.timeline = clips.filter((c) => c.url && c.seconds > 0);
  const onLine = new Set(job.timeline.map((c) => c.slotId));
  for (const slot of job.slots) {
    if (onLine.has(slot.id) && (slot.videoUrl || slot.stillUrl)) {
      slot.qc = "pass";
    }
  }
  job.masterUrl = undefined;
  job.assembleRequested = false;
  await saveGeneration(orderId, job);
  await appendEvent(
    orderId,
    "generate",
    `Timeline · ${job.timeline.map((c) => c.label).join(" → ") || "empty"}.`,
    "admin",
  );
  return { job, order };
}

export function clipQcSummary(order: OrderRow, job: GenerationJob) {
  const needed = masterClips(order.product);
  const rows = needed.map((c) => {
    const slot = job.slots.find((s) => s.id === c.id);
    return {
      id: c.id,
      label: slot?.label ?? c.id,
      qc: slot?.qc ?? null,
      ready: Boolean(slot?.videoUrl || (slot?.status === "done" && slot?.stillUrl)),
    };
  });
  return {
    passed: rows.filter((r) => r.qc === "pass").length,
    needed: rows.length,
    open: rows.filter((r) => r.qc !== "pass").map((r) => r.label),
    allPassed: rows.every((r) => r.qc === "pass" && r.ready),
  };
}

async function discardSlotAssets(orderId: string, slot: GenSlotState, job?: GenerationJob) {
  const sql = await getSql();
  const ids = slot.assetIds ?? [];
  const cutMaster = slot.id !== "mascot" && slot.id !== "static";
  if (ids.length > 0) {
    await sql.query(`delete from order_assets where order_id = $1 and id = any($2::text[])`, [orderId, ids]);
  }
  await sql.query(
    `delete from order_assets
      where order_id = $1
        and kind in ('still','delivery')
        and (
          filename ilike $2
          or filename ilike $3
          or filename ilike $4
          or ($5::text is not null and (coalesce(external_url,'') = $5 or coalesce(data_url,'') = $5))
          or ($6::text is not null and (coalesce(external_url,'') = $6 or coalesce(data_url,'') = $6))
          or ($7 = true and (filename like '%-20s.mp4' or filename like '%-40s.mp4' or filename ilike '%master%'))
          or ($8 = true and filename like '%-mascot.mp4')
        )`,
    [
      orderId,
      `${slot.id}-gen.%`,
      `${slot.id}-gen-%`,
      `%${slot.id}-gen%`,
      slot.stillUrl ?? null,
      slot.videoUrl ?? null,
      cutMaster,
      slot.id === "mascot",
    ],
  );
  slot.assetIds = [];
  if (job && cutMaster) {
    job.masterUrl = undefined;
    job.assembleRequested = false;
  }
  if (job && slot.id === "mascot") job.mascotUrl = undefined;
}

function trackAsset(slot: GenSlotState, id: string) {
  const ids = new Set(slot.assetIds ?? []);
  ids.add(id);
  slot.assetIds = [...ids];
}

function emptySlotMedia(slot: GenSlotState) {
  slot.stillUrl = undefined;
  slot.videoUrl = undefined;
  slot.videoRequestId = undefined;
  slot.videoStartedAt = undefined;
  slot.claimedAt = undefined;
  slot.overlaysApplied = undefined;
  slot.error = undefined;
  slot.status = "queued";
  slot.autoQc = undefined;
  slot.assetIds = [];
}

async function qcAndFloor(order: OrderRow, job: GenerationJob, slot: GenSlotState, actor = "grok") {
  await applyAutoQc(order, job, slot, actor);
  await applyFloorDecision(order, job, slot);
}

async function applyAutoQc(order: OrderRow, job: GenerationJob, slot: GenSlotState, actor = "grok") {
  if (slot.status !== "done") return;
  try {
    const result = await inspectClip({ slot, order });
    slot.autoQc = result;
    if (result.status === "pass") {
      await appendEvent(order.id, "qc", `Auto QC recommends keep · ${slot.label}.`, actor);
    } else {
      const note = result.checks
        .filter((c) => !c.ok)
        .map((c) => c.detail || c.label)
        .join(" ")
        .slice(0, 280);
      slot.qcNote = note || slot.qcNote;
      await appendEvent(
        order.id,
        "qc",
        `Auto QC needs review · ${slot.label}${note ? ` · ${note}` : ""}. Keep the take until you cut it.`,
        actor,
      );
    }
  } catch (err) {
    slot.autoQc = {
      status: "warn",
      ranAt: new Date().toISOString(),
      checks: [
        {
          id: "run",
          ok: false,
          hard: false,
          label: "Auto QC",
          detail: err instanceof Error ? err.message : "QC failed to run",
        },
      ],
    };
  }
}

const MAX_FLOOR_REMAKES = 1;

function floorDirection(order: OrderRow, slot: GenSlotState, overlay?: TextOverlaySpec | null): string {
  const fails = (slot.autoQc?.checks ?? []).filter((c) => !c.ok);
  const bits = fails.map((c) => c.detail || c.label);
  bits.push(pronunciationNote(order.city, order.state));
  if (hasTextOverlay(overlay)) {
    bits.push("Blank plate — no words, letters, logos, or URLs. Type is composited after this take.");
  } else {
    bits.push(
      `On-screen name must read ${order.business_name}. City ${order.city}. Phone ${order.phone}. No watermarks, no extra logos, no morphing lettering.`,
    );
  }
  return bits.filter(Boolean).join(" ").slice(0, 600);
}

/** Keep a passing take or queue one remake. Never start a second video in this tick. */
export async function applyFloorDecision(order: OrderRow, job: GenerationJob, slot: GenSlotState): Promise<"kept" | "remake" | "human" | "skip"> {
  if (slot.status !== "done" || !slot.autoQc) return "skip";
  slot.remakes = slot.remakes ?? 0;
  const hardFail = slot.autoQc.checks.some((c) => c.hard && !c.ok);
  if (slot.autoQc.status === "pass" || (!hardFail && slot.autoQc.status !== "fail")) {
    slot.qc = "pass";
    if (slot.videoUrl && !(job.timeline ?? []).some((c) => c.slotId === slot.id)) {
      job.timeline = [
        ...(job.timeline ?? []),
        {
          id: makeId("tl"),
          slotId: slot.id,
          label: slot.label,
          url: slot.videoUrl,
          stillUrl: slot.stillUrl,
          seconds: slot.targetSeconds || slot.duration || 15,
        },
      ];
    }
    job.floor = { status: "ready", note: "Floor kept this take. Watch the master, then Pass QC.", remakes: slot.remakes };
    await appendEvent(order.id, "qc", `Floor kept · ${slot.label}.`, "floor");
    return "kept";
  }
  if (hardFail && slot.remakes < MAX_FLOOR_REMAKES) {
    const note = floorDirection(order, slot, job.textOverlay);
    slot.remakes += 1;
    job.direction = note;
    slot.qcNote = note;
    const shown = directionShownToModel(note, job.textOverlay);
    const add = ` DIRECTION CHANGE (this overrides the previous take): ${shown}`;
    if (slot.stillPrompt && !slot.stillPrompt.includes(shown)) slot.stillPrompt += add;
    if (slot.motionPrompt && !slot.motionPrompt.includes(shown)) slot.motionPrompt += add;
    if (job.videoDirection) {
      const visual = videoDirectionForModel(job.videoDirection, job.textOverlay);
      if (slot.stillPrompt) slot.stillPrompt = applyVideoDirection(slot.stillPrompt, "still", visual);
      if (slot.motionPrompt) slot.motionPrompt = applyVideoDirection(slot.motionPrompt, "video", visual);
    }
    await discardSlotAssets(order.id, slot, job);
    emptySlotMedia(slot);
    slot.qc = "fix";
    slot.status = "queued";
    job.timeline = (job.timeline ?? []).filter((c) => c.slotId !== slot.id);
    job.status = "running";
    job.floor = { status: "remaking", note, remakes: slot.remakes };
    await appendEvent(
      order.id,
      "qc",
      `Floor remake ${slot.remakes}/${MAX_FLOOR_REMAKES} · ${slot.label}.`,
      "floor",
    );
    return "remake";
  }
  job.floor = { status: "needs_human", note: floorDirection(order, slot, job.textOverlay), remakes: slot.remakes };
  await appendEvent(order.id, "qc", `Floor stopped · ${slot.label} still fails. Watch it.`, "floor");
  return "human";
}

export async function runAutoQc(orderId: string): Promise<{ job: GenerationJob; order: OrderRow }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const job = await loadGeneration(orderId);
  if (!job) throw new Error("No clips to check");
  for (const slot of job.slots) {
    if (slot.status === "done" && (slot.videoUrl || slot.stillUrl)) {
      await qcAndFloor(order, job, slot, "admin");
    }
  }
  finishIfDone(job);
  await saveGeneration(orderId, job);
  return { job, order: (await getOrder(orderId))! };
}

export async function reviewSlot(
  orderId: string,
  slotId: SlotId,
  verdict: "pass" | "fix",
  note?: string,
): Promise<{ job: GenerationJob; order: OrderRow; stitch: StitchRequest | null }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const job = await loadGeneration(orderId);
  if (!job) throw new Error("No clips to review yet");
  const slot = job.slots.find((s) => s.id === slotId);
  if (!slot) throw new Error("Unknown clip");
  if (verdict === "pass" && !slot.videoUrl && !slot.stillUrl) {
    throw new Error("That clip is not ready yet");
  }
  if (verdict === "fix" && slot.qc === "fix" && !slot.videoUrl && !slot.stillUrl) {
    slot.qcNote = note?.trim() || slot.qcNote;
    await saveGeneration(orderId, job);
    return { job, order, stitch: null };
  }
  if (verdict === "fix" && !slot.videoUrl && !slot.stillUrl) {
    throw new Error("Nothing to discard");
  }
  slot.qc = verdict;
  slot.qcNote = note?.trim() || slot.qcNote;
  if (verdict === "fix") {
    await discardSlotAssets(orderId, slot, job);
    emptySlotMedia(slot);
    slot.qc = "fix";
    slot.qcNote = note?.trim() || slot.qcNote;
    job.timeline = (job.timeline ?? []).filter((c) => c.slotId !== slotId);
    job.status = job.slots.every((s) => s.status === "done") ? "done" : "running";
  } else if (slot.videoUrl) {
    const exists = (job.timeline ?? []).some((c) => c.slotId === slotId);
    if (!exists) {
      job.timeline = [
        ...(job.timeline ?? []),
        {
          id: makeId("tl"),
          slotId,
          label: slot.label,
          url: slot.videoUrl,
          stillUrl: slot.stillUrl,
          seconds: slot.targetSeconds || slot.duration || 6,
        },
      ];
    }
  }
  await saveGeneration(orderId, job);
  await appendEvent(
    orderId,
    "qc",
    verdict === "pass"
      ? `Made the cut · ${slot.label}.`
      : `Cut from library · ${slot.label}${slot.qcNote ? ` · ${slot.qcNote}` : ""}.`,
    "admin",
  );
  return { job, order, stitch: stitchIfReady(order, job) };
}

export async function regenSlot(
  orderId: string,
  slotId: SlotId,
  note?: string,
): Promise<{ job: GenerationJob; order: OrderRow }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const job = await loadGeneration(orderId);
  if (!job) throw new Error("No generation to redo");
  const slot = job.slots.find((s) => s.id === slotId);
  if (!slot) throw new Error("Unknown clip");
  const extra = (note ?? slot.qcNote)?.trim();
  if (extra) {
    job.direction = extra;
    slot.qcNote = extra;
    const shown = directionShownToModel(extra, job.textOverlay);
    const add = ` DIRECTION CHANGE (this overrides the previous take): ${shown}`;
    if (slot.stillPrompt && !slot.stillPrompt.includes(shown)) slot.stillPrompt += add;
    if (slot.motionPrompt && !slot.motionPrompt.includes(shown)) slot.motionPrompt += add;
  }
  if (job.videoDirection) {
    const visual = videoDirectionForModel(job.videoDirection, job.textOverlay);
    if (slot.stillPrompt) slot.stillPrompt = applyVideoDirection(slot.stillPrompt, "still", visual);
    if (slot.motionPrompt) slot.motionPrompt = applyVideoDirection(slot.motionPrompt, "video", visual);
  }
  const loc = pronunciationNote(order.city, order.state);
  if ((slot.id === "hook" || slot.id.startsWith("body")) && slot.motionPrompt && !slot.motionPrompt.includes("Never spell the state")) {
    slot.motionPrompt += ` ${loc}`;
  }
  slot.status = "queued";
  await discardSlotAssets(orderId, slot, job);
  emptySlotMedia(slot);
  slot.qc = "fix";
  job.timeline = (job.timeline ?? []).filter((c) => c.slotId !== slotId);
  job.status = "running";
  job.error = undefined;
  await saveGeneration(orderId, job);
  await appendEvent(orderId, "generate", `Redo · ${slot.label}${extra ? ` · ${extra}` : ""}.`, "admin");
  if (generationEngine() === "xai") {
    return tickGeneration(orderId, { action: "tick" });
  }
  return { job, order: (await getOrder(orderId))! };
}

export async function assembleMaster(
  orderId: string,
  origin: string,
): Promise<{
  job: GenerationJob;
  order: OrderRow;
  stitch: StitchRequest;
}> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const job = await loadGeneration(orderId);
  if (!job) throw new Error("No clips to assemble");
  const stitch = stitchIfReady(order, { ...job, masterUrl: undefined });
  if (!stitch) {
    if (job.timeline && job.timeline.length === 0) {
      throw new Error("Drag clips onto the FINAL CLIP timeline first.");
    }
    throw new Error("Need videos on the timeline (or generated hook / body / end card) to stitch.");
  }
  job.assembleRequested = true;
  job.masterUrl = undefined;
  job.error = undefined;
  await saveGeneration(orderId, job);
  await appendEvent(
    orderId,
    "generate",
    `Stitching FINAL CLIP · ${stitch.clips.map((c) => c.slotId).join(" → ")} · ${stitch.durationSeconds}s.`,
    "admin",
  );

  try {
    let buf = await stitchMasterFile({
      clips: stitch.clips,
      aspect: stitch.aspectRatio,
      crf: stitch.durationSeconds >= 40 ? 32 : 28,
      targetSeconds: stitch.durationSeconds,
    });
    if (buf.length > 4_500_000) {
      buf = await stitchMasterFile({
        clips: stitch.clips,
        aspect: stitch.aspectRatio,
        crf: 36,
        targetSeconds: stitch.durationSeconds,
      });
    }
    if (hasTextOverlay(job.textOverlay) && !job.slots.some((s) => s.overlaysApplied && s.id !== "mascot")) {
      try {
        const { overlayVideoBuffer } = await import("./text-overlay.server");
        const overlaid = await overlayVideoBuffer(buf, job.textOverlay!, {
          durationHint: stitch.durationSeconds,
        });
        buf = overlaid.buffer;
        await appendEvent(orderId, "generate", "Exact type composited on the stitched master.", "admin");
      } catch (err) {
        await appendEvent(
          orderId,
          "generate",
          `Master overlay skipped · ${err instanceof Error ? err.message : "composite failed"}`,
          "admin",
        );
      }
    }
    const dataUrl = `data:video/mp4;base64,${buf.toString("base64")}`;
    const attached = await attachGen(orderId, stitch.filename, null, "video/mp4", "delivery", dataUrl);
    job.masterUrl = assetViewUrl(origin, attached.id, dataUrl);
    job.assembleRequested = false;
    await saveGeneration(orderId, job);
    await appendEvent(orderId, "generate", `Master stitched · ${stitch.durationSeconds}s.`, "admin");
    return { job, order: (await getOrder(orderId))!, stitch };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stitch failed";
    job.assembleRequested = false;
    job.error = message.slice(0, 280);
    await saveGeneration(orderId, job);
    await appendEvent(orderId, "generate", `Stitch failed · ${job.error}`, "admin");
    throw new Error(job.error);
  }
}

async function clearGenFiles(orderId: string) {
  const sql = await getSql();
  await sql.query(
    `delete from order_assets where order_id = $1 and kind in ('still','delivery')
      and (filename like '%-gen.%' or filename like '%-12s.mp4' or filename like '%-20s.mp4' or filename like '%-40s.mp4' or filename like '%-mascot.mp4')`,
    [orderId],
  );
}

/** Drop prior still/video so remake + generate:true cannot return the same stillUrl. */
export async function resetGeneration(orderId: string): Promise<void> {
  const job = await loadGeneration(orderId);
  if (job) {
    for (const slot of job.slots) {
      await discardSlotAssets(orderId, slot, job);
    }
  }
  await clearGenFiles(orderId);
  await ensureGenerationColumn();
  const sql = await getSql();
  await sql.query(`update orders set generation = null, updated_at = now() where id = $1`, [orderId]);
}

function initJob(
  packet: GenerationPacket,
  engine: GenEngine,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
): GenerationJob {
  const now = new Date().toISOString();
  const ratio = packet.aspect_ratio_priority[0] ?? "9:16";
  const visual = videoDirection?.trim() || resolveVideoDirection({ brief: packet.intake.brief });
  const textOverlay = resolveTextOverlay({
    explicit: overlay,
    videoDirection: visual,
    brief: packet.intake.brief,
  });
  return {
    status: "running",
    engine,
    startedAt: now,
    updatedAt: now,
    direction: direction?.trim() || undefined,
    videoDirection: visual || undefined,
    textOverlay: hasTextOverlay(textOverlay) ? textOverlay : undefined,
    slots: packet.recipe.slots.map((s) => {
      const target = slotSeconds(s.duration);
      const duration = engine === "imagine" ? imagineSeconds(s.duration) : apiVideoSeconds(target);
      const spoken = spokenForSlot(packet, s.id);
      const still =
        engine === "imagine"
          ? composeImagineStillPrompt(toPromptPacket(packet, s.id), s, ratio, direction, visual, textOverlay)
          : composeStillPrompt(toPromptPacket(packet, s.id), s, ratio, direction, visual, textOverlay);
      const motion =
        duration != null
          ? composeMotionPrompt(toPromptPacket(packet, s.id), s, duration, spoken, direction, visual, textOverlay, engine)
          : undefined;
      return {
        id: s.id,
        label: s.label,
        duration,
        targetSeconds: target,
        status: "queued" as const,
        stillPrompt: still,
        motionPrompt: motion,
      };
    }),
    cost: emptyCost(),
  };
}

function finishIfDone(job: GenerationJob) {
  if (job.status === "cancelled") return;
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

async function applyExactOverlays(opts: {
  orderId: string;
  slot: GenSlotState;
  job: GenerationJob;
  origin: string;
  kind: "still" | "video";
  url: string;
}): Promise<{ url: string; dataUrl?: string; applied: boolean }> {
  const spec = opts.job.textOverlay;
  if (!hasTextOverlay(spec) || opts.slot.overlaysApplied) {
    return { url: opts.url, applied: false };
  }
  try {
    if (opts.kind === "still") {
      if (!shouldOverlayStill(opts.slot.id)) return { url: opts.url, applied: false };
      const overlaid = await overlayStillFromUrl(opts.url, spec!, "endCard");
      if (!overlaid) return { url: opts.url, applied: false };
      const dataUrl = `data:${overlaid.mime};base64,${overlaid.buffer.toString("base64")}`;
      opts.slot.overlaysApplied = true;
      await appendEvent(opts.orderId, "generate", `Exact end-card type composited on ${opts.slot.label}.`, "grok");
      return { url: dataUrl, dataUrl, applied: true };
    }
    if (!shouldOverlayVideo(opts.slot.id)) return { url: opts.url, applied: false };
    const overlaid = await overlayVideoFromUrl(opts.url, spec!, {
      durationHint: opts.slot.duration ?? opts.slot.targetSeconds ?? 15,
    });
    if (!overlaid) return { url: opts.url, applied: false };
    const dataUrl = `data:video/mp4;base64,${overlaid.buffer.toString("base64")}`;
    opts.slot.overlaysApplied = true;
    await appendEvent(opts.orderId, "generate", `Exact end-card / lower-third type composited on ${opts.slot.label}.`, "grok");
    return { url: dataUrl, dataUrl, applied: true };
  } catch (err) {
    await appendEvent(
      opts.orderId,
      "generate",
      `Overlay pass skipped · ${err instanceof Error ? err.message : "composite failed"}`,
      "grok",
    );
    return { url: opts.url, applied: false };
  }
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
  for (const a of usable.slice(0, 8)) {
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
    const sourceUrl = opts.dataUrl || opts.url || "";
    const overlaid = sourceUrl
      ? await applyExactOverlays({
          orderId: opts.orderId,
          slot,
          job,
          origin: opts.origin,
          kind: "still",
          url: sourceUrl,
        })
      : { url: sourceUrl, dataUrl: opts.dataUrl, applied: false };
    const attached = await attachGen(
      opts.orderId,
      filename.endsWith(".jpg") || filename.endsWith(".png") || filename.endsWith(".webp")
        ? filename
        : `${slot.id}-gen.jpg`,
      overlaid.applied ? null : opts.url ?? null,
      mime,
      slot.duration ? "still" : "delivery",
      overlaid.dataUrl ?? opts.dataUrl,
    );
    slot.stillUrl = assetViewUrl(opts.origin, attached.id, overlaid.dataUrl ?? opts.dataUrl);
    trackAsset(slot, attached.id);
    slot.claimedAt = undefined;
    slot.error = undefined;
    if (!slot.duration) {
      slot.status = "done";
      await appendEvent(opts.orderId, "generate", `Still ready · ${slot.label}.`, "grok");
      await qcAndFloor(order, job, slot);
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
    const sourceUrl = opts.dataUrl || opts.url || "";
    const overlaid = sourceUrl
      ? await applyExactOverlays({
          orderId: opts.orderId,
          slot,
          job,
          origin: opts.origin,
          kind: "video",
          url: sourceUrl,
        })
      : { url: sourceUrl, dataUrl: opts.dataUrl, applied: false };
    const attached = await attachGen(
      opts.orderId,
      outName,
      overlaid.applied ? null : opts.url ?? null,
      mime,
      "delivery",
      overlaid.dataUrl ?? opts.dataUrl,
    );
    slot.videoUrl = assetViewUrl(opts.origin, attached.id, overlaid.dataUrl ?? opts.dataUrl);
    trackAsset(slot, attached.id);
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
    await qcAndFloor(order, job, slot);
  }

  finishIfDone(job);
  if (job.status === "done") {
    await appendEvent(opts.orderId, "generate", "All slots generated. QC next.", "grok");
  }
  await saveGeneration(opts.orderId, job);
  const fresh = (await getOrder(opts.orderId))!;
  return { job, order: fresh, stitch: opts.kind === "video" ? stitchIfReady(fresh, job) : null };
}

const tickLocks = new Map<string, Promise<unknown>>();

export async function tickGeneration(
  orderId: string,
  opts: {
    action: "start" | "tick";
    force?: boolean;
    direction?: string;
    videoDirection?: string;
    textOverlay?: TextOverlaySpec;
  },
): Promise<{ job: GenerationJob; order: OrderRow }> {
  const run = () => runWithOrder(orderId, () => tickGenerationLocked(orderId, opts));
  const prev = tickLocks.get(orderId) ?? Promise.resolve();
  const next = prev.then(run, run);
  tickLocks.set(
    orderId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function tickGenerationLocked(
  orderId: string,
  opts: {
    action: "start" | "tick";
    force?: boolean;
    direction?: string;
    videoDirection?: string;
    textOverlay?: TextOverlaySpec;
  },
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
  if (order.product !== "video-20") {
    const existing = await loadGeneration(orderId);
    if (existing && existing.status === "running") {
      existing.status = "error";
      existing.error = "Stopped — 20s spots only for now.";
      for (const s of existing.slots) {
        if (s.status === "queued" || s.status === "still" || s.status === "video") {
          s.status = "error";
          s.error = existing.error;
        }
      }
      await saveGeneration(orderId, existing);
      await appendEvent(orderId, "generate", "Stopped — 20s spots only for now.", "admin");
    }
    throw new Error("20s spots only for now. Open the 20 Second job.");
  }

  let job = await loadGeneration(orderId);
  const live = job?.slots.some(
    (s) =>
      !s.videoUrl &&
      (s.status === "still" || s.status === "video") &&
      (Boolean(s.videoRequestId) || claimIsFresh(s)),
  );

  if (opts.action === "start") {
    if (shouldReinitGeneration(opts.action, opts.force, job?.status, Boolean(live))) {
      if (order.status === "paid" || order.status === "remake_requested") {
        order = await claimOrder(orderId, "grok");
      }
      const assets = (await listAssets({ orderId })).filter((a) => a.kind !== "delivery" && a.kind !== "still");
      const packet = packetFromOrder(order, assets);
      await clearGenFiles(orderId);
      const videoDirection = resolveVideoDirection({
        explicit: opts.videoDirection,
        stored: job?.videoDirection,
        brief: order.brief,
        operatorDirection: opts.direction || job?.direction,
      });
      const textOverlay = resolveTextOverlay({
        explicit: opts.textOverlay,
        stored: job?.textOverlay,
        videoDirection,
        brief: order.brief,
      });
      job = initJob(
        packet,
        engine,
        opts.direction?.trim() || job?.direction,
        videoDirection,
        textOverlay,
      );
      await saveGeneration(orderId, job);
      const via = engine === "imagine" ? "SuperGrok Imagine" : "xAI API";
      await appendEvent(orderId, "generate", `Started generation · ${job.slots.length} slots · ${via}.`, "grok");
    }
  }

  if (!job) throw new Error("No generation in progress");
  if (job.status === "cancelled") {
    return { job, order: (await getOrder(orderId))! };
  }
  if (jobStopped(job.status) && opts.action === "tick") {
    return { job, order: (await getOrder(orderId))! };
  }

  const timeout = detectGenerationTimeout(job);
  if (timeout) {
    const failed = persistFailedJob(job, timeout.message, timeout.slotId);
    await saveGeneration(orderId, failed);
    await appendEvent(orderId, "generate", `Failed · ${failed.error}`, "system");
    throw new Error(failed.error);
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

  if (slot.videoUrl) {
    slot.status = "done";
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
      if (slot.status === "still" && claimIsFresh(slot)) {
        return { job, order: (await getOrder(orderId))! };
      }
      slot.status = "still";
      slot.claimedAt = new Date().toISOString();
      await saveGeneration(orderId, job);
      const refs = await loadReferenceImages(orderId, slot.id === "end_card" || slot.id === "static");
      if (packetAssets.some((a) => a.kind === "logo" || a.kind === "upload") && refs.uris.length === 0) {
        throw new Error("Reference photos are on this order but none could be sent to the image model.");
      }
      const stillBase =
        slot.stillPrompt ||
        composeStillPrompt(toPromptPacket(packet, recipeSlot.id), recipeSlot, ratio, job.direction, job.videoDirection, job.textOverlay);
      const refBlock = refs.used.length ? referencePromptBlock(refs.used) : "";
      const url = await generateStill(
        refBlock && !stillBase.includes("REFERENCE PHOTOS ARE ATTACHED") ? `${stillBase}\n${refBlock}` : stillBase,
        refs.uris,
      );
      const origin = env("APP_ORIGIN") || "https://mya.geotargetus.dev";
      const overlaidStill = await applyExactOverlays({
        orderId,
        slot,
        job,
        origin,
        kind: "still",
        url,
      });
      slot.stillUrl = overlaidStill.url;
      job.cost = addImage(job.cost ?? emptyCost(), refs.uris.length > 0);
      if (refs.uris.length) {
        await appendEvent(
          orderId,
          "generate",
          `Still · ${refs.uris.length} reference photo(s) sent to the image model.`,
          "grok",
        );
      }
      const stillAst = await attachGen(
        orderId,
        `${slot.id}-gen.jpg`,
        overlaidStill.applied ? null : url,
        "image/jpeg",
        slot.duration ? "still" : "delivery",
        overlaidStill.dataUrl,
      );
      if (overlaidStill.applied) slot.stillUrl = assetViewUrl(origin, stillAst.id, overlaidStill.dataUrl);
      trackAsset(slot, stillAst.id);
      slot.claimedAt = undefined;
      if (!slot.duration) {
        slot.status = "done";
        await appendEvent(orderId, "generate", `Still ready · ${slot.label}.`, "grok");
        await qcAndFloor(order, job, slot);
      } else {
        await appendEvent(orderId, "generate", `Still ready · ${slot.label}. Animating next.`, "grok");
        // Same tick: if we wait for a later pump, remakes / dead workers hang forever at still.
        await enqueueSlotVideo(order, job, slot, recipeSlot, packet);
      }
    } else if (slot.status === "still" && slot.stillUrl) {
      await enqueueSlotVideo(order, job, slot, recipeSlot, packet);
    } else if (slot.status === "video") {
      const videoAge = slot.videoStartedAt || slot.claimedAt;
      if (videoAge && Date.now() - Date.parse(videoAge) > VIDEO_WAIT_MS) {
        throw new Error("Video timed out after 18 minutes");
      }
      if (!slot.videoRequestId) {
        if (claimIsFresh(slot) && slot.videoStartedAt) {
          return { job, order: (await getOrder(orderId))! };
        }
        await enqueueSlotVideo(order, job, slot, recipeSlot, packet);
      } else {
        const last = await pollVideo(slot.videoRequestId);
        const done = last.status === "done" || last.status === "completed" || last.status === "succeeded";
        if (done && last.url) {
          const origin = env("APP_ORIGIN") || "https://mya.geotargetus.dev";
          const overlaidVideo = await applyExactOverlays({
            orderId,
            slot,
            job,
            origin,
            kind: "video",
            url: last.url,
          });
          slot.videoUrl = overlaidVideo.url;
          slot.status = "done";
          const vidAst = await attachGen(
            orderId,
            `${slot.id}-gen.mp4`,
            overlaidVideo.applied ? null : last.url,
            "video/mp4",
            "delivery",
            overlaidVideo.dataUrl,
          );
          if (overlaidVideo.applied) slot.videoUrl = assetViewUrl(origin, vidAst.id, overlaidVideo.dataUrl);
          trackAsset(slot, vidAst.id);
          await appendEvent(orderId, "generate", `Clip ready · ${slot.label}.`, "grok");
          await qcAndFloor(order, job, slot);
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
    const floorNote = job.floor?.status === "ready" ? "Floor kept the take." : "QC next.";
    await appendEvent(orderId, "generate", `All slots generated. ${floorNote}`, "grok");
  }
  await saveGeneration(orderId, job);
  if (job.floor?.status === "ready" && !job.masterUrl && job.slots.some((s) => s.qc === "pass" && s.videoUrl)) {
    try {
      await assembleMaster(orderId, env("APP_ORIGIN") || "https://mya.geotargetus.dev");
    } catch (err) {
      await appendEvent(
        orderId,
        "generate",
        `Floor assemble later: ${err instanceof Error ? err.message : "stitch failed"}`,
        "floor",
      );
    }
  }
  return { job, order: (await getOrder(orderId))! };
}

const workerRef = globalThis as typeof globalThis & {
  __myaGenTimer__?: ReturnType<typeof setInterval>;
  __myaGenBusy__?: boolean;
};

/** Droplet-side pump: start/tick spots as paid jobs land. QC stays human. */
export function generateWorkerEnabled(): boolean {
  if (process.argv.includes("build")) return false;
  if (process.env.npm_lifecycle_event === "build") return false;
  if (generationEngine() !== "xai" || !apiKey()) return false;
  if (env("AUTO_GENERATE") === "0") return false;
  // Vercel isolates die after the request — opt in only. Persistent node (droplet) defaults on.
  if (env("VERCEL")) return env("AUTO_GENERATE") === "1";
  return true;
}

async function pumpGenerateQueue(): Promise<void> {
  if (workerRef.__myaGenBusy__) return;
  if (!generateWorkerEnabled()) return;
  workerRef.__myaGenBusy__ = true;
  try {
    const orders = await listOrders();
    const open = orders.filter((o) => orderOpenForGeneratePump(o));
    for (const order of open) {
      const job = await loadGeneration(order.id);
      if (jobStopped(job?.status)) continue;
      if (job?.status === "running") {
        const timeout = detectGenerationTimeout(job);
        if (timeout) {
          await failTimedOutGeneration(order.id, timeout.message);
          continue;
        }
      }
      const action = job ? "tick" : "start";
      await tickGeneration(order.id, { action });
      return;
    }
  } catch {
    /* next interval */
  } finally {
    workerRef.__myaGenBusy__ = false;
  }
}

export function ensureGenerateWorker(): void {
  if (typeof setInterval === "undefined") return;
  if (!generateWorkerEnabled()) return;
  if (workerRef.__myaGenTimer__) return;
  workerRef.__myaGenTimer__ = setInterval(() => {
    void pumpGenerateQueue();
  }, 8000);
  setTimeout(() => {
    void pumpGenerateQueue();
  }, 2000);
}

ensureGenerateWorker();

