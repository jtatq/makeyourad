import { categoryLabel } from "../categories";
import { PRODUCTS, type Platform, type ProductId, type Tone } from "../products";
import { aspectRatioPriority, recipeSlots, recipeSummary, type RecipeSlot, type SlotId } from "../recipe";
import type { WebsiteFacts } from "../website-profile";
import { getCategoryPack } from "./categories";
import { TONE_PACKS } from "./tones";

export type IntakeForPrompt = {
  businessName: string;
  category: string;
  city: string;
  state: string;
  website?: string | null;
  phone: string;
  email: string;
  brief: string;
  tone: Tone;
  platforms: Platform[];
  mascotDescription?: string | null;
  websiteProfile?: WebsiteFacts | null;
};

export type CompiledSlot = RecipeSlot & {
  prompt: string;
};

export type GenerationPacket = {
  order_id: string;
  product: ProductId;
  duration_seconds: number | null;
  add_ons: string[];
  price_cents: number;
  summary: string;
  intake: IntakeForPrompt & { category_label: string };
  website_profile: WebsiteFacts | null;
  assets: Array<{
    id: string;
    filename: string;
    mime: string;
    kind: string;
    signed_url: string;
  }>;
  platforms: Platform[];
  aspect_ratio_priority: ReturnType<typeof aspectRatioPriority>;
  recipe: {
    structure: string;
    slots: CompiledSlot[];
  };
  notes: string[];
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function websiteBlock(profile: WebsiteFacts | null | undefined): string {
  if (!profile?.sourceUrl) return "No website profile. Use only the intake fields and uploaded assets.";
  const lines = [
    "WEBSITE PROFILE (pulled from the live site — prefer these facts over generic category copy):",
    profile.tagline ? `Tagline: ${profile.tagline}` : "",
    profile.about ? `About: ${profile.about}` : "",
    profile.services?.length ? `Services: ${profile.services.join("; ")}` : "",
    profile.proofPoints?.length ? `Proof: ${profile.proofPoints.join("; ")}` : "",
    profile.hours ? `Hours: ${profile.hours}` : "",
    profile.serviceArea ? `Service area: ${profile.serviceArea}` : "",
    profile.cta ? `Their CTA: ${profile.cta}` : "",
    `Source: ${profile.sourceUrl}`,
    "Use the uploaded logo file (logo.png / logo.jpg / logo.svg) on the end card. Prefer website photos of the real shop, trucks, team, and work. Do not invent a different company.",
  ];
  return lines.filter(Boolean).join("\n");
}

function slotPrompt(slot: RecipeSlot, intake: IntakeForPrompt, mascot: boolean, productId: ProductId): string {
  const pack = getCategoryPack(intake.category);
  const tone = TONE_PACKS[intake.tone];
  const product = PRODUCTS[productId];
  const ratios = aspectRatioPriority(intake.platforms).join(", ");
  const vars: Record<string, string> = {
    business_name: intake.businessName,
    category: categoryLabel(intake.category),
    city: intake.city,
    state: intake.state,
    phone: intake.phone,
    email: intake.email,
    website: intake.website?.trim() || "(none given)",
    brief: intake.brief.trim(),
    tone: intake.tone,
    tone_direction: tone.direction,
    tone_vo: tone.vo,
    tone_picture: tone.picture,
    tone_music: tone.music,
    visual_world: pack.visualWorld,
    proof: pack.proof,
    cta: intake.websiteProfile?.cta?.trim() || pack.cta,
    hook_line: pack.hookLine[intake.tone],
    body_1: pack.bodyBeats[0],
    body_2: pack.bodyBeats[1],
    body_3: pack.bodyBeats[2],
    mascot: intake.mascotDescription?.trim() || "a simple, memorable character that can recur in future ads",
    duration: product.durationSeconds ? `${product.durationSeconds} seconds` : "still",
    ratios,
    slot_duration: slot.duration,
    website_block: websiteBlock(intake.websiteProfile),
  };

  const header = [
    `SLOT: ${slot.label.toUpperCase()} (${slot.duration})`,
    `BUSINESS: {{business_name}} — {{category}} in {{city}}, {{state}}`,
    `PHONE: {{phone}}`,
    `WEBSITE: {{website}}`,
    `TONE: {{tone}} — {{tone_direction}}`,
    `PICTURE: {{tone_picture}}`,
    `VO: {{tone_vo}}`,
    `MUSIC: {{tone_music}}`,
    `VISUAL WORLD: {{visual_world}}`,
    `CUSTOMER DIRECTION: {{brief}}`,
    `{{website_block}}`,
    `ASPECT RATIO PRIORITY: {{ratios}} (produce master at the first ratio, then reframe).`,
    `Use the customer's uploaded photos/logo as primary source. Do not invent a different business.`,
  ].join("\n");

  const bodies: Record<SlotId, string> = {
    hook: [
      header,
      `ROLE: ${slot.role}`,
      `First line of VO / captions, verbatim: "{{hook_line}}"`,
      `FORM: vertical talking-head commercial. One person (owner or tech from the uploaded photos if a face exists; otherwise a local tech in a branded shirt) stands in the driveway or at the storefront, facing camera, mid-speech.`,
      `BACKGROUND: their real van, truck, house, or shop from the uploads. Match wrap, logo, and shirt from the photos — do not invent lettering.`,
      `Captions sit at the bottom in clean white type on a dark bar, matching the spoken line. No logo bug, no phone number yet.`,
      `Natural sound + VO. Hard stop at {{slot_duration}}.`,
    ].join("\n"),
    mascot: [
      header,
      `ROLE: ${slot.role}`,
      `Character: {{mascot}}`,
      `The mascot appears after the hook as a recurring figure for this business. Keep the design simple enough to animate consistently later. Match the tone. No horror, no celebrity likeness.`,
      `One beat: mascot notices the problem or welcomes the viewer, then yields to the work footage.`,
      `Do not cover the end card here.`,
    ].join("\n"),
    body_1: [
      header,
      `ROLE: ${slot.role}`,
      `BEAT: {{body_1}}`,
      `Stay in the talking-head. Same person, same location language as the hook. They keep addressing the camera — proof, city, what they actually do.`,
      `If the uploads show the work (unit, roof, job site), you may cut to that for a beat, then return to the person.`,
      `VO continues the hook; do not repeat the hook line. Captions match VO.`,
      mascot ? `The mascot may cameo in a corner, but the speaker is the subject.` : ``,
    ].join("\n"),
    body_2: [
      header,
      `ROLE: ${slot.role}`,
      `BEAT: {{body_2}}`,
      `This is the work itself — hands, tools, rooms, plates, care. Prefer uploaded photos over invented B-roll.`,
      `PROOF NOTE: {{proof}}`,
    ].join("\n"),
    body_3: [
      header,
      `ROLE: ${slot.role}`,
      `BEAT: {{body_3}}`,
      `Land the local proof. Name {{city}}. Set up the end card; do not show the phone number until the end card unless it is already in a photo.`,
    ].join("\n"),
    end_card: [
      header,
      `ROLE: ${slot.role}`,
      `Hold a still-plus-motion end card long enough to read.`,
      `REQUIRED ON SCREEN:`,
      `• Logo (uploaded, prefer logo.png / logo.jpg / logo.svg) if present, else wordmark "{{business_name}}"`,
      `• Business name: {{business_name}}`,
      `• City: {{city}}, {{state}}`,
      `• CTA: {{cta}}`,
      `• Phone: {{phone}}`,
      `Optional: {{website}}`,
      `Do not add a website we did not receive. Do not add a different phone number.`,
      `Grade to match the rest of the ad. No extra slogans.`,
    ].join("\n"),
    static: [
      header,
      `ROLE: ${slot.role}`,
      `Compose one still that could also work as a paused video frame.`,
      `Hero: best customer photo, or a clean scene in the visual world if photos are only logos.`,
      `Copy, short: "{{hook_line}}"`,
      `REQUIRED: logo or wordmark, {{business_name}}, {{city}}, {{state}}, {{phone}}, CTA "{{cta}}"`,
      `Export three crops from the same composition: 9:16, 1:1, 16:9. Keep name and phone inside every safe area.`,
      `Tone grade: {{tone_picture}}`,
    ].join("\n"),
  };

  return fill(bodies[slot.id], vars).replace(/\n{3,}/g, "\n\n").trim();
}

export function compileRecipe(opts: {
  productId: ProductId;
  mascot: boolean;
  intake: IntakeForPrompt;
}): { structure: string; slots: CompiledSlot[] } {
  const slots = recipeSlots({ productId: opts.productId, mascot: opts.mascot });
  return {
    structure: recipeSummary(opts.productId, opts.mascot, opts.intake.tone),
    slots: slots.map((slot) => ({
      ...slot,
      prompt: slotPrompt(slot, opts.intake, opts.mascot, opts.productId),
    })),
  };
}

export function buildPacket(opts: {
  orderId: string;
  productId: ProductId;
  addOns: string[];
  priceCents: number;
  intake: IntakeForPrompt;
  assets: GenerationPacket["assets"];
}): GenerationPacket {
  const mascot = opts.addOns.includes("mascot");
  const recipe = compileRecipe({
    productId: opts.productId,
    mascot,
    intake: opts.intake,
  });
  const notes = [
    "Do not mention how the ad is made. The customer is buying a finished ad.",
    "Customer owns the finished ad outright.",
    "QC must confirm names, phone, and city are correct before delivery.",
    `Primary aspect: ${aspectRatioPriority(opts.intake.platforms)[0]}.`,
  ];
  if (mascot) notes.push("Mascot is an add-on — it must appear as its own clip (video) or as a character in the still.");
  if (opts.intake.websiteProfile?.sourceUrl) {
    notes.push("Logo and photos were pulled from the business website. Keep their real branding.");
  }
  return {
    order_id: opts.orderId,
    product: opts.productId,
    duration_seconds: PRODUCTS[opts.productId].durationSeconds,
    add_ons: opts.addOns,
    price_cents: opts.priceCents,
    summary: recipe.structure,
    intake: { ...opts.intake, category_label: categoryLabel(opts.intake.category) },
    website_profile: opts.intake.websiteProfile ?? null,
    assets: opts.assets,
    platforms: opts.intake.platforms,
    aspect_ratio_priority: aspectRatioPriority(opts.intake.platforms),
    recipe,
    notes,
  };
}
