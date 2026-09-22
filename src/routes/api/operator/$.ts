import { createFileRoute } from "@tanstack/react-router";
import { sendSlaDigest } from "@/lib/email.server";
import {
  attachFiles,
  attachReferencePhotos,
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
  storeOperatorUploads,
} from "@/lib/orders.server";
import {
  claimNextImagineWork,
  completeImagineSlot,
  listImagineQueue,
  tickGeneration,
} from "@/lib/generate-ad.server";
import {
  requestIsImagineWorker,
  requestIsOperator,
  requestOrigin,
  signedFileUrl,
  unauthorizedJson,
} from "@/lib/operator-auth.server";
import {
  GROK_BOT_PROFILE,
  GROK_INTAKE_PROFILE,
  intakeFromProfile,
  nextFloorWork,
  remakeFromBot,
  runBotTick,
  summarizeJob,
  cancelJob,
} from "@/lib/floor.server";
import { publicAssetUrl, publicExternalUrl } from "@/lib/durable-video";
import { collectReferencesFromBody, readOperatorJobRequest } from "@/lib/operator-refs";
import { specFromFields } from "@/lib/text-overlay";

export const Route = createFileRoute("/api/operator/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handle(request, params._splat ?? "", "GET"),
      POST: async ({ request, params }) => handle(request, params._splat ?? "", "POST"),
    },
  },
});

