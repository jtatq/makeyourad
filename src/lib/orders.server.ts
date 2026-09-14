import { parseAudiencePaste, scriptForProduct } from "./briefing";
import { getSql } from "./db";
import {
  sendDeliveryEmail,
  sendOperatorPaidNotice,
  sendOrderConfirmation,
} from "./email.server";
import { safeFilename, safeMime } from "./filename";
import { makeId } from "./ids";
import { asIso, asNumber, parseJsonArray, parseJsonObject } from "./json";
import {
  requestOrigin,
  signedFileUrl,
} from "./operator-auth.server";
import { spokenOnly } from "./script";
import { PRODUCTS, priceCentsFor, type OrderStatus, type Platform, type ProductId, type Tone } from "./products";
import { buildPacket, type GenerationPacket, type IntakeForPrompt } from "./prompts/compiler";
import type { WebsiteFacts } from "./website-profile";

export type AssetRow = {
  id: string;
  order_id: string | null;
  checkout_id: string | null;
  kind: string;
  filename: string;
  mime: string;
  data_url: string | null;
  external_url: string | null;
  created_at: string;
};

export type OrderRow = {
  id: string;
  checkout_id: string | null;
  product: ProductId;
  add_ons: string[];
  price_cents: number;
  stripe_session_id: string | null;
  business_name: string;
  category: string;
  city: string;
  state: string;
  website: string | null;
  phone: string;
  email: string;
  brief: string;
  tone: Tone;
  platforms: Platform[];
  mascot_description: string | null;
  website_profile: WebsiteFacts | null;
  status: OrderStatus;
  claimed_at: string | null;
  qc_passed_at: string | null;
  delivered_at: string | null;
  attention_note: string | null;
  featured_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  order_id: string;
  action: string;
  note: string | null;
  actor: string;
  created_at: string;
};

