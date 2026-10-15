import { Hono } from "hono";
import { sendWaitlistConfirmation } from "./email";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";
import { verifyTurnstile } from "./turnstile";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_BODY_BYTES = 2048;
// A human needs at least this long to read the form and type an email.
const MIN_FILL_MS = 1500;
// Must match the CHECK constraint in migrations/0001_base.sql.
const ROLES = ["launching", "trading", "integrating"] as const;

type WaitlistBody = {
  email?: unknown;
  role?: unknown;
  contract?: unknown;
  website?: unknown; // honeypot: hidden from humans, bots fill it
  elapsedMs?: unknown;
  turnstileToken?: unknown;
};

export const waitlist = new Hono<{ Bindings: Env }>();

waitlist.post("/", async (c) => {
  if (!originAllowed(c)) return c.json({ error: "origin_not_allowed" }, 403);

  const length = Number(c.req.header("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return c.json({ error: "payload_too_large" }, 413);

  const ip = clientIp(c);
  const ipHash = await hashIp(ip, c.env.IP_SALT);
  const { limited, retryAfter } = await overLimit(c.env.DB, `waitlist:${ipHash}`, 5, 600);
  if (limited) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }

  const body = await c.req.json<WaitlistBody>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  // Bots get the same success response so they have nothing to tune against.
  const honeypotFilled = typeof body.website === "string" && body.website.length > 0;
  const tooFast = typeof body.elapsedMs === "number" && body.elapsedMs < MIN_FILL_MS;
  if (honeypotFilled || tooFast) return c.json({ ok: true });

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) return c.json({ error: "invalid_email" }, 400);

  const role = ROLES.find((r) => r === body.role) ?? null;

  let contract: string | null = null;
  if (typeof body.contract === "string" && body.contract.trim() !== "") {
    contract = body.contract.trim();
    if (!ADDRESS.test(contract)) return c.json({ error: "invalid_contract" }, 400);
    contract = contract.toLowerCase();
  }

  const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  if (!token) return c.json({ error: "captcha_required" }, 400);
  const captcha = await verifyTurnstile(c.env.TURNSTILE_SECRET, token, ip);
  if (captcha === "unavailable") return c.json({ error: "captcha_unavailable" }, 503);
  if (captcha === "fail") return c.json({ error: "captcha_failed" }, 400);

  // Same response for new and existing emails: the form must not reveal who signed up.
  const result = await c.env.DB.prepare(
    `INSERT INTO waitlist (email, role, contract_address, ip_hash, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (email) DO NOTHING`,
  )
    .bind(email, role, contract, ipHash, (c.req.header("user-agent") ?? "").slice(0, 300))
    .run();

  // Only a genuinely new row gets an email — a resubmit of an existing
  // address must not re-notify (or confirm to a prober that it exists).
  if (result.meta.changes > 0 && c.env.RESEND_API_KEY) {
    c.executionCtx.waitUntil(sendWaitlistConfirmation(c.env.RESEND_API_KEY, email));
  }

  return c.json({ ok: true });
});
