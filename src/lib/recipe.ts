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

  const hook: RecipeSlot = {
    id: "hook",
    label: "Hook",
    duration: opts.productId === "video-40" ? "5s" : "4s",
    role: "Talking-head open: owner or tech on camera in front of the truck, van, or house, speaking straight to the viewer.",
  };
  const mascot: RecipeSlot = {
    id: "mascot",
    label: "Mascot (extra)",
    duration: "6s",
    role: "Standalone mascot spot. Delivered as its own video — not cut into the 20s/40s master.",
  };
  const body = (n: 1 | 2 | 3, duration: string, role: string): RecipeSlot => ({
    id: `body_${n}`,
    label: `Body ${n}`,
    duration,
    role,
  });
  const end: RecipeSlot = {
    id: "end_card",
    label: "End card",
    duration: opts.productId === "video-40" ? "5s" : "6s",
    role: "Logo, business name, city, CTA, phone. Hold long enough to read.",
  };

  if (opts.productId === "video-20") {
    return [
      hook,
      body(1, "10s", "They keep talking — city, proof, what they do. Stay on the person or cut to work from their photos."),
      end,
      ...(opts.mascot ? [mascot] : []),
    ];
  }

  return [
    hook,
    body(1, "10s", "Talking-head continues: name the problem, then the promise."),
    body(2, "10s", "The work itself — still the same person, or a cut to their photos of the job."),
    body(3, "10s", "Local proof, city, then hand to the end card."),
    end,
    ...(opts.mascot ? [mascot] : []),
  ];
}

export function recipeSummary(productId: ProductId, mascot: boolean, tone: Tone): string {
  if (productId === "static") {
    return `Static ad · ${tone} · one still in 9:16, 1:1, and 16:9.`;
  }
  const seconds = productId === "video-40" ? 40 : 20;
  const bodies = productId === "video-40" ? "hook + 3 body clips + end card, stitched to 40s" : "hook + 1 body clip + end card, stitched to 20s";
  const extra = mascot ? " Mascot is a separate extra video." : "";
  return `${seconds}s video · ${tone} · ${bodies}.${extra}`;
}

export type StitchClip = { id: Exclude<SlotId, "mascot" | "static">; seconds: number };

/** Main-timeline clips that concat to the paid 20s / 40s master. Mascot is not included. */
export function masterClips(productId: ProductId): StitchClip[] {
  if (productId === "static") return [];
  if (productId === "video-20") {
    return [
      { id: "hook", seconds: 4 },
      { id: "body_1", seconds: 10 },
      { id: "end_card", seconds: 6 },
    ];
  }
  return [
    { id: "hook", seconds: 5 },
    { id: "body_1", seconds: 10 },
    { id: "body_2", seconds: 10 },
    { id: "body_3", seconds: 10 },
    { id: "end_card", seconds: 5 },
  ];
}

export function isMasterSlot(id: SlotId): boolean {
  return id !== "mascot" && id !== "static";
}
