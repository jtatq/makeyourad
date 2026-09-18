/**
 * Exact end-card / lower-third copy.
 *
 * Brand type is NOT left to the image/video model. We parse the lines, tell
 * the model to leave clean space, then composite deterministic typography
 * after still/video generation (and again on the stitched master if needed).
 */

export type OverlayCard = {
  lines: string[];
};

export type TextOverlaySpec = {
  endCard: OverlayCard | null;
  lowerThird: OverlayCard | null;
};

export const END_CARD_FIELD_KEYS = [
  "endCard",
  "end_card",
  "endCardText",
  "end_card_text",
  "endcard",
] as const;

export const LOWER_THIRD_FIELD_KEYS = [
  "lowerThird",
  "lower_third",
  "lowerThirds",
  "lower_thirds",
  "lowerThirdText",
  "lower_third_text",
] as const;

const END_CARD_TAG = /^\s*\[END[- ]?CARDS?:?\]\s*:?\s*(.*)$/i;
const LOWER_THIRD_TAG = /^\s*\[LOWER[- ]?THIRDS?:?\]\s*:?\s*(.*)$/i;
const END_CARD_LABEL = /^(?:[-*•]\s*)?(?:\d+[.)]\s*)?end[- ]?cards?\s*:\s*(.+)$/i;
const LOWER_THIRD_LABEL = /^(?:[-*•]\s*)?(?:\d+[.)]\s*)?lower[- ]?thirds?\s*:\s*(.+)$/i;

const SCENE_PREFIX =
  /^(?:hold(?:ing)?|cut\s+to|transition(?:s)?\s+to|over|on|at|wide|tight|close[- ]up|drone|aerial)\b/i;
const LOGO_PLUS = /\b(?:logo|lockup|wordmark)\b/i;
const URL_LIKE = /\b(?:[a-z0-9][a-z0-9-]*\.)+(?:com|org|net|io|co|us|tv|biz|info|edu)\b/i;
const SCENE_SUFFIX = /\s+(?:over|on|against|above)\s+(?:a\s+|the\s+)?[A-Z][\w' -]{2,}$/;

export function emptyTextOverlay(): TextOverlaySpec {
  return { endCard: null, lowerThird: null };
}

export function hasTextOverlay(spec?: TextOverlaySpec | null): boolean {
  return Boolean(spec?.endCard?.lines.length || spec?.lowerThird?.lines.length);
}

export function overlayLines(spec?: TextOverlaySpec | null): string[] {
  return [...(spec?.endCard?.lines ?? []), ...(spec?.lowerThird?.lines ?? [])];
}

function tidyLine(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/^[-*•]\s*/, "").trim();
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.trim();
    if (!key) continue;
    const folded = key.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(key);
  }
  return out;
}

function card(lines: string[]): OverlayCard | null {
  const clean = uniqueLines(lines.map(tidyLine).filter(Boolean));
  return clean.length ? { lines: clean } : null;
}

/** Split "A / B / C" brand stacks without breaking URLs. */
export function splitOverlayLines(raw: string): string[] {
  const text = tidyLine(raw ?? "");
  if (!text) return [];
  if (/\n/.test(text)) {
    return uniqueLines(text.split(/\n/).flatMap((part) => splitOverlayLines(part)));
  }
  if (/\s+\/\s+/.test(text) && !/^https?:\/\//i.test(text)) {
    return uniqueLines(text.split(/\s+\/\s+/).map(tidyLine));
  }
  return [text];
}

function stripSceneCrumbs(line: string): string {
  let t = tidyLine(line);
  t = t.replace(/^\[(?:END[- ]?CARDS?|LOWER[- ]?THIRDS?|SUPER)\]\s*/i, "");
  t = t.replace(SCENE_SUFFIX, "");
  t = t.replace(/\s+\+\s+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/\b(?:logo|lockup|wordmark)\b/gi, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^[-+|/]+\s*|\s*[-+|/]+$/g, "").trim();
  return t;
}

