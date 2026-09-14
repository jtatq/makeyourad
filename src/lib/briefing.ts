import { CATEGORIES } from "./categories";
import type { ProductId } from "./products";

/** GPT briefing or PAGE_3 JSON → intake fields + exact ad scripts. */
export type ParsedBriefing = {
  businessName: string | null;
  categoryLabel: string | null;
  categoryId: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  phone: string | null;
  cameraScript: string | null;
  voiceoverScript: string | null;
  socialScript: string | null;
  targetingNotes: string | null;
};

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

function empty(): ParsedBriefing {
  return {
    businessName: null,
    categoryLabel: null,
    categoryId: null,
    address: null,
    city: null,
    state: null,
    website: null,
    phone: null,
    cameraScript: null,
    voiceoverScript: null,
    socialScript: null,
    targetingNotes: null,
  };
}

function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const v = lower[key.toLowerCase()];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function guessCategoryId(label: string | null | undefined): string | null {
  if (!label) return null;
  const t = label.toLowerCase();
  const hit = CATEGORIES.find(
    (c) => t === c.id || t === c.label.toLowerCase() || t.includes(c.label.toLowerCase()),
  );
  if (hit) return hit.id;
  if (/\b(spa|facial|massage|manicure|pedicure)\b/.test(t)) return "spa";
  if (/\b(salon|hair)\b/.test(t)) return "salon";
  if (/\b(gym|pilates|fitness)\b/.test(t)) return "gym";
  if (/\bhvac|heating|air\b/.test(t)) return "hvac";
  return null;
}

function cityStateFromAddress(address: string | null): { city: string | null; state: string | null } {
  if (!address) return { city: null, state: null };
  const m = address.match(/,\s*([^,]+),\s*([A-Z]{2})\b/);
  if (m) return { city: m[1].trim(), state: m[2] };
  const named = address.match(/,\s*([^,]+),\s*([A-Za-z][A-Za-z .]+?)(?:\s+\d{5})?$/);
  if (named) {
    const city = named[1].trim();
    const st = named[2].trim();
    const abbr = STATE_ABBR[st.toLowerCase()] || (st.length === 2 ? st.toUpperCase() : null);
    return { city, state: abbr };
  }
  return { city: null, state: null };
}

function labeled(text: string, key: string): string | null {
  const m = text.match(new RegExp(String.raw`^${key}\s*:\s*(.+)$`, "im"));
  const v = m?.[1]?.trim();
  return v && v.length > 1 ? v : null;
}

function section(text: string, heading: RegExp): string {
  const m = text.match(heading);
  if (!m || m.index == null) return "";
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/\n\s*\d+\.\s+[A-Z]/);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function conceptBlock(concepts: string, names: RegExp): string | null {
  const m = concepts.match(names);
  if (!m || m.index == null) return null;
  const rest = concepts.slice(m.index + m[0].length);
  const next = rest.search(
    /\n\s*(Camera-Facing|Voiceover|Voice-?over|Short-Form|Short Form|Social)\b/i,
  );
  const body = (next === -1 ? rest : rest.slice(0, next)).replace(/^\s*[—\-–:]+\s*/, "").trim();
  return body.length > 8 ? body : null;
}

function parsePage3(obj: Record<string, unknown>): ParsedBriefing {
  const out = empty();
  const url = pick(obj, [
    "PAGE_3_LANDING_PAGE_URL",
    "LANDING_PAGE_URL",
    "website",
    "WEBSITE",
  ]);
  if (url) {
    out.website = url.startsWith("http") ? url : `https://${url}`;
  }
  out.categoryLabel = pick(obj, ["PAGE_3_IN_MARKET_AUDIENCE", "IN_MARKET_AUDIENCE", "category", "Category"]);
  out.categoryId = guessCategoryId(out.categoryLabel);
  out.targetingNotes = pick(obj, [
    "PAGE_3_ADDITIONAL_TARGETING_NOTES",
    "ADDITIONAL_TARGETING_NOTES",
  ]);
  const retail = pick(obj, ["PAGE_3_PRIMARY_RETAIL_ADDRESS", "PRIMARY_RETAIL_ADDRESS"]);
  const loc = cityStateFromAddress(retail);
  out.city = loc.city;
  out.state = loc.state;
  out.phone = pick(obj, ["PAGE_3_PHONE", "PHONE", "Phone"]);
  out.businessName = pick(obj, ["PAGE_3_BUSINESS_NAME", "BUSINESS_NAME", "Business Name"]);
  return out;
}

