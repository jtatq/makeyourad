import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";

export const Route = createFileRoute("/privacy")({ component: Privacy });

function Privacy() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl">Privacy</h1>
        <p className="eyebrow mt-2 text-subtle">Last updated September 2026. Stub for v1.</p>
        <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-muted">
          <p>
            We collect what you type on the order form: business details, contact info, photos, and the brief. We
            use that to make and deliver the ad.
          </p>
          <p>
            Payment is handled by Stripe when Stripe keys are configured. We do not store card numbers.
          </p>
          <p>
            We email order confirmation and delivery links to the address you give us. Operator notices go to our
            fulfillment inbox.
          </p>
          <p>We do not sell your list. We do not post the ad for you.</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