/** Pull brandable copy out of a shot-list end-card cue. */
export function extractEndCardCopy(raw: string): string[] {
  const text = tidyLine(raw);
  if (!text) return [];
  const slash = splitOverlayLines(text);
  if (slash.length > 1) return uniqueLines(slash.map(stripSceneCrumbs).filter((l) => l && !SCENE_PREFIX.test(l)));

  const urls = text.match(new RegExp(URL_LIKE.source, "gi")) ?? [];
  let rest = text;
  for (const url of urls) rest = rest.replace(url, " ");
  rest = rest.replace(SCENE_SUFFIX, "");
  const beforeLogo = rest.split(LOGO_PLUS)[0] ?? "";
  const name = stripSceneCrumbs(beforeLogo);
  const lines = [name, ...urls.map(tidyLine)].filter((l) => l && !SCENE_PREFIX.test(l) && !/^logo\b/i.test(l));
  if (lines.length) return uniqueLines(lines);

  const cleaned = stripSceneCrumbs(text);
  if (!cleaned || SCENE_PREFIX.test(cleaned) || LOGO_PLUS.test(text) && cleaned.length < 3) return [];
  return [cleaned];
}

export function extractLowerThirdCopy(raw: string): string[] {
  const text = tidyLine(raw).replace(/^\[(?:LOWER[- ]?THIRDS?|SUPER)\]\s*/i, "");
  if (!text) return [];
  if (/\s+\/\s+/.test(text)) return uniqueLines(splitOverlayLines(text));
  if (text.includes("|")) {
    return uniqueLines(text.split("|").map(tidyLine).filter(Boolean));
  }
  return [text];
}

function readUnknownLines(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return splitOverlayLines(value);
  if (Array.isArray(value)) {
    return uniqueLines(value.flatMap((item) => (typeof item === "string" ? splitOverlayLines(item) : readUnknownLines(item))));
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (Array.isArray(rec.lines)) return readUnknownLines(rec.lines);
    if (typeof rec.text === "string") return splitOverlayLines(rec.text);
    if (typeof rec.line === "string") return splitOverlayLines(rec.line);
  }
  return [];
}

export function readEndCardField(body: Record<string, unknown> | null | undefined): string[] {
  if (!body) return [];
  for (const key of END_CARD_FIELD_KEYS) {
    const lines = readUnknownLines(body[key]);
    if (lines.length) return uniqueLines(lines.flatMap((l) => (l.includes("/") ? splitOverlayLines(l) : [l])));
  }
  return [];
}

export function readLowerThirdField(body: Record<string, unknown> | null | undefined): string[] {
  if (!body) return [];
  for (const key of LOWER_THIRD_FIELD_KEYS) {
    const lines = readUnknownLines(body[key]);
    if (lines.length) return uniqueLines(lines.flatMap((l) => extractLowerThirdCopy(l)));
  }
  return [];
}

export function parseTextOverlayFromDirection(text?: string | null): TextOverlaySpec {
  const spec = emptyTextOverlay();
  if (!text?.trim()) return spec;
  const end: string[] = [];
  const lower: string[] = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const endTag = line.match(END_CARD_TAG);
    if (endTag) {
      end.push(...extractEndCardCopy(endTag[1] ?? ""));
      continue;
    }
    const lowerTag = line.match(LOWER_THIRD_TAG);
    if (lowerTag) {
      lower.push(...extractLowerThirdCopy(lowerTag[1] ?? ""));
      continue;
    }
    const endLabel = line.match(END_CARD_LABEL);
    if (endLabel) {
      end.push(...extractEndCardCopy(endLabel[1] ?? ""));
      continue;
    }
    const lowerLabel = line.match(LOWER_THIRD_LABEL);
    if (lowerLabel) {
      lower.push(...extractLowerThirdCopy(lowerLabel[1] ?? ""));
    }
  }
  spec.endCard = card(end);
  spec.lowerThird = card(lower);
  return spec;
}

export function mergeTextOverlay(...parts: Array<TextOverlaySpec | null | undefined>): TextOverlaySpec {
  const end: string[] = [];
  const lower: string[] = [];
  for (const part of parts) {
    if (part?.endCard?.lines.length) end.push(...part.endCard.lines);
    if (part?.lowerThird?.lines.length) lower.push(...part.lowerThird.lines);
  }
  return { endCard: card(end), lowerThird: card(lower) };
}

