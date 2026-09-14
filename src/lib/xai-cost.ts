/** xAI Imagine rate card (USD cents). Image 2.0 2K medium + Video 1.5 1080p. */
export const IMAGE_2K_CENTS = 8;
export const IMAGE_INPUT_CENTS = 1;
export const VIDEO_1080P_CENTS_PER_SEC = 25;
export const VIDEO_IMAGE_INPUT_CENTS = 1;
export const DEFAULT_VIDEO_SECONDS = 15;

export function imageCallCents(usedReference: boolean): number {
  return IMAGE_2K_CENTS + (usedReference ? IMAGE_INPUT_CENTS : 0);
}

export function videoCallCents(seconds = DEFAULT_VIDEO_SECONDS): number {
  const s = Math.min(15, Math.max(1, Math.round(seconds || DEFAULT_VIDEO_SECONDS)));
  return s * VIDEO_1080P_CENTS_PER_SEC + VIDEO_IMAGE_INPUT_CENTS;
}

export function callCostCents(kind: string, path: string, method: string, status: number): number {
  if (status >= 400 || method.toUpperCase() !== "POST") return 0;
  if (kind === "image") return imageCallCents(path.includes("/edits"));
  if (kind === "video") return videoCallCents(DEFAULT_VIDEO_SECONDS);
  return 0;
}

export type CostTally = {
  stills: number;
  videos: number;
  imageCents: number;
  videoCents: number;
  totalCents: number;
};

export function emptyCost(): CostTally {
  return { stills: 0, videos: 0, imageCents: 0, videoCents: 0, totalCents: 0 };
}

export function addImage(tally: CostTally, usedReference: boolean): CostTally {
  const add = imageCallCents(usedReference);
  return {
    stills: tally.stills + 1,
    videos: tally.videos,
    imageCents: tally.imageCents + add,
    videoCents: tally.videoCents,
    totalCents: tally.totalCents + add,
  };
}

export function addVideo(tally: CostTally, seconds = DEFAULT_VIDEO_SECONDS): CostTally {
  const add = videoCallCents(seconds);
  return {
    stills: tally.stills,
    videos: tally.videos + 1,
    imageCents: tally.imageCents,
    videoCents: tally.videoCents + add,
    totalCents: tally.totalCents + add,
  };
}

export function estimateJobCost(job: {
  cost?: CostTally;
  slots?: Array<{ stillUrl?: string; videoUrl?: string; videoRequestId?: string; duration?: number | null }>;
}): CostTally {
  if (job.cost && job.cost.totalCents > 0) return job.cost;
  let tally = emptyCost();
  for (const s of job.slots ?? []) {
    if (s.stillUrl) tally = addImage(tally, false);
    if (s.videoUrl || s.videoRequestId) tally = addVideo(tally, s.duration ?? DEFAULT_VIDEO_SECONDS);
  }
  return tally;
}
