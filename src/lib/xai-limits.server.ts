import { AsyncLocalStorage } from "node:async_hooks";
import { getSql } from "./db";
import { makeId } from "./ids";
import { callCostCents } from "./xai-cost";

export type ApiCallKind = "image" | "video" | "poll" | "other";

export type ApiCallRow = {
  at: string;
  kind: ApiCallKind;
  path: string;
  method: string;
  status: number;
  ms: number | null;
  retryAfter: string | null;
  remaining: string | null;
  limit: string | null;
  reset: string | null;
  error: string | null;
  orderId: string | null;
  costCents: number;
};

export type ApiLimitSnapshot = {
  capturedAt: string;
  videoRpsCap: number;
  imageRpsCap: number;
  lastHour: { image: number; video: number; poll: number; limited: number; costCents: number };
  lastDay: { image: number; video: number; poll: number; limited: number; costCents: number };
  last429At: string | null;
  last429Path: string | null;
  lastRemaining: string | null;
  lastLimit: string | null;
  lastReset: string | null;
  recent: ApiCallRow[];
};

type Pending = {
  kind: ApiCallKind;
  path: string;
  method: string;
  status: number;
  ms: number;
  retryAfter: string | null;
  remaining: string | null;
  limit: string | null;
  reset: string | null;
  error: string | null;
  orderId: string | null;
  costCents: number;
};

const orderCtx = new AsyncLocalStorage<string>();

export function runWithOrder<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  return orderCtx.run(orderId, fn);
}

export function currentOrderId(): string | null {
  return orderCtx.getStore() ?? null;
}

const recentMem: ApiCallRow[] = [];
const pending: Pending[] = [];
let flushing = false;
let tableReady: Promise<void> | null = null;

function header(res: Response, name: string): string | null {
  const keys = [
    name,
    name.toLowerCase(),
    name.replaceAll("-", "_"),
    `x-${name}`,
    `x-ratelimit-${name}`,
    `ratelimit-${name}`,
  ];
  for (const k of keys) {
    const v = res.headers.get(k);
    if (v) return v;
  }
  return null;
}

export function classifyXaiPath(path: string, method: string): ApiCallKind {
  const p = path.toLowerCase();
  const m = method.toUpperCase();
  if (p.includes("/images")) return "image";
  if (p.includes("/videos/generations") && m === "POST") return "video";
  if (p.includes("/videos/")) return "poll";
  return "other";
}

export function readLimitHeaders(res: Response): {
  retryAfter: string | null;
  remaining: string | null;
  limit: string | null;
  reset: string | null;
} {
  const remaining =
    header(res, "x-ratelimit-remaining") ||
    header(res, "x-ratelimit-remaining-requests") ||
    header(res, "x-ratelimit-remaining-tokens") ||
    header(res, "ratelimit-remaining");
  const limit =
    header(res, "x-ratelimit-limit") ||
    header(res, "x-ratelimit-limit-requests") ||
    header(res, "ratelimit-limit");
  const reset =
    header(res, "x-ratelimit-reset") ||
    header(res, "x-ratelimit-reset-requests") ||
    header(res, "ratelimit-reset");
  return {
    retryAfter: res.headers.get("retry-after"),
    remaining,
    limit,
    reset,
  };
}

export function recordXaiCall(opts: Omit<Pending, "orderId" | "costCents"> & { orderId?: string | null }) {
  const orderId = opts.orderId ?? currentOrderId();
  const costCents = callCostCents(opts.kind, opts.path, opts.method, opts.status);
  const row: Pending = { ...opts, orderId, costCents };
  recentMem.unshift({
    at: new Date().toISOString(),
    kind: row.kind,
    path: row.path,
    method: row.method,
    status: row.status,
    ms: row.ms,
    retryAfter: row.retryAfter,
    remaining: row.remaining,
    limit: row.limit,
    reset: row.reset,
    error: row.error,
    orderId,
    costCents,
  });
  if (recentMem.length > 40) recentMem.pop();
  pending.push(row);
  void flushPending();
}

async function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      const sql = await getSql();
      await sql.query(`
        create table if not exists api_calls (
          id text primary key,
          created_at timestamptz not null default now(),
          kind text not null,
          path text not null,
          method text not null default 'GET',
          status int not null,
          ms int,
          retry_after text,
          remaining text,
          limit_hdr text,
          reset_hdr text,
          error text,
          order_id text,
          cost_cents int not null default 0
        )
      `);
      await sql.query(`alter table api_calls add column if not exists order_id text`);
      await sql.query(`alter table api_calls add column if not exists cost_cents int not null default 0`);
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

