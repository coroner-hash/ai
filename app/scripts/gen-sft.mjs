// Build the supervised fine-tuning dataset for Coroner (chat format JSONL).
// Targets come from the PRODUCTION rule engines (worker/rules.ts, autopsy.ts, premortem.ts), so the model learns to
// reproduce, and later to improve on, exactly what the site does today.
// Sources: real tokens (data/facts.jsonl from the collector) and seeded synthetic cases that cover the whole flag space.
// Synthetic rows are tagged in meta and are never used for the evaluation split's headline numbers.
//
// Usage: node --import ./scripts/ts-register.mjs scripts/gen-sft.mjs [outDir=../data/sft]
import fs from "node:fs";
import path from "node:path";
import { buildVerdict } from "../worker/rules.ts";
import { buildAutopsy } from "../worker/autopsy.ts";
import { premortem } from "../worker/premortem.ts";

const OUT = path.resolve(process.argv[2] ?? "../data/sft");
const FACTS = path.resolve("../data/facts.jsonl");
fs.mkdirSync(OUT, { recursive: true });

const SYSTEM =
  "You are Coroner, a risk judge for tokens on Robinhood Chain. You receive a fact sheet as JSON and reply with exactly one JSON verdict. " +
  "Use only numbers that appear in the fact sheet. Describe patterns consistent with the data; never accuse anyone. " +
  "Every flag must cite the fact keys it relies on. If a fact is absent, do not guess it.";

// ---------- seeded RNG ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261015);
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const chance = (p) => R() < p;
const logn = (lo, hi) => Math.exp(Math.log(lo) + R() * (Math.log(hi) - Math.log(lo)));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const hashSplit = (s) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % 100 < 20 ? "eval" : "train"; // 20% of real tokens held out, decided by the token, not by chance
};

const user = (obj) => JSON.stringify(obj);
const assistant = (obj) => JSON.stringify(obj);
const row = (mode, source, split, input, output) => ({ messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user(input) }, { role: "assistant", content: assistant(output) }], meta: { mode, source, split } });

const rows = [];

