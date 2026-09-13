import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { hoursLabel, slaTone, StatusPill } from "@/components/admin/status-pill";
import { Mark } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { adminDashboard, adminLogin, adminLogout, adminSendSla, adminSession } from "@/lib/admin.functions";
import { PRODUCTS, type OrderStatus } from "@/lib/products";
import { formatUsd } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  loader: async () => {
    const session = await adminSession();
    if (!session.ok) return { session, dashboard: null };
    const dashboard = await adminDashboard();
    return { session, dashboard };
  },
  component: AdminPage,
});

function AdminPage() {
  const { session, dashboard } = Route.useLoaderData();
  if (!session.ok || !dashboard) {
    return <Login previewHint={session.previewHint} />;
  }
  return <Queue dashboard={dashboard} />;
}

function Login({ previewHint }: { previewHint: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState(previewHint ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminLogin({ data: { password } });
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="panel w-full max-w-sm p-7"
      >
        <div className="flex items-center gap-2">
          <Mark className="h-7" />
          <span className="font-display text-xl">Operator</span>
        </div>
        <p className="mt-3 text-sm text-muted">Queue password. No user accounts.</p>
        <div className="mt-6">
          <Label htmlFor="pw">Password</Label>
          <Input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {previewHint ? (
          <p className="mt-2 text-xs text-muted">Preview password is prefilled. Change it with OPERATOR_TOKEN.</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <Button className="mt-6 w-full" disabled={busy} type="submit">
          {busy ? "Checking…" : "Open the queue"}
        </Button>
      </form>
    </div>
  );
}

function Queue({
  dashboard,
}: {
  dashboard: Awaited<ReturnType<typeof adminDashboard>>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
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
          <p className="mt-1 text-sm text-muted">
            Logged here. Sent through Resend when RESEND_API_KEY is set.
          </p>
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
