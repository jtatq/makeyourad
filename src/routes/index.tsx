import { ExampleAds } from "@/components/landing/example-ads";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { WebsiteCta } from "@/components/landing/website-cta";
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { AVATAR_CENTS, PRODUCT_LIST } from "@/lib/products";
import { formatUsd } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Clock, Shield } from "lucide-react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/")({ component: Home });

const FAQ = [
  {
    q: "What do I get?",
    a: "A finished ad made for your business, delivered to your email within 24 hours. Video orders come as MP4. Static orders come as one image in three sizes.",
  },
  {
    q: "Can you just use my website?",
    a: "Yes. Paste the site and we’ll pull the logo, photos, name, city, phone, and what you actually offer, then draft the ad from that. You can edit anything before you pay.",
  },
  {
    q: "What if I don’t have a website?",
    a: "Fill in the form by hand and upload photos. A website just saves you the typing.",
  },
  {
    q: "What sizes?",
    a: "Every order includes 9:16, 1:1, and 16:9 so it fits Instagram, Facebook, TikTok, and YouTube. You tell us where it will run so we know which size to lead with.",
  },
  {
    q: "Who owns it?",
    a: "You do. You own the finished ad outright. Run it wherever you like.",
  },
  {
    q: "What if I don’t like it?",
    a: "We’ll remake it once from the same brief, or refund you. Say so within 7 days of delivery.",
  },
  {
    q: "How fast?",
    a: "24 hours from payment. That’s the promise on every order.",
  },
];

function Home() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-4 pb-8 pt-14 sm:px-6 sm:pt-20">
          <p className="eyebrow text-primary">MakeYourAd</p>
          <h1 className="mt-4 max-w-3xl font-display text-[2.6rem] leading-[1.08] sm:text-6xl">
            Your ad, made for you.
            <span className="mt-2 block text-primary">Delivered in 24 hours.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Paste the website. We pull the logo and the details already there, you pay once, and a finished video or
            still lands in your inbox by this time tomorrow. You own it.
          </p>
          <WebsiteCta />
          <p className="mt-4 text-sm text-muted">
            Or{" "}
            <a href="#pricing" className="text-fg underline underline-offset-2">
              pick a length
            </a>{" "}
            and fill in the form by hand.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="panel grid gap-3 px-5 py-5 sm:grid-cols-3 sm:px-8">
            <PromiseItem icon={<Clock className="size-4" />} label="24-hour delivery" />
            <PromiseItem icon={<Shield className="size-4" />} label="You own the finished ad" />
            <PromiseItem icon={<Check className="size-4" />} label="9:16, 1:1, and 16:9" />
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6">
          <p className="eyebrow">Prices</p>
          <h2 className="mt-3 font-display text-4xl tracking-tight">Pick a length. That’s the whole menu.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PRODUCT_LIST.map((p) => (
              <article key={p.id} className="panel flex flex-col p-6">
                <h3 className="font-display text-2xl">{p.name}</h3>
                <p className="mt-4 font-display text-5xl tracking-tight tabular-nums">{formatUsd(p.priceCents)}</p>
                <p className="mt-3 text-sm text-muted">{p.blurb}</p>
                <ul className="mt-6 flex flex-col gap-2 text-sm">
                  {p.includes.map((item) => (
                    <li key={item} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-8 w-full" size="lg">
                  <Link to="/order/$product" params={{ product: p.id }}>
                    Order {p.shortName}
                  </Link>
                </Button>
              </article>
            ))}
          </div>
          <p className="mt-5 text-sm text-muted">
            Optional mascot character, +$25 on any paid ad. One-time. No subscription.
          </p>
        </section>

        <section id="examples" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-8 sm:px-6">
          <p className="eyebrow">Examples</p>
          <h2 className="mt-3 font-display text-4xl tracking-tight">Ads like the ones you’ll get.</h2>
          <p className="mt-3 max-w-xl text-muted">
            Local businesses, three sizes, a clear end card. Yours will use your logo, your name, your city, your
            number.
          </p>
          <div className="mt-10">
            <ExampleAds />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-3 font-display text-4xl tracking-tight">Three steps. No call.</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                n: "01",
                t: "Paste the website",
                d: "We pull the logo, photos, and what you actually offer, then draft the ad. Edit anything.",
              },
              { n: "02", t: "Pay once", d: "$25, $50, or $100. Optional mascot for $25 more." },
              { n: "03", t: "Get the files tomorrow", d: "We email the downloads within 24 hours. You own them." },
            ].map((s) => (
              <li key={s.n} className="panel p-6">
                <p className="font-display text-xs font-semibold tracking-[0.16em] text-primary">{s.n}</p>
                <h3 className="mt-3 font-display text-2xl">{s.t}</h3>
                <p className="mt-2 text-sm text-muted">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
          <div className="panel grid gap-8 p-6 md:grid-cols-[1.1fr_1fr] md:p-10">
            <div>
              <p className="eyebrow">Avatar</p>
              <h2 className="mt-3 font-display text-4xl tracking-tight">On camera, without a camera day.</h2>
              <p className="mt-3 text-muted">
                Avatar is {formatUsd(AVATAR_CENTS)} and not for sale yet. You own your likeness. You grant us a
                license to generate — we do not own it.
              </p>
            </div>
            <WaitlistForm />
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 sm:px-6">
          <p className="eyebrow">FAQ</p>
          <h2 className="mt-3 font-display text-4xl tracking-tight">Straight answers.</h2>
          <div className="mt-8 divide-y divide-border">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="cursor-pointer list-none font-medium text-lg [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {item.q}
                    <span className="text-muted transition-transform group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function PromiseItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <p className="flex items-center gap-2.5 text-sm">
      <span className="flex size-8 items-center justify-center rounded-sm text-primary">{icon}</span>
      {label}
    </p>
  );
}
