import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { CATEGORIES, CATEGORY_IDS } from "./categories";
import { US_STATES } from "./intake";
import { TONES, type Tone } from "./products";
import {
  CATEGORY_ID_SET,
  isTone,
  type WebsiteAsset,
  type WebsiteProfile,
  type WebsiteReadResult,
} from "./website-profile";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const HTML_MAX = 1_200_000;
const IMAGE_MAX = 5_000_000;
const DATA_URL_MAX = 2_400_000;
const CACHE_TTL_MS = 15 * 60 * 1000;

const cache = new Map<string, { at: number; value: Extract<WebsiteReadResult, { ok: true }> }>();

const STATE_NAME: Record<string, (typeof US_STATES)[number]> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const CATEGORY_KEYWORDS: Array<{ id: string; words: string[] }> = [
  { id: "hvac", words: ["hvac", "air conditioning", "heating and cooling", "ac repair", "furnace", "heat pump"] },
  { id: "plumbing", words: ["plumb", "drain cleaning", "water heater", "leak repair"] },
  { id: "electrical", words: ["electric", "electrician", "panel upgrade"] },
  { id: "roofing", words: ["roof", "shingle", "roofer"] },
  { id: "general_contractor", words: ["general contractor", "remodel", "home builder"] },
  { id: "garage_door", words: ["garage door"] },
  { id: "pest_control", words: ["pest", "termite", "exterminat"] },
  { id: "landscaping", words: ["landscape", "lawn care", "irrigation"] },
  { id: "tree_service", words: ["tree service", "tree removal", "arborist"] },
  { id: "cleaning", words: ["house cleaning", "maid service", "janitorial"] },
  { id: "painting", words: ["painter", "house painting", "interior paint"] },
  { id: "flooring", words: ["flooring", "hardwood floor", "carpet install"] },
  { id: "windows_doors", words: ["replacement window", "entry door", "window and door"] },
  { id: "solar", words: ["solar panel", "solar install"] },
  { id: "pool_spa", words: ["pool service", "spa repair", "pool cleaner"] },
  { id: "auto_repair", words: ["auto repair", "car repair", "mechanic"] },
  { id: "auto_body", words: ["auto body", "collision"] },
  { id: "dental", words: ["dental", "dentist", "orthodont"] },
  { id: "chiropractic", words: ["chiropract"] },
  { id: "medical_clinic", words: ["clinic", "family medicine", "urgent care"] },
  { id: "veterinary", words: ["veterinar", "animal hospital", "pet clinic"] },
  { id: "law_firm", words: ["law firm", "attorney", "lawyer"] },
  { id: "insurance", words: ["insurance agency", "insurance agent"] },
  { id: "real_estate", words: ["real estate", "realtor"] },
  { id: "restaurant", words: ["restaurant", "grill", "bistro"] },
  { id: "cafe", words: ["cafe", "coffee shop"] },
  { id: "salon", words: ["hair salon", "barber", "haircut"] },
  { id: "spa", words: ["spa", "massage", "facial"] },
  { id: "gym", words: ["gym", "fitness", "personal train"] },
  { id: "daycare", words: ["daycare", "child care", "preschool"] },
  { id: "moving", words: ["moving company", "movers"] },
  { id: "locksmith", words: ["locksmith"] },
  { id: "funeral", words: ["funeral", "mortuary"] },
  { id: "church", words: ["church", "parish", "congregation"] },
];

type ImageHint = { url: string; score: number; role: "logo" | "photo" };

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/"/gi, '"')
    .replace(/&#39;|'/gi, "'")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function clip(value: string, max: number): string {
  const t = value.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd();
}

