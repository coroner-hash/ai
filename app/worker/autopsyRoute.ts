import { Hono } from "hono";
import { buildAutopsy, type PoolRec, type PoolSnap } from "./autopsy";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";
import { ChainUnavailable } from "./rpc";
import { cachedContractFacts } from "./verdictRoute";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_BODY_BYTES = 4096;

export const autopsyRoute = new Hono<{ Bindings: Env }>();

const num = (v: unknown, hi = 1e13): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= hi ? v : null);

function snap(v: unknown): PoolSnap | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return { liq_usd: num(o.liq_usd), fdv_usd: num(o.fdv_usd, 1e16), vol_h24: num(o.vol_h24), buys_h24: num(o.buys_h24, 1e9), sells_h24: num(o.sells_h24, 1e9) };
}

// The browser reads the tracked record from the public collector data (GitHub) and sends it here;
// the Worker adds the contract facts and applies the same labelling rules used for the training data.
autopsyRoute.post("/", async (c) => {
  if (!originAllowed(c)) return c.json({ error: "origin_not_allowed" }, 403);
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) return c.json({ error: "payload_too_large" }, 413);
  const ipHash = await hashIp(clientIp(c), c.env.IP_SALT);
  const { limited, retryAfter } = await overLimit(c.env.DB, `autopsy:${ipHash}`, 30, 600);
  if (limited) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = await c.req.json<{ address?: unknown; record?: Record<string, unknown> }>().catch(() => null);
  if (!body || typeof body.address !== "string" || !ADDRESS.test(body.address.trim()) || !body.record) return c.json({ error: "invalid_body" }, 400);
  const first = snap(body.record.first);
  const outcome = snap(body.record.outcome);
  const created = typeof body.record.created === "string" ? body.record.created.slice(0, 30) : "";
  if (!first || !outcome || Number.isNaN(Date.parse(created))) return c.json({ error: "invalid_record" }, 400);
  const rec: PoolRec = { symbol: String(body.record.symbol ?? "").slice(0, 24), created, first, outcome };
  try {
    const { facts } = await cachedContractFacts(c.env, body.address.trim().toLowerCase());
    return c.json({ address: body.address.trim().toLowerCase(), rule_baseline: true, verdict: buildAutopsy(facts, rec), facts });
  } catch (err) {
    if (err instanceof ChainUnavailable) return c.json({ error: "chain_unavailable" }, 503);
    throw err;
  }
});
