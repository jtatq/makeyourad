import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hoursLabel, StatusPill } from "@/components/admin/status-pill";
import { Mark } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  adminAttach,
  adminClaim,
  adminDeliver,
  adminFlag,
  adminGenerate,
  adminOrder,
  adminQc,
  adminRefund,
  adminRemake,
  adminSession,
} from "@/lib/admin.functions";
import { PRODUCTS } from "@/lib/products";
import { formatUsd } from "@/lib/utils";

export const Route = createFileRoute("/admin/$orderId")({
  loader: async ({ params }) => {
    const session = await adminSession();
    if (!session.ok) return { session, detail: null };
    const detail = await adminOrder({ data: { id: params.orderId } });
    return { session, detail };
  },
  component: OrderAdminPage,
});

function OrderAdminPage() {
  const { session, detail } = Route.useLoaderData();
  const { orderId } = Route.useParams();
  if (!session.ok) {
    return (
      <div className="px-4 py-20 text-center">
        <Link to="/admin" className="text-primary underline">
          Sign in to the queue
        </Link>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="px-4 py-20 text-center">
        Order {orderId} not found.{" "}
        <Link to="/admin" className="text-primary underline">
          Queue
        </Link>
      </div>
    );
  }
  return <Detail detail={detail} canGenerate={Boolean(session.aiAvailable)} />;
}

