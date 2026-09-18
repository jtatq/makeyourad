/** Split spoken VO from visual/camera direction and weight the beat sheet on video. */

export type BriefLayers = {
  spoken: string;
  videoDirection: string;
  hasVisualDirection: boolean;
};

const DURATION_SPEAK =
  /\b(?:12|20|25|30|40|55|60)(?:\s*[–-]\s*(?:12|20|25|30|40|55|60))?\s*-?\s*seconds?\b/gi;
const PRODUCT_SECTION_HEAD =
  /^(?:camera-facing|voice-?over|short-form(?:\s+social)?)(?:\s*[—\-–:].*)?$/i;
const LEADING_LABEL = /^(?:12|20|40)\s*seconds?\s*[:\-–.]\s*/i;
const MEDIA_BUY_LINE =
  /\b(geofenc|in-?market audience|household income|target women|primary (?:store|retail)|suggested additional|pilates studios|fitness and wellness|luxury residential|golf communit|media[- ]buy|seven miles|\$\d{2,3},\d{3}\+)\b/i;
const INTAKE_FIELD =
  /^(?:business\s+name|business\s+address|address|website|phone|category|city|state|email)\s*:/i;

const SPOKEN_BRACKET =
  /^\s*\[(?:VO|V\.?O\.?|VOICEOVER|VOICE[- ]?OVER|DIALOGUE|DIALOG|TALENT|SPOKEN|ANNCR|NARRATION|NARRATOR):?\]\s*:?\s*(.*)$/i;
const VISUAL_BRACKET =
  /^\s*\[(?:VISUALS?|VIDEO|CAMERA|SHOTS?|B-?ROLL|GFX|GRAPHICS?|LOWER[- ]?THIRDS?|END[- ]?CARDS?|SUPER|SFX|MUSIC|OS(?:\s*ACTION)?):?\]\s*:?\s*(.*)$/i;

const VISUAL_SECTION =
  /^(?:visuals?(?:\s*[/|&]\s*camera)?|visual\s+(?:direction|notes?|beats?)|shot\s+lists?|camera(?:\s+notes?|\s+direction)?|b-?roll|picture(?:\s+direction)?|scene\s+direction|video\s+direction)\b(?:\s*[—\-–:])?\s*$/i;
const SPOKEN_SECTION =
  /^(?:voice-?over|spoken(?:\s+copy|\s+vo)?|dialogue|script)\b(?:\s*[—\-–:])?\s*$/i;

/** Cinematic beat lines — not spoken copy. "Open your doors" does not match. */
const VISUAL_BEAT =
  /^(?:[-*•]\s*)?(?:\d+[.)]\s*)?(?:open(?:ing)?\s+on|opening\s+shot|establishing(?:\s+shot)?|wide\s+shot|tight\s+shot|close[- ]up|transition(?:s)?\s+to|lower[- ]thirds?\s*:|end[- ]cards?\s*:|camera\s*:|b-?roll\s*:|drone|aerial(?:\s+shot)?)\b/i;
const CUT_TO_BEAT = /^(?:[-*•]\s*|\d+[.)]\s*)cut\s+to\b|^cut\s+to\s*:/i;
const LABELED_VISUAL =
  /^(?:[-*•]\s*)?(?:\d+[.)]\s*)?(?:visual|camera|shot|b-?roll|lower[- ]thirds?|end[- ]cards?|sfx|music|super)\s*:\s+\S/i;

const VIDEO_DIRECTION_KEYS = [
  "videoDirection",
  "video_direction",
  "visualDirection",
  "visual_direction",
  "shotList",
  "shot_list",
  "cameraDirection",
  "camera_direction",
] as const;

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
}

function tidyBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(DURATION_SPEAK, "").replace(LEADING_LABEL, "").trimEnd())
    .map((line) => line.trim())
    .filter((line) => line && !PRODUCT_SECTION_HEAD.test(line) && !MEDIA_BUY_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function uniqueLines(text: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const key = line.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line.trim());
  }
  return out.join("\n");
}

function isVisualBeat(line: string): boolean {
  return VISUAL_BEAT.test(line) || CUT_TO_BEAT.test(line) || LABELED_VISUAL.test(line);
}

/** Pull spoken words vs visual/camera/SFX direction from a pasted brief. */
export function parseBriefLayers(brief: string): BriefLayers {
  const text = normalizeNewlines(brief ?? "");
  if (!text.trim()) {
    return { spoken: "", videoDirection: "", hasVisualDirection: false };
  }

  const spoken: string[] = [];
  const visual: string[] = [];
  let mode: "auto" | "spoken" | "visual" = "auto";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (mode !== "auto") mode = "auto";
      continue;
    }
    if (MEDIA_BUY_LINE.test(line) || PRODUCT_SECTION_HEAD.test(line) || INTAKE_FIELD.test(line)) continue;

    const spokenTag = line.match(SPOKEN_BRACKET);
    if (spokenTag) {
      const body = spokenTag[1]?.trim() ?? "";
      if (body) spoken.push(body);
      mode = body ? "auto" : "spoken";
      continue;
    }

    const visualTag = line.match(VISUAL_BRACKET);
    if (visualTag) {
      const tag = line.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim() ?? "VISUAL";
      const body = visualTag[1]?.trim() ?? "";
      visual.push(body ? `[${tag}] ${body}` : `[${tag}]`);
      mode = "visual";
      continue;
    }

    if (VISUAL_SECTION.test(line)) {
      mode = "visual";
      continue;
    }
    if (SPOKEN_SECTION.test(line)) {
      mode = "spoken";
      continue;
    }

    if (mode === "visual") {
      visual.push(line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, ""));
      continue;
    }
    if (mode === "spoken") {
      spoken.push(line.replace(LEADING_LABEL, ""));
      continue;
    }
    if (isVisualBeat(line)) {
      visual.push(line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, ""));
      continue;
    }
    spoken.push(line.replace(LEADING_LABEL, ""));
  }

  const spokenText = tidyBlock(spoken.join("\n"));
  const videoDirection = uniqueLines(tidyBlock(visual.join("\n")));
  return {
    spoken: spokenText,
    videoDirection,
    hasVisualDirection: videoDirection.length > 0,
  };
}

