import { inspectClip } from "./auto-qc.server";
import { env } from "./env.server";
import {
  applyFloorDecision,
  assembleMaster,
  loadGeneration,
  tickGeneration,
  type GenerationJob,
} from "./generate-ad.server";
import { operatorEmail, signedFileUrl } from "./operator-auth.server";
import {
  appendEvent,
  attachReferencePhotos,
  claimOrder,
  createOrdersFromProfile,
  getOrder,
  listOrders,
  listReferenceAssets,
  remakeOrder,
} from "./orders.server";
import type { ReferenceInput } from "./operator-refs";
import { estimateJobCost } from "./xai-cost";

export const MAX_FLOOR_REMAKES = 1;

export const GROK_INTAKE_PROFILE = {
  name: "MYA",
  title: "Audience profile → 20s ad",
  job: "Turn a pasted audience profile into a 20-second MakeYourAd spot.",
  description: [
    "You make 20-second video ads for MakeYourAd.",
    "The human pastes an audience profile (GPT briefing, PAGE_3 JSON, Voiceover 25–30s script, camera-facing script). That paste is the brief. Do not rewrite the spoken copy. Do not invent a business. Ignore geofences, retail anchors, income, age, and PAGE_3 targeting — those are not in the ad.",
    "Call the MakeYourAd API. Do not drive the admin UI unless the API fails.",
    "POST https://mya.geotargetus.dev/api/operator/bot/jobs with Authorization: Bearer <the operator token already in your notes>. JSON body: {\"profile\":\"<the entire paste>\",\"generate\":true}. Optional: \"email\" (delivery), \"direction\" (one-line visual change), \"references\" (owner/job-site photos as data URLs or /api/files URLs from POST /api/operator/uploads). Multipart also works: profile text + references=@photo.jpg.",
    "When the human attaches photos (owner headshot, van, pool, job site), you MUST send them as references. Do not invent faces, vans, or job sites. Upload files to this app — do not host them on pastebins.",
    "Only 20-second spots. Never start 12s or 40s. Never send a delivery email. Never refund. Never remake unless the human asks. Remake with POST /api/operator/bot/jobs/<orderId>/remake — existing reference photos stay on the order.",
    "Reply with: business name, admin URL, generate cost (~$3.84 for one take: 2K still $0.08 + 15s 1080p $3.76). Then GET https://mya.geotargetus.dev/api/operator/bot/jobs/<orderId> every couple of minutes until status is done or error. Post a one-line result with the admin URL. If generate is already running, do not POST again.",
    "If the profile is missing Voiceover 25–30s, city/state, or business name, ask for those — do not guess.",
  ].join(" "),
  firstMessage:
    "You are MYA. When I paste an audience profile, POST it to https://mya.geotargetus.dev/api/operator/bot/jobs with generate:true and the operator Bearer token from your notes. If I attach photos, upload them with the job (multipart references or POST /api/operator/uploads then attach the returned URLs). Start one 20s ad. Give me the admin link and wait for the take. Never send the customer email.",
};

export const GROK_BOT_PROFILE = {
  name: "MYA Floor",
  title: "20s ad production floor",
  job: "Own 20-second MakeYourAd spots from generate through QC. Fix failed takes once. Leave delivery for a human.",
  description: [
    "You run the MakeYourAd production floor at https://mya.geotargetus.dev/admin.",
    "Only 20-second spots. Never start a 12s or 40s job. Never click Generate while a job already says generating or animating.",
    "Workflow for each paid 20s order: open the order → Generate if there is no clip → wait until the video is playable → watch the entire take with sound on.",
    "Pass if: the person says the script, the city is spoken as a real place name (Heber City, Rohnert Park), the state is the full word (Utah, California — never U.T. or C.A.), the on-screen name/phone/city match the order, no watermarks or morphing logos.",
    "Fail if any of that is wrong. Paste a short direction (what to fix) into Direction change and Apply direction. You get one remake. If the second take still fails, Flag needs attention with the reason and stop.",
    "When a take passes: add it to the timeline if it is not already there, Master 20s if needed, check Watched / Names phone city correct / No artifacts, then Pass QC.",
    "Never Send delivery email. Never refund. Never change the customer email. Never invent a second video while one is in flight.",
    "If the site asks for the operator password, stop and wait for takeover. After you are signed in, keep that browser session.",
  ].join(" "),
  routine:
    "Every 10 minutes, America/Phoenix, open https://mya.geotargetus.dev/admin. Work the oldest paid or in-production 20s order that is not delivered. Follow the MYA Floor profile. Post a one-line result in this chat: business, pass/remake/flag. Do not email the customer.",
  firstMessage:
    "You own the MakeYourAd 20s floor. Open https://mya.geotargetus.dev/admin, sign in if needed (I will take over for the password), then run the routine every 10 minutes. Generate, watch, one remake if QC fails, Pass QC when it is clean. Never send the delivery email.",
};

export function publicOrigin(): string {
  return env("APP_ORIGIN")?.replace(/\/$/, "") || "https://mya.geotargetus.dev";
}

export type BotWork = {
  orderId: string;
  businessName: string;
  product: string;
  status: string;
  jobStatus: string | null;
  floor: GenerationJob["floor"] | null;
  masterUrl: string | null;
  slot: { id: string; label: string; status: string; qc: string | null; remakes: number } | null;
  adminUrl: string;
};

