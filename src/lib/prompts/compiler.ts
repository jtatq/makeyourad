import { categoryLabel } from "../categories";
import { spokenPlace, spokenState } from "../intake";
import { extractProductScript, slotScripts } from "../script";
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
  const script = extractProductScript(intake.brief, productId);
  const beats = slotScripts(script, productId);
  const slotScript = beats[slot.id] || "";
  const vars: Record<string, string> = {
    business_name: intake.businessName,
    category: categoryLabel(intake.category),
    city: intake.city,
    state: spokenState(intake.state),
    place: spokenPlace(intake.city, intake.state),
    phone: intake.phone,
    email: intake.email,
    website: intake.website?.trim() || "(none given)",
    brief: script,
    script,
    slot_script: slotScript,
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
    `BUSINESS: {{business_name}} — {{category}} in {{place}}`,
    `PHONE: {{phone}}`,
    `WEBSITE: {{website}}`,
    `TONE: {{tone}} — {{tone_direction}}`,
    `PICTURE: {{tone_picture}}`,
    `VO: {{tone_vo}}`,
    `MUSIC: {{tone_music}}`,
    `VISUAL WORLD: {{visual_world}}`,
    `EXACT SCRIPT — these are the words to speak, not a theme or idea. Do not paraphrase, summarize, or write a new line. Never say how long the ad is — never "twelve seconds", "twenty seconds", or "forty seconds":`,
    `{{script}}`,
    `THIS SLOT, verbatim: {{slot_script}}`,
    `{{website_block}}`,
    `ASPECT RATIO PRIORITY: {{ratios}} (produce master at the first ratio, then reframe).`,
    `Use the customer's uploaded photos/logo as primary source. Do not invent a different business.`,
  ].join("\n");

  const bodies: Record<SlotId, string> = {
    hook: [
      header,
      `ROLE: ${slot.role}`,
      slotScript
        ? `Spoken line and captions, verbatim: "{{slot_script}}". Do not substitute a different hook.`
        : `First line of VO / captions, verbatim: "{{hook_line}}"`,
      `FORM: vertical talking-head commercial. One person (owner or tech from the uploaded photos if a face exists; otherwise a local tech in a branded shirt) stands in the driveway or at the storefront, facing camera, mid-speech.`,
      `BACKGROUND: the real job site, house, or vehicle from the uploaded photos. Do not invent a van, pool shape, or lettering that is not in the photos.`,
      `If direction asks for minimal / end-card text, on-screen type is business name and city only — do not burn the full VO as captions. Otherwise captions may match the spoken line. No logo bug, no phone number yet.`,
      `Natural sound + VO. Hard stop at {{slot_duration}}.`,
      `If they name the location, say "{{place}}". Never pronounce the state as letters — never "U.T.", "A.Z.", or any two-letter code. The state is the full word {{state}} only.`,
    ].join("\n"),
    mascot: [
      header,
      `ROLE: ${slot.role}`,
      `Character: {{mascot}}`,
      `The mascot is a standalone extra video, not cut into the 20s/40s master. Keep the design simple enough to animate consistently later. Match the tone. No horror, no celebrity likeness.`,
      `One beat: the character greets the viewer or notices the problem. End on the character — do not hand to the end card here.`,
      `Do not cover the end card here.`,
    ].join("\n"),
    body_1: [
      header,
      `ROLE: ${slot.role}`,
      slotScript
        ? `Spoken line and captions, verbatim: "{{slot_script}}". Continue the script — do not invent a new beat.`
        : `BEAT: {{body_1}}`,
      `Stay in the talking-head. Same person, same location language as the hook. They keep addressing the camera — proof, {{place}}, what they actually do.`,
      `If the uploads show the work (unit, roof, job site), you may cut to that for a beat, then return to the person.`,
      `VO continues the script. If direction asks for minimal text, do not burn the spoken words as captions.`,
      `Say "{{place}}" if they name the town — full state word {{state}}, never letters.`,
      mascot ? `Do not put the mascot in this clip. The mascot is a separate extra video.` : ``,
    ].join("\n"),
    body_2: [
      header,
      `ROLE: ${slot.role}`,
      slotScript ? `Spoken line, verbatim: "{{slot_script}}"` : `BEAT: {{body_2}}`,
      `This is the work itself — hands, tools, rooms, plates, care. Prefer uploaded photos over invented B-roll.`,
      `PROOF NOTE: {{proof}}`,
    ].join("\n"),
    body_3: [
      header,
      `ROLE: ${slot.role}`,
      slotScript ? `Spoken line, verbatim: "{{slot_script}}"` : `BEAT: {{body_3}}`,
      `Land the local proof. Name {{place}} as full words ({{state}}, never letters). Set up the end card; do not show the phone number until the end card unless it is already in a photo.`,
    ].join("\n"),
    end_card: [
      header,
      `ROLE: ${slot.role}`,
      `Hold a still-plus-motion end card long enough to read.`,
      `REQUIRED ON SCREEN:`,
      `• Logo (uploaded, prefer logo.png / logo.jpg / logo.svg) if present, else wordmark "{{business_name}}"`,
      `• Business name: {{business_name}}`,
      `• City: {{place}}`,
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
      `REQUIRED: logo or wordmark, {{business_name}}, {{place}}, {{phone}}, CTA "{{cta}}"`,
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
  if (mascot) notes.push("Mascot is an add-on extra video, delivered beside the stitched 20s/40s master — not edited into it.");
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