function isPrivateIp(ip: string): boolean {
  const v = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (v === "::1" || v === "0.0.0.0") return true;
  if (v.includes(":")) {
    const lower = v.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  const parts = v.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

async function assertPublicHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("That doesn’t look like a website.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an http or https website.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".arpa")
  ) {
    throw new Error("We can’t open that address.");
  }
  if (isIP(host) && isPrivateIp(host)) throw new Error("We can’t open that address.");
  const records = await lookup(host, { all: true });
  if (records.length === 0) throw new Error("We couldn’t find that website.");
  for (const rec of records) {
    if (isPrivateIp(rec.address)) throw new Error("We can’t open that address.");
  }
  return url;
}

async function fetchPublic(
  urlString: string,
  opts: { maxBytes: number; accept: string; timeoutMs: number },
): Promise<{ url: string; contentType: string; buffer: Buffer }> {
  let current = urlString;
  for (let hop = 0; hop <= 5; hop += 1) {
    const url = await assertPublicHttpUrl(current);
    const res = await fetch(url.href, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        Accept: opts.accept,
        "Accept-Language": "en-US,en;q=0.8",
        Referer: `${url.origin}/`,
      },
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("The site didn’t respond.");
      current = new URL(loc, url).href;
      continue;
    }
    if (!res.ok) throw new Error("The site didn’t respond in a way we can read.");
    const contentType = res.headers.get("content-type") || "";
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > opts.maxBytes) throw new Error("That page is too large to read.");
    return { url: url.href, contentType, buffer };
  }
  throw new Error("The site redirected too many times.");
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z:_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function metaContents(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<meta\b([^>]+)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const a = attrs(m[1]);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content && !out[key]) out[key] = a.content.trim();
  }
  return out;
}

function tagText(html: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html);
  return m ? clip(decodeEntities(m[1].replace(/<[^>]+>/g, " ")), 180) : "";
}

function htmlToText(html: string): string {
  return clip(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
    14000,
  );
}

function ldNodes(html: string): Record<string, unknown>[] {
  const acc: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      flattenLd(JSON.parse(m[1].trim()), acc);
    } catch {
      /* ignore broken JSON-LD */
    }
  }
  return acc;
}

function flattenLd(node: unknown, acc: Record<string, unknown>[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) flattenLd(n, acc);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj["@graph"]) flattenLd(obj["@graph"], acc);
  acc.push(obj);
}

function ldString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.url === "string") return o.url;
    if (typeof o.name === "string") return o.name;
    if (typeof o.telephone === "string") return o.telephone;
    if (typeof o.email === "string") return o.email;
    if (typeof o.streetAddress === "string") return o.streetAddress;
  }
  return "";
}

function pickLd(nodes: Record<string, unknown>[]): Record<string, unknown> | null {
  const rank = (n: Record<string, unknown>) => {
    const t = JSON.stringify(n["@type"] ?? "").toLowerCase();
    if (t.includes("localbusiness") || t.includes("dentist") || t.includes("hvac") || t.includes("homeandconstruction"))
      return 3;
    if (t.includes("organization") || t.includes("store") || t.includes("professional")) return 2;
    return 1;
  };
  return nodes.slice().sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

function absUrl(base: string, src: string | undefined): string | null {
  if (!src) return null;
  const s = src.trim();
  if (!s || s.startsWith("data:") || s.startsWith("javascript:")) return null;
  try {
    return new URL(s, base).href;
  } catch {
    return null;
  }
}

function looksJunk(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("sprite") ||
    u.includes("1x1") ||
    u.includes("pixel") ||
    u.includes("tracking") ||
    u.includes("gravatar") ||
    u.includes("facebook.com") ||
    u.includes("twitter.com") ||
    u.includes("linkedin") ||
    u.includes("doubleclick") ||
    u.includes("/badge") ||
    u.includes("payment") ||
    /\.(gif)(\?|$)/i.test(u)
  );
}