async function handle(request: Request, splat: string, method: "GET" | "POST") {
  const parts = splat.split("/").filter(Boolean);
  if (parts[0] === "imagine") {
    if (!requestIsImagineWorker(request)) return unauthorizedJson();
  } else if (!requestIsOperator(request)) {
    return unauthorizedJson();
  }

  try {
    if (parts[0] === "imagine") {
      if (method === "GET" && parts[1] === "next") {
        const work = await claimNextImagineWork(requestOrigin(request));
        return Response.json({ job: work });
      }
      if (method === "GET" && parts[1] === "pending") {
        const jobs = await listImagineQueue();
        return Response.json({
          jobs: jobs.map((j) => ({
            orderId: j.orderId,
            businessName: j.businessName,
            status: j.job.status,
            slots: j.job.slots.map((s) => ({ id: s.id, label: s.label, status: s.status })),
          })),
        });
      }
      if (method === "POST" && parts[1] === "complete") {
        const body = await readJson(request);
        const orderId = String(body.orderId ?? "");
        const slotId = String(body.slotId ?? "");
        if (!orderId || !slotId) return Response.json({ error: "orderId and slotId required" }, { status: 400 });
        const result = await completeImagineSlot({
          orderId,
          slotId,
          kind: body.kind === "video" ? "video" : "still",
          filename: String(body.filename ?? `${slotId}-gen.bin`),
          mime: String(body.mime ?? "application/octet-stream"),
          dataUrl: typeof body.dataUrl === "string" ? body.dataUrl : undefined,
          url: typeof body.url === "string" ? body.url : undefined,
          origin: requestOrigin(request),
        });
        return Response.json(result);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (parts[0] === "bot") {
      if (method === "GET" && (parts[1] === "playbook" || !parts[1])) {
        return Response.json({
          intake: GROK_INTAKE_PROFILE,
          floor: GROK_BOT_PROFILE,
          work: await nextFloorWork(),
        });
      }
      if (method === "GET" && parts[1] === "next") {
        return Response.json({ work: await nextFloorWork() });
      }
      if (method === "POST" && parts[1] === "tick") {
        return Response.json(await runBotTick());
      }
      if (method === "POST" && (parts[1] === "jobs" || parts[1] === "intake") && !parts[2]) {
        const body = await readOperatorJobRequest(request);
        const result = await intakeFromProfile(body.profile, {
          email: body.email,
          generate: body.generate,
          direction: body.direction,
          videoDirection: body.videoDirection,
          textOverlay: body.textOverlay,
          references: body.references,
        });
        return Response.json(result);
      }
      if (method === "GET" && parts[1] === "jobs" && parts[2] && !parts[3]) {
        return Response.json(await summarizeJob(parts[2], undefined, { tick: true }));
      }
      if (method === "POST" && parts[1] === "jobs" && parts[2] && (parts[3] === "cancel" || parts[3] === "kill" || parts[3] === "abort")) {
        const body = await readJson(request);
        const reason =
          (typeof body.reason === "string" && body.reason) ||
          (typeof body.note === "string" && body.note) ||
          (typeof body.direction === "string" && body.direction) ||
          undefined;
        return Response.json(await cancelJob(parts[2], reason));
      }
      if (method === "POST" && parts[1] === "jobs" && parts[2] && parts[3] === "tick") {
        return Response.json(await summarizeJob(parts[2], undefined, { tick: true }));
      }
      if (method === "POST" && parts[1] === "jobs" && parts[2] && parts[3] === "remake") {
        const body = await readOperatorJobRequest(request);
        return Response.json(
          await remakeFromBot(parts[2], {
            direction: body.direction,
            videoDirection: body.videoDirection,
            textOverlay: body.textOverlay,
            generate: body.generate,
            references: body.references,
          }),
        );
      }
      if (method === "POST" && parts[1] === "jobs" && parts[2] && parts[3] === "references") {
        const body = await readOperatorJobRequest(request);
        if (body.references.length === 0) {
          return Response.json({ error: "Attach at least one photo." }, { status: 400 });
        }
        await attachReferencePhotos(parts[2], body.references, "bot");
        return Response.json(await summarizeJob(parts[2]));
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (method === "POST" && parts[0] === "uploads" && parts.length === 1) {
      const body = await readOperatorJobRequest(request);
      if (body.references.length === 0) {
        return Response.json({ error: "Attach at least one photo." }, { status: 400 });
      }
      const origin = requestOrigin(request);
      const files = await storeOperatorUploads(body.references);
      return Response.json({
        files: files.map((a) => ({
          id: a.id,
          filename: a.filename,
          mime: a.mime,
          kind: a.kind,
          url: signedFileUrl(origin, a.id, 7),
        })),
      });
    }
    if (method === "GET" && parts[0] === "sla") {
      await purgeSeedDemoOrders();
      return Response.json(await slaSnapshot());
    }
    if (method === "POST" && parts.length === 1 && parts[0] === "sla") {
      const sla = await slaSnapshot();
      const sent = await sendSlaDigest({
        aging: sla.aging.map((o) => ({
          id: o.id,
          businessName: o.business_name,
          hours: o.hours,
          status: o.status,
        })),
      });
      return Response.json({ ok: true, sent });
    }
    if (method === "GET" && parts[0] === "orders" && parts.length === 1) {
      await purgeSeedDemoOrders();
      const url = new URL(request.url);
      const status = url.searchParams.get("status") ?? undefined;
      const orders = await listOrders(status || undefined);
      return Response.json({ orders });
    }
    if (parts[0] === "orders" && parts[1] && parts.length === 2) {
      const order = await getOrder(parts[1]);
      if (!order) return Response.json({ error: "Not found" }, { status: 404 });
      if (method === "GET") {
        const [events, assets] = await Promise.all([
          listEvents(order.id),
          listAssets({ orderId: order.id }),
        ]);
        const origin = requestOrigin(request);
        return Response.json({
          order,
          events,
          assets: assets.map((a) => ({
            id: a.id,
            kind: a.kind,
            filename: a.filename,
            mime: a.mime,
            hasData: Boolean(a.data_url),
            external_url: publicExternalUrl(a.external_url, Boolean(a.data_url)),
            url: publicAssetUrl({
              origin,
              assetId: a.id,
              mime: a.mime,
              hasData: Boolean(a.data_url),
              externalUrl: a.external_url,
              inlineDataUrl: a.data_url,
              days: 30,
            }),
          })),
        });
      }
    }
    if (parts[0] === "orders" && parts[1] && parts[2]) {
      const id = parts[1];
      const action = parts[2];
      if (method === "GET" && action === "packet") {
        return Response.json(await packetFor(id, request));
      }
      if (method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      }
      const isMultipart = (request.headers.get("content-type") || "").includes("multipart/form-data");
      if (isMultipart && (action === "references" || action === "remake")) {
        const payload = await readOperatorJobRequest(request);
        if (action === "references") {
          if (payload.references.length === 0) {
            return Response.json({ error: "Attach at least one photo." }, { status: 400 });
          }
          await attachReferencePhotos(id, payload.references);
          return Response.json(await summarizeJob(id));
        }
        if (payload.references.length) await attachReferencePhotos(id, payload.references);
        return Response.json({ order: await remakeOrder(id, payload.direction ?? null) });
      }
      const body = await readJson(request);
      if (action === "claim") return Response.json({ order: await claimOrder(id) });
      if (action === "generate") {
        const result = await tickGeneration(id, {
          action: body.action === "tick" ? "tick" : "start",
          force: Boolean(body.force),
          direction: typeof body.direction === "string" ? body.direction : undefined,
          videoDirection:
            typeof body.videoDirection === "string"
              ? body.videoDirection
              : typeof body.video_direction === "string"
                ? body.video_direction
                : typeof body.shotList === "string"
                  ? body.shotList
                  : undefined,
          textOverlay: specFromFields(
            body.endCard ?? body.end_card,
            body.lowerThird ?? body.lower_third ?? body.lowerThirds,
          ),
        });
        return Response.json(result);
      }
      if (action === "attach") {
        const files = Array.isArray(body.files)
          ? body.files
          : body.filename
            ? [{ filename: String(body.filename), url: body.url as string, mime: body.mime as string | undefined, dataUrl: body.dataUrl as string | undefined }]
            : [];
        return Response.json({ order: await attachFiles(id, files) });
      }
      if (action === "references") {
        const refs = collectReferencesFromBody(body);
        if (refs.length === 0) {
          return Response.json({ error: "Attach at least one photo." }, { status: 400 });
        }
        await attachReferencePhotos(id, refs);
        return Response.json(await summarizeJob(id));
      }
      if (action === "qc") {
        return Response.json({
          order: await passQc(id, {
            watched: Boolean(body.watched),
            namesPhoneCityCorrect: Boolean(body.namesPhoneCityCorrect),
            noArtifacts: Boolean(body.noArtifacts),
          }),
        });
      }
      if (action === "deliver") {
        return Response.json({ order: await deliverOrder(id, requestOrigin(request)) });
      }
      if (action === "flag") {
        const note = String(body.note ?? "");
        if (note.trim().length < 3) return Response.json({ error: "note is required" }, { status: 400 });
        return Response.json({ order: await flagOrder(id, note) });
      }
      if (action === "remake") {
        const refs = collectReferencesFromBody(body);
        if (refs.length) await attachReferencePhotos(id, refs);
        return Response.json({
          order: await remakeOrder(id, (body.note as string) ?? (body.direction as string) ?? null),
        });
      }
      if (action === "refund") {
        return Response.json({ order: await refundOrder(id, (body.note as string) ?? null) });
      }
      if (action === "cancel" || action === "kill" || action === "abort") {
        const reason =
          (typeof body.reason === "string" && body.reason) ||
          (typeof body.note === "string" && body.note) ||
          undefined;
        return Response.json(await cancelJob(id, reason));
      }
      return Response.json({ error: "Unknown action" }, { status: 404 });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    const status = message === "Order not found" ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
