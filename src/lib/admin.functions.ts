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
  loadGeneration,
  regenSlot,
  reviewSlot,
  runAutoQc,
  tickGeneration,
} from "./generate-ad.server";
import {
  attachFiles,
  claimOrder,
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
import { isWorkspacePreview } from "./env.server";

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
  const [orders, sla, emails] = await Promise.all([listOrders(), slaSnapshot(), listOutbound(12)]);
  return {
    orders,
    sla,
    emails,
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
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return tickGeneration(data.id, { action: data.action, force: data.force });
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
    return assembleMaster(data.id);
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
        throw new Error(`Pass clip QC first. Still open: ${summary.open.join(", ") || "clips"}`);
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
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    requireAdmin();
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
