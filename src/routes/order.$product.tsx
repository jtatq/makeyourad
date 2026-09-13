import { createFileRoute, Link } from "@tanstack/react-router";
import { OrderForm } from "@/components/order/order-form";
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";
import { isProductId, PRODUCTS } from "@/lib/products";
import { formatUsd } from "@/lib/utils";

type OrderSearch = { site?: string };

export const Route = createFileRoute("/order/$product")({
  validateSearch: (search: Record<string, unknown>): OrderSearch => ({
    site: typeof search.site === "string" ? search.site : undefined,
  }),
  component: OrderPage,
});

function OrderPage() {
  const { product } = Route.useParams();
  const { site } = Route.useSearch();
  if (!isProductId(product)) {
    return (
      <div className="min-h-dvh">
        <SiteHeader compact />
        <main className="mx-auto max-w-xl px-4 py-20 text-center">
          <h1 className="font-display text-3xl">That product isn’t on the menu.</h1>
          <Link to="/" className="mt-6 inline-block text-primary underline">
            Back to prices
          </Link>
        </main>
      </div>
    );
  }
  const p = PRODUCTS[product];
  return (
    <div className="min-h-dvh">
      <SiteHeader compact />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <p className="eyebrow">Order · 24-hour delivery</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">{p.name}</h1>
        <p className="mt-3 max-w-xl text-muted">
          Paste the website and we’ll use the logo and what’s on the site. {p.blurb} {formatUsd(p.priceCents)}. You own
          the finished ad.
        </p>
        <div className="mt-10">
          <OrderForm productId={product} initialSite={site} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
