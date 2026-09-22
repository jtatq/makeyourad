import { inspectClip } from "./auto-qc.server";
import { isEphemeralGeneratorUrl, presentGeneration } from "./durable-video";
import { env } from "./env.server";
import {
  applyFloorDecision,
  assembleMaster,
  cancelGeneration,
  failTimedOutGeneration,
  loadGeneration,
  resetGeneration,
  tickGeneration,
  type GenerationJob,
} from "./generate-ad.server";
import { detectGenerationTimeout, jobProgress, jobStopped } from "./generation-progress";
import { operatorEmail, signedFileUrl } from "./operator-auth.server";
import {
  appendEvent,
  attachReferencePhotos,
  claimOrder,
  createOrdersFromProfile,
  getOrder,
  listAssets,
  listOrders,
  listReferenceAssets,
  mergeOrderVideoDirection,
  remakeOrder,
} from "./orders.server";
import type { ReferenceInput } from "./operator-refs";
import { composeStoredVisual, hasTextOverlay, resolveTextOverlay, type TextOverlaySpec } from "./text-overlay";
import { resolveVideoDirection } from "./video-direction";
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
    "POST https://mya.geotargetus.dev/api/operator/bot/jobs with Authorization: Bearer <the operator token already in your notes>. JSON body: {\"profile\":\"<the entire paste>\",\"generate\":true}. Optional: \"email\" (delivery), \"direction\" (one-line remake note, e.g. minimal on-screen text), \"videoDirection\" (shot list / camera beats — or leave it off and we parse [VISUAL:] / camera notes from the paste), \"endCard\" / \"lowerThird\" (exact on-screen lines, or parse [END CARD:] / [LOWER THIRD:]), \"references\" (owner/job-site photos as data URLs or /api/files URLs from POST /api/operator/uploads). Multipart also works: profile text + references=@photo.jpg.",
    "When the human attaches photos (owner headshot, van, pool, job site), you MUST send them as references. Do not invent faces, vans, or job sites. Upload files to this app — do not host them on pastebins.",
    "Only 20-second spots. Never start 12s or 40s. Never send a delivery email. Never refund. Never remake unless the human asks. Remake with POST /api/operator/bot/jobs/<orderId>/remake and generate:true — that always starts a new still (new stillUrl). Existing reference photos stay on the order. Optional direction can ask for minimal on-screen text (business name + city only) while keeping the spoken VO. Do not rewrite spoken copy. Video uses the parsed or supplied videoDirection shot list; stills do not burn that shot list as captions. When the brief names an end card or lower third, send endCard / lowerThird (or [END CARD:] / [LOWER THIRD:] tags). Exact type is composited after generation — do not rely on the model to letter Knoxville or a tagline.",
    "Reply with: business name, admin URL, generate cost (~$3.84 for one take: 2K still $0.08 + 15s 1080p $3.76). Then GET https://mya.geotargetus.dev/api/operator/bot/jobs/<orderId> every couple of minutes until jobStatus is done, error, or cancelled. GET also ticks/polls the video so a still-ready job does not sit idle. If it hangs, POST .../jobs/<orderId>/cancel. Look at phase (still|video), videoStarted, timedOut. If generate is already running, do not POST the job again.",
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
    (o) =>
      o.product === "video-20" &&
      (o.status === "paid" || o.status === "in_production" || o.status === "remake_requested" || o.status === "qc"),
  );
  for (const order of open) {
    const job = await loadGeneration(order.id);
    const slot = job?.slots[0] ?? null;
    if (order.status === "delivered") continue;
    if (job?.status === "cancelled") continue;
    let masterUrl = job?.masterUrl ?? slot?.videoUrl ?? null;
    if (job && masterUrl && (isEphemeralGeneratorUrl(masterUrl) || masterUrl.startsWith("data:video/"))) {
      const assets = await listAssets({ orderId: order.id });
      const shown = presentGeneration(job, assets, publicOrigin());
      masterUrl = shown.masterUrl ?? shown.slots[0]?.videoUrl ?? null;
    }
    return {
      orderId: order.id,
      businessName: order.business_name,
      product: order.product,
      status: order.status,
      jobStatus: job?.status ?? null,
      floor: job?.floor ?? null,
      masterUrl,
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
  if (job.status === "cancelled") {
    return { work, did: `${order.business_name} was cancelled.` };
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
  opts: {
    email?: string;
    generate?: boolean;
    direction?: string;
    videoDirection?: string;
    textOverlay?: TextOverlaySpec | null;
    references?: ReferenceInput[];
  } = {},
) {
  const profile = raw.trim();
  if (profile.length < 40) throw new Error("Paste the full audience profile.");
  const email = (opts.email || operatorEmail()).trim();
  const videoDirection = resolveVideoDirection({
    explicit: opts.videoDirection,
    brief: profile,
    operatorDirection: opts.direction,
  });
  const textOverlay = resolveTextOverlay({
    explicit: opts.textOverlay,
    videoDirection,
    brief: profile,
  });
  const [order] = await createOrdersFromProfile(profile, email, {
    videoDirection: videoDirection || undefined,
    textOverlay: hasTextOverlay(textOverlay) ? textOverlay : undefined,
  });
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
      videoDirection: videoDirection || undefined,
      textOverlay: hasTextOverlay(textOverlay) ? textOverlay : undefined,
    });
    job = result.job;
  }
  return summarizeJob(order.id, job);
}

