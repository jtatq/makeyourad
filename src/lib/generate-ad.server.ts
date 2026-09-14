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
import { inspectClip, pronunciationNote, type AutoQcResult } from "./auto-qc.server";
import { spokenPlace } from "./intake";
import { extractProductScript, slotScriptLine } from "./script";
import { PRODUCTS, type Tone } from "./products";
import { stitchMasterFile } from "./stitch.server";

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
  qc?: "pass" | "fix";
  qcNote?: string;
  autoQc?: AutoQcResult;
  assetIds?: string[];
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
  status: "idle" | "running" | "done" | "error";
  engine: GenEngine;
  startedAt: string;
  updatedAt: string;
  error?: string;
  masterUrl?: string;
  mascotUrl?: string;
  assembleRequested?: boolean;
  timeline?: TimelineClip[];
  direction?: string;
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

function continuityLine(packet: GenerationPacket, direction?: string): string {
  const i = packet.intake;
  const cta = packet.website_profile?.cta || "Call today";
  const music = TONE_PACKS[i.tone].music;
  const dir = direction?.trim();
  return [
    "ONE CONTINUOUS SHOT. Do not cut to a new location or a separate end-card graphic.",
    `Music: ${music} One bed from frame one through the last frame — never restart, never drop out on the end card.`,
    `In the last three seconds the camera holds and clean type fades on: ${i.businessName}. ${spokenPlace(i.city, i.state)}. ${i.phone}. ${cta}.`,
    "Never speak the ad length. Never say twelve seconds, twenty seconds, or forty seconds.",
    dir ? `DIRECTION CHANGE (this overrides the previous take): ${dir}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function spokenForSlot(packet: GenerationPacket, slotId: string): string {
  if (slotId === "mascot" || slotId === "static" || slotId === "end_card") {
    return slotScriptLine(packet.intake.brief, packet.product, slotId);
  }
  return extractProductScript(packet.intake.brief, packet.product);
}

function stillPrompt(packet: GenerationPacket, slot: GenerationPacket["recipe"]["slots"][number], ratio: string) {
  const i = packet.intake;
  const site = packet.website_profile;
  const lines = [
    `Photoreal local-business advertisement still, ${ratio}, cinematic, natural light.`,
    `Business: ${i.businessName}, ${i.category_label} in ${spokenPlace(i.city, i.state)}.`,
    `Slot: ${slot.label}. ${slot.role}`,
    `Tone: ${i.tone}. ${packet.recipe.structure}`,
    extractProductScript(i.brief, packet.product)
      ? `EXACT SCRIPT (speak these words, do not paraphrase): ${extractProductScript(i.brief, packet.product)}`
      : "",
    site?.tagline ? `Tagline: ${site.tagline}` : "",
    site?.services?.length ? `Services: ${site.services.slice(0, 6).join(", ")}` : "",
    site?.about ? `About: ${site.about.slice(0, 280)}` : "",
    `Use the real business. Do not invent a different company or a celebrity.`,
    `No watermarks, no agency slogans, no UI chrome.`,
    `Never say twelve seconds, twenty seconds, forty seconds, or any runtime.`,
    continuityLine(packet),
  ];
  if (slot.id === "end_card" || slot.id === "static") {
    lines.push(
      `On-screen type, clean and readable: ${i.businessName}. ${spokenPlace(i.city, i.state)}. ${i.phone}. CTA: ${site?.cta || "Call today"}. Never letter the state (not U.T.).`,
    );
  }
  if (slot.id === "hook" || slot.id.startsWith("body")) {
    const line = extractProductScript(i.brief, packet.product);
    lines.push(
      "Talking-head: a real owner or technician from the reference photos stands in the driveway or at the storefront, facing camera, mid-speech. Van, truck, or house from the uploads sits behind them. Match their face, shirt, and wrap — do not invent lettering.",
    );
    if (line) {
      lines.push(`Mouth the exact full script: "${line}". Captions match those words. This is the script, not an idea.`);
    }
  }
  if (slot.id === "mascot" && i.mascotDescription) lines.push(`Mascot: ${i.mascotDescription}`);
  return lines.filter(Boolean).join("\n");
}

function motionPrompt(
  slot: GenerationPacket["recipe"]["slots"][number],
  seconds: number,
  tone: string,
  city: string,
  state: string,
  spokenLine?: string,
) {
  const talking =
    slot.id === "hook" || slot.id.startsWith("body")
      ? [
          "The person talks to camera with natural hand gestures. Mouth moves in speech.",
          spokenLine
            ? `Speak this script verbatim, do not paraphrase: "${spokenLine}". Captions match exactly.`
            : "",
          pronunciationNote(city, state),
          "Do not freeze the last seconds.",
        ]
          .filter(Boolean)
          .join(" ")
      : "Slow, confident camera. Keep type readable if present.";
  return [
    `Animate this advertisement frame. Clip length for editing is ${seconds} seconds — that is timing only. Do not speak the length.`,
    slot.role,
    `Tone: ${tone}. ${talking}`,
    `Photoreal, no morphing logos, no extra text, no watermarks.`,
    `Never say twelve seconds, twenty seconds, forty seconds, or any runtime. Hard cut when the line is done.`,
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
    `A photoreal ${ratio} advertisement still for ${i.businessName}, a ${i.category_label} in ${spokenPlace(i.city, i.state)}.`,
    `This frame is the ${slot.label.toLowerCase()}: ${slot.role}`,
    `The look is ${i.tone}: ${tone.picture}`,
  ];
  if (i.brief.trim()) {
    const line = slotScriptLine(i.brief, packet.product, slot.id) || extractProductScript(i.brief, packet.product);
    if (line) parts.push(`EXACT SCRIPT for this shot (speak these words, not an idea): ${line}`);
  }
  if (site?.tagline) parts.push(`Their line: ${site.tagline}.`);
  if (site?.services?.length) parts.push(`Services: ${site.services.slice(0, 5).join(", ")}.`);
  if (site?.about) parts.push(site.about.slice(0, 220));
  if (slot.id === "end_card" || slot.id === "static") {
    parts.push(
      `Put clean readable type on screen: ${i.businessName}. ${spokenPlace(i.city, i.state)}. ${i.phone}. ${site?.cta || "Call today"}. Write the full state name, never UT or U.T.`,
    );
  }
  if (slot.id === "hook") {
    const line = slotScriptLine(i.brief, packet.product, slot.id);
    parts.push(
      "Talking-head still: owner or tech from the reference photos, facing camera, mid-speech, branded van or house behind them. Match face, shirt, and wrap exactly. Do not invent lettering on the van or shirt.",
    );
    if (line) parts.push(`They are saying, verbatim: "${line}".`);
  }
  if (slot.id === "mascot" && i.mascotDescription) parts.push(`Mascot: ${i.mascotDescription}`);
  parts.push("Use the real business. No celebrity, no watermark, no UI chrome, no agency slogan.");
  return parts.join(" ");
}

function imagineMotionPrompt(
  slot: GenerationPacket["recipe"]["slots"][number],
  seconds: number,
  tone: Tone,
  city: string,
  state: string,
  spokenLine?: string,
) {
  const pack = TONE_PACKS[tone];
  const talking =
    slot.id === "hook" || slot.id.startsWith("body")
      ? [
          "The person talks to camera with natural hand gestures and a slight weight shift. Mouth moves in speech.",
          spokenLine
            ? `Speak this script verbatim, do not paraphrase: "${spokenLine}". Captions match exactly.`
            : "",
          pronunciationNote(city, state),
          "Do not freeze the last seconds.",
        ]
          .filter(Boolean)
          .join(" ")
      : "Slow, confident camera, subject stays recognizable, type stays readable.";
  return [
    `Animate this advertisement frame. Clip length for editing is ${seconds} seconds — that is timing only. Do not speak the length.`,
    slot.role,
    pack.picture,
    talking,
    "Photoreal, no morphing logos, no extra text, no watermarks.",
    "Never say twelve seconds, twenty seconds, forty seconds, or any runtime. Hard cut when the line is done.",
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
    resolution: "2k",
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
  const cap = apiVideoSeconds(duration);
  const tries = [...new Set([cap, 15, 10, 6])].filter((d) => d >= 6 && d <= 15);
  let lastMsg = "xAI video error";
  for (const d of tries) {
    const payload: Record<string, unknown> = {
      model: VIDEO_MODEL,
      prompt,
      duration: d,
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
      lastMsg = "Video generation returned no request id";
      continue;
    }
    lastMsg =
      body && typeof body === "object" && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : `xAI video error ${res.status}`;
  }
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
  slot.claimedAt = undefined;
  slot.error = undefined;
  slot.status = "queued";
  slot.autoQc = undefined;
  slot.assetIds = [];
}

async function applyAutoQc(order: OrderRow, job: GenerationJob, slot: GenSlotState, actor = "grok") {
  if (slot.status !== "done") return;
  try {
    const result = await inspectClip({ slot, order });
    slot.autoQc = result;
    if (result.status === "pass") {
      await appendEvent(order.id, "qc", `Auto QC recommends keep · ${slot.label}.`, actor);
    } else if (result.status === "fail") {
      const note = result.checks
        .filter((c) => !c.ok)
        .map((c) => c.detail)
        .join(" ")
        .slice(0, 280);
      await discardSlotAssets(order.id, slot, job);
      emptySlotMedia(slot);
      slot.qc = "fix";
      slot.qcNote = note;
      job.timeline = (job.timeline ?? []).filter((c) => c.slotId !== slot.id);
      await appendEvent(order.id, "qc", `Cut from library · ${slot.label} · ${note}`, actor);
    } else {
      const note = result.checks
        .filter((c) => !c.ok)
        .map((c) => c.label)
        .join(", ");
      await appendEvent(
        order.id,
        "qc",
        `Auto QC needs review · ${slot.label}${note ? ` · ${note}` : ""}.`,
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

export async function runAutoQc(orderId: string): Promise<{ job: GenerationJob; order: OrderRow }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const job = await loadGeneration(orderId);
  if (!job) throw new Error("No clips to check");
  for (const slot of job.slots) {
    if (slot.status === "done" && (slot.videoUrl || slot.stillUrl)) {
      await applyAutoQc(order, job, slot, "admin");
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
    const add = ` DIRECTION CHANGE (this overrides the previous take): ${extra}`;
    if (slot.stillPrompt && !slot.stillPrompt.includes(extra)) slot.stillPrompt += add;
    if (slot.motionPrompt && !slot.motionPrompt.includes(extra)) slot.motionPrompt += add;
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

function initJob(packet: GenerationPacket, engine: GenEngine, direction?: string): GenerationJob {
  const now = new Date().toISOString();
  const ratio = packet.aspect_ratio_priority[0] ?? "9:16";
  const extra = continuityLine(packet, direction);
  return {
    status: "running",
    engine,
    startedAt: now,
    updatedAt: now,
    direction: direction?.trim() || undefined,
    slots: packet.recipe.slots.map((s) => {
      const target = slotSeconds(s.duration);
      const duration = engine === "imagine" ? imagineSeconds(s.duration) : apiVideoSeconds(target);
      const spoken = spokenForSlot(packet, s.id);
      const still = (engine === "imagine" ? imagineStillPrompt(packet, s, ratio) : stillPrompt(packet, s, ratio)) + " " + extra;
      const motion =
        duration != null
          ? (engine === "imagine"
              ? imagineMotionPrompt(s, duration, packet.intake.tone, packet.intake.city, packet.intake.state, spoken)
              : motionPrompt(s, duration, packet.intake.tone, packet.intake.city, packet.intake.state, spoken)) +
            " " +
            extra
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
    trackAsset(slot, attached.id);
    slot.claimedAt = undefined;
    slot.error = undefined;
    if (!slot.duration) {
      slot.status = "done";
      await appendEvent(opts.orderId, "generate", `Still ready · ${slot.label}.`, "grok");
      await applyAutoQc(order, job, slot);
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
    await applyAutoQc(order, job, slot);
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
  opts: { action: "start" | "tick"; force?: boolean; direction?: string },
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
      job = initJob(packet, engine, opts.direction?.trim() || job?.direction);
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
      const url = await generateStill(slot.stillPrompt || stillPrompt(packet, recipeSlot, ratio), ref);
      slot.stillUrl = url;
      const stillAst = await attachGen(orderId, `${slot.id}-gen.jpg`, url, "image/jpeg", slot.duration ? "still" : "delivery");
      trackAsset(slot, stillAst.id);
      if (!slot.duration) {
        slot.status = "done";
        await appendEvent(orderId, "generate", `Still ready · ${slot.label}.`, "grok");
        await applyAutoQc(order, job, slot);
      }
    } else if (slot.status === "still" && slot.stillUrl) {
      if (!slot.duration) {
        slot.status = "done";
        await applyAutoQc(order, job, slot);
      } else {
        const vidId = await startVideo(
          slot.motionPrompt ||
            motionPrompt(
              recipeSlot,
              slot.duration,
              order.tone,
              order.city,
              order.state,
              spokenForSlot(packet, slot.id),
            ),
          slot.stillUrl,
          slot.duration,
        );
        slot.videoRequestId = vidId;
        slot.claimedAt = new Date().toISOString();
        slot.status = "video";
        await appendEvent(orderId, "generate", `Animating ${slot.label} (${slot.duration}s API take).`, "grok");
      }
    } else if (slot.status === "video") {
      if (slot.claimedAt && Date.now() - Date.parse(slot.claimedAt) > 18 * 60 * 1000) {
        throw new Error("Video timed out after 18 minutes");
      }
      if (!slot.videoRequestId) {
        if (!slot.stillUrl) throw new Error("Missing still for video");
        slot.videoRequestId = await startVideo(
          slot.motionPrompt ||
            motionPrompt(
              recipeSlot,
              slot.duration ?? 6,
              order.tone,
              order.city,
              order.state,
              spokenForSlot(packet, slot.id),
            ),
          slot.stillUrl,
          slot.duration ?? 6,
        );
      } else {
        const last = await pollVideo(slot.videoRequestId);
        const done = last.status === "done" || last.status === "completed" || last.status === "succeeded";
        if (done && last.url) {
          slot.videoUrl = last.url;
          slot.status = "done";
          const vidAst = await attachGen(orderId, `${slot.id}-gen.mp4`, last.url, "video/mp4", "delivery");
          trackAsset(slot, vidAst.id);
          await appendEvent(orderId, "generate", `Clip ready · ${slot.label}.`, "grok");
          await applyAutoQc(order, job, slot);
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

const workerRef = globalThis as typeof globalThis & {
  __myaGenTimer__?: ReturnType<typeof setInterval>;
  __myaGenBusy__?: boolean;
};

/** Droplet-side pump: start/tick spots as paid jobs land. QC stays human. */
export function generateWorkerEnabled(): boolean {
  if (env("AUTO_GENERATE") !== "1") return false;
  if (process.argv.includes("build")) return false;
  if (process.env.npm_lifecycle_event === "build") return false;
  return generationEngine() === "xai" && Boolean(apiKey());
}

async function pumpGenerateQueue(): Promise<void> {
  if (workerRef.__myaGenBusy__) return;
  if (!generateWorkerEnabled()) return;
  workerRef.__myaGenBusy__ = true;
  try {
    const orders = await listOrders();
    const open = orders.filter((o) => o.product === "video-20" && (o.status === "paid" || o.status === "in_production"));
    for (const order of open) {
      const job = await loadGeneration(order.id);
      if (job?.status === "done" || job?.status === "error") continue;
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

