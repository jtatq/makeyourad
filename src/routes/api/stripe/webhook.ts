import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/lib/env.server";
import { completeStripeCheckout } from "@/lib/orders.server";
import { verifyStripeSignature } from "@/lib/stripe.server";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payload = await request.text();
        const secret = env("STRIPE_WEBHOOK_SECRET");
        if (secret) {
          const header = request.headers.get("stripe-signature");
          if (!verifyStripeSignature(payload, header, secret)) {
            return Response.json({ error: "Invalid signature" }, { status: 400 });
          }
        }
        let event: { type?: string; data?: { object?: Record<string, unknown> } };
        try {
          event = JSON.parse(payload) as typeof event;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        if (event.type !== "checkout.session.completed") {
          return Response.json({ received: true });
        }
        const obj = event.data?.object ?? {};
        const sessionId = String(obj.id ?? "");
        const meta = (obj.metadata ?? {}) as { checkout_id?: string };
        const checkoutId = meta.checkout_id || (obj.client_reference_id as string | undefined);
        if (!checkoutId || !sessionId) {
          return Response.json({ error: "Missing checkout id" }, { status: 400 });
        }
        const order = await completeStripeCheckout({ checkoutId, sessionId });
        return Response.json({ received: true, orderId: order.id });
      },
    },
  },
});
