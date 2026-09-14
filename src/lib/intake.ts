import { z } from "zod";
import { CATEGORY_IDS } from "./categories";
import { PLATFORMS, PRODUCT_IDS, TONES } from "./products";
import { websiteFactsSchema } from "./website-profile";

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
] as const;

export const STATE_FULL_NAME: Record<(typeof US_STATES)[number], string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

/** Spoken state. Never two-letter codes — "Utah", never "U.T." or "UT". */
export function spokenState(state: string): string {
  const raw = state.trim();
  const code = raw.toUpperCase().replace(/\./g, "");
  if (code in STATE_FULL_NAME) return STATE_FULL_NAME[code as keyof typeof STATE_FULL_NAME];
  const named = Object.values(STATE_FULL_NAME).find((n) => n.toLowerCase() === raw.toLowerCase());
  return named || raw;
}

export function spokenPlace(city: string, state: string): string {
  const c = city.trim();
  const s = spokenState(state);
  if (c && s) return `${c}, ${s}`;
  return c || s;
}

const assetSchema = z.object({
  filename: z.string().min(1).max(180),
  mime: z.string().min(1).max(80),
  dataUrl: z.string().min(20).max(2_500_000),
  kind: z.enum(["upload", "logo"]).optional(),
});

const categoryEnum = z.enum(CATEGORY_IDS as unknown as [string, ...string[]]);

export const checkoutInputSchema = z.object({
  product: z.enum(PRODUCT_IDS),
  mascot: z.boolean(),
  mascotDescription: z.string().max(280).optional(),
  businessName: z.string().trim().min(2).max(80),
  category: categoryEnum,
  city: z.string().trim().min(2).max(60),
  state: z.enum(US_STATES),
  website: z.string().trim().max(200).optional(),
  phone: z.string().trim().min(7).max(32),
  email: z.email().max(120),
  brief: z.string().trim().min(12).max(1200),
  tone: z.enum(TONES),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  assets: z.array(assetSchema).min(1, "Add at least a logo or one photo.").max(8),
  websiteProfile: websiteFactsSchema.optional(),
});

export const waitlistSchema = z.object({
  email: z.email().max(120),
  name: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  likenessAck: z.literal(true),
});
