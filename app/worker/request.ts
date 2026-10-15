import type { Context } from "hono";

export function clientIp(c: Context<any>): string {
  return c.req.header("cf-connecting-ip") ?? "0.0.0.0";
}

/** Salted SHA-256 so we can rate-limit and dedupe without storing raw IPs. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Browsers always send Origin on cross-site POSTs. Rejecting unknown origins
 * stops other sites from submitting forms through a visitor's browser.
 */
export function originAllowed<E extends { Bindings: Env }>(c: Context<E>): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true; // non-browser clients; still gated by captcha + rate limit
  const allowed = c.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  return allowed.includes(origin);
}
