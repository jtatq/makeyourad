import { createFileRoute } from "@tanstack/react-router";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";
import { AVATAR_CENTS } from "@/lib/products";
import { formatUsd } from "@/lib/utils";

export const Route = createFileRoute("/avatar")({ component: AvatarPage });

function AvatarPage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <p className="eyebrow">Waitlist · {formatUsd(AVATAR_CENTS)}</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight">Avatar</h1>
        <p className="mt-4 text-muted">
          Not for sale in this version. Join the list. You own your likeness. You grant us a license to generate —
          we do not own it.
        </p>
        <div className="panel mt-8 p-6">
          <WaitlistForm />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
