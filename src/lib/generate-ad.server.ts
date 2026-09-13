import { getSql } from "./db";
import { makeId } from "./ids";
import {
  appendEvent,
  attachFiles,
  claimOrder,
  getOrder,
  listAssets,
  type OrderRow,
} from "./orders.server";
import { buildPacket, type GenerationPacket } from "./prompts/compiler";
import type { SlotId } from "./recipe";

export type GenSlotStatus = "queued" | "still" | "video" | "done" | "error";

export type GenSlotState = {
  id: SlotId;
  label: string;
  duration: number | null;
  status: GenSlotStatus;
  stillUrl?: string;
  videoUrl?: string;
  videoRequestId?: string;
  error?: string;
};

export type GenerationJob = {
  status: "idle" | "running" | "done" | "error";
  startedAt: string;
  updatedAt: string;
  error?: string;
  slots: GenSlotState[];
};

const IMAGE_MODEL = "grok-imagine-image-2.0";
const VIDEO_MODEL = "grok-imagine-video-1.5";
const XAI = "https://api.x.ai/v1";
const MAX_DATA_URI = 3_500_000;

function apiKey(): string | null {
  return process.env.XAI_API_KEY?.trim() || null;
}

function slotSeconds(duration: string): number | null {
  if (duration === "still") return null;
  const nums = duration.match(/\d+/g)?.map(Number) ?? [];
  if (nums.length === 0) return 6;
  return Math.min(15, Math.max(4, Math.max(...nums)));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

export async function loadGeneration(orderId: string): Promise<GenerationJob | null> {
  await ensureGenerationColumn();
  const sql = await getSql();
  const rows = await sql.query<{ generation: string | null }>(`select generation from orders where id = $1`, [
    orderId,
  ]);
  const raw = rows[0]?.generation;
  if (!raw) return null;
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as GenerationJob) : (raw as GenerationJob);
  } catch {
    return null;
  }
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
  if (slot.id === "hook") lines.push("Open on the problem or the promise. No logo yet.");
  if (slot.id === "mascot" && i.mascotDescription) lines.push(`Mascot: ${i.mascotDescription}`);
  return lines.filter(Boolean).join("\n");
}

function motionPrompt(slot: GenerationPacket["recipe"]["slots"][number], seconds: number, tone: string) {
  return [
    `Animate this advertisement frame as a ${seconds}-second ${slot.label.toLowerCase()} clip.`,
    slot.role,
    `Tone: ${tone}. Slow, confident camera. Keep type readable if present.`,
    `Photoreal, no morphing logos, no extra text, no watermarks.`,
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

async function clearGenFiles(orderId: string) {
  const sql = await getSql();
  await sql.query(
    `delete from order_assets where order_id = $1 and kind in ('still','delivery') and filename like '%-gen.%'`,
    [orderId],
  );
}

function initJob(packet: GenerationPacket): GenerationJob {
  const now = new Date().toISOString();
  return {
    status: "running",
    startedAt: now,
    updatedAt: now,
    slots: packet.recipe.slots.map((s) => ({
      id: s.id,
      label: s.label,
      duration: slotSeconds(s.duration),
      status: "queued",
    })),
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
  url: string,
  mime: string,
  kind: "still" | "delivery",
) {
  if (kind === "delivery") {
    await attachFiles(orderId, [{ filename, url, mime }], "grok");
    return;
  }
  const sql = await getSql();
  await sql.query(
    `insert into order_assets (id, order_id, kind, filename, mime, data_url, external_url)
     values ($1,$2,$3,$4,$5,null,$6)`,
    [makeId("ast"), orderId, kind, filename, mime, url],
  );
}

export async function tickGeneration(
  orderId: string,
  opts: { action: "start" | "tick"; force?: boolean },
): Promise<{ job: GenerationJob; order: OrderRow }> {
  if (!apiKey()) {
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
      // fall through and tick
    } else {
      if (order.status === "paid") {
        order = await claimOrder(orderId, "grok");
      }
      const assets = (await listAssets({ orderId })).filter((a) => a.kind !== "delivery" && a.kind !== "still");
      const packet = packetFromOrder(order, assets);
      await clearGenFiles(orderId);
      job = initJob(packet);
      await saveGeneration(orderId, job);
      await appendEvent(orderId, "generate", `Started generation · ${job.slots.length} slots.`, "grok");
    }
  }

  if (!job) throw new Error("No generation in progress");
  if (job.status === "done" && opts.action === "tick") {
    return { job, order: (await getOrder(orderId))! };
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
    if (slot.status === "queued") {
      slot.status = "still";
      await saveGeneration(orderId, job);
      const ref = await referenceUri(orderId, slot.id === "end_card" || slot.id === "static");
      const url = await generateStill(stillPrompt(packet, recipeSlot, ratio), ref);
      slot.stillUrl = url;
      await attachGen(orderId, `${slot.id}-gen.jpg`, url, "image/jpeg", slot.duration ? "still" : "delivery");
      if (!slot.duration) {
        slot.status = "done";
        await appendEvent(orderId, "generate", `Still ready · ${slot.label}.`, "grok");
      } else {
        const vidId = await startVideo(motionPrompt(recipeSlot, slot.duration, order.tone), url, slot.duration);
        slot.videoRequestId = vidId;
        slot.status = "video";
        await appendEvent(orderId, "generate", `Animating ${slot.label} (${slot.duration}s).`, "grok");
      }
    } else if (slot.status === "still" && slot.duration && slot.stillUrl) {
      const vidId = await startVideo(motionPrompt(recipeSlot, slot.duration, order.tone), slot.stillUrl, slot.duration);
      slot.videoRequestId = vidId;
      slot.status = "video";
    } else if (slot.status === "video") {
      if (!slot.videoRequestId) {
        if (!slot.stillUrl) throw new Error("Missing still for video");
        slot.videoRequestId = await startVideo(
          motionPrompt(recipeSlot, slot.duration ?? 6, order.tone),
          slot.stillUrl,
          slot.duration ?? 6,
        );
      } else {
        let last = { status: "pending", url: null as string | null };
        for (let i = 0; i < 3; i++) {
          last = await pollVideo(slot.videoRequestId);
          if (last.status === "done" && last.url) break;
          if (last.status === "failed" || last.status === "expired") break;
          await sleep(4000);
        }
        if (last.status === "done" && last.url) {
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