// ---------- A/B: real tokens ----------
const real = fs.existsSync(FACTS) ? fs.readFileSync(FACTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const snapAge = (created, at) => (at ? Math.max(0, round((Date.parse(at) - Date.parse(created)) / 3_600_000, 1)) : null);
for (const r of real) {
  const f = r.facts;
  if (!f["contract.is_contract"]) continue;
  const split = hashSplit(r.token);
  const mk = (m) => (m && Object.keys(m).length ? { ...m, "market.top_pool_age_hours": snapAge(r.created, m.__at) } : {});
  const marketNow = r.market_now && Object.keys(r.market_now).length ? r.market_now : r.market_first;
  const live = { ...f, ...marketNow };
  delete live["market.source"];
  const ageAt = r.market_now && Object.keys(r.market_now).length ? r.label?.evidence?.["now.at"] : null;
  live["market.top_pool_age_hours"] = r.label?.status === "unknown" ? 1 : 25; // coarse: unresolved rows were seen <24h after launch
  rows.push(row("live", "real", split, { mode: "live", facts: live }, buildVerdict(live, "live")));

  if (r.label?.status === "dead" || r.label?.status === "alive") {
    const mf = r.market_first, mn = r.market_now;
    const rec = {
      symbol: r.symbol, created: r.created,
      first: { liq_usd: mf["market.liq_usd"], fdv_usd: mf["market.fdv_usd"], vol_h24: mf["market.vol_h24_usd"], buys_h24: mf["market.buys_h24"], sells_h24: mf["market.sells_h24"] },
      outcome: { liq_usd: mn["market.liq_usd"], fdv_usd: mn["market.fdv_usd"], vol_h24: mn["market.vol_h24_usd"], buys_h24: mn["market.buys_h24"], sells_h24: mn["market.sells_h24"] },
    };
    const input = { mode: "autopsy", facts: f, record: rec };
    rows.push(row("autopsy", "real", split, input, buildAutopsy(f, rec, r.label.clone_of ?? null)));
  }
}

// ---------- C: synthetic live fact sheets ----------
const fakeAddr = () => "0x" + Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(R() * 16)]).join("");
function synthFacts() {
  const f = { "token.address": fakeAddr(), "contract.is_contract": true, "contract.code_bytes": Math.round(logn(1500, 24000)) };
  const priv = chance(0.35);
  f["contract.selector_mint"] = priv && chance(0.5);
  f["contract.selector_owner"] = priv || chance(0.1);
  f["contract.selector_blacklist"] = priv && chance(0.3);
  f["contract.selector_pause"] = priv && chance(0.25);
  f["contract.proxy_implementation"] = chance(0.06) ? fakeAddr() : null;
  f["token.name"] = pick(["Tacocat", "Moon Frog", "Nova", "Glitch", "Pixel Pup", "Orbit", "Hound", "Wisp", "Cashcat", "Atlas"]);
  f["token.symbol"] = pick(["TACO", "FROG", "NOVA", "GLCH", "PUP", "ORBT", "HOUND", "WISP", "CCAT", "ATLS"]);
  f["token.decimals"] = 18;
  f["token.supply"] = pick([1e9, 1e9, 1e9, 1e8, 1e12]);
  if (f["contract.selector_owner"]) {
    f["contract.owner"] = fakeAddr();
    f["contract.owner_renounced"] = chance(0.4);
  }
  if (chance(0.06)) f["token.category"] = "stablecoin";
  if (chance(0.9)) {
    f["market.pool_count"] = chance(0.05) ? 0 : 1 + Math.floor(R() * 3);
    if (f["market.pool_count"] > 0) {
      f["market.liq_usd"] = chance(0.1) ? 0 : round(logn(300, 400000), 0);
      f["market.vol_h24_usd"] = round(logn(1, 2000000), 0);
      f["market.top_pool_age_hours"] = round(logn(0.2, 400), 1);
      f["market.fdv_usd"] = round(logn(2000, 5e7), 0);
      f["market.buys_h24"] = Math.floor(logn(1, 4000));
      f["market.sells_h24"] = Math.floor(logn(1, 4000));
    }
  }
  if (chance(0.7)) {
    const top1 = round(chance(0.25) ? 10 + R() * 50 : R() * 10, 2);
    f["holders.count"] = Math.floor(logn(5, 40000));
    f["holders.top1_pct"] = top1;
    f["holders.top10_pct"] = round(Math.min(100, top1 + R() * 55), 2);
    f["holders.top1_is_contract"] = chance(0.3);
    f["holders.top1_address"] = fakeAddr();
  }
  return f;
}
for (let i = 0; i < 1500; i++) {
  const f = synthFacts();
  rows.push(row("live", "synthetic", chance(0.1) ? "eval" : "train", { mode: "live", facts: f }, buildVerdict(f, "live")));
}

// ---------- E: synthetic autopsies ----------
for (let i = 0; i < 700; i++) {
  const f = synthFacts();
  const liq0 = round(logn(200, 300000), 0);
  const vol0 = round(logn(1, 200000), 0);
  const kind = pick(["lp", "bleed", "never", "alive", "alive"]);
  const first = { liq_usd: liq0, fdv_usd: round(liq0 * (2 + R() * 20), 0), vol_h24: vol0, buys_h24: Math.floor(logn(1, 800)), sells_h24: Math.floor(logn(1, 800)) };
  let outcome;
  if (kind === "lp") outcome = { liq_usd: round(liq0 * R() * 0.05, 0), fdv_usd: round(first.fdv_usd * R() * 0.1, 0), vol_h24: round(R() * 40, 0), buys_h24: 0, sells_h24: Math.floor(R() * 3) };
  else if (kind === "bleed") outcome = { liq_usd: round(liq0 * (0.3 + R() * 0.7), 0), fdv_usd: round(first.fdv_usd * R() * 0.3, 0), vol_h24: round(R() * 40, 0), buys_h24: 0, sells_h24: Math.floor(R() * 3) };
  else if (kind === "never") outcome = { liq_usd: round(liq0 * (0.8 + R() * 0.2), 0), fdv_usd: first.fdv_usd, vol_h24: round(R() * 30, 0), buys_h24: 0, sells_h24: 0 };
  else outcome = { liq_usd: round(liq0 * (0.6 + R() * 0.6), 0), fdv_usd: round(first.fdv_usd * (0.4 + R()), 0), vol_h24: round(logn(60, 300000), 0), buys_h24: 3 + Math.floor(R() * 400), sells_h24: 3 + Math.floor(R() * 400) };
  if (kind === "never") first.vol_h24 = round(R() * 400, 0);
  const rec = { symbol: f["token.symbol"], created: "2026-10-14T06:00:00Z", first, outcome };
  const base = { ...f };
  for (const k of Object.keys(base)) if (k.startsWith("market.") || k.startsWith("holders.")) delete base[k];
  rows.push(row("autopsy", "synthetic", chance(0.1) ? "eval" : "train", { mode: "autopsy", facts: base, record: rec }, buildAutopsy(base, rec, null)));
}

