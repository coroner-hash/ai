import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export type AppEnv = { Bindings: Env; Variables: { address: string } };

const COOKIE = "coroner_session";
const SESSION_SECONDS = 7 * 24 * 3600;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function startSession(c: Context<AppEnv>, address: string): Promise<void> {
  const id = randomHex(32);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, address, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(id), address.toLowerCase(), now, now + SESSION_SECONDS)
    .run();
  setCookie(c, COOKIE, id, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function sessionAddress(c: Context<AppEnv>): Promise<string | null> {
  const id = getCookie(c, COOKIE);
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
  const row = await c.env.DB.prepare("SELECT address FROM sessions WHERE id_hash = ?1 AND expires_at > ?2")
    .bind(await sha256Hex(id), Math.floor(Date.now() / 1000))
    .first<{ address: string }>();
  return row?.address ?? null;
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const id = getCookie(c, COOKIE);
  if (id) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(await sha256Hex(id)).run();
  deleteCookie(c, COOKIE, { path: "/" });
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const address = await sessionAddress(c);
  if (!address) return c.json({ error: "not_signed_in" }, 401);
  c.set("address", address);
  await next();
};

export { randomHex };