function collectImages(html: string, base: string, meta: Record<string, string>, ld: Record<string, unknown> | null): ImageHint[] {
  const scored = new Map<string, ImageHint>();
  const add = (raw: string | undefined, score: number, role: "logo" | "photo") => {
    const url = absUrl(base, raw);
    if (!url || looksJunk(url)) return;
    const prev = scored.get(url);
    if (!prev || score > prev.score) scored.set(url, { url, score, role: prev?.role === "logo" ? "logo" : role });
  };

  add(ldString(ld?.logo), 100, "logo");
  add(meta["og:logo"], 92, "logo");
  add(ldString(ld?.image), 78, "photo");
  add(meta["og:image"], 74, "photo");
  add(meta["og:image:url"], 74, "photo");
  add(meta["twitter:image"], 68, "photo");

  const linkRe = /<link\b([^>]+)>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html))) {
    const a = attrs(lm[1]);
    const rel = (a.rel || "").toLowerCase();
    if (rel.includes("apple-touch-icon")) add(a.href, 55, "logo");
    else if (rel.includes("icon") && !/\.ico(\?|$)/i.test(a.href || "")) add(a.href, 30, "logo");
  }

  const imgRe = /<img\b([^>]+)>/gi;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(html))) {
    const a = attrs(im[1]);
    const blob = `${a.src} ${a.alt} ${a.class} ${a.id} ${a.width} ${a.height}`.toLowerCase();
    const src = a.src || (a.srcset || "").split(",")[0]?.trim().split(/\s+/)[0];
    if (!src) continue;
    if (blob.includes("logo") || blob.includes("brand") || blob.includes("wordmark")) add(src, 88, "logo");
    else if (
      blob.includes("hero") ||
      blob.includes("team") ||
      blob.includes("truck") ||
      blob.includes("van") ||
      blob.includes("gallery") ||
      blob.includes("project") ||
      blob.includes("before") ||
      blob.includes("after") ||
      blob.includes("storefront") ||
      blob.includes("job")
    )
      add(src, 70, "photo");
    else if (blob.includes("icon") || blob.includes("arrow") || blob.includes("button")) continue;
    else add(src, 42, "photo");
  }

  return [...scored.values()].sort((a, b) => b.score - a.score);
}

function extractPhones(text: string): string {
  const m = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

function extractEmails(html: string): string {
  const mails = [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((x) => decodeURIComponent(x[1]).trim());
  const prefer = mails.find((e) => /^(hello|info|office|contact|admin|service)@/i.test(e));
  return (prefer || mails[0] || "").slice(0, 120);
}

function extractCityState(text: string): { city: string; state: string } {
  const pair = text.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?),\s*([A-Z]{2})\b/);
  if (pair && (US_STATES as readonly string[]).includes(pair[2])) {
    return { city: pair[1], state: pair[2] };
  }
  for (const [name, code] of Object.entries(STATE_NAME)) {
    const re = new RegExp(`\\b([A-Z][a-zA-Z]+(?:\\s[A-Z][a-zA-Z]+)?)[,\\s]+${name}\\b`, "i");
    const m = text.match(re);
    if (m) return { city: m[1], state: code };
  }
  return { city: "", state: "" };
}

function inferCategory(text: string): string {
  const hay = text.toLowerCase();
  let best = { id: "general_contractor", n: 0 };
  for (const row of CATEGORY_KEYWORDS) {
    const n = row.words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
    if (n > best.n) best = { id: row.id, n };
  }
  return best.id;
}

function cleanName(raw: string): string {
  return clip(
    raw
      .replace(/\s*[\|–—-]\s*(home|welcome|official site).*$/i, "")
      .replace(/\s*[\|–—].*$/, "")
      .replace(/\s+/g, " "),
    80,
  );
}

function toDataUrl(mime: string, buffer: Buffer): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function rasterize(hint: ImageHint, index: number): Promise<WebsiteAsset | null> {
  try {
    const fetched = await fetchPublic(hint.url, {
      maxBytes: IMAGE_MAX,
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      timeoutMs: 8000,
    });
    const isLogo = hint.role === "logo";
    if (/svg/i.test(fetched.contentType) || /\.svg(\?|$)/i.test(hint.url)) {
      if (isLogo && fetched.buffer.length < 180_000) {
        const dataUrl = toDataUrl("image/svg+xml", fetched.buffer);
        if (dataUrl.length <= DATA_URL_MAX) {
          return { filename: "logo.svg", mime: "image/svg+xml", dataUrl, role: "logo" };
        }
      }
    }
    const img = sharp(fetched.buffer, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w && h && (w < 48 || h < 48) && !isLogo) return null;
    if (w && h && w <= 8 && h <= 8) return null;
    const maxEdge = isLogo ? 900 : 1280;
    const resized = img.resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
    if (isLogo && meta.hasAlpha) {
      const buffer = await resized.png({ compressionLevel: 8 }).toBuffer();
      const dataUrl = toDataUrl("image/png", buffer);
      if (dataUrl.length > DATA_URL_MAX) return null;
      return { filename: "logo.png", mime: "image/png", dataUrl, role: "logo" };
    }
    const buffer = await resized.jpeg({ quality: isLogo ? 84 : 72, mozjpeg: true }).toBuffer();
    const dataUrl = toDataUrl("image/jpeg", buffer);
    if (dataUrl.length > DATA_URL_MAX) return null;
    return {
      filename: isLogo ? "logo.jpg" : `site-${index + 1}.jpg`,
      mime: "image/jpeg",
      dataUrl,
      role: isLogo ? "logo" : "photo",
    };
  } catch {
    return null;
  }
}