export type OrderSql = {
  id: string;
  checkout_id: string | null;
  product: string;
  add_ons: string;
  price_cents: number | string;
  stripe_session_id: string | null;
  business_name: string;
  category: string;
  city: string;
  state: string;
  website: string | null;
  phone: string;
  email: string;
  brief: string;
  tone: string;
  platforms: string;
  mascot_description: string | null;
  website_profile: string | null;
  status: string;
  claimed_at: string | Date | null;
  qc_passed_at: string | Date | null;
  delivered_at: string | Date | null;
  attention_note: string | null;
  featured_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type CheckoutInput = {
  product: ProductId;
  mascot: boolean;
  mascotDescription?: string;
  businessName: string;
  category: string;
  city: string;
  state: string;
  website?: string;
  phone: string;
  email: string;
  brief: string;
  tone: Tone;
  platforms: Platform[];
  assets: Array<{ filename: string; mime: string; dataUrl: string; kind?: "upload" | "logo" }>;
  websiteProfile?: WebsiteFacts;
};

export function mapOrder(row: OrderSql): OrderRow {
  return {
    id: row.id,
    checkout_id: row.checkout_id,
    product: row.product as ProductId,
    add_ons: parseJsonArray(row.add_ons),
    price_cents: asNumber(row.price_cents),
    stripe_session_id: row.stripe_session_id,
    business_name: row.business_name,
    category: row.category,
    city: row.city,
    state: row.state,
    website: row.website,
    phone: row.phone,
    email: row.email,
    brief: row.brief,
    tone: row.tone as Tone,
    platforms: parseJsonArray(row.platforms) as Platform[],
    mascot_description: row.mascot_description,
    website_profile: parseJsonObject<WebsiteFacts>(row.website_profile),
    status: row.status as OrderStatus,
    claimed_at: asIso(row.claimed_at),
    qc_passed_at: asIso(row.qc_passed_at),
    delivered_at: asIso(row.delivered_at),
    attention_note: row.attention_note,
    featured_at: asIso(row.featured_at),
    created_at: asIso(row.created_at) ?? new Date().toISOString(),
    updated_at: asIso(row.updated_at) ?? new Date().toISOString(),
  };
}

function intakeFrom(order: OrderRow): IntakeForPrompt {
  return {
    businessName: order.business_name,
    category: order.category,
    city: order.city,
    state: order.state,
    website: order.website,
    phone: order.phone,
    email: order.email,
    brief: order.brief,
    tone: order.tone,
    platforms: order.platforms,
    mascotDescription: order.mascot_description,
    websiteProfile: order.website_profile,
  };
}

export async function insertCheckout(input: CheckoutInput): Promise<{ id: string; priceCents: number }> {
  const sql = await getSql();
  const id = makeId("chk");
  const addOns = input.mascot ? ["mascot"] : [];
  const priceCents = priceCentsFor(input.product, input.mascot);
  await sql.query(
    `insert into checkouts (
      id, product, add_ons, price_cents, business_name, category, city, state, website,
      phone, email, brief, tone, platforms, mascot_description, website_profile, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending')`,
    [
      id,
      input.product,
      JSON.stringify(addOns),
      priceCents,
      input.businessName,
      input.category,
      input.city,
      input.state,
      input.website || null,
      input.phone,
      input.email,
      input.brief,
      input.tone,
      JSON.stringify(input.platforms),
      input.mascot ? input.mascotDescription || null : null,
      input.websiteProfile ? JSON.stringify(input.websiteProfile) : null,
    ],
  );
  for (const asset of input.assets) {
    await sql.query(
      `insert into order_assets (id, checkout_id, kind, filename, mime, data_url)
       values ($1,$2,$3,$4,$5,$6)`,
      [makeId("ast"), id, asset.kind === "logo" ? "logo" : "upload", safeFilename(asset.filename), safeMime(asset.mime, "image/jpeg"), asset.dataUrl],
    );
  }
  return { id, priceCents };
}

export async function getCheckout(id: string) {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    product: string;
    add_ons: string;
    price_cents: number | string;
    business_name: string;
    email: string;
    city: string;
    state: string;
    status: string;
    stripe_session_id: string | null;
    category: string;
    phone: string;
    website: string | null;
    brief: string;
    tone: string;
    platforms: string;
    mascot_description: string | null;
  }>(`select * from checkouts where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function attachStripeSession(checkoutId: string, sessionId: string) {
  const sql = await getSql();
  await sql.query(`update checkouts set stripe_session_id = $1 where id = $2`, [sessionId, checkoutId]);
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  const sql = await getSql();
  const rows = await sql.query<OrderSql>(`select * from orders where id = $1`, [id]);
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function getOrderByStripeSession(sessionId: string): Promise<OrderRow | null> {
  const sql = await getSql();
  const rows = await sql.query<OrderSql>(`select * from orders where stripe_session_id = $1`, [sessionId]);
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function listOrders(status?: string): Promise<OrderRow[]> {
  const sql = await getSql();
  const rows = status
    ? await sql.query<OrderSql>(`select * from orders where status = $1 order by created_at desc`, [status])
    : await sql.query<OrderSql>(`select * from orders order by created_at desc`);
  return rows.map(mapOrder);
}

export async function listEvents(orderId: string): Promise<EventRow[]> {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    order_id: string;
    action: string;
    note: string | null;
    actor: string;
    created_at: string | Date;
  }>(`select * from order_events where order_id = $1 order by created_at asc`, [orderId]);
  return rows.map((r) => ({
    ...r,
    created_at: asIso(r.created_at) ?? new Date().toISOString(),
  }));
}

export async function listAssets(opts: { orderId?: string; checkoutId?: string }): Promise<AssetRow[]> {
  const sql = await getSql();
  const rows = opts.orderId
    ? await sql.query<AssetRow>(`select * from order_assets where order_id = $1 order by created_at asc`, [opts.orderId])
    : await sql.query<AssetRow>(`select * from order_assets where checkout_id = $1 order by created_at asc`, [
        opts.checkoutId,
      ]);
  return rows.map((r) => ({ ...r, created_at: asIso(r.created_at) ?? new Date().toISOString() }));
}

export async function getAsset(id: string): Promise<AssetRow | null> {
  const sql = await getSql();
  const rows = await sql.query<AssetRow>(`select * from order_assets where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function appendEvent(orderId: string, action: string, note: string | null, actor = "operator") {
  const sql = await getSql();
  await sql.query(
    `insert into order_events (id, order_id, action, note, actor) values ($1,$2,$3,$4,$5)`,
    [makeId("evt"), orderId, action, note, actor],
  );
}

async function fulfillFromCheckout(opts: {
  checkoutId: string;
  stripeSessionId?: string | null;
}): Promise<OrderRow> {
  const existing = opts.stripeSessionId ? await getOrderByStripeSession(opts.stripeSessionId) : null;
  if (existing) return existing;

  const sql = await getSql();
  const checkoutRows = await sql.query<OrderSql & { status: string }>(
    `select * from checkouts where id = $1`,
    [opts.checkoutId],
  );
  const checkout = checkoutRows[0];
  if (!checkout) throw new Error("Checkout not found");

  const byCheckout = await sql.query<OrderSql>(`select * from orders where checkout_id = $1`, [opts.checkoutId]);
  if (byCheckout[0]) return mapOrder(byCheckout[0]);

  const orderId = makeId("ord");
  const addOns = parseJsonArray(checkout.add_ons);
  await sql.query(
    `insert into orders (
      id, checkout_id, product, add_ons, price_cents, stripe_session_id,
      business_name, category, city, state, website, phone, email, brief, tone,
      platforms, mascot_description, website_profile, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'paid')`,
    [
      orderId,
      opts.checkoutId,
      checkout.product,
      JSON.stringify(addOns),
      asNumber(checkout.price_cents),
      opts.stripeSessionId ?? checkout.stripe_session_id,
      checkout.business_name,
      checkout.category,
      checkout.city,
      checkout.state,
      checkout.website,
      checkout.phone,
      checkout.email,
      checkout.brief,
      checkout.tone,
      JSON.stringify(parseJsonArray(checkout.platforms)),
      checkout.mascot_description,
      checkout.website_profile ?? null,
    ],
  );
  await sql.query(`update order_assets set order_id = $1 where checkout_id = $2`, [orderId, opts.checkoutId]);
  await sql.query(`update checkouts set status = 'paid' where id = $1`, [opts.checkoutId]);
  await appendEvent(orderId, "paid", "Order paid. Generation packet is ready.", "system");

  const order = await getOrder(orderId);
  if (!order) throw new Error("Order insert failed");

  const product = PRODUCTS[order.product];
  await sendOrderConfirmation({
    to: order.email,
    businessName: order.business_name,
    productName: product.name,
    priceLabel: `$${(order.price_cents / 100).toFixed(0)}`,
    orderId: order.id,
  });
  await sendOperatorPaidNotice({
    orderId: order.id,
    businessName: order.business_name,
    productName: product.name,
    city: order.city,
    state: order.state,
  });
  return order;
}

export async function completeDemoCheckout(checkoutId: string): Promise<OrderRow> {
  return fulfillFromCheckout({ checkoutId, stripeSessionId: `demo_${checkoutId}` });
}

export async function completeStripeCheckout(opts: {
  checkoutId: string;
  sessionId: string;
}): Promise<OrderRow> {
  await attachStripeSession(opts.checkoutId, opts.sessionId);
  return fulfillFromCheckout({ checkoutId: opts.checkoutId, stripeSessionId: opts.sessionId });
}

export async function claimOrder(id: string, actor = "operator"): Promise<OrderRow> {
  const order = await getOrder(id);
  if (!order) throw new Error("Order not found");
  if (order.status === "delivered" || order.status === "refunded") {
    throw new Error(`Cannot claim a ${order.status} order`);
  }
  const sql = await getSql();
  await sql.query(
    `update orders set status = 'in_production', claimed_at = coalesce(claimed_at, now()), updated_at = now() where id = $1`,
    [id],
  );
  await appendEvent(id, "in_production", "Order claimed for production.", actor);
  const next = await getOrder(id);
  if (!next) throw new Error("Order not found");
  return next;
}

export async function createOperatorOrder(input: {
  product: ProductId;
  businessName: string;
  category: string;
  city: string;
  state: string;
  website?: string | null;
  phone: string;
  email: string;
  brief: string;
  tone?: Tone;
  platforms?: Platform[];
}): Promise<OrderRow> {
  const sql = await getSql();
  const id = makeId("ord");
  const platforms = input.platforms?.length ? input.platforms : (["instagram", "facebook"] as Platform[]);
  const tone = input.tone ?? "trustworthy";
  await sql.query(
    `insert into orders (
      id, product, add_ons, price_cents, business_name, category, city, state, website,
      phone, email, brief, tone, platforms, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'paid')`,
    [
      id,
      input.product,
      JSON.stringify([]),
      priceCentsFor(input.product, false),
      input.businessName,
      input.category,
      input.city,
      input.state,
      input.website ?? null,
      input.phone,
      input.email,
      input.brief,
      tone,
      JSON.stringify(platforms),
    ],
  );
  await appendEvent(id, "paid", "Operator job from audience profile.", "admin");
  const order = await getOrder(id);
  if (!order) throw new Error("Order insert failed");
  return order;
}

export async function applyAudienceProfile(orderId: string, raw: string): Promise<OrderRow> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const parsed = parseAudiencePaste(raw);
  const brief = spokenOnly(scriptForProduct(parsed, order.product, ""));
  if (brief.trim().length < 12) {
    throw new Error("This paste has no script for this product (12s social, 20s voiceover, or 40s camera-facing).");
  }
  const sql = await getSql();
  await sql.query(
    `update orders set
      business_name = coalesce(nullif($2,''), business_name),
      category = coalesce(nullif($3,''), category),
      city = coalesce(nullif($4,''), city),
      state = coalesce(nullif($5,''), state),
      website = coalesce(nullif($6,''), website),
      phone = coalesce(nullif($7,''), phone),
      brief = $8,
      updated_at = now()
     where id = $1`,
    [
      orderId,
      parsed.businessName ?? "",
      parsed.categoryId ?? "",
      parsed.city ?? "",
      parsed.state ?? "",
      parsed.website ?? "",
      parsed.phone ?? "",
      brief.slice(0, 16000),
    ],
  );
  await appendEvent(orderId, "profile", "Audience profile applied. Scripts are now the spoken copy.", "admin");
  const next = await getOrder(orderId);
  if (!next) throw new Error("Order not found");
  return next;
}

export async function createOrdersFromProfile(raw: string, email: string): Promise<OrderRow[]> {
  const parsed = parseAudiencePaste(raw);
  const products: ProductId[] = [];
  if (parsed.socialScript) products.push("video-12");
  if (parsed.voiceoverScript) products.push("video-20");
  if (parsed.cameraScript) products.push("video-40");
  if (products.length === 0) {
    throw new Error("Need AD CONCEPTS: Short-Form Social, Voiceover (25–30s), and/or Camera-Facing.");
  }
  const businessName =
    parsed.businessName ||
    (parsed.website
      ? parsed.website
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .split("/")[0]
          .split(".")[0]
          .replace(/[-_]+/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : "");
  if (!businessName) throw new Error("Profile needs a business name (Business Name in the briefing).");
  const category = parsed.categoryId || "spa";
  const city = parsed.city;
  const state = parsed.state;
  if (!city || !state) {
    throw new Error("Profile needs a city and state (Business Address or PAGE_3_PRIMARY_RETAIL_ADDRESS).");
  }
  const phone = parsed.phone || "See website";
  const tone: Tone = category === "spa" || category === "salon" ? "premium" : "trustworthy";
  const created: OrderRow[] = [];
  for (const product of products) {
    const brief = spokenOnly(scriptForProduct(parsed, product, ""));
    if (brief.length < 8) continue;
    created.push(
      await createOperatorOrder({
        product,
        businessName,
        category,
        city,
        state,
        website: parsed.website,
        phone,
        email,
        brief,
        tone,
      }),
    );
  }
  if (created.length === 0) throw new Error("No scripts found to build.");
  return created;
}

export async function attachFiles(
  id: string,
  files: Array<{ filename: string; mime?: string; url?: string; dataUrl?: string }>,
  actor = "operator",
): Promise<OrderRow> {
  const order = await getOrder(id);
  if (!order) throw new Error("Order not found");
  if (files.length === 0) throw new Error("Attach at least one file or URL");
  const sql = await getSql();
  for (const file of files) {
    if (!file.url && !file.dataUrl) throw new Error("Each file needs a url or dataUrl");
    await sql.query(
      `insert into order_assets (id, order_id, kind, filename, mime, data_url, external_url)
       values ($1,$2,'delivery',$3,$4,$5,$6)`,
      [
        makeId("ast"),
        id,
        safeFilename(file.filename),
        safeMime(file.mime || "application/octet-stream"),
        file.dataUrl ?? null,
        file.url ?? null,
      ],
    );
  }
  await sql.query(`update orders set updated_at = now() where id = $1`, [id]);
  await appendEvent(id, "attach", `Attached ${files.length} file(s).`, actor);
  const next = await getOrder(id);
  if (!next) throw new Error("Order not found");
  return next;
}

export async function passQc(
  id: string,
  checks: { watched: boolean; namesPhoneCityCorrect: boolean; noArtifacts: boolean },
  actor = "operator",
): Promise<OrderRow> {
  const order = await getOrder(id);
  if (!order) throw new Error("Order not found");
  if (!checks.watched || !checks.namesPhoneCityCorrect || !checks.noArtifacts) {
    throw new Error("QC requires watched, names/phone/city correct, and no artifacts");
  }
  const deliveries = (await listAssets({ orderId: id })).filter((a) => a.kind === "delivery");
  if (deliveries.length === 0) throw new Error("Attach finished files before QC");
  const sql = await getSql();
  await sql.query(
    `update orders set status = 'qc', qc_passed_at = now(), updated_at = now() where id = $1`,
    [id],
  );
  await appendEvent(
    id,
    "qc",
    "QC passed: watched, names/phone/city correct, no artifacts.",
    actor,
  );
  const next = await getOrder(id);
  if (!next) throw new Error("Order not found");
  return next;
}

export async function deliverOrder(id: string, origin: string, actor = "operator"): Promise<OrderRow> {
  const order = await getOrder(id);
  if (!order) throw new Error("Order not found");
  const events = await listEvents(id);
  const qc = events.some((e) => e.action === "qc");
  if (!qc || !order.qc_passed_at) {
    throw new Error("QC is required before delivery");
  }
  const deliveries = (await listAssets({ orderId: id })).filter((a) => a.kind === "delivery");
  if (deliveries.length === 0) throw new Error("No delivery files attached");
  const links = deliveries.map((a) => ({
    filename: a.filename,
    url: a.external_url || signedFileUrl(origin, a.id, 30),
  }));
  await sendDeliveryEmail({
    to: order.email,
    businessName: order.business_name,
    orderId: order.id,
    links,
  });
  const sql = await getSql();
  await sql.query(
    `update orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = $1`,
    [id],
  );
  await appendEvent(id, "delivered", `Delivery email sent to ${order.email}.`, actor);
  try {
    const { maybeFeatureOnDeliver } = await import("./featured");
    await maybeFeatureOnDeliver(id, actor);
  } catch {
    // Homepage feature is optional; delivery still succeeded.
  }
  const next = await getOrder(id);
  if (!next) throw new Error("Order not found");
  return next;
}

export async function flagOrder(id: string, note: string, actor = "operator"): Promise<OrderRow> {
  const order = await getOrder(id);
  if (!order) throw new Error("Order not found");
  const sql = await getSql();
  await sql.query(
    `update orders set status = 'needs_attention', attention_note = $1, updated_at = now() where id = $2`,
    [note, id],
  );
  await appendEvent(id, "needs_attention", note, actor);
  const next = await getOrder(id);
  if (!next) throw new Error("Order not found");
  return next;
}

export async function remakeOrder(id: string, note: string | null, actor = "operator"): Promise<OrderRow> {
  const sql = await getSql();
  await sql.query(
    `update orders set status = 'remake_requested', attention_note = $1, qc_passed_at = null, delivered_at = null, updated_at = now() where id = $2`,
    [note, id],
  );
  await appendEvent(id, "remake_requested", note, actor);
  const next = await getOrder(id);
  if (!next) throw new Error("Order not found");
  return next;
}

export async function refundOrder(id: string, note: string | null, actor = "operator"): Promise<OrderRow> {
  const sql = await getSql();
  await sql.query(
    `update orders set status = 'refunded', attention_note = $1, updated_at = now() where id = $2`,
    [note, id],
  );
  await appendEvent(id, "refunded", note, actor);
  const next = await getOrder(id);
  if (!next) throw new Error("Order not found");
  return next;
}

export function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

export async function slaSnapshot() {
  const open = (await listOrders()).filter((o) => o.status !== "delivered" && o.status !== "refunded");
  const aging = open
    .map((o) => ({
      ...o,
      hours: hoursSince(o.created_at),
    }))
    .filter((o) => o.hours >= 12)
    .sort((a, b) => b.hours - a.hours);
  return {
    now: new Date().toISOString(),
    open_count: open.length,
    aging_12h: aging.filter((o) => o.hours < 20),
    critical_20h: aging.filter((o) => o.hours >= 20),
    aging,
  };
}

export async function packetFor(orderId: string, request: Request): Promise<GenerationPacket> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const origin = requestOrigin(request);
  const assets = (await listAssets({ orderId })).filter((a) => a.kind !== "delivery");
  return buildPacket({
    orderId: order.id,
    productId: order.product,
    addOns: order.add_ons,
    priceCents: order.price_cents,
    intake: intakeFrom(order),
    assets: assets.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      kind: a.kind,
      signed_url: a.external_url || signedFileUrl(origin, a.id, 1),
    })),
  });
}

