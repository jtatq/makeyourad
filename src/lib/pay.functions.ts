import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { asNumber, parseJsonArray } from "./json";
import { getCheckout } from "./orders.server";
import { PRODUCTS, type ProductId } from "./products";

export const loadPay = createServerFn({ method: "GET" })
  .validator(z.object({ checkoutId: z.string() }))
  .handler(async ({ data }) => {
    const checkout = await getCheckout(data.checkoutId);
    if (!checkout) return null;
    if (checkout.status !== "pending") {
      return { alreadyPaid: true as const, email: checkout.email, checkoutId: checkout.id };
    }
    const productId = checkout.product as ProductId;
    return {
      alreadyPaid: false as const,
      checkoutId: checkout.id,
      email: checkout.email,
      businessName: checkout.business_name,
      productId,
      productName: PRODUCTS[productId]?.name ?? checkout.product,
      priceCents: asNumber(checkout.price_cents),
      addOns: parseJsonArray(checkout.add_ons),
      city: checkout.city,
      state: checkout.state,
    };
  });
