import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AudienceProfilePaste } from "@/components/admin/audience-profile";
import { hoursLabel, slaTone, StatusPill } from "@/components/admin/status-pill";
import { Mark } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { adminCreateFromProfile, adminDashboard, adminLogout, adminSendSla } from "@/lib/admin.functions";
import { PRODUCTS, type OrderStatus } from "@/lib/products";
import { formatUsd } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  loader: async () => adminDashboard(),
  component: QueuePage,
});

function QueuePage() {
  const dashboard = Route.useLoaderData();
  const router = useRouter();
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const sla = dashboard.sla;
  const orders =
    filter === "all" ? dashboard.orders : dashboard.orders.filter((o) => o.status === filter);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Mark className="h-6" />
            <span className="font-display text-lg">Queue</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await adminSendSla();
                await router.invalidate();
              }}
            >
              Send SLA email
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await adminLogout();
                await router.invalidate();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {!dashboard.durable ? (
          dashboard.preview ? (
            <div className="mb-4 rounded-md bg-elevated px-4 py-3 text-sm text-muted">
              This is the Grok preview. It resets and is not the live queue. Open{" "}
              <a href="https://makeyourad.com/admin" className="text-primary underline">
                makeyourad.com/admin
              </a>
              .
            </div>
          ) : (
            <div className="mb-4 rounded-md bg-danger px-4 py-3 text-sm text-fg">
              Orders are not saving yet. In Vercel go to Storage, create Neon Postgres, connect it to this
              project, then Redeploy.
            </div>
          )
        ) : null}
        {dashboard.generationEngine === "imagine" ? (
          <div className="mb-4 rounded-md bg-elevated px-4 py-3 text-sm text-muted">
            Generate is queued for SuperGrok Imagine until an xAI API key is on this box. Paste{" "}
            <code className="text-fg">XAI_API_KEY</code> and Generate runs Image 2.0 / Video 1.5 on its own.
          </div>
        ) : !dashboard.aiAvailable ? (
          <div className="mb-4 rounded-md bg-warn px-4 py-3 text-sm text-fg">
            Generate is off. Add <code className="text-fg">XAI_API_KEY</code> on this droplet, then restart the app.
          </div>
        ) : (
          <div className="mb-4 rounded-md bg-elevated px-4 py-3 text-sm text-muted">
            Generate runs 20s spots on the xAI API (15s take, padded to 20). 12s and 40s stay off until that path is
            stable. Grok Bot comes later.
          </div>
        )}
        {dashboard.apiLimits ? (
          <div
            className={`mb-4 rounded-md px-4 py-3 text-sm ${
              dashboard.apiLimits.lastHour.limited > 0 || dashboard.apiLimits.lastDay.limited > 0
                ? "bg-warn text-fg"
                : "bg-elevated text-muted"
            }`}
          >
            <p className="font-medium text-fg">xAI rate limits</p>
            <p className="mt-1">
              Last hour · {dashboard.apiLimits.lastHour.video} video
              {dashboard.apiLimits.lastHour.video === 1 ? "" : "s"} · {dashboard.apiLimits.lastHour.image}{" "}
              still{dashboard.apiLimits.lastHour.image === 1 ? "" : "s"}
              {dashboard.apiLimits.lastHour.limited
                ? ` · ${dashboard.apiLimits.lastHour.limited} hit 429`
                : " · no 429s"}
              . Today · {dashboard.apiLimits.lastDay.video} video
              {dashboard.apiLimits.lastDay.video === 1 ? "" : "s"} · {dashboard.apiLimits.lastDay.image} still
              {dashboard.apiLimits.lastDay.image === 1 ? "" : "s"}.
            </p>
            <p className="mt-1">
              Published caps (Tier 0): video {dashboard.apiLimits.videoRpsCap}/sec · image{" "}
              {dashboard.apiLimits.imageRpsCap}/sec. xAI does not return remaining quota; 429s pause polls, never
              stack another video.
            </p>
            {dashboard.apiLimits.last429At ? (
              <p className="mt-1 text-fg">
                Last 429 · {dashboard.apiLimits.last429Path} · {dashboard.apiLimits.last429At}
              </p>
            ) : null}
            {dashboard.apiLimits.lastRemaining || dashboard.apiLimits.lastLimit ? (
              <p className="mt-1">
                Headers · remaining {dashboard.apiLimits.lastRemaining || "—"} · limit{" "}
                {dashboard.apiLimits.lastLimit || "—"} · reset {dashboard.apiLimits.lastReset || "—"}
              </p>
            ) : null}
          </div>
        ) : null}
        {sla.critical_20h.length > 0 ? (
          <div className="mb-4 rounded-md bg-danger px-4 py-3 text-sm text-fg">
            {sla.critical_20h.length} order{sla.critical_20h.length === 1 ? "" : "s"} past 20 hours.
          </div>
        ) : sla.aging_12h.length > 0 ? (
          <div className="mb-4 rounded-md bg-warn px-4 py-3 text-sm text-fg">
            {sla.aging_12h.length} order{sla.aging_12h.length === 1 ? "" : "s"} past 12 hours, not delivered.
          </div>
        ) : (
          <div className="mb-4 rounded-md bg-elevated px-4 py-3 text-sm text-muted">
            SLA clear. {sla.open_count} open. 24-hour clock starts at payment.
          </div>
        )}

        <div className="mb-6">
          {profileError ? <p className="mb-2 text-sm text-danger">{profileError}</p> : null}
          <AudienceProfilePaste
            mode="create"
            busy={profileBusy}
            onSubmit={async (raw) => {
              setProfileBusy(true);
              setProfileError("");
              try {
                const created = await adminCreateFromProfile({ data: { raw } });
                await router.invalidate();
                const first = created[0];
                if (first) {
                  await router.navigate({ to: "/admin/$orderId", params: { orderId: first.id } });
                }
              } catch (err) {
                setProfileError(err instanceof Error ? err.message : "Could not create jobs");
              } finally {
                setProfileBusy(false);
              }
            }}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {(["all", "paid", "in_production", "qc", "needs_attention", "delivered"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`h-10 rounded-sm px-3 text-sm ${
                filter === key ? "bg-primary text-primary-fg" : "bg-surface text-muted shadow-[var(--shadow-border)]"
              }`}
            >
              {key === "all" ? "All" : key.replaceAll("_", " ")}
            </button>
          ))}
        </div>

        <div className="panel mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-medium">Age</th>
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">
                    No orders in this filter.
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const tone = slaTone(o.created_at, o.status);
                  return (
                    <tr key={o.id} className="border-b border-border last:border-0 hover:bg-bg/80">
                      <td className="px-4 py-3">
                        <span
                          className={
                            tone === "danger"
                              ? "font-medium text-danger"
                              : tone === "warn"
                                ? "font-medium text-warn"
                                : "text-muted"
                          }
                        >
                          {hoursLabel(o.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/admin/$orderId"
                          params={{ orderId: o.id }}
                          className="font-medium hover:underline"
                        >
                          {o.business_name}
                        </Link>
                        <div className="text-xs text-muted">
                          {o.city}, {o.state}
                        </div>
                      </td>
                      <td className="px-4 py-3">{PRODUCTS[o.product]?.shortName}</td>
                      <td className="px-4 py-3">
                        <StatusPill status={o.status} />
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatUsd(o.price_cents)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <section className="mt-10">
          <h2 className="font-display text-2xl">Outbound email</h2>
          <p className="mt-1 text-sm text-muted">Logged here. Sent through Resend when a mail key is set.</p>
          <ul className="panel mt-4 divide-y divide-border">
            {dashboard.emails.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted">No mail yet.</li>
            ) : (
              dashboard.emails.map((e) => (
                <li key={e.id} className="px-4 py-3 text-sm">
                  <span className="font-medium">{e.subject}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {e.kind} · {e.to_email} · {e.sent_via}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </main>
    </div>
  );
}
