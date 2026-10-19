// Sentinel: email me when a token's contract changes.
// What it can see: owner, ownership renounced, mint / blacklist / pause functions, proxy implementation, supply, and whether
// the address still holds code. Market and liquidity alerts are not in this version (those sources block server egress).
// Double opt-in: nothing is checked or sent until the email's owner confirms. Every alert carries a one-click unsubscribe.
import { Hono } from "hono";
import { sendMail } from "./email";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";
import { ChainUnavailable } from "./rpc";
import { verifyTurnstile } from "./turnstile";
import { contractFacts, type Facts } from "./verdict";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_WATCHES_PER_EMAIL = 3;
const PER_RUN = 15;
const WATCHED = [
  "contract.is_contract",
  "contract.owner",
  "contract.owner_renounced",
  "contract.selector_mint",
  "contract.selector_blacklist",
  "contract.selector_pause",
  "contract.proxy_implementation",
  "token.supply_raw",
] as const;

type Baseline = Record<string, string | number | boolean | null>;

export function pickBaseline(f: Facts): Baseline {
  const out: Baseline = {};
  for (const k of WATCHED) out[k] = (f[k] as Baseline[string]) ?? null;
  return out;
}

const short = (v: unknown) => (typeof v === "string" && v.startsWith("0x") && v.length === 42 ? `${v.slice(0, 6)}…${v.slice(-4)}` : String(v));

/** Plain-language list of what changed between two baselines. Empty when nothing material changed. */
export function diffBaseline(before: Baseline, now: Baseline): string[] {
  const out: string[] = [];
  if (before["contract.is_contract"] === true && now["contract.is_contract"] === false) out.push("The address no longer holds contract code.");
  if (before["contract.owner"] !== now["contract.owner"]) {
    if (now["contract.owner_renounced"] === true && before["contract.owner_renounced"] !== true) out.push("The owner renounced ownership (the owner is now the zero or dead address).");
    else out.push(`The owner changed from ${short(before["contract.owner"])} to ${short(now["contract.owner"])}.`);
  }
  for (const [k, label] of [
    ["contract.selector_mint", "a mint function"],
    ["contract.selector_blacklist", "a blacklist function"],
    ["contract.selector_pause", "a pause function"],
  ] as const) {
    if (before[k] === false && now[k] === true) out.push(`The contract code now contains ${label}.`);
    if (before[k] === true && now[k] === false) out.push(`The contract code no longer contains ${label}.`);
  }
  if (before["contract.proxy_implementation"] !== now["contract.proxy_implementation"]) {
    out.push(`The proxy now points to a different implementation (${short(before["contract.proxy_implementation"])} to ${short(now["contract.proxy_implementation"])}). The contract logic was upgraded.`);
  }
  try {
    const a = BigInt(String(before["token.supply_raw"] ?? "0"));
    const b = BigInt(String(now["token.supply_raw"] ?? "0"));
    if (a > 0n && b > a) {
      const pct = Number(((b - a) * 10000n) / a) / 100;
      out.push(`Total supply increased by ${pct}%.`);
    } else if (a > 0n && b < a) {
      const pct = Number(((a - b) * 10000n) / a) / 100;
      if (pct >= 1) out.push(`Total supply decreased by ${pct}%.`);
    }
  } catch {
    /* unparsable supply: ignore */
  }
  return out;
}

const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const sentinel = new Hono<{ Bindings: Env }>();

sentinel.post("/watch", async (c) => {
  if (!originAllowed(c)) return c.json({ error: "origin_not_allowed" }, 403);
  if (Number(c.req.header("content-length") ?? 0) > 2048) return c.json({ error: "payload_too_large" }, 413);
  if (!c.env.RESEND_API_KEY) return c.json({ error: "email_unavailable" }, 503);

  const ip = clientIp(c);
  const ipHash = await hashIp(ip, c.env.IP_SALT);
  const { limited, retryAfter } = await overLimit(c.env.DB, `sentinel:${ipHash}`, 5, 600);
  if (limited) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }

  const body = await c.req.json<{ email?: unknown; address?: unknown; website?: unknown; turnstileToken?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  if (typeof body.website === "string" && body.website.length > 0) return c.json({ ok: true }); // honeypot: same answer as success
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) return c.json({ error: "invalid_email" }, 400);
  const address = typeof body.address === "string" ? body.address.trim().toLowerCase() : "";
  if (!ADDRESS.test(address)) return c.json({ error: "invalid_address" }, 400);

  const captchaToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  if (!captchaToken) return c.json({ error: "captcha_required" }, 400);
  const captcha = await verifyTurnstile(c.env.TURNSTILE_SECRET, captchaToken, ip);
  if (captcha === "unavailable") return c.json({ error: "captcha_unavailable" }, 503);
  if (captcha === "fail") return c.json({ error: "captcha_failed" }, 400);

  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM sentinel_watches WHERE email = ?1").bind(email).first<{ n: number }>();
  const existing = await c.env.DB.prepare("SELECT token, confirmed FROM sentinel_watches WHERE email = ?1 AND address = ?2").bind(email, address).first<{ token: string; confirmed: number }>();
  if (!existing && (count?.n ?? 0) >= MAX_WATCHES_PER_EMAIL) return c.json({ error: "too_many_watches" }, 400);

  const token = existing?.token ?? randomToken();
  if (!existing) {
    await c.env.DB.prepare("INSERT INTO sentinel_watches (email, address, token, ip_hash) VALUES (?1, ?2, ?3, ?4)").bind(email, address, token, ipHash).run();
  }
  // Only an unconfirmed watch gets a (re)sent confirmation; a confirmed one answers the same way without mailing anyone.
  if (!existing || existing.confirmed === 0) {
    const origin = new URL(c.req.url).origin;
    c.executionCtx.waitUntil(
      sendMail(
        c.env.RESEND_API_KEY,
        email,
        "Confirm your Coroner Sentinel watch",
        `Someone (hopefully you) asked Coroner Sentinel to watch this token and email ${email} if its contract changes:\n\n${address}\n\nConfirm here:\n${origin}/api/sentinel/confirm?t=${token}\n\nIf this was not you, ignore this email and nothing will be watched.\n\nSentinel watches the contract only: owner, mint, blacklist, pause, upgrades and supply. It does not watch price or liquidity yet. Not financial advice.`,
      ),
    );
  }
  return c.json({ ok: true });
});

