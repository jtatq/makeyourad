/** Direction-change helpers: remake restart + optional minimal on-screen type. */

export type OnScreenMode = "script-captions" | "minimal-endcard";

export type EndCardBits = {
  businessName: string;
  place: string;
  phone: string;
  cta: string;
};

export type OverlayTypeHint = {
  endCard?: { lines: string[] } | null;
  lowerThird?: { lines: string[] } | null;
} | null | undefined;

const MINIMAL_TEXT =
  /minimal(?:\s+on[-\s]?screen)?(?:\s+text)?|end[-\s]?cards?(?:\s+only|\s+text)?|(?:business\s+)?name(?:\s+and|\s*\+\s*|\s*\/\s*|&\s*)city|city\s+and\s+(?:business\s+)?name|no (?:on[-\s]?screen )?(?:script|captions?|lower[- ]thirds?)|don'?t (?:put|burn|letter|show) (?:the )?(?:full )?(?:script|voiceover|\bvo\b)|(?:spoken|voiceover|vo)\s+only/i;

const PLACEHOLDER_PHONE = /see\s+website|n\/a\b|none\b|unknown|not\s+provided|tbd\b/i;

export function onScreenMode(direction?: string | null): OnScreenMode {
  const d = direction?.trim() ?? "";
  if (!d) return "script-captions";
  return MINIMAL_TEXT.test(d) ? "minimal-endcard" : "script-captions";
}

export function hasOverlayType(overlay?: OverlayTypeHint): boolean {
  return Boolean(overlay?.endCard?.lines.length || overlay?.lowerThird?.lines.length);
}

/** Real customer phone we may letter — not placeholders like "See website". */
export function looksLikeOnScreenPhone(phone?: string | null): boolean {
  const t = phone?.trim() ?? "";
  if (!t || PLACEHOLDER_PHONE.test(t)) return false;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export const NO_INVENTED_ONSCREEN_TYPE =
  "Never invent phone numbers, fake digits, addresses, captions, logos, or gibberish lettering. Do not burn digit scrap, placeholder numbers, or nonsense words.";

export function noInventedOnScreenTypeInstruction(phone?: string | null, overlay?: OverlayTypeHint): string {
  if (hasOverlayType(overlay)) {
    return `Clean plate only. ${NO_INVENTED_ONSCREEN_TYPE} Exact brand type is composited after generation — leave space; do not letter a contact footer.`;
  }
  if (looksLikeOnScreenPhone(phone)) {
    return `${NO_INVENTED_ONSCREEN_TYPE} If a phone appears on screen it must be exactly ${phone!.trim()} — never a different number.`;
  }
  return `${NO_INVENTED_ONSCREEN_TYPE} Do not show a phone number unless the brief provided a real one.`;
}

function phoneGuard(phone?: string | null): string {
  if (looksLikeOnScreenPhone(phone)) {
    return `Do not invent a different phone number. If a phone must appear it must be exactly ${phone!.trim()}.`;
  }
  return "Do not invent a phone number, fake digits, an address, or extra contact scrap.";
}

export function spokenScriptInstruction(script: string, mode: OnScreenMode): string {
  if (mode === "minimal-endcard") {
    return `Mouth and SPEAK this script verbatim, do not paraphrase: "${script}". Do not burn those words as on-screen captions, lower-thirds, or a paragraph of type. On-screen text is business name and city only. Do not invent phone numbers, digits, addresses, or gibberish lettering.`;
  }
  return `Mouth the exact full script: "${script}". Captions match those words. This is the script, not an idea.`;
}

export function motionScriptInstruction(script: string, mode: OnScreenMode): string {
  if (mode === "minimal-endcard") {
    return `Speak this script verbatim, do not paraphrase: "${script}". Do not burn the spoken words as captions. Do not invent phone numbers, digits, addresses, or gibberish lettering on screen.`;
  }
  return `Speak this script verbatim, do not paraphrase: "${script}". Captions match exactly.`;
}

export function endCardTypeInstruction(
  mode: OnScreenMode,
  bits: EndCardBits,
  overlay?: OverlayTypeHint,
): string {
  if (hasOverlayType(overlay)) {
    return [
      "In the last three seconds the camera holds on a clean plate.",
      "Do not letter any words, phone numbers, digits, addresses, captions, logos, or gibberish on screen — exact end-card and lower-third type will be composited after generation.",
      "Leave a clear lower-third band and a clean last-three-second hold for composited type.",
      NO_INVENTED_ONSCREEN_TYPE,
    ].join(" ");
  }
  if (mode === "minimal-endcard") {
    return `In the last three seconds the camera holds and clean type fades on: ${bits.businessName}. ${bits.place}. Do not letter the spoken script. No paragraph of voiceover on screen. ${phoneGuard(bits.phone)} ${NO_INVENTED_ONSCREEN_TYPE}`;
  }
  const phoneFade = looksLikeOnScreenPhone(bits.phone) ? `${bits.phone.trim()}. ` : "";
  return `In the last three seconds the camera holds and clean type fades on: ${bits.businessName}. ${bits.place}. ${phoneFade}${bits.cta}. ${phoneGuard(bits.phone)}`;
}

/** End-card / static still copy. Overlay plates stay blank; models do not invent contact scrap. */
export function stillEndCardTypeInstruction(
  mode: OnScreenMode,
  bits: EndCardBits,
  overlay?: OverlayTypeHint,
): string {
  if (hasOverlayType(overlay)) {
    return "Leave a clean plate for exact end-card type. Do not letter any words, phone numbers, digits, addresses, captions, logos, or gibberish — type is composited after generation.";
  }
  if (mode === "minimal-endcard") {
    return `On-screen type, clean and readable: ${bits.businessName}. ${bits.place}. No voiceover paragraph. Never letter the state (not U.T.). ${phoneGuard(bits.phone)}`;
  }
  const phoneFade = looksLikeOnScreenPhone(bits.phone) ? `${bits.phone.trim()}. ` : "";
  return `On-screen type, clean and readable: ${bits.businessName}. ${bits.place}. ${phoneFade}CTA: ${bits.cta}. Never letter the state (not U.T.). ${phoneGuard(bits.phone)}`;
}

/** start + force always begins a new job — remake must not keep a prior still/video. */
export function shouldReinitGeneration(
  action: "start" | "tick",
  force: boolean | undefined,
  jobStatus: string | null | undefined,
  live: boolean,
): boolean {
  if (action !== "start") return false;
  if (force) return true;
  if (!jobStatus) return true;
  if (live || jobStatus === "running") return false;
  return true;
}
