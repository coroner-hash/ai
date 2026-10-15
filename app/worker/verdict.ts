// Coroner reference verdict (rule baseline) for Robinhood Chain tokens.
// Contract facts are read here over RPC. Market and holder facts are read by the visitor's browser
// (Blockscout, GeckoTerminal) because those services block Worker egress, and are passed in as `ext`.
// The model will replace the rules later; the output shape stays the same (schema/verdict.schema.json).
import { buildVerdict, flagsFrom, type Facts } from "./rules";
import { ethCall, rpc } from "./rpc";

export { buildVerdict, flagsFrom, type Facts };


const ZERO = "0x" + "0".repeat(40);
const DEAD = "0x000000000000000000000000000000000000dead";

// 4-byte selectors. Heuristic: present in bytecode means the function may exist, not that it is abusable.
const SELECTORS: Record<string, string[]> = {
  mint: ["40c10f19", "a0712d68"],
  owner: ["8da5cb5b"],
  renounce: ["715018a6"],
  pause: ["8456cb59"],
  blacklist: ["f9f92be4", "fe575a87", "0ecb93c0"],
};

// Tokens whose owner-controlled mint is expected. Without this, the rules would flag a regulated stablecoin like a day-old meme.
const KNOWN: Record<string, { category: string; label: string }> = {
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": { category: "stablecoin", label: "USDG (Global Dollar)" },
};

function decodeString(hex: string | null): string | null {
  if (!hex || hex === "0x") return null;
  try {
    const raw = hex.slice(2);
    const bytes = new Uint8Array(raw.match(/../g)!.map((h) => parseInt(h, 16)));
    if (bytes.length >= 64) {
      const len = parseInt(raw.slice(64, 128), 16);
      if (len > 0 && len < 256) return new TextDecoder().decode(bytes.slice(64, 64 + len));
    }
    return new TextDecoder().decode(bytes).replace(/\0+$/g, "") || null; // bytes32-style name
  } catch {
    return null;
  }
}

async function implementationOf(env: Env, address: string, code: string): Promise<string | null> {
  const h = code.slice(2).toLowerCase();
  if (h.startsWith("363d3d373d3d3d363d73") && h.length >= 62) return "0x" + h.slice(20, 60); // EIP-1167
  if (h.length < 400) {
    const slot = await rpc<string>(env, "eth_getStorageAt", [address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"]);
    if (slot && BigInt(slot) !== 0n) return "0x" + slot.slice(-40); // EIP-1967
  }
  return null;
}

export async function contractFacts(env: Env, address: string): Promise<Facts> {
  const a = address.toLowerCase();
  const f: Facts = { "token.address": a };
  const code = (await rpc<string>(env, "eth_getCode", [a, "latest"])) ?? "0x";
  f["contract.is_contract"] = code.length > 2;
  f["contract.code_bytes"] = (code.length - 2) / 2;
  if (code.length <= 2) return f;

  let hex = code.slice(2).toLowerCase();
  const impl = await implementationOf(env, a, code);
  f["contract.proxy_implementation"] = impl;
  if (impl) hex += ((await rpc<string>(env, "eth_getCode", [impl, "latest"])) ?? "0x").slice(2).toLowerCase();
  for (const [name, sels] of Object.entries(SELECTORS)) f[`contract.selector_${name}`] = sels.some((s) => hex.includes(s));

  const [name, symbol, dec, supply, owner] = await Promise.all([
    ethCall(env, a, "0x06fdde03"),
    ethCall(env, a, "0x95d89b41"),
    ethCall(env, a, "0x313ce567"),
    ethCall(env, a, "0x18160ddd"),
    f["contract.selector_owner"] ? ethCall(env, a, "0x8da5cb5b") : Promise.resolve(null),
  ]);
  f["token.name"] = decodeString(name);
  f["token.symbol"] = decodeString(symbol);
  const decimals = dec && dec !== "0x" ? parseInt(dec, 16) : null;
  f["token.decimals"] = decimals;
  if (supply && supply !== "0x" && decimals !== null) {
    f["token.supply_raw"] = BigInt(supply).toString();
    f["token.supply"] = Number(BigInt(supply) / 10n ** BigInt(Math.max(decimals - 2, 0))) / 10 ** Math.min(decimals, 2);
  }
  if (owner && owner.length >= 66) {
    const o = "0x" + owner.slice(-40).toLowerCase();
    f["contract.owner"] = o;
    f["contract.owner_renounced"] = o === ZERO || o === DEAD;
  } else {
    f["contract.owner"] = null;
    f["contract.owner_renounced"] = null;
  }
  const known = KNOWN[a];
  if (known) f["token.category"] = known.category;
  return f;
}

// ---------- facts supplied by the browser ----------
export type Ext = {
  market?: { poolCount?: number; topPoolName?: string; poolCreated?: string; liqUsd?: number | null; vol24Usd?: number | null; fdvUsd?: number | null; buys24?: number | null; sells24?: number | null };
  holders?: { count?: number | null; top1Pct?: number | null; top10Pct?: number | null; top1IsContract?: boolean | null; top1Address?: string | null };
};

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

export function mergeExt(f: Facts, ext: Ext | undefined): void {
  const m = ext?.market;
  if (m && typeof m === "object") {
    const n = num(m.poolCount, 0, 1000);
    if (n !== null) f["market.pool_count"] = n;
    if (typeof m.topPoolName === "string") f["market.top_pool_name"] = m.topPoolName.slice(0, 60);
    const created = typeof m.poolCreated === "string" ? Date.parse(m.poolCreated) : NaN;
    if (!Number.isNaN(created)) {
      f["market.top_pool_created"] = new Date(created).toISOString();
      f["market.top_pool_age_hours"] = Math.max(0, Math.round(((Date.now() - created) / 3_600_000) * 10) / 10);
    }
    f["market.liq_usd"] = num(m.liqUsd, 0, 1e13);
    f["market.vol_h24_usd"] = num(m.vol24Usd, 0, 1e13);
    f["market.fdv_usd"] = num(m.fdvUsd, 0, 1e15);
    f["market.buys_h24"] = num(m.buys24, 0, 1e9);
    f["market.sells_h24"] = num(m.sells24, 0, 1e9);
    f["market.source"] = "browser:geckoterminal";
  }
  const h = ext?.holders;
  if (h && typeof h === "object") {
    f["holders.count"] = num(h.count, 0, 1e9);
    f["holders.top1_pct"] = num(h.top1Pct, 0, 100);
    f["holders.top10_pct"] = num(h.top10Pct, 0, 100);
    f["holders.top1_is_contract"] = typeof h.top1IsContract === "boolean" ? h.top1IsContract : null;
    f["holders.top1_address"] = typeof h.top1Address === "string" && /^0x[0-9a-fA-F]{40}$/.test(h.top1Address) ? h.top1Address.toLowerCase() : null;
    f["holders.source"] = "browser:blockscout";
  }
}

