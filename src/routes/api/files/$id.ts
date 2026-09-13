import { createFileRoute } from "@tanstack/react-router";
import { getAsset } from "@/lib/orders.server";
import { verifyAssetToken } from "@/lib/operator-auth.server";

export const Route = createFileRoute("/api/files/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        if (!verifyAssetToken(params.id, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
          return new Response("Forbidden", { status: 403 });
        }
        const asset = await getAsset(params.id);
        if (!asset) return new Response("Not found", { status: 404 });
        if (asset.external_url) {
          return Response.redirect(asset.external_url, 302);
        }
        if (!asset.data_url) return new Response("Not found", { status: 404 });
        const match = /^data:([^;,]+);base64,(.+)$/.exec(asset.data_url);
        if (!match) {
          return new Response(asset.data_url, { headers: { "Content-Type": asset.mime } });
        }
        const bytes = Buffer.from(match[2], "base64");
        return new Response(bytes, {
          headers: {
            "Content-Type": match[1] || asset.mime,
            "Content-Disposition": `inline; filename="${asset.filename.replaceAll('"', "")}"`,
            "Cache-Control": "private, max-age=3600",
          },
        });
      },
    },
  },
});