export function resolveTextOverlay(opts: {
  explicit?: TextOverlaySpec | null;
  stored?: TextOverlaySpec | null;
  videoDirection?: string | null;
  brief?: string | null;
}): TextOverlaySpec {
  const explicit = opts.explicit && hasTextOverlay(opts.explicit) ? opts.explicit : null;
  if (explicit?.endCard && explicit.lowerThird) return explicit;
  const parsed = mergeTextOverlay(
    parseTextOverlayFromDirection(opts.videoDirection),
    parseTextOverlayFromDirection(opts.brief),
  );
  const stored = opts.stored && hasTextOverlay(opts.stored) ? opts.stored : null;
  return {
    endCard: explicit?.endCard ?? stored?.endCard ?? parsed.endCard,
    lowerThird: explicit?.lowerThird ?? stored?.lowerThird ?? parsed.lowerThird,
  };
}

export function specFromFields(endCard?: unknown, lowerThird?: unknown): TextOverlaySpec {
  return {
    endCard: card(readUnknownLines(endCard).flatMap((l) => splitOverlayLines(l))),
    lowerThird: card(readUnknownLines(lowerThird).flatMap((l) => extractLowerThirdCopy(l))),
  };
}

export function overlayTags(spec?: TextOverlaySpec | null): string {
  if (!hasTextOverlay(spec)) return "";
  const lines: string[] = [];
  if (spec?.endCard?.lines.length) lines.push(`[END CARD:] ${spec.endCard.lines.join(" / ")}`);
  if (spec?.lowerThird?.lines.length) lines.push(`[LOWER THIRD:] ${spec.lowerThird.lines.join(" | ")}`);
  return lines.join("\n");
}

/** Persist exact overlay tags beside the shot list so remakes can re-parse them. */
export function composeStoredVisual(videoDirection?: string | null, overlay?: TextOverlaySpec | null): string {
  const visual = videoDirection?.trim() ?? "";
  const already = parseTextOverlayFromDirection(visual);
  const missing: string[] = [];
  if (overlay?.endCard && !already.endCard) missing.push(overlayTags({ endCard: overlay.endCard, lowerThird: null }));
  if (overlay?.lowerThird && !already.lowerThird) missing.push(overlayTags({ endCard: null, lowerThird: overlay.lowerThird }));
  return [visual, ...missing].filter(Boolean).join("\n").trim();
}

/** Shot list for the model: keep the beat, drop letters we will composite. */
export function videoDirectionForModel(videoDirection?: string | null, spec?: TextOverlaySpec | null): string {
  const d = videoDirection?.trim() ?? "";
  if (!d) return "";
  if (!hasTextOverlay(spec)) return d;
  return d
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      if (END_CARD_TAG.test(line) || END_CARD_LABEL.test(line)) {
        return "End card: hold a clean plate — no on-screen letters, phones, digits, addresses, or invented logos (type composited after generation).";
      }
      if (LOWER_THIRD_TAG.test(line) || LOWER_THIRD_LABEL.test(line)) {
        return "Lower third: leave a clear name-title band — no on-screen letters, phones, digits, or invented captions (type composited after generation).";
      }
      return raw;
    })
    .join("\n");
}

export function overlayHoldInstruction(spec?: TextOverlaySpec | null): string {
  if (!hasTextOverlay(spec)) return "";
  return [
    "Do not letter end-card or lower-third copy, captions, phones, digits, addresses, logos, or a paragraph of type.",
    "Exact brand type is composited after generation — leave a clean lower-third band and a clean last-three-second hold.",
    "Clean plate only: no invented phone numbers, fake digits, digit scrap, addresses, captions, or gibberish lettering (not Knowillo, not Knoxvillo).",
  ].join(" ");
}

export function shouldOverlayStill(slotId: string): boolean {
  return slotId === "end_card" || slotId === "static";
}

export function shouldOverlayVideo(slotId: string): boolean {
  return slotId !== "mascot";
}

export type OverlayTiming = {
  lowerThirdStart: number;
  lowerThirdEnd: number;
  endCardStart: number;
  duration: number;
};

export function overlayTiming(durationSeconds: number): OverlayTiming {
  const duration = Math.max(1, durationSeconds);
  const endHold = duration >= 8 ? 3 : Math.max(1.2, duration * 0.28);
  const endCardStart = Math.max(0, duration - endHold);
  let lowerThirdStart = duration >= 10 ? 2.4 : Math.max(0.4, duration * 0.18);
  let lowerThirdEnd = Math.max(lowerThirdStart + 1.4, endCardStart - 0.35);
  if (lowerThirdEnd <= lowerThirdStart) {
    lowerThirdStart = Math.max(0.2, endCardStart * 0.25);
    lowerThirdEnd = Math.max(lowerThirdStart + 0.8, endCardStart - 0.2);
  }
  return { lowerThirdStart, lowerThirdEnd, endCardStart, duration };
}