sentinel.get("/confirm", async (c) => {
  const t = c.req.query("t") ?? "";
  const row = /^[0-9a-f]{48}$/.test(t) ? await c.env.DB.prepare("SELECT id, address FROM sentinel_watches WHERE token = ?1").bind(t).first<{ id: number; address: string }>() : null;
  if (!row) return c.redirect("/sentinel#invalid", 302);
  try {
    const facts = await contractFacts(c.env, row.address);
    if (facts["contract.is_contract"] === false) {
      await c.env.DB.prepare("DELETE FROM sentinel_watches WHERE id = ?1").bind(row.id).run();
      return c.redirect("/sentinel#not-a-contract", 302);
    }
    await c.env.DB.prepare("UPDATE sentinel_watches SET confirmed = 1, baseline_json = ?2, last_check_at = ?3 WHERE id = ?1").bind(row.id, JSON.stringify(pickBaseline(facts)), Math.floor(Date.now() / 1000)).run();
    return c.redirect("/sentinel#confirmed", 302);
  } catch (err) {
    if (err instanceof ChainUnavailable) return c.redirect("/sentinel#try-again", 302);
    throw err;
  }
});

sentinel.get("/unsubscribe", async (c) => {
  const t = c.req.query("t") ?? "";
  if (/^[0-9a-f]{48}$/.test(t)) await c.env.DB.prepare("DELETE FROM sentinel_watches WHERE token = ?1").bind(t).run();
  return c.redirect("/sentinel#unsubscribed", 302);
});

/** Cron: check the least recently checked confirmed watches, mail anyone whose token changed. */
export async function runSentinel(env: Env, origin = "https://coronerai.pro"): Promise<{ checked: number; alerts: number }> {
  await env.DB.prepare("DELETE FROM sentinel_watches WHERE confirmed = 0 AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')").run();
  const rows = await env.DB.prepare("SELECT id, email, address, token, baseline_json FROM sentinel_watches WHERE confirmed = 1 ORDER BY last_check_at ASC LIMIT ?1")
    .bind(PER_RUN)
    .all<{ id: number; email: string; address: string; token: string; baseline_json: string | null }>();
  let checked = 0;
  let alerts = 0;
  for (const w of rows.results ?? []) {
    try {
      const now = pickBaseline(await contractFacts(env, w.address));
      const before: Baseline | null = w.baseline_json ? JSON.parse(w.baseline_json) : null;
      const changes = before ? diffBaseline(before, now) : [];
      if (changes.length && env.RESEND_API_KEY) {
        const sent = await sendMail(
          env.RESEND_API_KEY,
          w.email,
          `Sentinel: a token you watch changed (${short(w.address)})`,
          `Coroner Sentinel noticed a change in the contract at ${w.address}:\n\n${changes.map((x) => `- ${x}`).join("\n")}\n\nThis is a rule-based observation of public on-chain data. It does not say why it changed, and it is not financial advice.\n\nCheck it: ${origin}/check\nStop watching: ${origin}/api/sentinel/unsubscribe?t=${w.token}`,
        );
        if (!sent) continue; // keep the old baseline so the next run tries again
        alerts++;
      }
      await env.DB.prepare("UPDATE sentinel_watches SET baseline_json = ?2, last_check_at = ?3 WHERE id = ?1").bind(w.id, JSON.stringify(now), Math.floor(Date.now() / 1000)).run();
      checked++;
    } catch (err) {
      if (err instanceof ChainUnavailable) break; // chain unreachable: stop this run, try next time
      console.error(JSON.stringify({ event: "sentinel_error", id: w.id, err: String(err) }));
    }
  }
  return { checked, alerts };
}
