import { createFileRoute } from "@tanstack/react-router";
import { sendSlaDigest } from "@/lib/email.server";
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
  refundOrder,
  remakeOrder,
  seedDemoIfEmpty,
  slaSnapshot,
} from "@/lib/orders.server";
import { tickGeneration } from "@/lib/generate-ad.server";
import { requestIsOperator, requestOrigin, unauthorizedJson } from "@/lib/operator-auth.server";

export const Route = createFileRoute("/api/operator/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handle(request, params._splat ?? "", "GET"),
      POST: async ({ request, params }) => handle(request, params._splat ?? "", "POST"),
    },
  },
});

async function handle(request: Request, splat: string, method: "GET" | "POST") {
  if (!requestIsOperator(request)) return unauthorizedJson();
  const parts = splat.split("/").filter(Boolean);

  try {
    if (method === "GET" && parts.length === 1 && parts[0] === "sla") {
      await seedDemoIfEmpty();
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
      await seedDemoIfEmpty();
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
        return Response.json({
          order,
          events,
          assets: assets.map((a) => ({
            id: a.id,
            kind: a.kind,
            filename: a.filename,
            mime: a.mime,
            hasData: Boolean(a.data_url),
            external_url: a.external_url,
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
      const body = await readJson(request);
      if (action === "claim") return Response.json({ order: await claimOrder(id) });
      if (action === "generate") {
        const result = await tickGeneration(id, {
          action: body.action === "tick" ? "tick" : "start",
          force: Boolean(body.force),
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
        return Response.json({ order: await remakeOrder(id, (body.note as string) ?? null) });
      }
      if (action === "refund") {
        return Response.json({ order: await refundOrder(id, (body.note as string) ?? null) });
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
