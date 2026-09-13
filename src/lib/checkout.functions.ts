import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { checkoutInputSchema, waitlistSchema } from "./intake";
import { completeDemoCheckout, insertCheckout, joinWaitlist } from "./orders.server";
import { requestOrigin } from "./operator-auth.server";
import { createStripeCheckoutSession, stripeMode } from "./stripe.server";

export const startCheckout = createServerFn({ method: "POST" })
  .validator(checkoutInputSchema)
  .handler(async ({ data }) => {
    if (data.mascot && !data.mascotDescription?.trim()) {
      throw new Error("Add a one-line description of the mascot.");
    }
    const created = await insertCheckout(data);
    const request = getRequest();
    const origin = requestOrigin(request);
    if (stripeMode() === "stripe") {
      const url = await createStripeCheckoutSession({
        checkoutId: created.id,
        productId: data.product,
        mascot: data.mascot,
        priceCents: created.priceCents,
        email: data.email,
        businessName: data.businessName,
        origin,
      });
      return { mode: "stripe" as const, url, checkoutId: created.id };
    }
    return { mode: "demo" as const, url: `/pay/${created.id}`, checkoutId: created.id };
  });

export const payDemoCheckout = createServerFn({ method: "POST" })
  .validator((d: { checkoutId: string }) => d)
  .handler(async ({ data }) => {
    const order = await completeDemoCheckout(data.checkoutId);
    return { orderId: order.id, email: order.email };
  });

export const addToWaitlist = createServerFn({ method: "POST" })
  .validator(waitlistSchema)
  .handler(async ({ data }) => joinWaitlist(data));
