export const PRODUCT_IDS = ["video-40", "video-20", "static"] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

export const TONES = ["energetic", "trustworthy", "premium", "friendly"] as const;
export type Tone = (typeof TONES)[number];

export const PLATFORMS = ["instagram", "facebook", "tiktok", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const ORDER_STATUSES = [
  "paid",
  "in_production",
  "qc",
  "delivered",
  "needs_attention",
  "remake_requested",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const MASCOT_CENTS = 2500;
export const AVATAR_CENTS = 25000;

export type Product = {
  id: ProductId;
  name: string;
  shortName: string;
  priceCents: number;
  durationSeconds: number | null;
  kind: "video" | "static";
  blurb: string;
  includes: string[];
};

export const PRODUCTS: Record<ProductId, Product> = {
  "video-40": {
    id: "video-40",
    name: "40-second video ad",
    shortName: "40s video",
    priceCents: 10000,
    durationSeconds: 40,
    kind: "video",
    blurb: "Talking-head hook, three scenes from your photos, and an end card — stitched into one 40-second ad.",
    includes: ["40-second MP4", "9:16, 1:1, and 16:9", "End card with your info", "Delivered in 24 hours"],
  },
  "video-20": {
    id: "video-20",
    name: "20-second video ad",
    shortName: "20s video",
    priceCents: 5000,
    durationSeconds: 20,
    kind: "video",
    blurb: "A talking-head hook, one scene from your photos, and a clear end card — stitched into one 20-second ad.",
    includes: ["20-second MP4", "9:16, 1:1, and 16:9", "End card with your info", "Delivered in 24 hours"],
  },
  static: {
    id: "static",
    name: "Static ad",
    shortName: "Static ad",
    priceCents: 2500,
    durationSeconds: null,
    kind: "static",
    blurb: "One still, cut to three sizes so it fits Instagram, Facebook, TikTok, and YouTube.",
    includes: ["One image, three sizes", "9:16, 1:1, and 16:9", "Your logo, name, city, phone", "Delivered in 24 hours"],
  },
};

export const PRODUCT_LIST = PRODUCT_IDS.map((id) => PRODUCTS[id]);

export function isProductId(value: string): value is ProductId {
  return (PRODUCT_IDS as readonly string[]).includes(value);
}

export function priceCentsFor(productId: ProductId, mascot: boolean): number {
  return PRODUCTS[productId].priceCents + (mascot ? MASCOT_CENTS : 0);
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export const TONE_LABELS: Record<Tone, string> = {
  energetic: "Energetic",
  trustworthy: "Trustworthy",
  premium: "Premium",
  friendly: "Friendly",
};

export const TONE_HELP: Record<Tone, string> = {
  energetic: "Upbeat, quick cuts, a reason to act today.",
  trustworthy: "Calm, direct, no shouting. Feels like a neighbor.",
  premium: "Quiet, considered, high craft. Fewer words.",
  friendly: "Warm and easy. A smile without the hard sell.",
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  paid: "Paid",
  in_production: "In production",
  qc: "QC",
  delivered: "Delivered",
  needs_attention: "Needs attention",
  remake_requested: "Remake requested",
  refunded: "Refunded",
};
