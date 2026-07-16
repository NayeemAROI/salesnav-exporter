import { NextRequest } from "next/server";
import type { LinkedInCookie, ProxyConfig } from "./linkedin-scraper";

const MAX_BODY_BYTES = 256_000;
const MAX_ACTIVE_JOBS = 1;
const ALLOWED_PROXY_COUNTRIES = new Set(["bd", "us", "gb", "in", "ca", "au", "de"]);
const state = globalThis as typeof globalThis & { __activeScrapeJobs?: number };

export class ApiInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function assertBodySize(req: NextRequest) {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new ApiInputError("Request body too large", 413);
}

export function acquireScrapeJob() {
  const active = state.__activeScrapeJobs || 0;
  if (active >= MAX_ACTIVE_JOBS) throw new ApiInputError("Server is busy. Try again shortly.", 429);
  state.__activeScrapeJobs = active + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.__activeScrapeJobs = Math.max(0, (state.__activeScrapeJobs || 1) - 1);
  };
}

export function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function boundedString(value: unknown, name: string, max = 500) {
  if (typeof value !== "string") throw new ApiInputError(`${name} must be a string`);
  const clean = value.trim();
  if (!clean || clean.length > max) throw new ApiInputError(`Invalid ${name}`);
  return clean;
}

export function boundedStrings(value: unknown, name: string, maxItems: number, maxLength = 500) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ApiInputError(`${name} must be an array`);
  if (value.length > maxItems) throw new ApiInputError(`${name} exceeds the ${maxItems} item limit`);
  return value.map((item) => boundedString(item, name, maxLength));
}

export function linkedinUrl(value: unknown, kind: "profile" | "sales" | "company") {
  const raw = boundedString(value, "URL", 2_000);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiInputError("Invalid URL"); }
  if (url.protocol !== "https:" || url.hostname !== "www.linkedin.com") throw new ApiInputError("Only https://www.linkedin.com URLs are allowed");
  if (kind === "profile" && !/^\/in\/[^/]+\/?$/.test(url.pathname)) throw new ApiInputError("Invalid LinkedIn profile URL");
  if (kind === "sales" && ![/^\/sales\/search\/(people|company)/, /^\/sales\/lists\/(people|company|companies|accounts)/].some((rule) => rule.test(url.pathname))) throw new ApiInputError("Invalid Sales Navigator URL");
  if (kind === "company" && !/^\/company\/[^/]+\/?$/.test(url.pathname)) throw new ApiInputError("Invalid LinkedIn company URL");
  url.username = ""; url.password = ""; url.hash = "";
  return url.toString();
}

export function googleMapsUrl(value: unknown) {
  const raw = boundedString(value, "Maps URL", 2_000);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiInputError("Invalid Maps URL"); }
  if (url.protocol !== "https:" || !new Set(["www.google.com", "google.com", "maps.google.com"]).has(url.hostname) || !url.pathname.startsWith("/maps")) throw new ApiInputError("Only Google Maps HTTPS URLs are allowed");
  url.username = ""; url.password = ""; url.hash = "";
  return url.toString();
}

export function sanitizeLinkedInCookies(value: unknown): LinkedInCookie[] {
  if (!Array.isArray(value) || value.length > 10) throw new ApiInputError("Invalid cookies");
  const allowed = new Set(["li_at", "JSESSIONID"]);
  const cookies = value.filter((cookie) => cookie && typeof cookie === "object" && allowed.has(String(cookie.name))).map((cookie) => ({
    name: String(cookie.name), value: boundedString(cookie.value, `${String(cookie.name)} cookie`, 5_000), domain: ".linkedin.com", path: "/",
  }));
  if (!cookies.some((cookie) => cookie.name === "li_at")) throw new ApiInputError("Missing li_at cookie");
  return cookies;
}

export function serverProxy(countryValue: unknown): ProxyConfig | undefined {
  if (!process.env.PROXY_HOST || !process.env.PROXY_PORT) return undefined;
  const requested = typeof countryValue === "string" ? countryValue.toLowerCase() : "";
  return { host: process.env.PROXY_HOST, port: process.env.PROXY_PORT, username: process.env.PROXY_USER || undefined, password: process.env.PROXY_PASS || undefined, countryCode: ALLOWED_PROXY_COUNTRIES.has(requested) ? requested : undefined };
}

export function safeError(error: unknown) {
  console.error("[scrape-api]", error);
  return "Scrape failed. Check the input and try again.";
}

export function apiError(error: unknown) {
  if (error instanceof ApiInputError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: safeError(error) }, { status: 500 });
}

export function sseHeaders() {
  return { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate", Connection: "keep-alive", "X-Content-Type-Options": "nosniff" };
}
