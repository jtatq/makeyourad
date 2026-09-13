import { createHmac, timingSafeEqual } from "node:crypto";
import { env, isWorkspacePreview } from "./env.server";

const COOKIE = "mya_operator";

export function operatorToken(): string {
  return env("OPERATOR_TOKEN") ?? env("ADMIN_PASSWORD") ?? "makeyourad-operator";
}

export function operatorEmail(): string {
  return env("OPERATOR_EMAIL") ?? "operator@makeyourad.com";
}

export function isPreviewOperatorSecret(): boolean {
  return !env("OPERATOR_TOKEN") && !env("ADMIN_PASSWORD");
}

export function previewAdminOpen(): boolean {
  if (env("VERCEL")) return false;
  return isWorkspacePreview() && isPreviewOperatorSecret();
}

function sign(value: string): string {
  return createHmac("sha256", operatorToken()).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function tokenMatches(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  return safeEqual(sign(candidate), sign(operatorToken()));
}

export function sessionCookieValue(): string {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 14;
  const payload = `ok.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function sessionCookieIsValid(raw: string | undefined): boolean {
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [ok, exp, mac] = parts;
  if (ok !== "ok") return false;
  const payload = `${ok}.${exp}`;
  if (!safeEqual(sign(payload), mac)) return false;
  const when = Number(exp);
  return Number.isFinite(when) && when > Date.now();
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function readOperatorCookie(request: Request): boolean {
  const cookies = parseCookies(request.headers.get("cookie"));
  return sessionCookieIsValid(cookies[COOKIE]);
}

function cookieAttrs(): string {
  const secure = env("VERCEL") || env("GROK_PROJECT_ID") ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function operatorCookieHeader(): string {
  return `${COOKIE}=${encodeURIComponent(sessionCookieValue())}; ${cookieAttrs()}; Max-Age=${60 * 60 * 24 * 14}`;
}

export function clearOperatorCookieHeader(): string {
  return `${COOKIE}=; ${cookieAttrs()}; Max-Age=0`;
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization") || request.headers.get("x-operator-token");
  if (!header) return null;
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return header.trim();
}

export function requestIsOperator(request: Request): boolean {
  if (tokenMatches(bearerFrom(request))) return true;
  if (readOperatorCookie(request)) return true;
  return false;
}

export function unauthorizedJson(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function signAssetToken(assetId: string, exp: number): string {
  return createHmac("sha256", operatorToken()).update(`${assetId}.${exp}`).digest("hex");
}

export function verifyAssetToken(assetId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const when = Number(exp);
  if (!Number.isFinite(when) || when < Date.now()) return false;
  const expected = signAssetToken(assetId, when);
  return safeEqual(expected, sig);
}

export function signedFileUrl(origin: string, assetId: string, days = 30): string {
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const sig = signAssetToken(assetId, exp);
  return `${origin}/api/files/${assetId}?exp=${exp}&sig=${sig}`;
}

export function requestOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "127.0.0.1:8080";
  return `${proto}://${host}`;
}
