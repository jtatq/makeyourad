import type { Platform, ProductId, Tone } from "./products";

export type SlotId = "hook" | "mascot" | "body_1" | "body_2" | "body_3" | "end_card" | "static";

export type RecipeSlot = {
  id: SlotId;
  label: string;
  duration: string;
  role: string;
};

export type AspectRatio = "9:16" | "1:1" | "16:9";

const PLATFORM_ASPECT: Record<Platform, AspectRatio[]> = {
  tiktok: ["9:16", "1:1", "16:9"],
  instagram: ["9:16", "1:1", "16:9"],
  facebook: ["1:1", "9:16", "16:9"],
  youtube: ["16:9", "1:1", "9:16"],
};

export function aspectRatioPriority(platforms: Platform[]): AspectRatio[] {
  const seen = new Set<AspectRatio>();
  const out: AspectRatio[] = [];
  const list = platforms.length > 0 ? platforms : (["instagram", "facebook", "tiktok", "youtube"] as Platform[]);
  for (const p of list) {
    for (const ratio of PLATFORM_ASPECT[p]) {
      if (!seen.has(ratio)) {
        seen.add(ratio);
        out.push(ratio);
      }
    }
  }
  return out;
}

const SPOT_ROLE =
  "ONE CONTINUOUS SPOT. Same room, same person, same light, same music bed from first frame through the last. Speak the full script. In the last three seconds hold and super name and city (full state word). Super a phone only when a real number was provided — never invent digits, addresses, or contact scrap. Super CTA if provided. Do not cut to a separate end-card graphic. Never say how long the ad is.";

export function recipeSlots(opts: {
  productId: ProductId;
  mascot: boolean;
}): RecipeSlot[] {
  if (opts.productId === "static") {
    return [
      {
        id: "static",
        label: "Still (three sizes)",
        duration: "still",
        role: "One composed still, exported 9:16, 1:1, and 16:9.",
      },
    ];
  }

  const duration = opts.productId === "video-40" ? "40s" : opts.productId === "video-12" ? "12s" : "20s";
  const spot: RecipeSlot = {
    id: "hook",
    label: "Spot",
    duration,
    role: SPOT_ROLE,
  };
  const mascot: RecipeSlot = {
    id: "mascot",
    label: "Mascot (extra)",
    duration: "6s",
    role: "Standalone mascot spot. Delivered as its own video — not cut into the master.",
  };
  return opts.mascot ? [spot, mascot] : [spot];
}

export function recipeSummary(productId: ProductId, mascot: boolean, tone: Tone): string {
  if (productId === "static") {
    return `Static ad · ${tone} · one still in 9:16, 1:1, and 16:9.`;
  }
  const seconds = productId === "video-40" ? 40 : productId === "video-12" ? 12 : 20;
  return `${seconds}s one-shot · ${tone} · full script, music through the end card.${mascot ? " Mascot is a separate extra video." : ""}`;
}

export type StitchClip = { id: Exclude<SlotId, "mascot" | "static">; seconds: number };

/** Main-timeline clips. One-shot spots are a single hook. */
export function masterClips(productId: ProductId): StitchClip[] {
  if (productId === "static") return [];
  const seconds = productId === "video-40" ? 40 : productId === "video-12" ? 12 : 20;
  return [{ id: "hook", seconds }];
}

export function isMasterSlot(id: SlotId): boolean {
  return id !== "mascot" && id !== "static";
}