async function flushPending() {
  if (flushing || pending.length === 0) return;
  flushing = true;
  try {
    await ensureTable();
    const sql = await getSql();
    while (pending.length) {
      const batch = pending.splice(0, 20);
      for (const c of batch) {
        await sql.query(
          `insert into api_calls (id, kind, path, method, status, ms, retry_after, remaining, limit_hdr, reset_hdr, error, order_id, cost_cents)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            makeId("api"),
            c.kind,
            c.path.slice(0, 180),
            c.method,
            c.status,
            c.ms,
            c.retryAfter,
            c.remaining,
            c.limit,
            c.reset,
            c.error?.slice(0, 280) ?? null,
            c.orderId,
            c.costCents,
          ],
        );
      }
    }
  } catch {
    /* next call retries */
  } finally {
    flushing = false;
  }
}

function countWindow(
  rows: Array<{ kind: string; status: number }>,
  kind: ApiCallKind,
): { n: number; limited: number } {
  const match = rows.filter((r) => r.kind === kind);
  return { n: match.length, limited: match.filter((r) => r.status === 429).length };
}

export async function apiLimitSnapshot(): Promise<ApiLimitSnapshot> {
  const empty = {
    image: 0,
    video: 0,
    poll: 0,
    limited: 0,
    costCents: 0,
  };
  const snap: ApiLimitSnapshot = {
    capturedAt: new Date().toISOString(),
    videoRpsCap: 10,
    imageRpsCap: 6,
    lastHour: { ...empty },
    lastDay: { ...empty },
    last429At: null,
    last429Path: null,
    lastRemaining: recentMem.find((r) => r.remaining)?.remaining ?? null,
    lastLimit: recentMem.find((r) => r.limit)?.limit ?? null,
    lastReset: recentMem.find((r) => r.reset)?.reset ?? null,
    recent: recentMem.slice(0, 12),
  };
  try {
    await ensureTable();
    const sql = await getSql();
    const hour = await sql.query<{ kind: string; status: number; cost_cents: number | null }>(
      `select kind, status, cost_cents from api_calls where created_at > now() - interval '1 hour'`,
    );
    const day = await sql.query<{ kind: string; status: number; cost_cents: number | null }>(
      `select kind, status, cost_cents from api_calls where created_at > now() - interval '24 hours'`,
    );
    const last429 = await sql.query<{ created_at: string; path: string }>(
      `select created_at::text as created_at, path from api_calls where status = 429 order by created_at desc limit 1`,
    );
    const hdr = await sql.query<{ remaining: string | null; limit_hdr: string | null; reset_hdr: string | null }>(
      `select remaining, limit_hdr, reset_hdr from api_calls
       where remaining is not null or limit_hdr is not null
       order by created_at desc limit 1`,
    );
    const recent = await sql.query<{
      created_at: string;
      kind: ApiCallKind;
      path: string;
      method: string;
      status: number;
      ms: number | null;
      retry_after: string | null;
      remaining: string | null;
      limit_hdr: string | null;
      reset_hdr: string | null;
      error: string | null;
    }>(
      `select created_at::text as created_at, kind, path, method, status, ms, retry_after, remaining, limit_hdr, reset_hdr, error
       from api_calls order by created_at desc limit 12`,
    );
    const roll = (rows: Array<{ kind: string; status: number; cost_cents?: number | null }>) => {
      const img = countWindow(rows, "image");
      const vid = countWindow(rows, "video");
      const poll = countWindow(rows, "poll");
      return {
        image: img.n,
        video: vid.n,
        poll: poll.n,
        limited: rows.filter((r) => r.status === 429).length,
        costCents: rows.reduce((n, r) => n + (Number(r.cost_cents) || 0), 0),
      };
    };
    snap.lastHour = roll(hour);
    snap.lastDay = roll(day);
    if (last429[0]) {
      snap.last429At = last429[0].created_at;
      snap.last429Path = last429[0].path;
    }
    if (hdr[0]) {
      snap.lastRemaining = hdr[0].remaining;
      snap.lastLimit = hdr[0].limit_hdr;
      snap.lastReset = hdr[0].reset_hdr;
    }
    if (recent.length) {
      snap.recent = recent.map((r) => ({
        at: r.created_at,
        kind: r.kind,
        path: r.path,
        method: r.method,
        status: r.status,
        ms: r.ms,
        retryAfter: r.retry_after,
        remaining: r.remaining,
        limit: r.limit_hdr,
        reset: r.reset_hdr,
        error: r.error,
        orderId: null,
        costCents: 0,
      }));
    }
  } catch {
    /* in-memory fallback already on snap.recent */
  }
  return snap;
}

export async function orderApiCostCents(orderId: string): Promise<number> {
  try {
    await ensureTable();
    const sql = await getSql();
    const rows = await sql.query<{ sum: number | string | null }>(
      `select coalesce(sum(cost_cents),0) as sum from api_calls where order_id = $1`,
      [orderId],
    );
    return Number(rows[0]?.sum ?? 0);
  } catch {
    return 0;
  }
}
