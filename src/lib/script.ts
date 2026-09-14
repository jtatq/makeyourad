import { parseAudiencePaste, scriptForProduct } from "./briefing";
import type { ProductId } from "./products";
import { masterClips } from "./recipe";

const DURATION_SPEAK =
  /\b(?:12|20|25|30|40|55|60)(?:\s*[–-]\s*(?:12|20|25|30|40|55|60))?\s*-?\s*seconds?\b/gi;
const SECTION_HEAD =
  /^(?:camera-facing|voice-?over|short-form(?:\s+social)?)(?:\s*[—\-–:].*)?$/i;
const LEADING_LABEL = /^(?:12|20|40)\s*seconds?\s*[:\-–.]\s*/i;

/** Strip duration labels so talent never says "twelve seconds" / "forty seconds". */
export function spokenOnly(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (SECTION_HEAD.test(trimmed)) return "";
      return trimmed.replace(LEADING_LABEL, "").replace(DURATION_SPEAK, "").trim();
    })
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function labeledSection(brief: string, seconds: 12 | 20 | 40): string | null {
  const re = new RegExp(
    String.raw`${seconds}\s*seconds?\s*[:\-–]\s*([\s\S]*?)(?=(?:12|20|40)\s*seconds?\s*[:\-–]|$)`,
    "i",
  );
  const m = brief.match(re);
  const body = m?.[1]?.trim() ?? "";
  return body.length > 8 ? spokenOnly(body) : null;
}

/** One product, one script. Social ≠ 20s ≠ 40s. */
export function extractProductScript(brief: string, productId: ProductId): string {
  const text = brief.trim();
  if (!text) return "";
  const parsed = parseAudiencePaste(text);
  const fromProfile = spokenOnly(scriptForProduct(parsed, productId, ""));
  if (fromProfile) return fromProfile;
  if (productId === "video-40") return labeledSection(text, 40) || spokenOnly(text);
  if (productId === "video-20") return labeledSection(text, 20) || spokenOnly(text);
  if (productId === "video-12") return labeledSection(text, 12) || spokenOnly(text);
  return spokenOnly(text);
}

export function slotScripts(script: string, productId: ProductId): Record<string, string> {
  const clips = masterClips(productId);
  const clean = spokenOnly(script);
  const out: Record<string, string> = {};
  if (!clean || clips.length === 0) return out;
  const sentences = clean
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => spokenOnly(s))
    .filter(Boolean);
  if (sentences.length === 0) {
    out[clips[0].id] = clean;
    return out;
  }
  const total = clips.reduce((n, c) => n + c.seconds, 0) || 1;
  let cursor = 0;
  for (let i = 0; i < clips.length; i += 1) {
    const leftSlots = clips.length - i;
    const leftSent = sentences.length - cursor;
    if (leftSent <= 0) break;
    let take =
      i === clips.length - 1 ? leftSent : Math.max(1, Math.round((clips[i].seconds / total) * sentences.length));
    take = Math.min(take, leftSent - (leftSlots - 1));
    take = Math.max(1, take);
    out[clips[i].id] = sentences.slice(cursor, cursor + take).join(" ");
    cursor += take;
  }
  return out;
}

export function slotScriptLine(brief: string, productId: ProductId, slotId: string): string {
  const script = extractProductScript(brief, productId);
  if (!script) return "";
  const beats = slotScripts(script, productId);
  return spokenOnly(beats[slotId] || script);
}