const FONT_REGULAR =
  process.env.MYA_OVERLAY_FONT ?? "/usr/share/fonts/truetype/macos/Inter-Regular.ttf";
const FONT_BOLD =
  process.env.MYA_OVERLAY_FONT_BOLD ?? "/usr/share/fonts/truetype/macos/Inter-Bold.ttf";

export function overlayFontPaths(): { regular: string; bold: string } {
  return { regular: FONT_REGULAR, bold: FONT_BOLD };
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fontFaceCss(): string {
  const { regular, bold } = overlayFontPaths();
  return `@font-face{font-family:'MYAOverlay';src:url('file://${regular}') format('truetype');font-weight:400;}
@font-face{font-family:'MYAOverlay';src:url('file://${bold}') format('truetype');font-weight:700;}`;
}

function fitFontSize(text: string, maxWidth: number, base: number): number {
  const longest = text.length || 1;
  const guessed = (maxWidth / longest) * 1.7;
  return Math.max(18, Math.min(base, guessed));
}

/** SVG markup used to rasterize exact overlay type. Tests assert the strings here. */
export function overlaySvgMarkup(
  spec: TextOverlaySpec,
  width: number,
  height: number,
  kind: "endCard" | "lowerThird" | "both" = "both",
): string {
  const w = Math.max(64, Math.round(width));
  const h = Math.max(64, Math.round(height));
  const parts: string[] = [];

  if ((kind === "endCard" || kind === "both") && spec.endCard?.lines.length) {
    const lines = spec.endCard.lines;
    const boxW = Math.round(w * 0.86);
    const boxX = Math.round((w - boxW) / 2);
    const lineH = Math.round(h * (lines.length > 3 ? 0.045 : 0.055));
    const boxH = Math.round(lineH * lines.length + h * 0.06);
    const boxY = Math.round(h * 0.62);
    parts.push(
      `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${Math.round(h * 0.012)}" fill="rgba(8,12,18,0.62)"/>`,
    );
    lines.forEach((line, i) => {
      const weight = i === 0 ? 700 : 400;
      const size = fitFontSize(line, boxW * 0.9, i === 0 ? Math.round(h * 0.042) : Math.round(h * 0.028));
      const y = boxY + Math.round(h * 0.04) + i * lineH;
      parts.push(
        `<text x="${Math.round(w / 2)}" y="${y}" text-anchor="middle" font-family="MYAOverlay, Inter, 'Noto Sans', sans-serif" font-weight="${weight}" font-size="${size}" fill="#ffffff">${xmlEscape(line)}</text>`,
      );
    });
  }

  if ((kind === "lowerThird" || kind === "both") && spec.lowerThird?.lines.length) {
    const lines = spec.lowerThird.lines;
    const boxW = Math.round(w * 0.72);
    const boxX = Math.round(w * 0.07);
    const lineH = Math.round(h * 0.038);
    const boxH = Math.round(lineH * lines.length + h * 0.04);
    const boxY = Math.round(h * 0.78);
    parts.push(
      `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${Math.round(h * 0.008)}" fill="rgba(8,12,18,0.72)"/>`,
      `<rect x="${boxX}" y="${boxY}" width="${Math.round(w * 0.012)}" height="${boxH}" fill="#f4d35e"/>`,
    );
    lines.forEach((line, i) => {
      const size = fitFontSize(line, boxW * 0.88, i === 0 ? Math.round(h * 0.032) : Math.round(h * 0.022));
      const y = boxY + Math.round(h * 0.032) + i * lineH;
      parts.push(
        `<text x="${boxX + Math.round(w * 0.03)}" y="${y}" text-anchor="start" font-family="MYAOverlay, Inter, 'Noto Sans', sans-serif" font-weight="${i === 0 ? 700 : 400}" font-size="${size}" fill="#ffffff">${xmlEscape(line)}</text>`,
      );
    });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><style type="text/css">${fontFaceCss()}</style></defs>
  ${parts.join("\n  ")}
</svg>`;
}

export function overlaySvgContainsExact(svg: string, line: string): boolean {
  return svg.includes(xmlEscape(line)) || svg.includes(line);
}