type Heuristic = {
  businessName: string;
  tagline: string;
  about: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  category: string;
  pageText: string;
  title: string;
  description: string;
};

function heuristicFromPage(html: string, pageUrl: string): Heuristic {
  const meta = metaContents(html);
  const nodes = ldNodes(html);
  const ld = pickLd(nodes);
  const title = tagText(html, "title");
  const description = meta["og:description"] || meta.description || ldString(ld?.description);
  const addr = (ld?.address && typeof ld.address === "object" ? ld.address : null) as Record<string, unknown> | null;
  const text = htmlToText(html);
  const fromAddr = {
    city: ldString(addr?.addressLocality),
    state: normalizeState(ldString(addr?.addressRegion)),
  };
  const fromText = extractCityState(`${title} ${description} ${text.slice(0, 2500)}`);
  const name = cleanName(ldString(ld?.name) || meta["og:site_name"] || meta["og:title"] || title) || new URL(pageUrl).hostname.replace(/^www\./, "");
  return {
    businessName: name,
    tagline: clip(ldString(ld?.slogan) || description, 200),
    about: clip(description || text.slice(0, 500), 800),
    phone: ldString(ld?.telephone) || extractPhones(html) || extractPhones(text),
    email: ldString(ld?.email) || extractEmails(html),
    city: fromAddr.city || fromText.city,
    state: fromAddr.state || fromText.state,
    category: inferCategory(`${title} ${description} ${name} ${text.slice(0, 2000)}`),
    pageText: text,
    title,
    description,
  };
}

function normalizeState(raw: string): string {
  const t = raw.trim();
  if ((US_STATES as readonly string[]).includes(t.toUpperCase())) return t.toUpperCase();
  return STATE_NAME[t.toLowerCase()] || "";
}

type GrokFields = {
  businessName: string;
  tagline: string;
  category: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  about: string;
  services: string[];
  proofPoints: string[];
  hours: string;
  serviceArea: string;
  cta: string;
  brief: string;
  tone: Tone;
};

async function enrichWithGrok(pageUrl: string, h: Heuristic): Promise<GrokFields | null> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) return null;
  const payload = {
    model: "grok-4.5",
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      {
        role: "system",
        content:
          "Extract a local-business ad profile from a website. Use only facts on the page. Empty string if unknown. brief is 2–5 sentences the business would want in a local ad: what they do, who they serve, a proof point, and a CTA. Plain language, no agency jargon.",
      },
      {
        role: "user",
        content: [
          `URL: ${pageUrl}`,
          `Guessed name: ${h.businessName}`,
          `Title: ${h.title}`,
          `Description: ${h.description}`,
          `Guessed phone: ${h.phone}`,
          `Guessed city/state: ${h.city}, ${h.state}`,
          `Page text:`,
          h.pageText.slice(0, 9000),
        ].join("\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "website_profile",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "businessName",
            "tagline",
            "category",
            "city",
            "state",
            "phone",
            "email",
            "about",
            "services",
            "proofPoints",
            "hours",
            "serviceArea",
            "cta",
            "brief",
            "tone",
          ],
          properties: {
            businessName: { type: "string" },
            tagline: { type: "string" },
            category: { type: "string", enum: CATEGORY_IDS },
            city: { type: "string" },
            state: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
            about: { type: "string" },
            services: { type: "array", items: { type: "string" } },
            proofPoints: { type: "array", items: { type: "string" } },
            hours: { type: "string" },
            serviceArea: { type: "string" },
            cta: { type: "string" },
            brief: { type: "string" },
            tone: { type: "string", enum: [...TONES] },
          },
        },
      },
    },
  };
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content) as GrokFields;
  } catch {
    return null;
  }
}

