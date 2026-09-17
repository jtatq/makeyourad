import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JOB_MAX_MS,
  STILL_HANDOFF_MS,
  VIDEO_WAIT_MS,
  detectGenerationTimeout,
  jobProgress,
  jobStopped,
  markJobCancelled,
  markJobFailed,
  orderOpenForGeneratePump,
  progressPhase,
  videoHasStarted,
  type ProgressJob,
} from "./generation-progress.ts";

function job(partial: Partial<ProgressJob> & { slots?: ProgressJob["slots"] }): ProgressJob {
  const now = "2026-09-17T02:00:00.000Z";
  return {
    status: "running",
    startedAt: now,
    updatedAt: now,
    slots: partial.slots ?? [
      { id: "hook", status: "queued", duration: 15 },
    ],
    ...partial,
  };
}

describe("generation progress", () => {
  it("reports still phase when a still is ready but video has not started", () => {
    const current = job({
      slots: [{ id: "hook", status: "still", stillUrl: "https://img.example/s.jpg", duration: 15 }],
    });
    assert.equal(progressPhase(current), "still");
    assert.equal(videoHasStarted(current.slots[0]), false);
    const progress = jobProgress(current, Date.parse(current.updatedAt));
    assert.equal(progress.phase, "still");
    assert.equal(progress.stillReady, true);
    assert.equal(progress.videoStarted, false);
    assert.equal(progress.timedOut, false);
  });

  it("reports video phase once a request id exists", () => {
    const current = job({
      slots: [
        {
          id: "hook",
          status: "video",
          stillUrl: "https://img.example/s.jpg",
          videoRequestId: "req_1",
          videoStartedAt: "2026-09-17T02:01:00.000Z",
          duration: 15,
        },
      ],
    });
    assert.equal(progressPhase(current), "video");
    const progress = jobProgress(current, Date.parse("2026-09-17T02:02:00.000Z"));
    assert.equal(progress.videoStarted, true);
    assert.equal(progress.videoRequestId, "req_1");
    assert.equal(progress.timedOut, false);
  });

  it("does not time out a fresh still waiting for the next tick", () => {
    const started = "2026-09-17T02:00:00.000Z";
    const current = job({
      startedAt: started,
      updatedAt: started,
      slots: [
        {
          id: "hook",
          status: "still",
          stillUrl: "https://img.example/s.jpg",
          claimedAt: started,
          duration: 15,
        },
      ],
    });
    assert.equal(detectGenerationTimeout(current, Date.parse(started) + 60_000), null);
  });

  it("fails fast when a still sits ready and video never starts", () => {
    const started = "2026-09-17T02:00:00.000Z";
    const current = job({
      startedAt: started,
      updatedAt: started,
      slots: [
        {
          id: "hook",
          status: "still",
          stillUrl: "https://img.example/s.jpg",
          claimedAt: started,
          duration: 15,
        },
      ],
    });
    const hit = detectGenerationTimeout(current, Date.parse(started) + STILL_HANDOFF_MS + 1);
    assert.ok(hit);
    assert.match(hit.message, /Video never started after still was ready/);
    assert.equal(hit.slotId, "hook");
  });

  it("times out an in-flight video after 18 minutes", () => {
    const started = "2026-09-17T02:00:00.000Z";
    const videoAt = "2026-09-17T02:01:00.000Z";
    const current = job({
      startedAt: started,
      updatedAt: videoAt,
      slots: [
        {
          id: "hook",
          status: "video",
          stillUrl: "https://img.example/s.jpg",
          videoRequestId: "req_1",
          videoStartedAt: videoAt,
          claimedAt: videoAt,
          duration: 15,
        },
      ],
    });
    assert.equal(detectGenerationTimeout(current, Date.parse(videoAt) + VIDEO_WAIT_MS - 1000), null);
    const hit = detectGenerationTimeout(current, Date.parse(videoAt) + VIDEO_WAIT_MS + 1);
    assert.ok(hit);
    assert.equal(hit.message, "Video timed out after 18 minutes");
  });

  it("uses job startedAt as a 20 minute backstop even if slot clocks are missing", () => {
    const started = "2026-09-17T02:00:00.000Z";
    const current = job({
      startedAt: started,
      updatedAt: started,
      slots: [{ id: "hook", status: "still", stillUrl: "https://img.example/s.jpg", duration: 15 }],
    });
    const hit = detectGenerationTimeout(current, Date.parse(started) + JOB_MAX_MS + 1);
    assert.ok(hit);
    assert.equal(hit.message, "Job timed out after 20 minutes");
  });

  it("marks a timed-out job error so clients stop polling as running", () => {
    const current = job({
      slots: [{ id: "hook", status: "still", stillUrl: "https://img.example/s.jpg", duration: 15 }],
    });
    const failed = markJobFailed(current, "Video never started after still was ready", "hook");
    assert.equal(failed.status, "error");
    assert.equal(failed.error, "Video never started after still was ready");
    assert.equal(failed.slots[0]?.status, "error");
    assert.equal(jobStopped(failed.status), true);
  });

  it("cancels a running job without wiping a finished take", () => {
    const current = job({
      slots: [
        { id: "hook", status: "video", stillUrl: "https://img.example/s.jpg", videoRequestId: "req_1", duration: 15 },
        { id: "mascot", status: "done", videoUrl: "https://vid.example/m.mp4", duration: 6 },
      ],
    });
    const cancelled = markJobCancelled(current);
    assert.equal(cancelled.status, "cancelled");
    assert.match(cancelled.error ?? "", /Cancelled/);
    assert.equal(cancelled.slots[0]?.status, "error");
    assert.equal(cancelled.slots[1]?.status, "done");
    assert.equal(progressPhase(cancelled), "cancelled");
    assert.equal(jobStopped(cancelled.status), true);
  });

  it("keeps remake_requested 20s orders on the generate pump", () => {
    assert.equal(orderOpenForGeneratePump({ product: "video-20", status: "paid" }), true);
    assert.equal(orderOpenForGeneratePump({ product: "video-20", status: "in_production" }), true);
    assert.equal(orderOpenForGeneratePump({ product: "video-20", status: "remake_requested" }), true);
    assert.equal(orderOpenForGeneratePump({ product: "video-20", status: "qc" }), false);
    assert.equal(orderOpenForGeneratePump({ product: "video-12", status: "in_production" }), false);
  });
});
