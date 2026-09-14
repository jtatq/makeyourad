import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { listOutbound, sendSlaDigest } from "./email.server";
import { dbSource } from "./db";
import {
  aiAvailable,
  assembleMaster,
  clipQcSummary,
  generationEngine,
  generateWorkerEnabled,
  loadGeneration,
  regenSlot,
  reviewSlot,
  runAutoQc,
  saveTimeline,
  tickGeneration,
} from "./generate-ad.server";
import {
  applyAudienceProfile,
  attachFiles,
  claimOrder,
  createOrdersFromProfile,
  deliverOrder,
  flagOrder,
  getOrder,
  listAssets,
  listEvents,
  listOrders,
  packetFor,
  passQc,
  purgeSeedDemoOrders,
  refundOrder,
  remakeOrder,
  setOrderEmail,
  slaSnapshot,
} from "./orders.server";
import {
  clearOperatorCookieHeader,
  isPreviewOperatorSecret,
  operatorCookieHeader,
  previewAdminOpen,
  readOperatorCookie,
  requestOrigin,
  signedFileUrl,
  tokenMatches,
} from "./operator-auth.server";
import { env, isWorkspacePreview } from "./env.server";
import { apiLimitSnapshot } from "./xai-limits.server";

function requireAdmin() {
  const request = getRequest();
  if (readOperatorCookie(request) || previewAdminOpen()) return;
  throw new Error("Unauthorized");
}

export const adminLogin = createServerFn({ method: "POST" })
  .validator(z.object({ password: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!tokenMatches(data.password)) throw new Error("Wrong password");
    setResponseHeader("Set-Cookie", operatorCookieHeader());
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  setResponseHeader("Set-Cookie", clearOperatorCookieHeader());
  return { ok: true as const };
});

export const adminSession = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  return {
    ok: readOperatorCookie(request) || previewAdminOpen(),
    previewHint: isWorkspacePreview() && isPreviewOperatorSecret() ? "makeyourad-operator" : null,
    aiAvailable: aiAvailable(),
    generationEngine: generationEngine(),
  };
});

export const adminDashboard = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin();
  await purgeSeedDemoOrders();
  const [orders, sla, emails, apiLimits] = await Promise.all([
    listOrders(),
    slaSnapshot(),
    listOutbound(12),
    apiLimitSnapshot(),
  ]);
  return {
    orders,
    sla,
    emails,
    apiLimits,
    durable: dbSource === "neon",
    preview: isWorkspacePreview(),
    aiAvailable: aiAvailable(),
    generationEngine: generationEngine(),
  };
});

export const adminOrder = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    requireAdmin();
    const order = await getOrder(data.id);
    if (!order) throw new Error("Order not found");
    const request = getRequest();
    const origin = requestOrigin(request);
    const [events, assets, packet, generation] = await Promise.all([
      listEvents(data.id),
      listAssets({ orderId: data.id }),
      packetFor(data.id, request),
      loadGeneration(data.id),
    ]);
    return {
      order,
      events,
      generation,
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        filename: a.filename,
        mime: a.mime,
        hasData: Boolean(a.data_url),
        external_url: a.external_url,
        preview_url:
          a.external_url && /^https?:\/\//.test(a.external_url)
            ? a.external_url
            : a.data_url && a.data_url.startsWith("data:") && a.data_url.length < 1_500_000
              ? a.data_url
              : a.mime.startsWith("image/") || a.mime.startsWith("video/")
                ? signedFileUrl(origin, a.id, 1)
                : null,
      })),
      packet,
    };
  });

export const adminClaim = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    requireAdmin();
    return claimOrder(data.id, "admin");
  });

export const adminGenerate = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      action: z.enum(["start", "tick"]).default("tick"),
      force: z.boolean().optional(),
      direction: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return tickGeneration(data.id, { action: data.action, force: data.force, direction: data.direction });
  });