function parseTextBrief(text: string): ParsedBriefing {
  const out = empty();
  const biz = section(text, /(?:^|\n)\s*2\.\s*BUSINESS INFO\b/i) || text;
  const concepts = section(text, /(?:^|\n)\s*8\.\s*AD CONCEPTS\b/i) || text;
  out.businessName = labeled(biz, "Business Name") || labeled(text, "Business Name");
  out.categoryLabel = labeled(biz, "Category");
  out.categoryId = guessCategoryId(out.categoryLabel);
  out.address = labeled(biz, "Business Address") || labeled(biz, "Address");
  const loc = cityStateFromAddress(out.address);
  out.city = loc.city;
  out.state = loc.state;
  const site = labeled(biz, "Website");
  if (site) out.website = site.startsWith("http") ? site : `https://${site}`;
  out.phone = labeled(biz, "Phone");
  out.cameraScript = conceptBlock(concepts, /Camera-Facing[^\n]{0,48}\n/i);
  out.voiceoverScript = conceptBlock(concepts, /Voice-?over[^\n]{0,48}\n/i);
  out.socialScript = conceptBlock(concepts, /Short-Form(?:\s+Social)?[^\n]{0,48}\n/i);
  return out;
}

function first(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/** Accept PAGE_3 JSON, a GPT audience brief, or both in one paste. */
export function parseAudiencePaste(raw: string): ParsedBriefing {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return empty();
  let jsonPart: Record<string, unknown> | null = null;
  let rest = text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        jsonPart = parsed as Record<string, unknown>;
        rest = `${text.slice(0, jsonMatch.index)}${text.slice((jsonMatch.index ?? 0) + jsonMatch[0].length)}`;
      }
    } catch {
      jsonPart = null;
    }
  }
  const fromJson = jsonPart ? parsePage3(jsonPart) : empty();
  const fromText = parseTextBrief(rest);
  return {
    businessName: first(fromText.businessName, fromJson.businessName),
    categoryLabel: first(fromText.categoryLabel, fromJson.categoryLabel),
    categoryId: fromText.categoryId || fromJson.categoryId,
    address: first(fromText.address, fromJson.address),
    city: first(fromText.city, fromJson.city),
    state: first(fromText.state, fromJson.state),
    website: first(fromText.website, fromJson.website),
    phone: first(fromText.phone, fromJson.phone),
    cameraScript: first(fromText.cameraScript, fromJson.cameraScript),
    voiceoverScript: first(fromText.voiceoverScript, fromJson.voiceoverScript),
    socialScript: first(fromText.socialScript, fromJson.socialScript),
    targetingNotes: first(fromJson.targetingNotes, fromText.targetingNotes),
  };
}

export function scriptForProduct(parsed: ParsedBriefing, productId: ProductId, fallback: string): string {
  if (productId === "video-40") return parsed.cameraScript || fallback;
  if (productId === "video-20") return parsed.voiceoverScript || fallback;
  if (productId === "video-12") return parsed.socialScript || fallback;
  return fallback;
}

export function labeledBriefFromParsed(parsed: ParsedBriefing, fallback: string): string {
  const parts: string[] = [];
  if (parsed.socialScript) parts.push(`12 second:\n${parsed.socialScript.trim()}`);
  if (parsed.voiceoverScript) parts.push(`20 second:\n${parsed.voiceoverScript.trim()}`);
  if (parsed.cameraScript) parts.push(`40 second:\n${parsed.cameraScript.trim()}`);
  if (parts.length) return parts.join("\n\n");
  if (parsed.targetingNotes) return parsed.targetingNotes.trim();
  return fallback.trim();
}

export function parseSummary(parsed: ParsedBriefing): string {
  const bits: string[] = [];
  if (parsed.businessName) bits.push(parsed.businessName);
  if (parsed.categoryLabel) bits.push(parsed.categoryLabel);
  if (parsed.city && parsed.state) bits.push(`${parsed.city}, ${parsed.state}`);
  if (parsed.voiceoverScript) bits.push("20s voiceover (will generate)");
  if (parsed.socialScript) bits.push("12s social (queued later)");
  if (parsed.cameraScript) bits.push("40s camera (queued later)");
  if (parsed.website) bits.push(parsed.website.replace(/^https?:\/\//, ""));
  return bits.join(" · ");
}
