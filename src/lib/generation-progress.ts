/** Timeouts and operator-facing progress for a generation job. */

export const STILL_HANDOFF_MS = 4 * 60 * 1000;
export const STILL_GEN_MS = 10 * 60 * 1000;
export const VIDEO_WAIT_MS = 18 * 60 * 1000;
export const JOB_MAX_MS = 20 * 60 * 1000;

export type JobProgressStatus = "idle" | "running" | "done" | "error" | "cancelled";
export type ProgressPhase = "queued" | "still" | "video" | "done" | "error" | "cancelled";

export type ProgressSlot = {
  id: string;
  status: string;
  stillUrl?: string;
  videoUrl?: string;
  videoRequestId?: string;
  videoStartedAt?: string;
  claimedAt?: string;
  duration?: number | null;
  error?: string;
};

export type ProgressJob = {
  status: JobProgressStatus;
  startedAt: string;
  updatedAt: string;
  error?: string;
  slots: ProgressSlot[];
};

export type GenerationTimeout = {
  timedOut: true;
  message: string;
  slotId?: string;
};

export type JobProgress = {
  phase: ProgressPhase;
  startedAt: string | null;
  updatedAt: string | null;
  timedOut: boolean;
  timeoutMessage: string | null;
  videoStarted: boolean;
  videoRequestId: string | null;
  stillReady: boolean;
};

export function ageMs(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return now - t;
}

export function activeSlot(job: ProgressJob): ProgressSlot | null {
  return job.slots.find((s) => s.status !== "done" && s.status !== "error" && s.status !== "cancelled") ?? job.slots[0] ?? null;
}

export function progressPhase(job: ProgressJob | null | undefined, slot?: ProgressSlot | null): ProgressPhase {
  if (!job) return "queued";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "error") return "error";
  if (job.status === "done") return "done";
  const s = slot ?? activeSlot(job);
  if (!s) return job.status === "idle" ? "queued" : "queued";
  if (s.status === "error" || s.status === "cancelled") return s.status === "cancelled" ? "cancelled" : "error";
  if (s.status === "done" && (s.videoUrl || !s.duration)) return "done";
  if (s.videoUrl) return "done";
  if (s.status === "video" || s.videoRequestId || s.videoStartedAt) return "video";
  if (s.status === "still" || s.stillUrl) return "still";
  return "queued";
}

export function videoHasStarted(slot: ProgressSlot | null | undefined): boolean {
  if (!slot) return false;
  return Boolean(slot.videoRequestId || slot.videoStartedAt || slot.videoUrl || slot.status === "video");
}

export function detectGenerationTimeout(job: ProgressJob, now = Date.now()): GenerationTimeout | null {
  if (job.status !== "running") return null;
  const jobAge = ageMs(job.startedAt, now);
  if (jobAge != null && jobAge > JOB_MAX_MS) {
    return { timedOut: true, message: "Job timed out after 20 minutes", slotId: activeSlot(job)?.id };
  }

  for (const slot of job.slots) {
    if (slot.status === "done" || slot.status === "error" || slot.status === "cancelled") continue;
    if (slot.videoUrl) continue;

    const startedVideo = videoHasStarted(slot);
    const videoAge = ageMs(slot.videoStartedAt || (startedVideo ? slot.claimedAt : undefined), now);
    if (startedVideo && videoAge != null && videoAge > VIDEO_WAIT_MS) {
      return { timedOut: true, message: "Video timed out after 18 minutes", slotId: slot.id };
    }

    if (slot.duration && slot.stillUrl && !startedVideo) {
      const handoffAge = ageMs(slot.claimedAt, now) ?? ageMs(job.updatedAt, now);
      if (handoffAge != null && handoffAge > STILL_HANDOFF_MS) {
        return {
          timedOut: true,
          message: "Video never started after still was ready",
          slotId: slot.id,
        };
      }
    }

    if ((slot.status === "queued" || slot.status === "still") && !slot.stillUrl) {
      const stillAge = ageMs(slot.claimedAt, now);
      if (stillAge != null && stillAge > STILL_GEN_MS) {
        return { timedOut: true, message: "Still timed out after 10 minutes", slotId: slot.id };
      }
    }
  }

  return null;
}

export function markJobFailed<T extends ProgressJob>(job: T, message: string, slotId?: string): T {
  const next = {
    ...job,
    status: "error" as const,
    error: message,
    slots: job.slots.map((s) => {
      if (slotId && s.id !== slotId) {
        if (s.status === "queued" || s.status === "still" || s.status === "video") {
          return { ...s, status: "error", error: message };
        }
        return s;
      }
      if (!slotId && (s.status === "done" || s.status === "error" || s.status === "cancelled")) return s;
      if (slotId && s.id !== slotId && s.status !== "queued" && s.status !== "still" && s.status !== "video") return s;
      if (s.status === "done") return s;
      return { ...s, status: "error" as const, error: message };
    }),
  };
  return next;
}

export function markJobCancelled<T extends ProgressJob>(job: T, reason = "Cancelled by operator"): T {
  return {
    ...job,
    status: "cancelled" as const,
    error: reason,
    slots: job.slots.map((s) => {
      if (s.status === "done") return s;
      return { ...s, status: "error" as const, error: reason };
    }),
  };
}

export function jobProgress(job: ProgressJob | null | undefined, now = Date.now()): JobProgress {
  if (!job) {
    return {
      phase: "queued",
      startedAt: null,
      updatedAt: null,
      timedOut: false,
      timeoutMessage: null,
      videoStarted: false,
      videoRequestId: null,
      stillReady: false,
    };
  }
  const slot = activeSlot(job);
  const timeout = detectGenerationTimeout(job, now);
  return {
    phase: progressPhase(job, slot),
    startedAt: job.startedAt ?? null,
    updatedAt: job.updatedAt ?? null,
    timedOut: Boolean(timeout) || /timed out|never started/i.test(job.error ?? ""),
    timeoutMessage: timeout?.message ?? (job.status === "error" && /timed out|never started/i.test(job.error ?? "") ? job.error ?? null : null),
    videoStarted: videoHasStarted(slot),
    videoRequestId: slot?.videoRequestId ?? null,
    stillReady: Boolean(slot?.stillUrl),
  };
}

/** Orders the droplet worker should keep ticking. Remakes used to be skipped forever. */
export function orderOpenForGeneratePump(order: { product: string; status: string }): boolean {
  if (order.product !== "video-20") return false;
  return order.status === "paid" || order.status === "in_production" || order.status === "remake_requested";
}

export function jobStopped(status: string | null | undefined): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}
