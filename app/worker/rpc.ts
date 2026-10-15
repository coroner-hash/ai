// JSON-RPC with provider fallback.
// Order: RPC_URL (primary), RPC_URL_2 (e.g. Alchemy), then the public RPC. A provider that errors with a
// rate-limit style failure is skipped for a short cooldown so the next request does not wait on it again.
// Never put provider URLs in responses or logs: they contain API keys.

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const COOLDOWN_MS = 60_000;
const cooldown = new Map<string, number>(); // per-isolate, best effort

export class ChainUnavailable extends Error {}

function providers(env: Env): string[] {
  const list = [env.RPC_URL, env.RPC_URL_2, PUBLIC_RPC].filter((u): u is string => Boolean(u && u.startsWith("https://")));
  return [...new Set(list)];
}

type RpcReply = { result?: unknown; error?: { code?: number; message?: string } };

const isRevert = (e?: RpcReply["error"]) => Boolean(e && (e.code === 3 || /revert|invalid opcode|execution/i.test(e.message ?? "")));

export async function rpc<T = unknown>(env: Env, method: string, params: unknown[]): Promise<T | null> {
  const now = Date.now();
  const all = providers(env);
  const live = all.filter((u) => (cooldown.get(u) ?? 0) < now);
  const order = live.length ? live : all; // if everything is cooling down, try anyway
  for (const url of order) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429 || res.status >= 500) {
        cooldown.set(url, now + COOLDOWN_MS);
        continue;
      }
      const body = (await res.json()) as RpcReply;
      if (body.error) {
        if (isRevert(body.error)) return null; // a normal "this contract has no such function"
        cooldown.set(url, now + COOLDOWN_MS);
        continue;
      }
      return (body.result ?? null) as T | null;
    } catch {
      cooldown.set(url, now + COOLDOWN_MS);
    }
  }
  throw new ChainUnavailable("all RPC providers failed");
}

export const ethCall = (env: Env, to: string, data: string) => rpc<string>(env, "eth_call", [{ to, data }, "latest"]);

/** Diagnostic: call ONE provider directly (1 = RPC_URL, 2 = RPC_URL_2). Returns a sanitized result, never the URL. */
export async function probeProvider(env: Env, which: 1 | 2, logSpan = 0): Promise<{ ok: boolean; block?: string; reason?: string; logs?: string }> {
  const url = which === 1 ? env.RPC_URL : env.RPC_URL_2;
  if (!url) return { ok: false, reason: "not set" };
  if (!url.startsWith("https://")) return { ok: false, reason: "value is not an https URL" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).replace(/https?:\/\/\S+/g, "<url>").replace(/\s+/g, " ").slice(0, 160);
      return { ok: false, reason: `HTTP ${res.status} ${text}`.trim() };
    }
    const body = (await res.json()) as RpcReply;
    if (body.error) return { ok: false, reason: String(body.error.message ?? "rpc error").replace(/https?:\/\/\S+/g, "<url>").slice(0, 140) };
    const block = typeof body.result === "string" ? BigInt(body.result) : null;
    let logs: string | undefined;
    if (block !== null && logSpan > 0) {
      // does this plan allow wide eth_getLogs ranges? (needed to rebuild holders on the server)
      const lr = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getLogs", params: [{ address: "0xc0d5912d1903d7f79ba312d86c08c9c11a037777", topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"], fromBlock: "0x" + (block - BigInt(logSpan)).toString(16), toBlock: "0x" + block.toString(16) }] }),
        signal: AbortSignal.timeout(15000),
      });
      const lb = (await lr.json().catch(() => ({}))) as RpcReply;
      logs = lb.error ? "ERR " + String(lb.error.message ?? "").replace(/https?:\/\/\S+/g, "<url>").slice(0, 120) : "ok " + (Array.isArray(lb.result) ? lb.result.length : "?");
    }
    return { ok: block !== null, block: block?.toString(), logs };
  } catch {
    return { ok: false, reason: "request failed" };
  }
}