// ---------- D: synthetic pre-mortem drafts ----------
const NAMES = ["Tacocat", "Moon Frog", "Nova", "Cashcat 2", "Official Robinhood Cat", "Atlas", "Safe Gem", "Pixel Pup", "USDG Inu", "Orbit"];
const SYMS = ["TACO", "FROG", "nova", "CCAT", "ROBINCAT", "ATLS", "GEM", "PUP", "USDGINU", "ORBT"];
const DESCS = ["", "A community token run by three named maintainers.", "Guaranteed 100x gem, to the moon.", "A cat-themed meme. No promises.", "Risk free, financial freedom.", "Open source token with a fixed supply and locked liquidity."];
const SRC = [
  "contract T is Ownable {\n  function mint(address a, uint v) external onlyOwner { _mint(a, v); }\n}",
  "contract T is ERC20 {\n  function setFee(uint f) external onlyOwner { fee = f; }\n  function blacklistAddr(address a) external onlyOwner { isBlacklisted[a] = true; }\n}",
  "contract T is ERC20 {\n  function kill() external { selfdestruct(payable(msg.sender)); }\n}",
  "contract T is ERC20 {\n  constructor() ERC20(\"T\", \"T\") { _mint(msg.sender, 1e27); }\n}",
  "",
];
for (let i = 0; i < 1500; i++) {
  const d = {};
  if (chance(0.9)) d.name = pick(NAMES);
  if (chance(0.9)) d.symbol = pick(SYMS);
  if (chance(0.8)) d.description = pick(DESCS);
  if (chance(0.7)) { d.buyTaxPct = pick([0, 0, 1, 3, 5, 8, 12]); d.sellTaxPct = pick([0, 0, 1, 3, 5, 8, 12, 20]); }
  if (chance(0.5)) d.taxChangeable = chance(0.3);
  d.hasMint = chance(0.25); d.ownerRenounce = chance(0.5); d.hasBlacklist = chance(0.15); d.hasPause = chance(0.15);
  if (chance(0.7)) { d.teamAllocationPct = pick([0, 2, 5, 10, 15, 25, 40]); d.allocationSplit = pick(["one_wallet", "several_wallets", "vesting"]); }
  if (chance(0.7)) { d.liquidityUsd = pick([200, 800, 3000, 15000, 80000]); d.liquidityLock = pick(["none", "short", "long"]); }
  const src = pick(SRC);
  if (src) d.source = src;
  if (chance(0.2) && d.symbol) d.similar = [{ symbol: d.symbol.toUpperCase(), address: fakeAddr(), vol24Usd: pick([500, 20000, 400000]), liqUsd: pick([800, 9000, 300000]) }];
  if (!Object.keys(d).length) continue;
  rows.push(row("draft", "synthetic", chance(0.1) ? "eval" : "train", { mode: "draft", draft: d }, premortem(d)));
}

// ---------- write ----------
const by = { train: [], eval: [] };
for (const r of rows) by[r.meta.split].push(r);
for (const [k, v] of Object.entries(by)) fs.writeFileSync(path.join(OUT, `${k}.jsonl`), v.map((x) => JSON.stringify(x)).join("\n") + "\n");
const count = (arr, key) => arr.reduce((m, r) => ((m[r.meta[key]] = (m[r.meta[key]] ?? 0) + 1), m), {});
const chars = rows.reduce((s, r) => s + r.messages.reduce((a, m) => a + m.content.length, 0), 0);
console.log(JSON.stringify({ total: rows.length, train: by.train.length, eval: by.eval.length, mode: count(rows, "mode"), source: count(rows, "source"), approxTokens: Math.round(chars / 3.5) }, null, 1));
