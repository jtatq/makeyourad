import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TimelineClip } from "@/lib/generate-ad.server";
import type { SlotId } from "@/lib/recipe";

export type Take = {
  slotId: SlotId | string;
  label: string;
  url: string;
  stillUrl?: string;
  seconds: number;
};

type Props = {
  takes: Take[];
  timeline: TimelineClip[];
  targetSeconds: number;
  busy: boolean;
  onSave: (clips: TimelineClip[]) => Promise<void>;
  onCutFromLibrary: (slotId: string) => void;
};

function nid() {
  return `tl_${Math.random().toString(36).slice(2, 10)}`;
}

function takeToClip(t: Take): TimelineClip {
  return {
    id: nid(),
    slotId: String(t.slotId),
    label: t.label,
    url: t.url,
    stillUrl: t.stillUrl,
    seconds: t.seconds,
  };
}

export function CutTimeline({ takes, timeline, targetSeconds, busy, onSave, onCutFromLibrary }: Props) {
  const [line, setLine] = useState<TimelineClip[]>(timeline);
  const [drag, setDrag] = useState<{ kind: "take" | "line"; id: string } | null>(null);

  useEffect(() => {
    setLine(timeline);
  }, [timeline]);

  const used = new Set(line.map((c) => c.slotId));
  const total = line.reduce((n, c) => n + c.seconds, 0);

  async function commit(next: TimelineClip[]) {
    setLine(next);
    await onSave(next);
  }

  function addTake(t: Take, at?: number) {
    if (busy) return;
    const clip = takeToClip(t);
    const next = [...line];
    if (at == null || at < 0 || at > next.length) next.push(clip);
    else next.splice(at, 0, clip);
    void commit(next);
  }

  function swap(i: number, j: number) {
    if (j < 0 || j >= line.length || busy) return;
    const next = [...line];
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
    void commit(next);
  }

  function moveLine(from: number, insertAt: number) {
    if (from < 0) return;
    const next = [...line];
    const [item] = next.splice(from, 1);
    let at = insertAt;
    if (from < insertAt) at -= 1;
    at = Math.max(0, Math.min(at, next.length));
    next.splice(at, 0, item);
    void commit(next);
  }

  function dropOnLine(index: number) {
    if (!drag) return;
    if (drag.kind === "take") {
      const t = takes.find((x) => String(x.slotId) === drag.id);
      if (t) addTake(t, index);
    } else {
      const from = line.findIndex((c) => c.id === drag.id);
      moveLine(from, index);
    }
    setDrag(null);
  }

  return (
    <div className="mt-6 min-w-0">
      <h3 className="font-display text-lg">Takes</h3>
      <p className="mt-1 text-xs text-muted">Drag onto the FINAL CLIP, or tap Add. Cut this out deletes it from the library.</p>
      <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-2">
        {takes.length === 0 ? (
          <p className="text-sm text-muted">No clips yet.</p>
        ) : (
          takes.map((t) => {
            const onLine = used.has(String(t.slotId));
            return (
              <div
                key={String(t.slotId)}
                draggable={!busy}
                onDragStart={() => setDrag({ kind: "take", id: String(t.slotId) })}
                onDragEnd={() => setDrag(null)}
                className={`w-28 shrink-0 overflow-hidden rounded-md bg-elevated ${onLine ? "opacity-60" : ""}`}
              >
                {t.stillUrl || t.url ? (
                  t.url.endsWith(".mp4") || t.url.includes("video") ? (
                    <video src={t.url} className="h-20 w-full object-cover" muted playsInline />
                  ) : (
                    <img src={t.stillUrl || t.url} alt="" className="h-20 w-full object-cover" />
                  )
                ) : null}
                <p className="truncate px-1.5 pt-1 text-[11px]">{t.label}</p>
                <p className="px-1.5 pb-1 text-[10px] uppercase tracking-wider text-muted">{t.seconds}s</p>
                <div className="grid grid-cols-1 gap-1 p-1">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => addTake(t)}>
                    Add
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => onCutFromLibrary(String(t.slotId))}>
                    Cut this out
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <h3 className="mt-6 font-display text-lg">FINAL CLIP</h3>
      <p className="mt-1 text-xs text-muted">
        {total.toFixed(0)}s of {targetSeconds}s · drag to reorder
      </p>
      <div
        className="mt-3 flex min-h-[7.5rem] min-w-0 items-stretch gap-1 overflow-x-auto rounded-md bg-elevated p-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => dropOnLine(line.length)}
      >
        {line.length === 0 ? (
          <p className="m-auto px-3 text-center text-sm text-muted">Drag takes here in the order they should play.</p>
        ) : (
          line.map((c, i) => (
            <div
              key={c.id}
              draggable={!busy}
              onDragStart={() => setDrag({ kind: "line", id: c.id })}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.stopPropagation();
                dropOnLine(i);
              }}
              style={{ flex: `${Math.max(c.seconds, 3)} 0 0` }}
              className="relative min-w-[4.5rem] overflow-hidden rounded-sm bg-surface"
            >
              {c.stillUrl ? (
                <img src={c.stillUrl} alt="" className="h-16 w-full object-cover" />
              ) : (
                <video src={c.url} className="h-16 w-full object-cover" muted playsInline />
              )}
              <p className="truncate px-1 pt-1 text-[11px]">{c.label}</p>
              <p className="px-1 text-[10px] text-muted">{c.seconds}s</p>
              <div className="flex gap-0.5 p-1">
                <button
                  type="button"
                  className="h-7 flex-1 rounded-sm bg-elevated text-xs disabled:opacity-40"
                  disabled={busy || i === 0}
                  onClick={() => swap(i, i - 1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="h-7 flex-1 rounded-sm bg-elevated text-xs disabled:opacity-40"
                  disabled={busy || i === line.length - 1}
                  onClick={() => swap(i, i + 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  className="h-7 flex-1 rounded-sm bg-danger text-xs text-fg"
                  disabled={busy}
                  onClick={() => void commit(line.filter((x) => x.id !== c.id))}
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
