// Coroner rule engine (rule baseline). Pure functions, no imports: the Worker and the dataset generator
// (scripts/gen-sft.mjs) run this exact code, so training targets match production behaviour.

export type Facts = Record<string, string | number | boolean | null>;
const DISCLAIMER = "Risk classification from public on-chain data. Not financial advice.";

// ---------- rules ----------
type Level = "low" | "medium" | "high";
type Flag = { code: string; level: Level; text: string; evidence_ids: string[] };
const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };
const flag = (code: string, level: Level, text: string, ev: string[]): Flag => ({ code, level, text, evidence_ids: ev });

export function flagsFrom(f: Facts): Flag[] {
  const out: Flag[] = [];
  const stable = f["token.category"] === "stablecoin";
  if (f["contract.selector_mint"] && f["contract.owner_renounced"] === false) {
    out.push(
      stable
        ? flag("issuer_controlled_mint", "low", "Known stablecoin: an owner-controlled mint is expected for an issuer.", ["contract.selector_mint", "contract.owner_renounced", "token.category"])
        : flag("mint_with_live_owner", "high", "Contract has a mint function and the owner has not renounced; supply may be increased.", ["contract.selector_mint", "contract.owner_renounced", "contract.owner"]),
    );
  }
  if (f["contract.selector_blacklist"]) out.push(flag("blacklist_function", stable ? "low" : "medium", "Contract bytecode contains a blacklist function; selected wallets may be blocked from trading.", ["contract.selector_blacklist"]));
  if (f["contract.selector_pause"]) out.push(flag("pause_function", stable ? "low" : "medium", "Contract bytecode contains pause(); transfers may be halted.", ["contract.selector_pause"]));
  const t1 = f["holders.top1_pct"] as number | null;
  const t10 = f["holders.top10_pct"] as number | null;
  if (typeof t1 === "number" && f["holders.top1_is_contract"] === false) {
    if (t1 >= 25) out.push(flag("top1_concentration", "high", `One wallet holds ${t1}% of supply.`, ["holders.top1_pct", "holders.top1_address"]));
    else if (t1 >= 10) out.push(flag("top1_concentration", "medium", `One wallet holds ${t1}% of supply.`, ["holders.top1_pct", "holders.top1_address"]));
  }
  if (typeof t10 === "number" && t10 >= 50) out.push(flag("top10_concentration", "medium", `Top 10 wallets hold ${t10}% of supply.`, ["holders.top10_pct"]));
  if (f["market.pool_count"] === 0) out.push(flag("no_pool", "medium", "No trading pool found for this token.", ["market.pool_count"]));
  else if (typeof f["market.pool_count"] === "number") {
    const liq = f["market.liq_usd"] as number | null;
    if (liq && liq > 0 && liq < 1000) out.push(flag("thin_liquidity", "medium", `Reported liquidity is only $${Math.round(liq).toLocaleString("en-US")}.`, ["market.liq_usd"])); // 0 is unreliable on some v4 pools
    const age = f["market.top_pool_age_hours"] as number | null;
    if (typeof age === "number" && age < 6) out.push(flag("very_new_pool", "low", `Main pool is ${age} hours old.`, ["market.top_pool_age_hours"]));
  }
  return out;
}

const FIXES: Record<string, string> = {
  mint_with_live_owner: "Remove the mint function, or renounce ownership after the initial mint.",
  blacklist_function: "Remove the blacklist function; if one is required, document who controls it.",
  pause_function: "Remove pause() or put it behind a timelock so holders can exit.",
  top1_concentration: "Split the top wallet's allocation or vest it; state the wallet publicly.",
  top10_concentration: "Widen distribution (airdrop, vesting, larger public float).",
  thin_liquidity: "Add more liquidity and lock it before promoting the token.",
  no_pool: "Create and fund a pool before announcing the token.",
};

export function buildVerdict(f: Facts, mode: "live" | "draft" = "live") {
  const flags = flagsFrom(f);
  const worst = Math.max(0, ...flags.map((x) => RANK[x.level]));
  const mediums = flags.filter((x) => x.level === "medium").length;
  const risk = worst === 2 || mediums >= 3 ? "high" : worst === 1 ? "medium" : "low";
  const used = [...new Set(flags.flatMap((x) => x.evidence_ids))];
  const evidence: Record<string, unknown> = {};
  for (const k of used) evidence[k] = f[k] ?? null;
  const known = ["holders.count", "market.liq_usd", "contract.owner_renounced", "token.supply"].filter((k) => f[k] !== undefined && f[k] !== null).length;
  const hidden = flags.some((x) => x.code === "mint_with_live_owner" || x.code === "blacklist_function");
  return {
    mode,
    risk_class: risk,
    cause_pattern: hidden ? "hidden_privilege" : "none",
    clone_of: null,
    flags: flags.map(({ code, text, evidence_ids }) => ({ code, text, evidence_ids })),
    ...(mode === "draft" ? { fixes: flags.filter((x) => FIXES[x.code]).map((x) => ({ flag_code: x.code, suggestion: FIXES[x.code], diff: null })) } : {}),
    evidence,
    confidence: Math.round((0.45 + 0.1 * known) * 100) / 100,
    disclaimer: DISCLAIMER,
  };
}
