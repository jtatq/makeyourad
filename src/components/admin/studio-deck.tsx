import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { TimelineClip } from "@/lib/generate-ad.server";
import type { SlotId } from "@/lib/recipe";

export type StudioTake = {
  slotId: SlotId | string;
  label: string;
  url?: string;
  stillUrl?: string;
  seconds: number;
  status: string;
  extra?: boolean;
};

type Props = {
  takes: StudioTake[];
  timeline: TimelineClip[];
  targetSeconds: number;
  masterUrl?: string;
  busy: boolean;
  stitching?: boolean;
  canGenerate: boolean;
  onSave: (clips: TimelineClip[]) => Promise<void>;
  onCutFromLibrary: (slotId: string) => void;
  onReshoot: (slotId: string, note: string) => void;
  onStitch: () => void;
  onGenerate: () => void;
  generateLabel: string;
  direction: string;
  onDirection: (value: string) => void;
  onApplyDirection: () => void;
};

function nid() {
  return `tl_${Math.random().toString(36).slice(2, 10)}`;
}

function fmt(seconds: number) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function StudioDeck({
  takes,
  timeline,
  targetSeconds,
  masterUrl,
  busy,
  stitching,
  canGenerate,
  onSave,
  onCutFromLibrary,
  onReshoot,
  onStitch,
  onGenerate,
  generateLabel,
  direction,
  onDirection,
  onApplyDirection,
}: Props) {
  const [line, setLine] = useState<TimelineClip[]>(timeline);
  const [selected, setSelected] = useState<string | null>(takes.find((t) => t.url)?.slotId.toString() ?? null);
  const [mode, setMode] = useState<"take" | "sequence" | "master">(masterUrl ? "master" : "take");
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const [clock, setClock] = useState(0);
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState<{ kind: "take" | "line"; id: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setLine(timeline);
  }, [timeline]);

  const readyTakes = takes.filter((t) => t.url);
  const selectedTake = takes.find((t) => String(t.slotId) === selected);
  const total = line.reduce((n, c) => n + c.seconds, 0);
  const over = total - targetSeconds;
  const used = new Set(line.map((c) => c.slotId));

  const sequenceSrc = useMemo(() => {
    if (mode === "master" && masterUrl) return masterUrl;
    if (mode === "sequence" && line[playIndex]) return line[playIndex].url;
    return selectedTake?.url || selectedTake?.stillUrl || masterUrl || "";
  }, [mode, masterUrl, line, playIndex, selectedTake]);

  async function commit(next: TimelineClip[]) {
    setLine(next);
    await onSave(next);
  }

  function addTake(t: StudioTake, at?: number) {
    if (busy || !t.url) return;
    const clip: TimelineClip = {
      id: nid(),
      slotId: String(t.slotId),
      label: t.label,
      url: t.url,
      stillUrl: t.stillUrl,
      seconds: t.seconds,
    };
    const next = [...line];
    if (at == null || at < 0 || at > next.length) next.push(clip);
    else next.splice(at, 0, clip);
    void commit(next);
    setMode("sequence");
  }

  function loadRecipe() {
    const order = ["hook", "body_1", "body_2", "body_3", "end_card"];
    const next = order
      .map((id) => readyTakes.find((t) => String(t.slotId) === id && !t.extra))
      .filter((t): t is StudioTake => Boolean(t?.url))
      .map((t) => ({
        id: nid(),
        slotId: String(t.slotId),
        label: t.label,
        url: t.url!,
        stillUrl: t.stillUrl,
        seconds: t.seconds,
      }));
    void commit(next);
    setMode("sequence");
  }

  function fitTarget() {
    if (line.length === 0) return;
    const sum = line.reduce((n, c) => n + c.seconds, 0) || 1;
    const next = line.map((c) => ({
      ...c,
      seconds: Math.max(2, Math.round((c.seconds / sum) * targetSeconds)),
    }));
    const diff = targetSeconds - next.reduce((n, c) => n + c.seconds, 0);
    next[next.length - 1] = {
      ...next[next.length - 1],
      seconds: Math.max(2, next[next.length - 1].seconds + diff),
    };
    void commit(next);
  }

  function setSeconds(id: string, seconds: number) {
    void commit(line.map((c) => (c.id === id ? { ...c, seconds: Math.max(2, Math.min(15, seconds)) } : c)));
  }

  function swap(i: number, j: number) {
    if (j < 0 || j >= line.length) return;
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
      moveLine(line.findIndex((c) => c.id === drag.id), index);
    }
    setDrag(null);
  }

  function playSequence() {
    if (line.length === 0) return;
    setMode("sequence");
    setPlayIndex(0);
    setClock(0);
    setPlaying(true);
  }

  useEffect(() => {
    const el = videoRef.current;
    if (!el || mode !== "sequence" || !playing) return;
    const clip = line[playIndex];
    if (!clip) {
      setPlaying(false);
      return;
    }
    if (el.getAttribute("src") !== clip.url) {
      el.src = clip.url;
      el.load();
    }
    el.currentTime = 0;
    void el.play().catch(() => setPlaying(false));
  }, [mode, playing, playIndex, line]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !playing) return;
    const onTime = () => {
      const clip = line[playIndex];
      const prefix = line.slice(0, playIndex).reduce((n, c) => n + c.seconds, 0);
      const local = el.currentTime;
      setClock(prefix + local);
      if (clip && local >= clip.seconds - 0.05) {
        if (playIndex + 1 < line.length) setPlayIndex((i) => i + 1);
        else {
          setPlaying(false);
          setClock(total);
        }
      }
    };
    const onEnded = () => {
      if (playIndex + 1 < line.length) setPlayIndex((i) => i + 1);
      else setPlaying(false);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
    };
  }, [playing, playIndex, line, total]);

  const playheadPct = Math.min(100, (clock / Math.max(targetSeconds, total, 1)) * 100);
  const monitorIsVideo = Boolean(sequenceSrc) && !sequenceSrc.startsWith("data:image") && (mode !== "take" || Boolean(selectedTake?.url));

  return (
    <section className="panel min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <p className="font-display text-xl">Studio</p>
          <p className="text-xs uppercase tracking-wider text-muted">
            {targetSeconds}s master · {fmt(total)} on the timeline · one 15s video per generate
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!canGenerate || busy} onClick={onGenerate}>
            {generateLabel}
          </Button>
          <Button size="sm" disabled={busy || line.length === 0} onClick={onStitch}>
            {stitching ? "Stitching…" : `Master ${targetSeconds}s`}
          </Button>
        </div>
      </header>

      <div className="border-b border-border px-4 py-4 sm:px-5">
        <p className="text-xs uppercase tracking-wider text-muted">Direction change</p>
        <p className="mt-1 text-sm text-muted">
          Full script renders as one spot. Restage without rewriting copy — lighting, pace, hold the end card, keep the
          same music.
        </p>
        <Textarea
          className="mt-3"
          rows={3}
          value={direction}
          onChange={(e) => onDirection(e.target.value)}
          placeholder="e.g. Same room and piano bed through the end card. Warmer light. Speak slower. Super the phone last."
        />
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          disabled={busy || !canGenerate || direction.trim().length < 4}
          onClick={onApplyDirection}
        >
          Apply direction
        </Button>
      </div>

      <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col border-b border-border bg-bg lg:border-b-0 lg:border-r">
          <div className="relative mx-auto flex min-h-64 w-full max-w-xs items-center justify-center bg-bg">
            {monitorIsVideo ? (
              <video
                ref={videoRef}
                key={mode === "master" ? masterUrl : mode === "take" ? selectedTake?.url : "seq"}
                src={mode === "sequence" ? undefined : sequenceSrc}
                className="max-h-96 w-full bg-bg object-contain"
                controls={mode !== "sequence"}
                playsInline
                onPlay={() => {
                  if (mode !== "sequence") setPlaying(false);
                }}
              />
            ) : selectedTake?.stillUrl ? (
              <img src={selectedTake.stillUrl} alt="" className="max-h-96 w-full object-contain" />
            ) : (
              <p className="px-6 text-center text-sm text-muted">Play a take or the sequence in this monitor.</p>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={line.length === 0}
              onClick={() => (playing ? setPlaying(false) : playSequence())}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              <span className="ml-2">{playing ? "Stop" : "Play sequence"}</span>
            </Button>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted">
              {fmt(clock)} / {fmt(targetSeconds)}
            </span>
          </div>
          {masterUrl ? (
            <button
              type="button"
              className={`px-3 py-2 text-left text-xs uppercase tracking-wider ${mode === "master" ? "bg-elevated text-fg" : "text-muted"}`}
              onClick={() => {
                setMode("master");
                setPlaying(false);
              }}
            >
              Watch master
            </button>
          ) : null}
        </div>

        <div className="min-w-0 p-4">
          <p className="text-xs uppercase tracking-wider text-muted">Takes</p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 lg:overflow-visible">
            {takes.length === 0 ? (
              <p className="text-sm text-muted">Generate to fill the bin.</p>
            ) : (
              takes.map((t) => {
                const onLine = used.has(String(t.slotId));
                const active = selected === String(t.slotId);
                return (
                  <div
                    key={String(t.slotId)}
                    draggable={Boolean(t.url) && !busy}
                    onDragStart={() => t.url && setDrag({ kind: "take", id: String(t.slotId) })}
                    onDragEnd={() => setDrag(null)}
                    className={`w-36 shrink-0 overflow-hidden rounded-md bg-elevated lg:w-auto ${active ? "ring-2 ring-primary" : ""} ${onLine ? "opacity-80" : ""}`}
                  >
                    <button
                      type="button"
                      className="block w-full"
                      onClick={() => {
                        setSelected(String(t.slotId));
                        setMode("take");
                        setPlaying(false);
                      }}
                    >
                      {t.url ? (
                        <video src={t.url} className="h-24 w-full object-cover" muted playsInline />
                      ) : t.stillUrl ? (
                        <img src={t.stillUrl} alt="" className="h-24 w-full object-cover" />
                      ) : (
                        <div className="flex h-24 items-center justify-center text-xs text-muted">{t.status}</div>
                      )}
                    </button>
                    <div className="px-2 py-1.5">
                      <p className="truncate text-sm">{t.label}</p>
                      <p className="text-xs uppercase tracking-wider text-muted">
                        {t.url ? `${t.seconds}s` : t.status}
                        {t.extra ? " · extra" : ""}
                        {onLine ? " · on timeline" : ""}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-1 p-1.5">
                      <Button size="sm" variant="secondary" disabled={busy || !t.url} onClick={() => addTake(t)}>
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy || !t.url}
                        onClick={() => onCutFromLibrary(String(t.slotId))}
                      >
                        <Scissors className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {selectedTake ? (
            <div className="mt-4 grid gap-2">
              <Textarea
                rows={2}
                placeholder={
                  selectedTake.slotId === "hook"
                    ? "Reshoot note · Pronounce Heber City, Utah — never U.T."
                    : "Reshoot note for this take"
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !canGenerate}
                onClick={() => onReshoot(String(selectedTake.slotId), note)}
              >
                Reshoot {selectedTake.label.toLowerCase()}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted">Final clip</p>
            <p className={`font-mono text-sm tabular-nums ${Math.abs(over) < 0.6 ? "text-ok" : over > 0 ? "text-warn" : "text-muted"}`}>
              {fmt(total)} of {fmt(targetSeconds)}
              {over > 0.4 ? ` · ${over.toFixed(0)}s long` : over < -0.4 ? ` · ${Math.abs(over).toFixed(0)}s short` : " · on length"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy || readyTakes.length === 0} onClick={loadRecipe}>
              Recipe order
            </Button>
            <Button size="sm" variant="secondary" disabled={busy || line.length === 0} onClick={fitTarget}>
              Fit to {targetSeconds}s
            </Button>
          </div>
        </div>

        <div
          className="relative mt-3 min-h-28 overflow-x-auto rounded-md bg-bg p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dropOnLine(line.length)}
        >
          <div className="mb-2 flex justify-between font-mono text-xs text-subtle">
            {Array.from({ length: Math.floor(targetSeconds / 5) + 1 }, (_, i) => (
              <span key={i}>{i * 5}s</span>
            ))}
          </div>
          <div className="relative flex min-h-20 items-stretch gap-1">
            {line.length === 0 ? (
              <p className="m-auto px-3 text-center text-sm text-muted">
                Drag takes here in play order. Cut this out deletes a take from the library.
              </p>
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
                  style={{ width: `${Math.max(8, (c.seconds / Math.max(targetSeconds, total)) * 100)}%` }}
                  className="min-w-16 overflow-hidden rounded-sm bg-surface"
                >
                  {c.stillUrl ? (
                    <img src={c.stillUrl} alt="" className="h-12 w-full object-cover" />
                  ) : (
                    <video src={c.url} className="h-12 w-full object-cover" muted playsInline />
                  )}
                  <p className="truncate px-1.5 pt-1 text-xs">{c.label}</p>
                  <div className="flex items-center gap-1 px-1 pb-1">
                    <button
                      type="button"
                      className="h-7 w-7 rounded-sm bg-elevated text-xs"
                      disabled={busy}
                      onClick={() => setSeconds(c.id, c.seconds - 1)}
                    >
                      −
                    </button>
                    <span className="flex-1 text-center font-mono text-xs tabular-nums">{c.seconds}s</span>
                    <button
                      type="button"
                      className="h-7 w-7 rounded-sm bg-elevated text-xs"
                      disabled={busy}
                      onClick={() => setSeconds(c.id, c.seconds + 1)}
                    >
                      +
                    </button>
                  </div>
                  <div className="flex gap-1 p-1">
                    <button
                      type="button"
                      className="h-8 flex-1 rounded-sm bg-elevated text-xs"
                      disabled={busy || i === 0}
                      onClick={() => swap(i, i - 1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="h-8 flex-1 rounded-sm bg-elevated text-xs"
                      disabled={busy || i === line.length - 1}
                      onClick={() => swap(i, i + 1)}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-sm bg-danger"
                      disabled={busy}
                      onClick={() => void commit(line.filter((x) => x.id !== c.id))}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary"
              style={{ left: `${playheadPct}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