export async function joinWaitlist(opts: {
  email: string;
  name?: string;
  city?: string;
  likenessAck: boolean;
}) {
  if (!opts.likenessAck) throw new Error("You must confirm you own your likeness");
  const sql = await getSql();
  const existing = await sql.query<{ id: string }>(
    `select id from waitlist where lower(email) = lower($1)`,
    [opts.email],
  );
  if (existing[0]) return { id: existing[0].id, already: true };
  const id = makeId("wtl");
  await sql.query(
    `insert into waitlist (id, email, name, city, likeness_ack) values ($1,$2,$3,$4,true)`,
    [id, opts.email, opts.name || null, opts.city || null],
  );
  return { id, already: false };
}

const SEED_DEMO_EMAILS = [
  "pat@desertair.example",
  "hello@northside.example",
  "desk@willowdental.example",
];

/** Removes leftover sample businesses if they landed in the live Neon DB. */
export async function purgeSeedDemoOrders() {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `select id from orders where email in ($1,$2,$3)`,
    SEED_DEMO_EMAILS,
  );
  if (!rows.length) return 0;
  for (const row of rows) {
    await sql.query(`delete from order_assets where order_id = $1`, [row.id]);
    await sql.query(`delete from order_events where order_id = $1`, [row.id]);
    await sql.query(`delete from orders where id = $1`, [row.id]);
  }
  return rows.length;
}

