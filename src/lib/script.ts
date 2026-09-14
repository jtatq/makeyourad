import type { ProductId } from "./products";
import { masterClips } from "./recipe";

function labeledSection(brief: string, seconds: 20 | 40): string | null {
  const re = new RegExp(
    String.raw`${seconds}\s*seconds?\s*[:\-–]\s*([\s\S]*?)(?=(?:20|40)\s*seconds?\s*[:\-–]|$)`,
    "i",
  );
  const m = brief.match(re);
  const body = m?.[1]?.trim() ?? "";
  return body.length > 8 ? body : null;
}

/** Pull the 20s or 40s block when both are pasted; otherwise the whole brief. */
export function extractProductScript(brief: string, productId: ProductId): string {
  const text = brief.trim();
  if (!text) return "";
  if (productId === "video-40") return labeledSection(text, 40) || labeledSection(text, 20) || text;
  if (productId === "video-20") return labeledSection(text, 20) || text;
  return text;
}

export function slotScripts(script: string, productId: ProductId): Record<string, string> {
  const clips = masterClips(productId);
  const out: Record<string, string> = {};
  if (!script || clips.length === 0) return out;
  const sentences = script
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/^(20|40)\s*seconds?\s*[:\-–]\s*/i, "").trim())
    .filter(Boolean);
  if (sentences.length === 0) {
    out[clips[0].id] = script;
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
  return beats[slotId] || script;
}