export async function nextFloorWork(): Promise<BotWork | null> {
  const orders = await listOrders();
  const open = orders.filter(
    (o) => o.product === "video-20" && (o.status === "paid" || o.status === "in_production" || o.status === "qc"),
  );
  for (const order of open) {
    const job = await loadGeneration(order.id);
    const slot = job?.slots[0] ?? null;
    if (order.status === "delivered") continue;
    return {
      orderId: order.id,
      businessName: order.business_name,
      product: order.product,
      status: order.status,
      jobStatus: job?.status ?? null,
      floor: job?.floor ?? null,
      masterUrl: job?.masterUrl ?? slot?.videoUrl ?? null,
      slot: slot
        ? {
            id: slot.id,
            label: slot.label,
            status: slot.status,
            qc: slot.qc ?? null,
            remakes: slot.remakes ?? 0,
          }
        : null,
      adminUrl: `${publicOrigin()}/admin/${order.id}`,
    };
  }
  return null;
}

export async function runBotTick(): Promise<{ work: BotWork | null; did: string }> {
  const work = await nextFloorWork();
  if (!work) return { work: null, did: "Queue empty." };
  const order = await getOrder(work.orderId);
  if (!order) return { work, did: "Order missing." };
  if (order.status === "paid") {
    await claimOrder(order.id, "floor");
  }
  const job = await loadGeneration(order.id);
  if (!job) {
    await tickGeneration(order.id, { action: "start" });
    return { work, did: `Started generate for ${order.business_name}.` };
  }
  if (job.status === "running" || job.slots.some((s) => s.status === "queued" || s.status === "still" || s.status === "video")) {
    await tickGeneration(order.id, { action: "tick" });
    return { work, did: `Ticked ${order.business_name}.` };
  }
  const slot = job.slots[0];
  if (slot && slot.status === "done" && slot.qc !== "pass") {
    if (!slot.autoQc) {
      slot.autoQc = await inspectClip({ slot, order });
    }
    await applyFloorDecision(order, job, slot);
    return { work, did: `QC ${order.business_name} · ${slot.autoQc?.status ?? "unknown"}.` };
  }
  if (slot?.qc === "pass" && !job.masterUrl) {
    try {
      await assembleMaster(order.id, publicOrigin());
      await appendEvent(order.id, "generate", "Floor assembled the 20s master. Human Pass QC next.", "floor");
      return { work, did: `Assembled ${order.business_name}.` };
    } catch (err) {
      return { work, did: `Assemble failed: ${err instanceof Error ? err.message : "stitch"}` };
    }
  }
  return { work, did: `${order.business_name} is waiting for you to watch the master.` };
}

export async function intakeFromProfile(
  raw: string,
  opts: { email?: string; generate?: boolean; direction?: string; references?: ReferenceInput[] } = {},
) {
  const profile = raw.trim();
  if (profile.length < 40) throw new Error("Paste the full audience profile.");
  const email = (opts.email || operatorEmail()).trim();
  const [order] = await createOrdersFromProfile(profile, email);
  if (opts.references?.length) {
    await attachReferencePhotos(order.id, opts.references, "bot");
  }
  await claimOrder(order.id, "bot");
  await appendEvent(order.id, "generate", "Grok Bot intake. 20s generate queued.", "bot");
  let job = await loadGeneration(order.id);
  if (opts.generate !== false) {
    const result = await tickGeneration(order.id, {
      action: "start",
      direction: opts.direction?.trim() || undefined,
    });
    job = result.job;
  }
  return summarizeJob(order.id, job);
}

export async function remakeFromBot(
  orderId: string,
  opts: { direction?: string; generate?: boolean; references?: ReferenceInput[] } = {},
) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  if (opts.references?.length) {
    await attachReferencePhotos(orderId, opts.references, "bot");
  }
  const note = opts.direction?.trim() || null;
  await remakeOrder(orderId, note, "bot");
  let job = await loadGeneration(orderId);
  if (opts.generate !== false) {
    const result = await tickGeneration(orderId, {
      action: "start",
      force: true,
      direction: note || undefined,
    });
    job = result.job;
  }
  return summarizeJob(orderId, job);
}

export async function summarizeJob(orderId: string, job?: GenerationJob | null) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const loaded = job ?? (await loadGeneration(orderId));
  const slot = loaded?.slots[0] ?? null;
  const cost = loaded ? estimateJobCost(loaded) : { totalCents: 0, stills: 0, videos: 0 };
  const origin = publicOrigin();
  const references = (await listReferenceAssets(order.id)).map((a) => ({
    id: a.id,
    filename: a.filename,
    mime: a.mime,
    kind: a.kind,
    hasData: Boolean(a.data_url),
    url: a.external_url && /^https?:\/\//.test(a.external_url) ? a.external_url : signedFileUrl(origin, a.id, 7),
  }));
  return {
    orderId: order.id,
    businessName: order.business_name,
    product: order.product,
    status: order.status,
    city: order.city,
    state: order.state,
    email: order.email,
    jobStatus: loaded?.status ?? null,
    error: loaded?.error ?? null,
    slot: slot
      ? { id: slot.id, label: slot.label, status: slot.status, qc: slot.qc ?? null }
      : null,
    stillUrl: slot?.stillUrl ?? null,
    videoUrl: slot?.videoUrl ?? loaded?.masterUrl ?? null,
    references,
    costCents: cost.totalCents,
    stills: cost.stills,
    videos: cost.videos,
    adminUrl: `${publicOrigin()}/admin/${order.id}`,
  };
}
