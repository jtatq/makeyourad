import { z } from "zod";
import { CATEGORY_IDS } from "./categories";
import { TONES, type Tone } from "./products";

export type WebsiteAsset = {
  filename: string;
  mime: string;
  dataUrl: string;
  role: "logo" | "photo";
};

/** Extra facts pulled from the live site — stored on the order for the generation packet. */
export type WebsiteFacts = {
  sourceUrl: string;
  tagline: string;
  about: string;
  services: string[];
  proofPoints: string[];
  hours: string;
  serviceArea: string;
  cta: string;
};

export type WebsiteProfile = WebsiteFacts & {
  businessName: string;
  category: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  brief: string;
  tone: Tone;
};

export const websiteFactsSchema = z.object({
  sourceUrl: z.string().trim().max(300),
  tagline: z.string().max(200).optional().default(""),
  about: z.string().max(800).optional().default(""),
  services: z.array(z.string().max(80)).max(12).optional().default([]),
  proofPoints: z.array(z.string().max(120)).max(8).optional().default([]),
  hours: z.string().max(200).optional().default(""),
  serviceArea: z.string().max(200).optional().default(""),
  cta: z.string().max(120).optional().default(""),
});

export const websiteReadInputSchema = z.object({
  url: z.string().trim().min(4).max(300),
});

export const websiteAssetSchema = z.object({
  filename: z.string().min(1).max(180),
  mime: z.string().min(1).max(80),
  dataUrl: z.string().min(20).max(2_500_000),
  role: z.enum(["logo", "photo"]),
});

export type WebsiteReadResult =
  | {
      ok: true;
      url: string;
      profile: WebsiteProfile;
      logo: WebsiteAsset | null;
      photos: WebsiteAsset[];
    }
  | { ok: false; error: string };

export const CATEGORY_ID_SET = new Set(CATEGORY_IDS);

export function factsFromProfile(profile: WebsiteProfile): WebsiteFacts {
  return {
    sourceUrl: profile.sourceUrl,
    tagline: profile.tagline,
    about: profile.about,
    services: profile.services,
    proofPoints: profile.proofPoints,
    hours: profile.hours,
    serviceArea: profile.serviceArea,
    cta: profile.cta,
  };
}

export function normalizeWebsiteUrl(raw: string): string {
  let s = raw.trim();
  if (!s) throw new Error("Paste a website.");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  const url = new URL(s);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an http or https website.");
  }
  return url.href;
}

export function isTone(value: string): value is Tone {
  return (TONES as readonly string[]).includes(value);
}

export function emptyFacts(sourceUrl = ""): WebsiteFacts {
  return {
    sourceUrl,
    tagline: "",
    about: "",
    services: [],
    proofPoints: [],
    hours: "",
    serviceArea: "",
    cta: "",
  };
}
