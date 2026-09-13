import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { payDemoCheckout } from "@/lib/checkout.functions";
import { loadPay } from "@/lib/pay.functions";
import { formatUsd } from "@/lib/utils";

export const Route = createFileRoute("/pay/$checkoutId")({
  loader: ({ params }) => loadPay({ data: { checkoutId: params.checkoutId } }),
  component: PayPage,
});

function PayPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!data) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Checkout not found.</h1>
        <Link to="/" className="mt-4 inline-block text-primary underline">
          Home
        </Link>
      </Shell>
    );
  }
  if (data.alreadyPaid) {
    return (
      <Shell>
        <h1 className="font-display text-3xl">Already paid.</h1>
        <p className="mt-3 text-muted">Delivery within 24 hours to {data.email}.</p>
      </Shell>
    );
  }

  const checkoutId = data.checkoutId;
  const email = data.email;

  async function pay() {
    setBusy(true);
    setError("");
    try {
      const res = await payDemoCheckout({ data: { checkoutId } });
      await navigate({
        to: "/order/success",
        search: { order: res.orderId, email: res.email },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setBusy(false);
    }
  }

  return (
    <Shell>
      <p className="eyebrow">Checkout</p>
      <h1 className="mt-3 font-display text-4xl">Pay {formatUsd(data.priceCents)}</h1>
      <p className="mt-3 text-muted">
        {data.productName}
        {data.addOns.includes("mascot") ? " + mascot" : ""} for {data.businessName} in {data.city}, {data.state}.
      </p>
      <p className="mt-2 text-sm text-muted">
        Preview checkout — no card is charged here. Delivery still goes to {email} within 24 hours. You own the
        finished ad.
      </p>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      <Button className="mt-8" size="lg" disabled={busy} onClick={() => void pay()}>
        {busy ? "Paying…" : `Pay ${formatUsd(data.priceCents)}`}
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <SiteHeader compact />
      <main className="mx-auto max-w-lg px-4 py-16">{children}</main>
      <SiteFooter />
    </div>
  );
}