export async function remakeFromBot(
  orderId: string,
  opts: {
    direction?: string;
    videoDirection?: string;
    textOverlay?: TextOverlaySpec | null;
    generate?: boolean;
    references?: ReferenceInput[];
  } = {},
) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  if (opts.references?.length) {
    await attachReferencePhotos(orderId, opts.references, "bot");
  }
  const note = opts.direction?.trim() || null;
  const prior = await loadGeneration(orderId);
  const videoDirection = resolveVideoDirection({
    explicit: opts.videoDirection,
    stored: prior?.videoDirection,
    brief: order.brief,
    operatorDirection: note,
  });
  const textOverlay = resolveTextOverlay({
    explicit: opts.textOverlay,
    stored: prior?.textOverlay,
    videoDirection,
    brief: order.brief,
  });
  if (opts.videoDirection?.trim() || hasTextOverlay(textOverlay)) {
    await mergeOrderVideoDirection(orderId, composeStoredVisual(opts.videoDirection?.trim() || videoDirection, textOverlay));
  }
  await remakeOrder(orderId, note, "bot");
  if (opts.generate !== false) {
    await resetGeneration(orderId);
    const result = await tickGeneration(orderId, {
      action: "start",
      force: true,
      direction: note || undefined,
      videoDirection: videoDirection || undefined,
      textOverlay: hasTextOverlay(textOverlay) ? textOverlay : undefined,
    });
    return summarizeJob(orderId, result.job);
  }
  return summarizeJob(orderId);
}

export async function cancelJob(orderId: string, reason?: string) {
  const result = await cancelGeneration(orderId, "bot", reason?.trim() || "Cancelled by operator");
  return summarizeJob(orderId, result.job);
}

export async function summarizeJob(
  orderId: string,
  job?: GenerationJob | null,
  opts: { tick?: boolean } = {},
) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  let loaded = job ?? (await loadGeneration(orderId));
  if (loaded?.status === "running") {
    const timeout = detectGenerationTimeout(loaded);
    if (timeout) {
      loaded = (await failTimedOutGeneration(orderId, timeout.message)) ?? loaded;
    } else if (opts.tick && !jobStopped(loaded.status)) {
      try {
        const result = await tickGeneration(orderId, { action: "tick" });
        loaded = result.job;
      } catch {
        loaded = (await loadGeneration(orderId)) ?? loaded;
      }
    }
  }
  const slot = loaded?.slots[0] ?? null;
  const cost = loaded ? estimateJobCost(loaded) : { totalCents: 0, stills: 0, videos: 0 };
  const origin = publicOrigin();
  const rawVideo = slot?.videoUrl ?? loaded?.masterUrl ?? null;
  const shown =
    loaded && rawVideo && (isEphemeralGeneratorUrl(rawVideo) || rawVideo.startsWith("data:video/"))
      ? presentGeneration(loaded, await listAssets({ orderId: order.id }), origin)
      : loaded;
  const progress = jobProgress(loaded);
  const references = (await listReferenceAssets(order.id)).map((a) => ({
    id: a.id,
    filename: a.filename,
    mime: a.mime,
    kind: a.kind,
    hasData: Boolean(a.data_url),
    url: a.external_url && /^https?:\/\//.test(a.external_url) ? a.external_url : signedFileUrl(origin, a.id, 7),
  }));
  const overlay = resolveTextOverlay({
    explicit: resolveTextOverlay({ brief: order.brief, videoDirection: loaded?.videoDirection }),
    stored: loaded?.textOverlay,
  });
  return {
    orderId: order.id,
    businessName: order.business_name,
    product: order.product,
    status: order.status,
    city: order.city,
    state: order.state,
    email: order.email,
    jobStatus: loaded?.status ?? null,
    phase: progress.phase,
    startedAt: progress.startedAt,
    updatedAt: progress.updatedAt,
    timedOut: progress.timedOut,
    videoStarted: progress.videoStarted,
    error: loaded?.error ?? null,
    slot: slot
      ? { id: slot.id, label: slot.label, status: slot.status, qc: slot.qc ?? null }
      : null,
    stillUrl: slot?.stillUrl ?? null,
    videoUrl: shown?.slots[0]?.videoUrl ?? shown?.masterUrl ?? null,
    videoDirection: loaded?.videoDirection || resolveVideoDirection({ brief: order.brief }) || null,
    endCard: overlay.endCard?.lines ?? null,
    lowerThird: overlay.lowerThird?.lines ?? null,
    overlaysApplied: Boolean(slot?.overlaysApplied),
    references,
    costCents: cost.totalCents,
    stills: cost.stills,
    videos: cost.videos,
    adminUrl: `${publicOrigin()}/admin/${order.id}`,
  };
}
