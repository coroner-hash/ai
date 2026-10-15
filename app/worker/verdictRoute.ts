import { Hono } from "hono";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";
import { ChainUnavailable } from "./rpc";
import { buildVerdict, contractFacts, mergeExt, type Ext, type Facts } from "./verdict";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_BODY_BYTES = 4096;
const CACHE_SECONDS = 600; // contract facts rarely change; saves RPC credits

export const verdict = new Hono<{ Bindings: Env }>();

export async function cachedContractFacts(env: Env, address: string): Promise<{ facts: Facts; cached: boolean }> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT facts_json, created_at FROM verdict_cache WHERE address = ?1").bind(address).first<{ facts_json: string; created_at: number }>();
  if (row && now - row.created_at < CACHE_SECONDS) return { facts: JSON.parse(row.facts_json) as Facts, cached: true };
  const facts = await contractFacts(env, address);
  await env.DB.prepare("INSERT INTO verdict_cache (address, facts_json, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (address) DO UPDATE SET facts_json = ?2, created_at = ?3")
    .bind(address, JSON.stringify(facts), now)
    .run();
  return { facts, cached: false };
}

async function handle(c: any, address: string, ext: Ext | undefined, mode: "live" | "draft") {
  const ipHash = await hashIp(clientIp(c), c.env.IP_SALT);
  const { limited, retryAfter } = await overLimit(c.env.DB, `verdict:${ipHash}`, 30, 600);
  if (limited) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }
  if (!ADDRESS.test(address)) return c.json({ error: "invalid_address" }, 400);
  try {
    const { facts, cached } = await cachedContractFacts(c.env, address.toLowerCase());
    if (facts["contract.is_contract"] === false) return c.json({ error: "not_a_contract", address: address.toLowerCase() }, 404);
    const merged: Facts = { ...facts };
    mergeExt(merged, ext);
    const notes: string[] = [];
    if (merged["market.pool_count"] === undefined) notes.push("Market data was not provided, so liquidity and pool checks were skipped.");
    if (merged["holders.count"] === undefined) notes.push("Holder data was not provided, so concentration checks were skipped.");
    return c.json({ address: address.toLowerCase(), rule_baseline: true, cached, verdict: buildVerdict(merged, mode), facts: merged, notes });
  } catch (err) {
    if (err instanceof ChainUnavailable) return c.json({ error: "chain_unavailable" }, 503);
    throw err;
  }
}

// GET: contract facts only (no market/holders), handy for quick API use.
verdict.get("/:address", (c) => handle(c, c.req.param("address"), undefined, "live"));

// POST: the web page sends market/holder facts it read in the browser.
verdict.post("/", async (c) => {
  if (!originAllowed(c)) return c.json({ error: "origin_not_allowed" }, 403);
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) return c.json({ error: "payload_too_large" }, 413);
  const body = await c.req.json<{ address?: unknown; ext?: Ext; mode?: unknown }>().catch(() => null);
  if (!body || typeof body.address !== "string") return c.json({ error: "invalid_body" }, 400);
  return handle(c, body.address.trim(), body.ext, body.mode === "draft" ? "draft" : "live");
});