export const adminApplyProfile = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), raw: z.string().min(20).max(20000) }))
  .handler(async ({ data }) => {
    requireAdmin();
    return applyAudienceProfile(data.id, data.raw);
  });

export const adminCreateFromProfile = createServerFn({ method: "POST" })
  .validator(z.object({ raw: z.string().min(20).max(20000) }))
  .handler(async ({ data }) => {
    requireAdmin();
    const email = env("OPERATOR_EMAIL") || "jtrocki@geotargetus.com";
    return createOrdersFromProfile(data.raw, email);
  });

export const adminSetEmail = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), email: z.string().email() }))
  .handler(async ({ data }) => {
    requireAdmin();
    return setOrderEmail(data.id, data.email, "admin");
  });

const SlotIdSchema = z.enum(["hook", "mascot", "body_1", "body_2", "body_3", "end_card", "static"]);

export const adminSlotQc = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      slotId: SlotIdSchema,
      verdict: z.enum(["pass", "fix"]),
      note: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return reviewSlot(data.id, data.slotId, data.verdict, data.note);
  });

export const adminRegenSlot = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      slotId: SlotIdSchema,
      note: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return regenSlot(data.id, data.slotId, data.note);
  });

export const adminAssemble = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    requireAdmin();
    const origin = requestOrigin(getRequest());
    return assembleMaster(data.id, origin);
  });

export const adminSaveTimeline = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      clips: z.array(
        z.object({
          id: z.string(),
          slotId: z.string(),
          label: z.string(),
          url: z.string(),
          stillUrl: z.string().optional(),
          seconds: z.number().positive(),
        }),
      ),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return saveTimeline(data.id, data.clips);
  });

export const adminAutoQc = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    requireAdmin();
    return runAutoQc(data.id);
  });

export const adminAttach = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      filename: z.string().min(1),
      url: z.string().min(4),
      mime: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return attachFiles(data.id, [{ filename: data.filename, url: data.url, mime: data.mime }], "admin");
  });

export const adminQc = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      watched: z.boolean(),
      namesPhoneCityCorrect: z.boolean(),
      noArtifacts: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    const order = await getOrder(data.id);
    if (!order) throw new Error("Order not found");
    const job = await loadGeneration(data.id);
    if (job) {
      const summary = clipQcSummary(order, job);
      if (!summary.allPassed) {
        throw new Error(
          `Not in the cut yet: ${summary.open.join(", ") || "clips"}. Scroll up, tap Add on that take, then Pass QC.`,
        );
      }
    }
    return passQc(
      data.id,
      {
        watched: data.watched,
        namesPhoneCityCorrect: data.namesPhoneCityCorrect,
        noArtifacts: data.noArtifacts,
      },
      "admin",
    );
  });

export const adminDeliver = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), email: z.string().email().optional() }))
  .handler(async ({ data }) => {
    requireAdmin();
    if (data.email) await setOrderEmail(data.id, data.email, "admin");
    return deliverOrder(data.id, requestOrigin(getRequest()), "admin");
  });

export const adminFlag = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), note: z.string().min(3) }))
  .handler(async ({ data }) => {
    requireAdmin();
    return flagOrder(data.id, data.note, "admin");
  });

export const adminRemake = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), note: z.string().optional() }))
  .handler(async ({ data }) => {
    requireAdmin();
    return remakeOrder(data.id, data.note ?? null, "admin");
  });

export const adminRefund = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), note: z.string().optional() }))
  .handler(async ({ data }) => {
    requireAdmin();
    return refundOrder(data.id, data.note ?? null, "admin");
  });

export const adminSendSla = createServerFn({ method: "POST" }).handler(async () => {
  requireAdmin();
  const sla = await slaSnapshot();
  return sendSlaDigest({
    aging: sla.aging.map((o) => ({
      id: o.id,
      businessName: o.business_name,
      hours: o.hours,
      status: o.status,
    })),
  });
});
