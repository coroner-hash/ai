#!/usr/bin/env node
// Coroner MCP server (stdio). Gives an AI agent three tools: check_token, premortem, autopsy_token.
//
// Market and holder data are read from THIS machine (Blockscout and GeckoTerminal block cloud servers),
// then sent with the address to the Coroner API, which reads the contract and applies the open rule engine.
// Answers are rule-based today. Each reply says which engine produced it. Not financial advice.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = (process.env.CORONER_API ?? "https://coronerai.pro").replace(/\/$/, "");
const BS = "https://robinhoodchain.blockscout.com/api/v2";
const GT = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const SHARDS = "https://raw.githubusercontent.com/coroner-hash/ai/main/data/shards";
const DEAD = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UA = { "user-agent": "coroner-mcp/0.1", accept: "application/json" };

async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function postJSON(path, body) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { ...UA, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Coroner API ${r.status}: ${data.error ?? "error"}`);
  return data;
}

/** Market and holder facts, read locally. Returns what could be read and which parts could not. */
export async function readExt(address) {
  const [tok, hold, pools] = await Promise.allSettled([
    getJSON(`${BS}/tokens/${address}`),
    getJSON(`${BS}/tokens/${address}/holders`),
    getJSON(`${GT}/tokens/${address}/pools`),
  ]);
  const ext = {};
  const gaps = [];
  if (pools.status === "fulfilled") {
    const list = pools.value.data ?? [];
    ext.market = { poolCount: list.length };
    if (list.length) {
      const top = list.reduce((a, b) => (Number(b.attributes.reserve_in_usd) > Number(a.attributes.reserve_in_usd) ? b : a)).attributes;
      const tx = top.transactions?.h24 ?? {};
      Object.assign(ext.market, {
        topPoolName: top.name,
        poolCreated: top.pool_created_at,
        liqUsd: Number(top.reserve_in_usd),
        vol24Usd: Number(top.volume_usd?.h24),
        fdvUsd: top.fdv_usd ? Number(top.fdv_usd) : null,
        buys24: tx.buys ?? null,
        sells24: tx.sells ?? null,
      });
    }
  } else gaps.push("market");
  if (tok.status === "fulfilled" && hold.status === "fulfilled" && tok.value.total_supply) {
    const supply = BigInt(tok.value.total_supply);
    const items = (hold.value.items ?? []).filter((h) => !DEAD.has(String(h.address?.hash).toLowerCase()));
    const pct = (v) => (supply > 0n ? Number((BigInt(v) * 10000n) / supply) / 100 : null);
    const top10 = items.slice(0, 10).reduce((s, h) => s + BigInt(h.value), 0n);
    ext.holders = {
      count: Number(tok.value.holders_count ?? tok.value.holders ?? NaN),
      top1Pct: items[0] ? pct(items[0].value) : null,
      top10Pct: pct(top10),
      top1IsContract: items[0] ? Boolean(items[0].address?.is_contract) : null,
      top1Address: items[0]?.address?.hash ?? null,
    };
  } else gaps.push("holders");
  return { ext, gaps };
}

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ isError: true, content: [{ type: "text", text: msg }] });

function summarize(d, gaps = []) {
  const v = d.verdict ?? {};
  return {
    engine: d.engine ?? "rules",
    model: d.model ?? null,
    address: d.address,
    risk_class: v.risk_class,
    status: v.status,
    cause_pattern: v.cause_pattern,
    flags: (v.flags ?? []).map((f) => ({ code: f.code, text: f.text, evidence: f.evidence_ids })),
    fixes: v.fixes,
    confidence: v.confidence,
    narrative: d.narrative,
    notes: [...(d.notes ?? []), ...(gaps.length ? [`Could not read ${gaps.join(" and ")} data from this machine, so those checks were skipped.`] : [])],
    disclaimer: v.disclaimer,
  };
}

const server = new McpServer({ name: "coroner", version: "0.1.0" });

server.registerTool(
  "check_token",
  {
    title: "Check a token (verdict)",
    description:
      "Risk verdict for a deployed token on Robinhood Chain: reads the contract, market and holders, and returns a risk class with each flag tied to its evidence. Rule-based today; never a price call or an accusation. Use before trading or listing a token.",
    inputSchema: { address: z.string().describe("Token contract address (0x...)") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ address }) => {
    if (!ADDRESS.test(address.trim())) return fail("That is not a valid 0x address (40 hex characters).");
    const a = address.trim().toLowerCase();
    try {
      const { ext, gaps } = await readExt(a);
      const d = await postJSON("/api/v1/verdict", { address: a, ext });
      return text(summarize(d, gaps));
    } catch (e) {
      return fail(String(e.message ?? e));
    }
  },
);

server.registerTool(
  "premortem",
  {
    title: "Pre-mortem of a launch draft",
    description:
      "Before launching a token: describe the draft and get the risks the market will see, the death patterns it invites, and concrete fixes. Rule-based today. Provide as many fields as you know.",
    inputSchema: {
      name: z.string().optional(),
      symbol: z.string().optional(),
      description: z.string().optional().describe("What it is and who runs it, in a sentence or two"),
      buyTaxPct: z.number().optional(),
      sellTaxPct: z.number().optional(),
      teamAllocationPct: z.number().optional(),
      allocationSplit: z.enum(["one_wallet", "several_wallets", "vesting"]).optional(),
      liquidityUsd: z.number().optional(),
      liquidityLock: z.enum(["none", "short", "long"]).optional().describe("none, short (<6 months), long (6+ months, burned or launchpad-locked)"),
      taxChangeable: z.boolean().optional(),
      hasMint: z.boolean().optional(),
      ownerRenounce: z.boolean().optional(),
      hasBlacklist: z.boolean().optional(),
      hasPause: z.boolean().optional(),
      source: z.string().max(24000).optional().describe("Solidity source of the token contract"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (draft) => {
    try {
      return text(summarize(await postJSON("/api/v1/premortem", draft)));
    } catch (e) {
      return fail(String(e.message ?? e));
    }
  },
);

server.registerTool(
  "autopsy_token",
  {
    title: "Autopsy of a watched token",
    description:
      "What happened to a token the open Coroner collector watched for at least 24 hours: still trading, or dead and the pattern (liquidity pulled, bled out, never lived, clone). Only tokens recorded since 14 Oct 2026 can be examined. Patterns consistent with the numbers, never accusations.",
    inputSchema: { address: z.string().describe("Token contract address (0x...)") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ address }) => {
    if (!ADDRESS.test(address.trim())) return fail("That is not a valid 0x address (40 hex characters).");
    const a = address.trim().toLowerCase();
    try {
      const shard = await getJSON(`${SHARDS}/${a.slice(2, 4)}.json`);
      const recs = (shard[a] ?? []).filter((r) => r.first && r.outcome);
      if (!recs.length) return fail("No autopsy record for this address. The collector has not watched it for 24 hours yet, or it was never recorded.");
      const rec = recs.sort((x, y) => String(y.created).localeCompare(String(x.created)))[0];
      const record = { symbol: rec.symbol, created: rec.created, first: rec.first, outcome: rec.outcome };
      return text(summarize(await postJSON("/api/v1/autopsy", { address: a, record })));
    } catch (e) {
      return fail(String(e.message ?? e));
    }
  },
);

if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ ok: true, api: API }));
} else {
  await server.connect(new StdioServerTransport());
}
