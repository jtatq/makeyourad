import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";

export const Route = createFileRoute("/terms")({ component: Terms });

function Terms() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl">Terms</h1>
        <p className="eyebrow mt-2 text-subtle">Last updated September 2026. Stub for v1.</p>
        <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-muted">
          <p>
            You buy a finished ad. Payment is one-time. We deliver files to the email on the order within 24 hours
            of payment.
          </p>
          <p>
            You own the finished ad outright. You may run it on any platform. You are responsible for claims in the
            brief you submit.
          </p>
          <p>
            If you don’t like the first version, we remake it once from the same brief, or refund you, if you write
            within 7 days of delivery.
          </p>
          <p>
            Photos you upload should be yours to use. Avatar waitlist: you own your likeness and grant us a license
            to generate — we do not own it.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