function mergeProfile(pageUrl: string, h: Heuristic, grok: GrokFields | null): WebsiteProfile {
  const state = normalizeState(grok?.state || h.state);
  const category = grok?.category && CATEGORY_ID_SET.has(grok.category) ? grok.category : h.category;
  const tone: Tone = grok && isTone(grok.tone) ? grok.tone : "trustworthy";
  const name = clip(grok?.businessName || h.businessName, 80);
  const services = (grok?.services ?? []).map((s) => clip(s, 80)).filter(Boolean).slice(0, 12);
  const proof = (grok?.proofPoints ?? []).map((s) => clip(s, 120)).filter(Boolean).slice(0, 8);
  const brief =
    clip(grok?.brief || "", 1200) ||
    clip(
      [h.tagline || h.about, h.city ? `Local to ${h.city}${state ? `, ${state}` : ""}.` : "", "End on a clear call to book or call."]
        .filter(Boolean)
        .join(" "),
      1200,
    );
  return {
    sourceUrl: pageUrl,
    businessName: name,
    tagline: clip(grok?.tagline || h.tagline, 200),
    about: clip(grok?.about || h.about, 800),
    services,
    proofPoints: proof,
    hours: clip(grok?.hours || "", 200),
    serviceArea: clip(grok?.serviceArea || "", 200),
    cta: clip(grok?.cta || "", 120),
    category,
    city: clip(grok?.city || h.city, 60),
    state,
    phone: clip(grok?.phone || h.phone, 32),
    email: clip(grok?.email || h.email, 120),
    brief: brief.length >= 12 ? brief : clip(`${name} — local ${CATEGORIES.find((c) => c.id === category)?.label ?? "business"}. Call to book.`, 1200),
    tone,
  };
}

export async function readBusinessWebsite(rawUrl: string): Promise<WebsiteReadResult> {
  let pageUrl: string;
  try {
    pageUrl = new URL(rawUrl.match(/^[a-z][a-z0-9+.-]*:/i) ? rawUrl : `https://${rawUrl.trim()}`).href;
  } catch {
    return { ok: false, error: "That doesn’t look like a website." };
  }

  const cached = cache.get(pageUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const page = await fetchPublic(pageUrl, {
      maxBytes: HTML_MAX,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      timeoutMs: 10000,
    });
    const html = page.buffer.toString("utf8");
    if (html.length < 80) return { ok: false, error: "That page didn’t have enough public info. Fill in the details below." };

    const h = heuristicFromPage(html, page.url);
    const meta = metaContents(html);
    const ld = pickLd(ldNodes(html));
    const hints = collectImages(html, page.url, meta, ld);
    const logoHints = hints.filter((x) => x.role === "logo").slice(0, 3);
    const photoHints = hints.filter((x) => x.role === "photo").slice(0, 10);

    const [grok, logoTried, photoTried] = await Promise.all([
      enrichWithGrok(page.url, h).catch(() => null),
      Promise.all(logoHints.map((hint, i) => rasterize(hint, i))),
      Promise.all(photoHints.map((hint, i) => rasterize(hint, i))),
    ]);

    const profile = mergeProfile(page.url, h, grok);
    if (!profile.businessName || profile.businessName.length < 2) {
      return { ok: false, error: "That page didn’t have enough public info. Fill in the details below." };
    }

    const logo = logoTried.find((a): a is WebsiteAsset => Boolean(a && a.role === "logo")) ?? null;
    const photos: WebsiteAsset[] = [];
    const seen = new Set<string>(logo ? [logo.dataUrl.slice(0, 80)] : []);
    for (const asset of photoTried) {
      if (!asset || asset.role !== "photo") continue;
      const key = asset.dataUrl.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      photos.push({ ...asset, filename: `site-${photos.length + 1}.jpg` });
      if (photos.length >= (logo ? 7 : 8)) break;
    }

    const value: Extract<WebsiteReadResult, { ok: true }> = {
      ok: true,
      url: page.url,
      profile,
      logo,
      photos,
    };
    cache.set(pageUrl, { at: Date.now(), value });
    cache.set(page.url, { at: Date.now(), value });
    if (cache.size > 40) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that website.";
    if (
      message.includes("don’t look") ||
      message.includes("can’t open") ||
      message.includes("didn’t") ||
      message.includes("couldn’t") ||
      message.includes("too large") ||
      message.includes("http or https") ||
      message.includes("Paste")
    ) {
      return { ok: false, error: message };
    }
    return { ok: false, error: "Could not read that website. Fill in the details below." };
  }
}