export function extractSpokenVoiceover(brief: string): string {
  return parseBriefLayers(brief).spoken;
}

export function extractVideoDirection(brief: string): string {
  return parseBriefLayers(brief).videoDirection;
}

export function looksLikeShotList(text: string | null | undefined): boolean {
  const t = text?.trim() ?? "";
  if (!t) return false;
  if (VISUAL_BRACKET.test(t) || /\[(?:VISUAL|CAMERA|SFX|LOWER[- ]?THIRD|END[- ]?CARD)\b/i.test(t)) return true;
  const layers = parseBriefLayers(t);
  return layers.hasVisualDirection && layers.videoDirection.length >= 12;
}

export function readVideoDirectionField(body: Record<string, unknown> | null | undefined): string | undefined {
  if (!body) return undefined;
  for (const key of VIDEO_DIRECTION_KEYS) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function resolveVideoDirection(opts: {
  explicit?: string | null;
  stored?: string | null;
  brief?: string | null;
  operatorDirection?: string | null;
}): string {
  const explicit = opts.explicit?.trim();
  if (explicit) return explicit;
  const stored = opts.stored?.trim();
  if (stored) return stored;
  const fromBrief = opts.brief ? extractVideoDirection(opts.brief) : "";
  if (fromBrief) return fromBrief;
  const dir = opts.operatorDirection?.trim() || "";
  if (dir && looksLikeShotList(dir)) return extractVideoDirection(dir) || dir;
  return "";
}

/** Keep spoken copy intact and append a parseable visual appendix for remakes. */
export function composeStoredBrief(spoken: string, videoDirection?: string | null): string {
  const vo = spoken.trim();
  const visual = videoDirection?.trim() ?? "";
  if (!visual) return vo;
  const already = extractVideoDirection(vo);
  if (already && already === visual) return vo;
  if (already && visual.includes(already) && already.length >= visual.length * 0.8) return vo;
  return `${vo}\n\n[VISUAL:]\n${visual}`.trim();
}

export function firstVisualBeat(videoDirection: string): string {
  const line = videoDirection
    .split("\n")
    .map((l) => l.replace(/^\[(?:VISUALS?|CAMERA|SHOTS?)\]\s*/i, "").trim())
    .find((l) => l && !/^\[(?:SFX|MUSIC)\]/i.test(l));
  return (line ?? "").replace(/^\[(?:LOWER[- ]?THIRD|END[- ]?CARD|SUPER)\]\s*/i, "").trim();
}

export function stillOpeningHint(videoDirection?: string | null): string {
  const d = videoDirection?.trim();
  if (!d) return "";
  const first = firstVisualBeat(d);
  return [
    "FIRST PASS STILL — opening frame only.",
    first ? `Open on this picture (composition, not captions): ${first}` : "",
    "Do not letter the visual shot list, camera notes, [VISUAL:] / [SFX:] lines, or the full beat sheet on screen.",
    "Do not invent phone numbers, digits, addresses, or gibberish lettering on this still.",
    "If this opening frame has no person, do not force a talking-head into the still.",
    "Honor reference photos for any real person or place that appears in this frame.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function videoShotListInstruction(videoDirection?: string | null): string {
  const d = videoDirection?.trim();
  if (!d) return "";
  return [
    "SECOND PASS VIDEO — VISUAL SHOT LIST / CAMERA DIRECTION (picture and camera only; do not speak these words; do not rewrite the voiceover):",
    d,
    "Hit every beat: locations, transitions, talent action, named lower-thirds, end card, and SFX cues.",
    "This shot list overrides any one-room / one-person / no-cut default.",
    "Spoken copy stays the voiceover script verbatim.",
  ].join(" ");
}

export function pictureContinuityInstruction(videoDirection?: string | null): string {
  if (videoDirection?.trim()) {
    return "Follow the visual shot list for camera, location, and graphics. Directed transitions are required. Keep one music bed. Do not invent extra locations. Never speak the shot list.";
  }
  return "ONE CONTINUOUS SHOT. Do not cut to a new location or a separate end-card graphic.";
}

export function stillUsesDirectedOpening(videoDirection?: string | null): boolean {
  return Boolean(videoDirection?.trim());
}

export function applyVideoDirection(
  prompt: string,
  phase: "still" | "video",
  videoDirection?: string | null,
): string {
  const add = phase === "video" ? videoShotListInstruction(videoDirection) : stillOpeningHint(videoDirection);
  if (!add) return prompt;
  const marker = phase === "video" ? "SECOND PASS VIDEO — VISUAL SHOT LIST" : "FIRST PASS STILL — opening frame only";
  if (prompt.includes(marker)) return prompt;
  return `${prompt}\n${add}`.trim();
}
