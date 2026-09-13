import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.server";
import { PRODUCTS, type ProductId } from "./products";
import { attachStripeSession } from "./orders.server";

export function stripeSecret(): string | undefined {
  return env("STRIPE_SECRET_KEY");
}

export function stripeMode(): "stripe" | "demo" {
  return stripeSecret() ? "stripe" : "demo";
}

export async function createStripeCheckoutSession(opts: {
  checkoutId: string;
  productId: ProductId;
  mascot: boolean;
  priceCents: number;
  email: string;
  businessName: string;
  origin: string;
}): Promise<string> {
  const secret = stripeSecret();
  if (!secret) throw new Error("Stripe is not configured");
  const product = PRODUCTS[opts.productId];
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("customer_email", opts.email);
  params.set("client_reference_id", opts.checkoutId);
  params.set("success_url", `${opts.origin}/order/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${opts.origin}/order/${opts.productId}`);
  params.set("metadata[checkout_id]", opts.checkoutId);
  params.set("metadata[product]", opts.productId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(opts.priceCents));
  params.set(
    "line_items[0][price_data][product_data][name]",
    opts.mascot ? `${product.name} + mascot` : product.name,
  );
  params.set(
    "line_items[0][price_data][product_data][description]",
    `Ad for ${opts.businessName}. Delivered in 24 hours. You own the finished files.`,
  );

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe checkout failed: ${text}`);
  }
  const json = (await res.json()) as { id: string; url: string };
  await attachStripeSession(opts.checkoutId, json.id);
  return json.url;
}

export async function retrieveStripeSession(sessionId: string) {
  const secret = stripeSecret();
  if (!secret) return null;
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    id: string;
    payment_status: string;
    customer_email: string | null;
    client_reference_id: string | null;
    metadata?: { checkout_id?: string };
  };
}

export function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v];
    }),
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 60 * 5) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}
