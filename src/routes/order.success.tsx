import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";
import { loadSuccess } from "@/lib/success.functions";

const searchSchema = z.object({
  order: z.string().optional(),
  email: z.string().optional(),
  session_id: z.string().optional(),
  checkout: z.string().optional(),
});

export const Route = createFileRoute("/order/success")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    loadSuccess({
      data: {
        orderId: deps.order,
        sessionId: deps.session_id,
        checkoutId: deps.checkout,
      },
    }),
  component: SuccessPage,
});

function SuccessPage() {
  const search = Route.useSearch();
  const order = Route.useLoaderData();
  const email = order?.email || search.email || "your inbox";

  return (
    <div className="min-h-dvh">
      <SiteHeader compact />
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="eyebrow">Order received</p>
        <h1 className="mt-4 font-display text-5xl tracking-tight">In production.</h1>
        <p className="mt-6 text-lg text-muted">
          Delivery within 24 hours to <span className="text-fg">{email}</span>.
        </p>
        <p className="mt-4 text-sm text-muted">
          You own the finished ad. We’ll email download links when it’s ready. No further action from you.
        </p>
        {order?.id ? (
          <p className="mt-6 font-mono text-xs text-subtle">Order {order.id}</p>
        ) : null}
        <Link to="/" className="mt-10 inline-block text-sm text-primary underline">
          Back to MakeYourAd
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
