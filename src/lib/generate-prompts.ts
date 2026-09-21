/** Still / motion prompt builders. Type-guard text is injected once in continuityLine. */

import { TONE_PACKS } from "./prompts/tones.ts";
import type { Tone } from "./products.ts";
import {
  directionShownToModel,
  endCardTypeInstruction,
  motionScriptInstruction,
  onScreenMode,
  onScreenTypeGuard,
  spokenScriptInstruction,
  stillEndCardTypeInstruction,
} from "./generate-direction.ts";
import {
  hasTextOverlay,
  promptRoleForOverlay,
  videoDirectionForModel,
  type TextOverlaySpec,
} from "./text-overlay.ts";
import {
  applyVideoDirection,
  pictureContinuityInstruction,
  stillUsesDirectedOpening,
} from "./video-direction.ts";
import { referencePromptBlock } from "./generate-refs.ts";

export type PromptSlot = {
  id: string;
  label: string;
  role: string;
};

export type PromptPacket = {
  intake: {
    businessName: string;
    category_label: string;
    city: string;
    state: string;
    phone: string;
    brief: string;
    tone: Tone;
    mascotDescription?: string | null;
  };
  website_profile: {
    cta?: string | null;
    tagline?: string | null;
    services?: string[] | null;
    about?: string | null;
  } | null;
  recipe: { structure: string };
  assets: Array<{ kind: string; filename: string }>;
  /** Spoken VO only — caller must strip shot-list / overlay tags. */
  script: string;
};

