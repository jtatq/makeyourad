import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hoursLabel, StatusPill } from "@/components/admin/status-pill";
import { StudioDeck } from "@/components/admin/studio-deck";
import { AudienceProfilePaste } from "@/components/admin/audience-profile";
import { Mark } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  adminAssemble,
  adminApplyProfile,
  adminAttach,
  adminClaim,
  adminDeliver,
  adminFlag,
  adminGenerate,
  adminOrder,
  adminQc,
  adminRefund,
  adminRegenSlot,
  adminRemake,
  adminSaveTimeline,
  adminSession,
  adminSlotQc,
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
  return <Detail detail={detail} canGenerate={Boolean(session.aiAvailable)} engine={session.generationEngine ?? "imagine"} />;
}

function Detail({
  detail,
  canGenerate,
  engine,
}: {
  detail: Awaited<ReturnType<typeof adminOrder>>;
  canGenerate: boolean;
  engine: "imagine" | "xai";
}) {
  const router = useRouter();
  const { order, events, assets, packet, generation } = detail;
  const [filename, setFilename] = useState("ad-9x16.mp4");
  const [url, setUrl] = useState("/examples/hvac.jpg");
  const [watched, setWatched] = useState(false);
  const [names, setNames] = useState(false);
  const [clean, setClean] = useState(false);
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState("");
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
    const viaApi = (generation.engine ?? engine) === "xai";
    const t = window.setInterval(() => {
      if (viaApi) {
        void run("generate", () => adminGenerate({ data: { id: order.id, action: "tick" } }));
      } else {
        void router.invalidate();
      }
    }, viaApi ? 2800 : 2500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation?.status, generation?.engine, engine, order.id]);

  const uploads = assets.filter((a) => a.kind === "upload" || a.kind === "logo");
  const deliveries = assets.filter(
    (a) => a.kind === "delivery" && !a.filename.includes("-gen.") && !a.filename.includes("-gen-"),
  );
  const generating = busy === "generate" || generation?.status === "running";
  const hasOutput = Boolean(generation?.slots.some((s) => s.stillUrl || s.videoUrl));
  const stuckWaiting = generation?.status === "running" && !hasOutput;
  const studioTakes = (generation?.slots ?? [])
    .filter((s) => s.id !== "static")
    .map((s) => ({
      slotId: s.id,
      label: s.label,
      url: s.videoUrl,
      stillUrl: s.stillUrl,
      seconds: s.targetSeconds || s.duration || 6,
      extra: s.id === "mascot",
      status:
        s.qc === "pass"
          ? s.id === "mascot"
            ? "extra"
            : "in the cut"
          : s.qc === "fix" && !s.videoUrl
            ? "cut"
            : s.status === "queued"
              ? "waiting"
              : s.status === "still" && !s.stillUrl
                ? "drawing"
                : s.status === "still" || s.status === "video"
                  ? "animating"
                  : s.status,
    }));
  const generateLabel =
    busy === "generate"
      ? "Starting…"
      : stuckWaiting
        ? "Restart generate"
        : generating
          ? engine === "imagine"
            ? "Drawing…"
            : "Generating…"
          : generation?.status === "done"
            ? "Generate again"
            : generation?.status === "error"
              ? "Retry generate"
              : "Generate takes";


  return (
    <div className="min-h-dvh max-w-full overflow-x-hidden pb-16">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/admin" className="flex items-center gap-2 text-sm text-muted hover:text-fg">
            <Mark className="h-6" />
            Queue
          </Link>
          <StatusPill status={order.status} />
        </div>
      </header>
      <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">
            {order.id} · {hoursLabel(order.created_at)}
          </p>
          <h1 className="mt-2 font-display text-3xl break-words sm:text-4xl">{order.business_name}</h1>
          <p className="mt-2 text-muted">
            {PRODUCTS[order.product]?.name}
            {order.add_ons.includes("mascot") ? " + mascot" : ""} · {formatUsd(order.price_cents)} · {order.city},{" "}
            {order.state}
          </p>
          {generation?.error ? <p className="mt-2 text-sm text-danger">{generation.error}</p> : null}
          {error && (busy === "generate" || busy === "assemble" || busy === "timeline" || busy === "profile") ? (
            <p className="mt-2 text-sm text-danger">{error}</p>
          ) : null}
          <div className="mt-6">
            <AudienceProfilePaste
              mode="apply"
              busy={busy !== null}
              onSubmit={(raw) => run("profile", () => adminApplyProfile({ data: { id: order.id, raw } }))}
            />
          </div>
          <div className="mt-6">
            <StudioDeck
              takes={studioTakes}
              timeline={generation?.timeline ?? []}
              targetSeconds={PRODUCTS[order.product]?.durationSeconds ?? 20}
              masterUrl={generation?.masterUrl}
              busy={busy !== null}
              stitching={busy === "assemble"}
              canGenerate={canGenerate}
              generateLabel={generateLabel}
              direction={direction || generation?.direction || ""}
              onDirection={setDirection}
              onApplyDirection={() => {
                const text = (direction || generation?.direction || "").trim();
                const spot = generation?.slots.find((s) => s.id === "hook") ?? generation?.slots[0];
                if (spot) {
                  void run("regen", () =>
                    adminRegenSlot({
                      data: {
                        id: order.id,
                        slotId: spot.id as "hook" | "mascot" | "body_1" | "body_2" | "body_3" | "end_card" | "static",
                        note: text,
                      },
                    }),
                  );
                } else {
                  void run("generate", () =>
                    adminGenerate({
                      data: { id: order.id, action: "start", force: true, direction: text },
                    }),
                  );
                }
              }}
              onSave={(clips) => run("timeline", () => adminSaveTimeline({ data: { id: order.id, clips } }))}
              onCutFromLibrary={(slotId) =>
                void run("qc-slot", () =>
                  adminSlotQc({
                    data: {
                      id: order.id,
                      slotId: slotId as "hook" | "mascot" | "body_1" | "body_2" | "body_3" | "end_card" | "static",
                      verdict: "fix",
                    },
                  }),
                )
              }
              onReshoot={(slotId, reshootNote) =>
                void run("regen", () =>
                  adminRegenSlot({
                    data: {
                      id: order.id,
                      slotId: slotId as "hook" | "mascot" | "body_1" | "body_2" | "body_3" | "end_card" | "static",
                      note: reshootNote,
                    },
                  }),
                )
              }
              onStitch={() => void run("assemble", () => adminAssemble({ data: { id: order.id } }))}
              onGenerate={() =>
                void run("generate", () =>
                  adminGenerate({
                    data: {
                      id: order.id,
                      action: "start",
                      direction: (direction || generation?.direction || "").trim() || undefined,
                      force:
                        generating ||
                        generation?.status === "done" ||
                        generation?.status === "error" ||
                        stuckWaiting,
                    },
                  }),
                )
              }
            />
          </div>
        </div>

        <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="min-w-0">

          <dl className="panel mt-8 grid min-w-0 gap-3 overflow-hidden p-5 text-sm sm:grid-cols-2">
            <Item label="Email" value={order.email} />
            <Item label="Phone" value={order.phone} />
            <Item label="Category" value={order.category} />
            <Item label="Tone" value={order.tone} />
            <Item label="Platforms" value={order.platforms.join(", ") || "—"} />
            <Item label="Website" value={order.website || "—"} />
            <div className="sm:col-span-2">
              <Item label="Script" value={order.brief} />
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
                <div key={a.id} className="min-w-0 overflow-hidden rounded-md bg-elevated text-xs">
                  {a.preview_url ? (
                    <img
                      src={a.preview_url}
                      alt=""
                      className="mx-auto h-24 w-full object-contain bg-surface p-1"
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
          <p className="mt-1 text-sm text-muted">Prompts map 1:1 to recipe slots. Collapse this on a phone.</p>
          <details className="mt-4 min-w-0">
            <summary className="cursor-pointer text-sm text-muted">Show packet JSON</summary>
            <pre className="mt-2 max-h-[320px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bg p-4 font-mono text-[11px] leading-relaxed text-muted">
              {JSON.stringify(packet, null, 2)}
            </pre>
          </details>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
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
                        <video
                          src={d.preview_url}
                          className="mb-1 max-h-[52vh] w-full rounded-md bg-bg object-contain"
                          controls
                          playsInline
                        />
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
                  {e.note ? <span className="block break-words text-muted">{e.note}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        </aside>
        </div>
      </main>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