function Detail({
  detail,
  canGenerate,
}: {
  detail: Awaited<ReturnType<typeof adminOrder>>;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const { order, events, assets, packet, generation } = detail;
  const [filename, setFilename] = useState("ad-9x16.mp4");
  const [url, setUrl] = useState("/examples/hvac.jpg");
  const [watched, setWatched] = useState(false);
  const [names, setNames] = useState(false);
  const [clean, setClean] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await fn();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (generation?.status !== "running") return;
    const t = window.setTimeout(() => {
      void run("generate", () => adminGenerate({ data: { id: order.id, action: "tick" } }));
    }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation?.status, generation?.updatedAt, order.id]);

  const uploads = assets.filter((a) => a.kind === "upload" || a.kind === "logo");
  const deliveries = assets.filter((a) => a.kind === "delivery");
  const generating = busy === "generate" || generation?.status === "running";


  return (
    <div className="min-h-dvh pb-16">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/admin" className="flex items-center gap-2 text-sm text-muted hover:text-fg">
            <Mark className="h-6" />
            Queue
          </Link>
          <StatusPill status={order.status} />
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_340px] sm:px-6">
        <div>
          <p className="font-mono text-xs text-muted">
            {order.id} · {hoursLabel(order.created_at)}
          </p>
          <h1 className="mt-2 font-display text-4xl">{order.business_name}</h1>
          <p className="mt-2 text-muted">
            {PRODUCTS[order.product]?.name}
            {order.add_ons.includes("mascot") ? " + mascot" : ""} · {formatUsd(order.price_cents)} · {order.city},{" "}
            {order.state}
          </p>

          <dl className="panel mt-8 grid gap-3 p-5 text-sm sm:grid-cols-2">
            <Item label="Email" value={order.email} />
            <Item label="Phone" value={order.phone} />
            <Item label="Category" value={order.category} />
            <Item label="Tone" value={order.tone} />
            <Item label="Platforms" value={order.platforms.join(", ") || "—"} />
            <Item label="Website" value={order.website || "—"} />
            <div className="sm:col-span-2">
              <Item label="Brief" value={order.brief} />
            </div>
            {order.mascot_description ? (
              <div className="sm:col-span-2">
                <Item label="Mascot" value={order.mascot_description} />
              </div>
            ) : null}
            {order.website_profile?.sourceUrl ? (
              <div className="sm:col-span-2 space-y-2">
                <Item label="From the website" value={order.website_profile.tagline || order.website_profile.about || order.website_profile.sourceUrl} />
                {order.website_profile.services.length > 0 ? (
                  <Item label="Services" value={order.website_profile.services.join(" · ")} />
                ) : null}
                {order.website_profile.proofPoints.length > 0 ? (
                  <Item label="Proof" value={order.website_profile.proofPoints.join(" · ")} />
                ) : null}
                {order.website_profile.hours ? <Item label="Hours" value={order.website_profile.hours} /> : null}
                {order.website_profile.serviceArea ? (
                  <Item label="Service area" value={order.website_profile.serviceArea} />
                ) : null}
              </div>
            ) : null}
          </dl>

          <h2 className="mt-10 font-display text-2xl">Uploads</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {uploads.length === 0 ? (
              <p className="col-span-full text-sm text-muted">No uploads on this order.</p>
            ) : (
              uploads.map((a) => (
                <div key={a.id} className="overflow-hidden rounded-md bg-elevated text-xs">
                  {a.preview_url ? (
                    <img
                      src={a.preview_url}
                      alt=""
                      className={`aspect-square w-full ${a.kind === "logo" ? "object-contain bg-surface p-2" : "object-cover"}`}
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  ) : null}
                  <p className="truncate px-2 py-1.5">
                    {a.kind === "logo" ? "Logo · " : ""}
                    {a.filename}
                  </p>
                </div>
              ))
            )}
          </div>

          <h2 className="mt-10 font-display text-2xl">Generation packet</h2>
          <p className="mt-1 text-sm text-muted">This is the whole job. Prompts map 1:1 to recipe slots.</p>
          <pre className="mt-4 max-h-[480px] overflow-auto rounded-lg bg-bg p-4 font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify(packet, null, 2)}
          </pre>
        </div>

        <aside className="flex flex-col gap-4">
          <section className="panel p-5">
            <h2 className="font-display text-xl">Generate</h2>
            <p className="mt-1 text-sm text-muted">
              Builds each recipe slot from the packet. Stills first, then motion. Uses the customer’s photos when we have them.
            </p>
            {generation?.error ? <p className="mt-2 text-sm text-danger">{generation.error}</p> : null}
            {!canGenerate ? (
              <p className="mt-2 text-sm text-danger">
                This live copy doesn’t have the image engine attached, so Generate is off here.
              </p>
            ) : null}
            {error && busy === "generate" ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
            <div className="mt-4 flex flex-col gap-2">
              <Button
                disabled={!canGenerate || busy !== null || generating}
                onClick={() =>
                  void run("generate", () =>
                    adminGenerate({
                      data: {
                        id: order.id,
                        action: "start",
                        force: generation?.status === "done" || generation?.status === "error",
                      },
                    }),
                  )
                }
              >
                {generating
                  ? "Generating…"
                  : generation?.status === "done"
                    ? "Generate again"
                    : generation?.status === "error"
                      ? "Retry generate"
                      : "Generate ad"}
              </Button>
            </div>
            {generation ? (
              <ol className="mt-4 space-y-3">
                {generation.slots.map((s) => (
                  <li key={s.id} className="text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{s.label}</span>
                      <span className="text-xs uppercase tracking-wider text-muted">
                        {s.status === "video" ? "animating" : s.status}
                        {s.duration ? ` · ${s.duration}s` : ""}
                      </span>
                    </div>
                    {s.error ? <p className="mt-1 text-xs text-danger">{s.error}</p> : null}
                    {(s.videoUrl || s.stillUrl) && (
                      <div className="mt-2 overflow-hidden rounded-md bg-elevated">
                        {s.videoUrl ? (
                          <video src={s.videoUrl} className="aspect-[9/16] w-full bg-bg" controls playsInline />
                        ) : (
                          <img src={s.stillUrl} alt="" className="aspect-[9/16] w-full object-cover" />
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
          <section className="panel p-5">
            <h2 className="font-display text-xl">Actions</h2>
            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
            <div className="mt-4 flex flex-col gap-2">
              <Button
                disabled={busy !== null}
                onClick={() => void run("claim", () => adminClaim({ data: { id: order.id } }))}
              >
                Claim · in production
              </Button>
              <div className="grid gap-2">
                <Label htmlFor="fn">Attach finished file (URL)</Label>
                <Input id="fn" value={filename} onChange={(e) => setFilename(e.target.value)} />
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https:// or /examples/…" />
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("attach", () =>
                      adminAttach({ data: { id: order.id, filename, url } }),
                    )
                  }
                >
                  Attach file
                </Button>
              </div>
              {deliveries.length > 0 ? (
                <ul className="space-y-2 text-xs text-muted">
                  {deliveries.map((d) => (
                    <li key={d.id}>
                      {d.preview_url && d.mime.startsWith("video/") ? (
                        <video src={d.preview_url} className="mb-1 aspect-[9/16] w-full rounded-md bg-bg" controls playsInline />
                      ) : null}
                      {d.filename}
                    </li>
                  ))}
                </ul>
              ) : null}
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={watched} onChange={(e) => setWatched(e.target.checked)} />
                Watched it
              </label>
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
                Names, phone, city correct
              </label>
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} />
                No artifacts
              </label>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() =>
                  void run("qc", () =>
                    adminQc({
                      data: {
                        id: order.id,
                        watched,
                        namesPhoneCityCorrect: names,
                        noArtifacts: clean,
                      },
                    }),
                  )
                }
              >
                Pass QC
              </Button>
              <Button
                disabled={busy !== null}
                onClick={() => void run("deliver", () => adminDeliver({ data: { id: order.id } }))}
              >
                Send delivery email
              </Button>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Problem note"
                className="min-h-20"
              />
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void run("flag", () => adminFlag({ data: { id: order.id, note } }))}
              >
                Flag needs attention
              </Button>
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void run("remake", () => adminRemake({ data: { id: order.id, note } }))}
              >
                Remake requested
              </Button>
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void run("refund", () => adminRefund({ data: { id: order.id, note } }))}
              >
                Mark refunded
              </Button>
            </div>
          </section>
          <section className="panel p-5">
            <h2 className="font-display text-xl">Event log</h2>
            <ol className="mt-3 space-y-3">
              {events.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-medium">{e.action}</span>
                  <span className="block text-xs text-muted">
                    {e.actor} · {new Date(e.created_at).toLocaleString()}
                  </span>
                  {e.note ? <span className="block text-muted">{e.note}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </main>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