const STATE_FULL_NAME: Record<string, string> = {
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

function spokenPlace(city: string, state: string): string {
  const raw = state.trim();
  const code = raw.toUpperCase().replace(/\./g, "");
  const named =
    STATE_FULL_NAME[code] ||
    Object.values(STATE_FULL_NAME).find((n) => n.toLowerCase() === raw.toLowerCase()) ||
    raw;
  const c = city.trim();
  if (c && named) return `${c}, ${named}`;
  return c || named;
}

export function continuityLine(
  packet: PromptPacket,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
): string {
  const i = packet.intake;
  const cta = packet.website_profile?.cta || "Call today";
  const music = TONE_PACKS[i.tone].music;
  const dir = direction?.trim();
  const visual = videoDirectionForModel(videoDirection, overlay);
  const endType = endCardTypeInstruction(
    onScreenMode(dir),
    {
      businessName: i.businessName,
      place: spokenPlace(i.city, i.state),
      phone: i.phone,
      cta,
    },
    overlay,
  );
  return [
    pictureContinuityInstruction(visual),
    `Music: ${music} One bed from frame one through the last frame — never restart, never drop out on the end card.`,
    endType,
    onScreenTypeGuard(i.phone, overlay),
    "Never speak the ad length. Never say twelve seconds, twenty seconds, or forty seconds.",
    dir
      ? `DIRECTION CHANGE (this overrides the previous take): ${directionShownToModel(dir, overlay)}`
      : "",
    "This is the customer-facing ad. Do not mention geofences, grocery or retail anchors, household income, age ranges, pilates studios, golf communities, or any media-buy targeting.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function stillPrompt(
  packet: PromptPacket,
  slot: PromptSlot,
  ratio: string,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
) {
  const i = packet.intake;
  const site = packet.website_profile;
  const mode = onScreenMode(direction);
  const directedOpen = stillUsesDirectedOpening(videoDirection);
  const visual = videoDirectionForModel(videoDirection, overlay);
  const script = packet.script.trim();
  const lines = [
    `Photoreal local-business advertisement still, ${ratio}, cinematic, natural light.`,
    `Business: ${i.businessName}, ${i.category_label} in ${spokenPlace(i.city, i.state)}.`,
    `Slot: ${slot.label}. ${promptRoleForOverlay(slot.role, overlay)}`,
    `Tone: ${i.tone}. ${packet.recipe.structure}`,
    script && slot.id !== "hook" && !slot.id.startsWith("body")
      ? `EXACT SCRIPT (speak these words, do not paraphrase): ${script}`
      : "",
    site?.tagline ? `Tagline: ${site.tagline}` : "",
    site?.services?.length ? `Services: ${site.services.slice(0, 6).join(", ")}` : "",
    site?.about ? `About: ${site.about.slice(0, 280)}` : "",
    `Use the real business. Do not invent a different company or a celebrity.`,
    referencePromptBlock(packet.assets.filter((a) => a.kind === "logo" || a.kind === "upload")),
    `No watermarks, no agency slogans, no UI chrome.`,
    `Never say twelve seconds, twenty seconds, forty seconds, or any runtime.`,
  ];
  if (slot.id === "end_card" || slot.id === "static") {
    lines.push(
      stillEndCardTypeInstruction(
        mode,
        {
          businessName: i.businessName,
          place: spokenPlace(i.city, i.state),
          phone: i.phone,
          cta: site?.cta || "Call today",
        },
        overlay,
      ),
    );
  }
  if (slot.id === "hook" || slot.id.startsWith("body")) {
    if (!directedOpen) {
      lines.push(
        packet.assets.length
          ? "Talking-head: the real person from the attached reference photos, facing camera, mid-speech, at the real job site from those photos."
          : "Talking-head: a local owner or technician facing camera, mid-speech, at a real driveway or storefront.",
      );
    }
    lines.push(
      "Do not invent vehicles, pool shapes, buildings, or lettering that are not in the reference photos. If no van is in the photos, do not add a branded service van.",
    );
    if (script) lines.push(spokenScriptInstruction(script, mode, overlay));
  }
  if (slot.id === "mascot" && i.mascotDescription) lines.push(`Mascot: ${i.mascotDescription}`);
  return applyVideoDirection(lines.filter(Boolean).join("\n"), "still", visual);
}

/** Final still text sent to the image model: body + one continuity/guard line. */
export function composeStillPrompt(
  packet: PromptPacket,
  slot: PromptSlot,
  ratio: string,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
): string {
  return [
    stillPrompt(packet, slot, ratio, direction, videoDirection, overlay),
    continuityLine(packet, direction, videoDirection, overlay),
  ]
    .filter(Boolean)
    .join(" ");
}

export function motionPrompt(
  slot: PromptSlot,
  seconds: number,
  tone: string,
  city: string,
  state: string,
  spokenLine?: string,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
) {
  const mode = onScreenMode(direction);
  const directed = stillUsesDirectedOpening(videoDirection);
  const visual = videoDirectionForModel(videoDirection, overlay);
  const talking =
    slot.id === "hook" || slot.id.startsWith("body")
      ? [
          directed
            ? "Follow the visual shot list. Talent speaks when they are on camera; establishing frames may have VO over picture."
            : "The person talks to camera with natural hand gestures. Mouth moves in speech.",
          spokenLine ? motionScriptInstruction(spokenLine, mode) : "",
          `Say the location as ${spokenPlace(city, state)}. Never spell the state as letters.`,
          "Keep real people, places, and products from the still and reference photos. Do not invent a van or a different pool.",
          "Do not freeze the last seconds.",
        ]
          .filter(Boolean)
          .join(" ")
      : hasTextOverlay(overlay)
        ? "Slow, confident camera. Blank plate — no words, letters, logos, or URLs."
        : "Slow, confident camera. Keep type readable if present.";
  return applyVideoDirection(
    [
      `Animate this advertisement frame. Clip length for editing is ${seconds} seconds — that is timing only. Do not speak the length.`,
      promptRoleForOverlay(slot.role, overlay),
      `Tone: ${tone}. ${talking}`,
      `Photoreal, no morphing logos, no extra text, no watermarks.`,
      `Never say twelve seconds, twenty seconds, forty seconds, or any runtime. Hard cut when the line is done.`,
      "Do not mention geofences, grocery or retail anchors, or media-buy targeting.",
    ].join(" "),
    "video",
    visual,
  );
}

export function imagineStillPrompt(
  packet: PromptPacket,
  slot: PromptSlot,
  ratio: string,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
) {
  const i = packet.intake;
  const site = packet.website_profile;
  const tone = TONE_PACKS[i.tone];
  const mode = onScreenMode(direction);
  const directedOpen = stillUsesDirectedOpening(videoDirection);
  const script = packet.script.trim();
  const parts = [
    `A photoreal ${ratio} advertisement still for ${i.businessName}, a ${i.category_label} in ${spokenPlace(i.city, i.state)}.`,
    `This frame is the ${slot.label.toLowerCase()}: ${promptRoleForOverlay(slot.role, overlay)}`,
    `The look is ${i.tone}: ${tone.picture}`,
  ];
  if (script && slot.id !== "hook") {
    parts.push(`EXACT SCRIPT for this shot (speak these words, not an idea): ${script}`);
  }
  if (site?.tagline) parts.push(`Their line: ${site.tagline}.`);
  if (site?.services?.length) parts.push(`Services: ${site.services.slice(0, 5).join(", ")}.`);
  if (site?.about) parts.push(site.about.slice(0, 220));
  if (slot.id === "end_card" || slot.id === "static") {
    parts.push(
      stillEndCardTypeInstruction(
        mode,
        {
          businessName: i.businessName,
          place: spokenPlace(i.city, i.state),
          phone: i.phone,
          cta: site?.cta || "Call today",
        },
        overlay,
      ),
    );
  }
  if (slot.id === "hook") {
    if (!directedOpen) {
      parts.push(
        "Talking-head still: owner or tech from the reference photos, facing camera, mid-speech, at the real job site from those photos. Match face and clothing exactly.",
      );
    }
    parts.push(
      "Do not invent a branded van, a different pool shape, or lettering that is not in the photos.",
    );
    if (script) parts.push(spokenScriptInstruction(script, mode, overlay));
  }
  if (slot.id === "mascot" && i.mascotDescription) parts.push(`Mascot: ${i.mascotDescription}`);
  const refs = referencePromptBlock(
    packet.assets.filter((a) => a.kind === "logo" || a.kind === "upload"),
  );
  if (refs) parts.push(refs);
  parts.push("Use the real business. No celebrity, no watermark, no UI chrome, no agency slogan.");
  parts.push(
    "Do not mention geofences, grocery or retail anchors, household income, age ranges, pilates studios, golf communities, or any media-buy targeting.",
  );
  return applyVideoDirection(
    parts.filter(Boolean).join(" "),
    "still",
    videoDirectionForModel(videoDirection, overlay),
  );
}

export function imagineMotionPrompt(
  slot: PromptSlot,
  seconds: number,
  tone: Tone,
  city: string,
  state: string,
  spokenLine?: string,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
) {
  const pack = TONE_PACKS[tone];
  const mode = onScreenMode(direction);
  const directed = stillUsesDirectedOpening(videoDirection);
  const talking =
    slot.id === "hook" || slot.id.startsWith("body")
      ? [
          directed
            ? "Follow the visual shot list. Talent speaks when they are on camera; establishing frames may have VO over picture."
            : "The person talks to camera with natural hand gestures and a slight weight shift. Mouth moves in speech.",
          spokenLine ? motionScriptInstruction(spokenLine, mode) : "",
          `Say the location as ${spokenPlace(city, state)}. Never spell the state as letters.`,
          "Keep real people, places, and products from the still and reference photos. Do not invent a van or a different pool.",
          "Do not freeze the last seconds.",
        ]
          .filter(Boolean)
          .join(" ")
      : hasTextOverlay(overlay)
        ? "Slow, confident camera, subject stays recognizable. Blank plate — no words, letters, logos, or URLs."
        : "Slow, confident camera, subject stays recognizable, type stays readable.";
  return applyVideoDirection(
    [
      `Animate this advertisement frame. Clip length for editing is ${seconds} seconds — that is timing only. Do not speak the length.`,
      promptRoleForOverlay(slot.role, overlay),
      pack.picture,
      talking,
      "Photoreal, no morphing logos, no extra text, no watermarks.",
      "Never say twelve seconds, twenty seconds, forty seconds, or any runtime. Hard cut when the line is done.",
      "Do not mention geofences, grocery or retail anchors, or media-buy targeting.",
    ].join(" "),
    "video",
    videoDirectionForModel(videoDirection, overlay),
  );
}

export function composeImagineStillPrompt(
  packet: PromptPacket,
  slot: PromptSlot,
  ratio: string,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
): string {
  return [
    imagineStillPrompt(packet, slot, ratio, direction, videoDirection, overlay),
    continuityLine(packet, direction, videoDirection, overlay),
  ]
    .filter(Boolean)
    .join(" ");
}

export function composeMotionPrompt(
  packet: PromptPacket,
  slot: PromptSlot,
  seconds: number,
  spokenLine?: string,
  direction?: string,
  videoDirection?: string,
  overlay?: TextOverlaySpec,
  engine: "imagine" | "xai" = "xai",
): string {
  const motion =
    engine === "imagine"
      ? imagineMotionPrompt(
          slot,
          seconds,
          packet.intake.tone,
          packet.intake.city,
          packet.intake.state,
          spokenLine,
          direction,
          videoDirection,
          overlay,
        )
      : motionPrompt(
          slot,
          seconds,
          packet.intake.tone,
          packet.intake.city,
          packet.intake.state,
          spokenLine,
          direction,
          videoDirection,
          overlay,
        );
  return [motion, continuityLine(packet, direction, videoDirection, overlay)]
    .filter(Boolean)
    .join(" ");
}
