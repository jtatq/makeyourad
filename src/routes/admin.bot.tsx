import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Mark } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { adminBotPlaybook, adminBotTick } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/bot")({
  loader: async () => adminBotPlaybook(),
  component: BotPlaybookPage,
});

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="panel mt-6 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">{label}</h2>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{text}</pre>
    </section>
  );
}

function BotPlaybookPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const p = data.profile;
  const intake = data.intake;
  const [busy, setBusy] = useState(false);
  const [tickNote, setTickNote] = useState("");
  const floorText = `Name: ${p.name}\nTitle: ${p.title}\nJob: ${p.job}\n\n${p.description}`;
  const intakeText = intake
    ? `Name: ${intake.name}\nTitle: ${intake.title}\nJob: ${intake.job}\n\n${intake.description}`
    : "";

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Mark className="h-6" />
            <span className="font-display text-lg">Grok Bot</span>
          </div>
          <Link to="/admin" className="text-sm text-muted hover:underline">
            Queue
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-sm text-muted">
          Two Bots. <strong className="text-fg">MYA</strong> takes a pasted audience profile and starts one 20s ad.
          <strong className="text-fg"> MYA Floor</strong> watches finished takes and Pass QC. Neither emails the
          customer.
        </p>

        <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm">
          <li>
            Install Grok Bot from{" "}
            <a className="text-primary underline" href="https://x.ai/bot" target="_blank" rel="noreferrer">
              x.ai/bot
            </a>
            . SuperGrok Heavy / Plus.
          </li>
          <li>New → Create new agent. Make the intake bot first, named MYA.</li>
          <li>Bot actions → Edit Profile. Paste the intake profile. Put the operator token in that Bot’s notes.</li>
          <li>Send the intake first message. Next paste is an audience profile — it will POST and generate.</li>
          <li>Optional second Bot: MYA Floor, for watching masters. Take over once for the admin password.</li>
        </ol>

        {data.work ? (
          <div className="mt-6 rounded-md bg-elevated px-4 py-3 text-sm">
            Next job · {data.work.businessName} · {data.work.jobStatus ?? "not started"} ·{" "}
            {data.work.floor?.status ?? "no floor yet"}
            <div className="mt-2">
              <Link className="text-primary underline" to="/admin/$orderId" params={{ orderId: data.work.orderId }}>
                Open order
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-md bg-elevated px-4 py-3 text-sm text-muted">No open 20s jobs.</div>
        )}

        <div className="mt-4">
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await adminBotTick();
                setTickNote(result.did);
                await router.invalidate();
              } catch (err) {
                setTickNote(err instanceof Error ? err.message : "Tick failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Running…" : "Run one floor tick now"}
          </Button>
          {tickNote ? <p className="mt-2 text-sm text-muted">{tickNote}</p> : null}
        </div>

        <CopyBlock label="Intake profile — MYA" text={intakeText} />
        <CopyBlock label="Intake first message" text={intake?.firstMessage ?? ""} />
        <CopyBlock label="Floor profile — MYA Floor" text={floorText} />
        <CopyBlock label="Floor first message" text={p.firstMessage} />
        <CopyBlock label="Floor routine" text={p.routine} />
      </main>
    </div>
  );
}
