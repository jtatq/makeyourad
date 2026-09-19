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

/** Image-model prompt cap. Leave headroom under the 4096 hard limit. */
export const IMAGE_STILL_PROMPT_BUDGET = 3500;
export const IMAGE_STILL_PROMPT_HARD_MAX = 4096;

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

/** Single short anti-fabrication line. Inject once — do not restate in other helpers. */
export const ON_SCREEN_TYPE_GUARD = "No invented phones, digits, addresses, or gibberish type.";

export function onScreenTypeGuard(phone?: string | null, overlay?: OverlayTypeHint): string {
  if (hasOverlayType(overlay)) {
    return "Clean plate — no phones, digits, or invented type. Overlay is composited after generation.";
  }
  if (looksLikeOnScreenPhone(phone)) {
    return `${ON_SCREEN_TYPE_GUARD} If a phone appears use only ${phone!.trim()}.`;
  }
  return `${ON_SCREEN_TYPE_GUARD} Show a phone only if the brief gave a real one.`;
}

/** @deprecated Use onScreenTypeGuard — kept as the one injected still/video guard. */
export const noInventedOnScreenTypeInstruction = onScreenTypeGuard;
export const NO_INVENTED_ONSCREEN_TYPE = ON_SCREEN_TYPE_GUARD;

export function spokenScriptInstruction(script: string, mode: OnScreenMode): string {
  if (mode === "minimal-endcard") {
    return `Mouth and SPEAK this script verbatim, do not paraphrase: "${script}". Do not burn those words as on-screen captions, lower-thirds, or a paragraph of type. On-screen text is business name and city only.`;
  }
  return `Mouth the exact full script: "${script}". Captions match those words. This is the script, not an idea.`;
}

export function motionScriptInstruction(script: string, mode: OnScreenMode): string {
  if (mode === "minimal-endcard") {
    return `Speak this script verbatim, do not paraphrase: "${script}". Do not burn the spoken words as captions.`;
  }
  return `Speak this script verbatim, do not paraphrase: "${script}". Captions match exactly.`;
}

export function endCardTypeInstruction(
  mode: OnScreenMode,
  bits: EndCardBits,
  overlay?: OverlayTypeHint,
): string {
  if (hasOverlayType(overlay)) {
    return "Last 3s: hold a clean plate for composited type.";
  }
  if (mode === "minimal-endcard") {
    return `Last 3s: ${bits.businessName}. ${bits.place}. Do not letter the spoken script.`;
  }
  const phoneFade = looksLikeOnScreenPhone(bits.phone) ? `${bits.phone.trim()}. ` : "";
  return `Last 3s: ${bits.businessName}. ${bits.place}. ${phoneFade}${bits.cta}.`;
}

/** End-card / static still copy. Overlay plates stay blank; the shared guard covers fabrication. */
export function stillEndCardTypeInstruction(
  mode: OnScreenMode,
  bits: EndCardBits,
  overlay?: OverlayTypeHint,
): string {
  if (hasOverlayType(overlay)) {
    return "Clean plate for composited end-card.";
  }
  if (mode === "minimal-endcard") {
    return `Type: ${bits.businessName}. ${bits.place}.`;
  }
  const phoneFade = looksLikeOnScreenPhone(bits.phone) ? `${bits.phone.trim()}. ` : "";
  return `Type: ${bits.businessName}. ${bits.place}. ${phoneFade}${bits.cta}.`;
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
