/** Direction-change helpers: remake restart + optional minimal on-screen type. */

export type OnScreenMode = "script-captions" | "minimal-endcard";

const MINIMAL_TEXT =
  /minimal(?:\s+on[-\s]?screen)?(?:\s+text)?|end[-\s]?cards?(?:\s+only|\s+text)?|(?:business\s+)?name(?:\s+and|\s*\+\s*|\s*\/\s*|&\s*)city|city\s+and\s+(?:business\s+)?name|no (?:on[-\s]?screen )?(?:script|captions?|lower[- ]thirds?)|don'?t (?:put|burn|letter|show) (?:the )?(?:full )?(?:script|voiceover|\bvo\b)|(?:spoken|voiceover|vo)\s+only/i;

export function onScreenMode(direction?: string | null): OnScreenMode {
  const d = direction?.trim() ?? "";
  if (!d) return "script-captions";
  return MINIMAL_TEXT.test(d) ? "minimal-endcard" : "script-captions";
}

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
  bits: { businessName: string; place: string; phone: string; cta: string },
): string {
  if (mode === "minimal-endcard") {
    return `In the last three seconds the camera holds and clean type fades on: ${bits.businessName}. ${bits.place}. Do not letter the spoken script. No paragraph of voiceover on screen.`;
  }
  return `In the last three seconds the camera holds and clean type fades on: ${bits.businessName}. ${bits.place}. ${bits.phone}. ${bits.cta}.`;
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
