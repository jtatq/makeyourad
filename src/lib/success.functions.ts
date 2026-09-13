import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCheckout, getOrder, getOrderByStripeSession, toPublic } from "./orders.server";
import { retrieveStripeSession } from "./stripe.server";

export const loadSuccess = createServerFn({ method: "GET" })
  .validator(
    z.object({
      orderId: z.string().optional(),
      sessionId: z.string().optional(),
      checkoutId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    if (data.orderId) {
      const order = await getOrder(data.orderId);
      return order ? toPublic(order) : null;
    }
    if (data.sessionId) {
      const byStripe = await getOrderByStripeSession(data.sessionId);
      if (byStripe) return toPublic(byStripe);
      const session = await retrieveStripeSession(data.sessionId);
      const email = session?.customer_email ?? null;
      return email
        ? {
            id: data.sessionId,
            product: "video-20" as const,
            price_cents: 0,
            business_name: "",
            email,
            status: "paid" as const,
            created_at: new Date().toISOString(),
          }
        : null;
    }
    if (data.checkoutId) {
      const checkout = await getCheckout(data.checkoutId);
      if (!checkout) return null;
      return {
        id: checkout.id,
        product: checkout.product as "video-20",
        price_cents: Number(checkout.price_cents),
        business_name: checkout.business_name,
        email: checkout.email,
        status: "paid" as const,
        created_at: new Date().toISOString(),
      };
    }
    return null;
  });
