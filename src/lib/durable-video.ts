import { signedFileUrl } from "./operator-auth.server.ts";

/** Hosts that hand out short-lived generator media. Public video URLs must not use them once bytes are stored. */
const EPHEMERAL_GENERATOR_HOSTS = ["vidgen.x.ai"];

export function isEphemeralGeneratorUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return EPHEMERAL_GENERATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export type FinishedVideoPlan = {
  /** Inline MP4 to store. Set when overlay or the caller already has the final bytes. */
  dataUrl: string | null;
  /** Remote file to download when dataUrl is empty. Never the post-overlay file. */
  fetchUrl: string | null;
  /**
   * Generator URL kept only as a private asset field for debugging.
   * Null unless the source is an ephemeral host. /api/files must serve stored bytes, not redirect here.
   */
  externalUrl: string | null;
};

/**
 * Decide what to persist when a video slot finishes.
 * A Sharp/ffmpeg overlay replaces the generator file; that composited MP4 is the one we store.
 */
export function planFinishedVideo(opts: {
  generatorUrl?: string | null;
  overlaidApplied: boolean;
  overlaidDataUrl?: string | null;
  providedDataUrl?: string | null;
}): FinishedVideoPlan {
  const generator = opts.generatorUrl?.trim() || null;
  const externalUrl = generator && isEphemeralGeneratorUrl(generator) ? generator : null;
  if (opts.overlaidApplied) {
    if (!opts.overlaidDataUrl?.startsWith("data:")) {
      throw new Error("Overlay finished without a video file");
    }
    return { dataUrl: opts.overlaidDataUrl, fetchUrl: null, externalUrl };
  }
  if (opts.providedDataUrl?.startsWith("data:")) {
    return { dataUrl: opts.providedDataUrl, fetchUrl: null, externalUrl };
  }
  if (generator && !generator.startsWith("data:")) {
    return { dataUrl: null, fetchUrl: generator, externalUrl };
  }
  if (generator?.startsWith("data:")) {
    return { dataUrl: generator, fetchUrl: null, externalUrl: null };
  }
  throw new Error("Finished video had no source file");
}

export function durableFileUrl(origin: string, assetId: string, days = 30): string {
  return signedFileUrl(origin.replace(/\/$/, ""), assetId, days);
}

/** Hide a generator URL once the asset row has the copied bytes. */
export function publicExternalUrl(externalUrl: string | null, hasData: boolean): string | null {
  if (hasData && isEphemeralGeneratorUrl(externalUrl)) return null;
  return externalUrl;
}

export function publicAssetUrl(opts: {
  origin: string;
  assetId: string;
  mime: string;
  hasData: boolean;
  externalUrl: string | null;
  inlineDataUrl?: string | null;
  days?: number;
}): string | null {
  const days = opts.days ?? 30;
  const video = opts.mime.startsWith("video/");
  if (opts.hasData && (video || isEphemeralGeneratorUrl(opts.externalUrl))) {
    return durableFileUrl(opts.origin, opts.assetId, days);
  }
  if (opts.externalUrl && /^https?:\/\//i.test(opts.externalUrl) && !isEphemeralGeneratorUrl(opts.externalUrl)) {
    return opts.externalUrl;
  }
  if (opts.externalUrl && !/^https?:\/\//i.test(opts.externalUrl)) {
    return opts.externalUrl;
  }
  if (
    !video &&
    opts.inlineDataUrl &&
    opts.inlineDataUrl.startsWith("data:") &&
    opts.inlineDataUrl.length < 1_500_000
  ) {
    return opts.inlineDataUrl;
  }
  if (video || opts.mime.startsWith("image/") || opts.hasData) {
    return durableFileUrl(opts.origin, opts.assetId, days);
  }
  return null;
}

export type PlaybackAsset = {
  id: string;
  mime: string;
  hasData: boolean;
  externalUrl?: string | null;
  dataUrl?: string | null;
};

/**
 * Swap a public video field to the signed MYA file when we already stored the MP4.
 * Leaves the original URL alone when there is no durable copy (older jobs).
 */
export function durablePlaybackUrl(
  url: string | null | undefined,
  assetIds: string[] | undefined,
  assets: PlaybackAsset[],
  origin: string,
  days = 30,
): string | null | undefined {
  if (!url) return url;
  const needsSwap = isEphemeralGeneratorUrl(url) || url.startsWith("data:video/");
  if (!needsSwap) return url;
  const videos = assets.filter((a) => a.hasData && a.mime.startsWith("video/"));
  const byId = (assetIds ?? []).find((id) => videos.some((a) => a.id === id));
  if (byId) return durableFileUrl(origin, byId, days);
  const bySource = videos.find(
    (a) => a.externalUrl === url || (url.startsWith("data:") && a.dataUrl === url),
  );
  if (bySource) return durableFileUrl(origin, bySource.id, days);
  return url;
}

type PresentSlot = { id: string; videoUrl?: string; assetIds?: string[] };

/** Job JSON returned to admin, operator, and share surfaces. */
export function presentGeneration<S extends PresentSlot, T extends {
  masterUrl?: string;
  mascotUrl?: string;
  slots: S[];
  timeline?: Array<{ url: string; slotId: string }>;
}>(job: T, assets: Array<{ id: string; mime: string; data_url: string | null; external_url: string | null }>, origin: string): T {
  const playable: PlaybackAsset[] = assets
    .filter((a) => a.mime.startsWith("video/") && Boolean(a.data_url))
    .map((a) => ({
      id: a.id,
      mime: a.mime,
      hasData: true,
      externalUrl: a.external_url,
      dataUrl: a.data_url,
    }));
  const urlFor = (url: string | undefined, assetIds?: string[]) =>
    durablePlaybackUrl(url, assetIds, playable, origin) ?? url;
  const slots = job.slots.map((slot) => ({
    ...slot,
    videoUrl: urlFor(slot.videoUrl, slot.assetIds),
  }));
  const mascot = slots.find((slot) => slot.id === "mascot");
  const timeline = job.timeline?.map((clip) => {
    const slot = slots.find((item) => item.id === clip.slotId);
    return { ...clip, url: urlFor(clip.url, slot?.assetIds) ?? clip.url };
  });
  return {
    ...job,
    slots,
    mascotUrl: urlFor(job.mascotUrl, mascot?.assetIds),
    masterUrl: urlFor(job.masterUrl),
    timeline,
  };
}

/** /api/files: stored bytes win over a redirect to a generator URL. */
export function fileServePlan(asset: { data_url: string | null; external_url: string | null }): "bytes" | "redirect" | "missing" {
  if (asset.data_url) return "bytes";
  if (asset.external_url) return "redirect";
  return "missing";
}