export async function seedDemoIfEmpty() {
  // Fake HVAC / roofing / dental rows were confusing the live queue.
  // Opt in only: MYA_SEED_DEMO=1
  if (process.env.MYA_SEED_DEMO !== "1") return;
  if (typeof process !== "undefined" && process.env.VERCEL) return;
  const sql = await getSql();
  const rows = await sql.query<{ n: number }>(`select count(*)::int as n from orders`);
  if ((rows[0]?.n ?? 0) > 0) return;

  const now = Date.now();
  const samples: Array<{
    hoursAgo: number;
    status: OrderStatus;
    product: ProductId;
    mascot: boolean;
    business: string;
    category: string;
    city: string;
    state: string;
    phone: string;
    email: string;
    brief: string;
    tone: Tone;
    platforms: Platform[];
  }> = [
    {
      hoursAgo: 2,
      status: "paid",
      product: "video-40",
      mascot: false,
      business: "Desert Air HVAC",
      category: "hvac",
      city: "Mesa",
      state: "AZ",
      phone: "480-555-0142",
      email: "pat@desertair.example",
      brief: "Same-day AC repair for Mesa and East Valley. Licensed, no scare quotes. End on Book a visit.",
      tone: "trustworthy",
      platforms: ["instagram", "facebook"],
    },
    {
      hoursAgo: 14,
      status: "in_production",
      product: "video-20",
      mascot: true,
      business: "Northside Roofing",
      category: "roofing",
      city: "Fresno",
      state: "CA",
      phone: "559-555-0194",
      email: "hello@northside.example",
      brief: "Free roof checks before the next storm. Honest: repair vs replace. Mascot is a small terracotta tile character.",
      tone: "energetic",
      platforms: ["facebook", "youtube"],
    },
    {
      hoursAgo: 21,
      status: "qc",
      product: "video-40",
      mascot: false,
      business: "Willow Dental",
      category: "dental",
      city: "Queen Creek",
      state: "AZ",
      phone: "480-555-0177",
      email: "desk@willowdental.example",
      brief: "New patient special. Calm office, no drill shots. Invite people who have been putting the visit off.",
      tone: "premium",
      platforms: ["instagram", "youtube"],
    },
  ];

  for (const s of samples) {
    const id = makeId("ord");
    const created = new Date(now - s.hoursAgo * 36e5).toISOString();
    const addOns = s.mascot ? ["mascot"] : [];
    await sql.query(
      `insert into orders (
        id, product, add_ons, price_cents, business_name, category, city, state, website,
        phone, email, brief, tone, platforms, mascot_description, status,
        claimed_at, qc_passed_at, created_at, updated_at, stripe_session_id
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        id,
        s.product,
        JSON.stringify(addOns),
        priceCentsFor(s.product, s.mascot),
        s.business,
        s.category,
        s.city,
        s.state,
        null,
        s.phone,
        s.email,
        s.brief,
        s.tone,
        JSON.stringify(s.platforms),
        s.mascot ? "A small terracotta roof-tile character with kind eyes." : null,
        s.status,
        s.status === "paid" ? null : created,
        s.status === "qc" ? created : null,
        created,
        created,
        `seed_${id}`,
      ],
    );
    await sql.query(
      `insert into order_events (id, order_id, action, note, actor, created_at) values ($1,$2,'paid','Seeded paid order.','system',$3)`,
      [makeId("evt"), id, created],
    );
    if (s.status !== "paid") {
      await appendEvent(id, "in_production", "Seeded claim.", "system");
    }
    if (s.status === "qc") {
      await sql.query(
        `insert into order_assets (id, order_id, kind, filename, mime, external_url)
         values ($1,$2,'delivery','willow-dental-9x16.mp4','video/mp4',$3)`,
        [makeId("ast"), id, "/examples/dental.jpg"],
      );
      await appendEvent(id, "qc", "QC passed on seeded files.", "system");
    }
  }
}

export type PublicOrder = Pick<
  OrderRow,
  "id" | "product" | "price_cents" | "business_name" | "email" | "status" | "created_at"
>;

export function toPublic(order: OrderRow): PublicOrder {
  return {
    id: order.id,
    product: order.product,
    price_cents: order.price_cents,
    business_name: order.business_name,
    email: order.email,
    status: order.status,
    created_at: order.created_at,
  };
}
