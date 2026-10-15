// Pre-mortem (draft mode): rule baseline for a launch draft BEFORE it ships.
// Input is what a builder knows now: name, ticker, parameters, optional contract source.
// Output follows the verdict shape (mode "draft") with fixes, plus the death patterns this draft is exposed to.
// Patterns, not predictions: nothing here says a token will die or pump.

export type Draft = {
  name?: unknown; symbol?: unknown; description?: unknown;
  buyTaxPct?: unknown; sellTaxPct?: unknown; taxChangeable?: unknown;
  hasMint?: unknown; ownerRenounce?: unknown; hasBlacklist?: unknown; hasPause?: unknown;
  teamAllocationPct?: unknown; allocationSplit?: unknown;
  liquidityUsd?: unknown; liquidityLock?: unknown;
  source?: unknown;
  similar?: unknown;
};

type Level = "low" | "medium" | "high";
type Flag = { code: string; level: Level; text: string; evidence_ids: string[] };
type Fix = { flag_code: string; suggestion: string; diff: string | null };
const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };
const DISCLAIMER = "Risk classification from public on-chain data. Not financial advice.";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const bool = (v: unknown) => v === true || v === "true" || v === "on";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const IMPERSONATION = /(robinhood|official|usdg|usdc|tether|circle|binance|coinbase|elon|trump)/i;
const PROMISES = /(100x|1000x|guaranteed|risk[- ]?free|can'?t lose|cannot lose|moon|to the moon|safe gem|no risk|next (btc|bitcoin|eth|doge)|financial freedom)/i;

type Similar = { symbol: string; address: string; vol24Usd: number; liqUsd: number };
function readSimilar(v: unknown): Similar[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 10).flatMap((x) => {
    const o = x as Record<string, unknown>;
    const symbol = str(o.symbol, 24);
    const address = str(o.address, 42);
    const vol = num(o.vol24Usd, 0, 1e13);
    const liq = num(o.liqUsd, 0, 1e13);
    return symbol && /^0x[0-9a-fA-F]{40}$/.test(address) ? [{ symbol, address: address.toLowerCase(), vol24Usd: vol ?? 0, liqUsd: liq ?? 0 }] : [];
  });
}

// ---- contract source scan (line-based, heuristic) ----
type Hit = { line: number; text: string };
function scan(source: string, re: RegExp): Hit[] {
  const hits: Hit[] = [];
  source.split("\n").forEach((t, i) => {
    if (re.test(t)) hits.push({ line: i + 1, text: t.trim().slice(0, 140) });
  });
  return hits;
}

export function premortem(d: Draft) {
  const flags: Flag[] = [];
  const fixes: Fix[] = [];
  const evidence: Record<string, unknown> = {};
  const add = (code: string, level: Level, text: string, ev: Record<string, unknown>, fix?: string, diff: string | null = null) => {
    flags.push({ code, level, text, evidence_ids: Object.keys(ev) });
    Object.assign(evidence, ev);
    if (fix) fixes.push({ flag_code: code, suggestion: fix, diff });
  };

  const name = str(d.name, 60), symbol = str(d.symbol, 24), description = str(d.description, 600);
  const buy = num(d.buyTaxPct, 0, 100), sell = num(d.sellTaxPct, 0, 100);
  const team = num(d.teamAllocationPct, 0, 100);
  const liq = num(d.liquidityUsd, 0, 1e12);
  const lock = str(d.liquidityLock, 24);
  const split = str(d.allocationSplit, 24);
  const source = typeof d.source === "string" ? d.source.slice(0, 24_000) : "";
  const hasMint = bool(d.hasMint), renounce = bool(d.ownerRenounce), taxChangeable = bool(d.taxChangeable);
  const hasBlacklist = bool(d.hasBlacklist), hasPause = bool(d.hasPause);

  // identity
  if (symbol && !/^[A-Z0-9]{1,10}$/.test(symbol)) add("ticker_format", "medium", "Ticker should be 1 to 10 characters, A to Z and 0 to 9. Other formats are rejected or look off on launchpads.", { "draft.symbol": symbol }, "Use 3 to 6 uppercase letters or digits.");
  if (IMPERSONATION.test(`${name} ${symbol}`)) add("impersonation_risk", "medium", "The name or ticker implies an official or affiliated token. That invites takedowns and distrust.", { "draft.name": name, "draft.symbol": symbol }, "Remove brand and 'official' wording unless you are that brand.");
  if (description && PROMISES.test(description)) add("promise_language", "medium", "The description promises returns or safety. Readers treat that as a warning sign.", { "draft.description": description.slice(0, 120) }, "Describe what the token is, not what it will do for the price.");
  if (!description) add("no_description", "low", "No description. Buyers have nothing to read before they decide.", { "draft.description": "" }, "Add two honest sentences: what it is and who runs it.");

  // ticker collision, supplied by the browser's market search
  const sym = norm(symbol);
  const clash = readSimilar(d.similar).filter((s) => norm(s.symbol) === sym && sym.length >= 2).sort((a, b) => b.vol24Usd - a.vol24Usd)[0];
  if (clash && (clash.liqUsd >= 5000 || clash.vol24Usd >= 10_000)) {
    add("ticker_collision", clash.vol24Usd >= 100_000 ? "high" : "medium", `An active token already uses the ticker ${clash.symbol} (about $${Math.round(clash.vol24Usd).toLocaleString("en-US")} 24h volume). Yours will read as a copy.`, { "similar.address": clash.address, "similar.vol24_usd": clash.vol24Usd, "similar.liq_usd": clash.liqUsd }, "Pick a ticker that is not already trading with real volume.");
  }

  // tax
  const maxTax = Math.max(buy ?? 0, sell ?? 0);
  if (maxTax > 10) add("high_tax", "high", `A ${maxTax}% tax reads as a honeypot to most scanners and traders.`, { "draft.buy_tax_pct": buy, "draft.sell_tax_pct": sell }, "Keep each side at 5% or less, or none.");
  else if (maxTax > 5) add("high_tax", "medium", `A ${maxTax}% tax is above what most traders accept.`, { "draft.buy_tax_pct": buy, "draft.sell_tax_pct": sell }, "Keep each side at 5% or less.");
  if (buy !== null && sell !== null && sell - buy >= 5) add("asymmetric_tax", "medium", `Sell tax (${sell}%) is far above buy tax (${buy}%). That discourages exits.`, { "draft.buy_tax_pct": buy, "draft.sell_tax_pct": sell }, "Make the two sides equal.");
  if (taxChangeable) add("tax_changeable", "high", "The owner can change the tax after launch, so it can be raised to trap holders.", { "draft.tax_changeable": true }, "Fix the tax at deploy, or hard-cap it in code and renounce the setter.");

  // privileges
  if (hasMint && !renounce) add("mint_with_live_owner", "high", "A mint function with a live owner means supply can be increased after launch.", { "draft.has_mint": true, "draft.owner_renounce": false }, "Remove the mint function, or mint once and renounce ownership.");
  if (hasBlacklist) add("blacklist_function", "medium", "A blacklist lets the owner block wallets from trading.", { "draft.has_blacklist": true }, "Remove it. If you must keep it, document who controls it and why.");
  if (hasPause) add("pause_function", "medium", "pause() lets the owner halt transfers.", { "draft.has_pause": true }, "Remove it, or put it behind a timelock.");

  // distribution and liquidity
  if (team !== null && team >= 10) {
    const oneWallet = split === "one_wallet";
    const level: Level = team >= 25 ? "high" : "medium";
    add("top1_concentration", oneWallet ? level : "medium", `${team}% of supply is allocated to the team${oneWallet ? " in a single wallet" : ""}. That is the first thing a holder check will show.`, { "draft.team_allocation_pct": team, "draft.allocation_split": split || "unspecified" }, "Lower the allocation, split it across wallets, or vest it in a public contract.");
  }
  if (lock === "none") add("liquidity_unlocked", "high", "Liquidity is not locked. The most common death pattern is liquidity pulled by whoever holds it.", { "draft.liquidity_lock": "none" }, "Lock the LP in a time-lock contract, burn it, or launch on a venue that locks it for you.");
  else if (lock === "short") add("liquidity_unlocked", "medium", "A short lock expires fast. Holders will watch the date.", { "draft.liquidity_lock": "short" }, "Lock for at least 6 months, and publish the lock address.");
  if (liq !== null && liq < 1000) add("thin_liquidity", "medium", `Only $${Math.round(liq).toLocaleString("en-US")} of liquidity. Small trades will move the price a lot.`, { "draft.liquidity_usd": liq }, "Add more liquidity before promoting the token.");

  // source scan
  if (source.trim()) {
    evidence["code.lines"] = source.split("\n").length;
    const rules: [string, RegExp, Level, string, string, string][] = [
      ["mint_with_live_owner", /function\s+(mint|_mint|issue)\b/i, "high", "Source defines a mint function.", "Remove the mint function, or mint once and renounce ownership.", "// mint removed: supply is fixed at deploy"],
      ["blacklist_function", /(blacklist|isBlacklisted|_blocked\[)/i, "medium", "Source contains blacklist logic.", "Remove the blacklist logic.", "// blacklist removed"],
      ["pause_function", /(function\s+pause\b|whenNotPaused|_pause\()/i, "medium", "Source contains pause logic.", "Remove pause, or put it behind a timelock.", "// pause removed"],
      ["tax_changeable", /function\s+(set|update)\w*(tax|fee)\w*\s*\(/i, "high", "Source lets someone change the tax or fee.", "Fix the fee at deploy, or hard-cap it and drop the setter.", "// fee setter removed: fee is a constant"],
      ["risky_opcode", /(selfdestruct|delegatecall|tx\.origin)/i, "high", "Source uses selfdestruct, delegatecall or tx.origin, which are common in malicious tokens.", "Remove it. Standard tokens do not need it.", "// removed risky opcode"],
    ];
    for (const [code, re, level, text, fix, repl] of rules) {
      const hits = scan(source, re);
      if (!hits.length) continue;
      if (flags.some((f) => f.code === code && f.level === level)) {
        // already flagged from the form: attach the line evidence to the same flag
        const f = flags.find((x) => x.code === code)!;
        for (const h of hits.slice(0, 3)) { evidence[`code.line:${h.line}`] = h.text; f.evidence_ids.push(`code.line:${h.line}`); }
        const fx = fixes.find((x) => x.flag_code === code);
        if (fx && !fx.diff) fx.diff = hits.slice(0, 3).map((h) => `- ${h.text}`).join("\n") + `\n+ ${repl}`;
        continue;
      }
      const ev: Record<string, unknown> = {};
      for (const h of hits.slice(0, 3)) ev[`code.line:${h.line}`] = h.text;
      add(code, level, text, ev, fix, hits.slice(0, 3).map((h) => `- ${h.text}`).join("\n") + `\n+ ${repl}`);
    }
    const owners = scan(source, /onlyOwner/).length;
    if (owners >= 3 && !/renounceOwnership/.test(source)) add("owner_privileges", "medium", `${owners} functions are owner-only and there is no renounceOwnership.`, { "code.only_owner_count": owners }, "Reduce owner-only functions and add renounceOwnership.");
  }

  // exposure: which death patterns this draft invites (patterns, not predictions)
  const has = (...c: string[]) => flags.some((f) => c.includes(f.code));
  const exposure: { pattern: string; why: string }[] = [];
  if (has("liquidity_unlocked")) exposure.push({ pattern: "lp_removed", why: "Unlocked liquidity is the setup for the most common death pattern: liquidity pulled." });
  if (has("top1_concentration")) exposure.push({ pattern: "dev_exit", why: "A large allocation in few wallets makes a quiet exit possible." });
  if (has("mint_with_live_owner", "tax_changeable", "blacklist_function", "pause_function", "risky_opcode", "high_tax", "asymmetric_tax")) exposure.push({ pattern: "hidden_privilege", why: "Owner powers over supply, tax or transfers are what scanners flag first." });
  if (has("ticker_collision", "impersonation_risk")) exposure.push({ pattern: "clone", why: "A name that matches or imitates another token is read as a copy." });
  if (has("thin_liquidity", "no_description", "promise_language")) exposure.push({ pattern: "never_lived", why: "Thin liquidity and weak positioning make it hard to get a first buyer." });

  const worst = Math.max(0, ...flags.map((f) => RANK[f.level]));
  const mediums = flags.filter((f) => f.level === "medium").length;
  const risk = worst === 2 || mediums >= 3 ? "high" : worst === 1 ? "medium" : "low";
  const inputs = [buy, sell, team, liq].filter((v) => v !== null).length + (lock ? 1 : 0) + (source ? 1 : 0) + (description ? 1 : 0);

  return {
    mode: "draft" as const,
    risk_class: risk,
    cause_pattern: exposure[0]?.pattern ?? "none",
    clone_of: clash?.address ?? null,
    flags: flags.map(({ code, text, evidence_ids }) => ({ code, text, evidence_ids })),
    levels: Object.fromEntries(flags.map((f) => [f.code, f.level])),
    fixes,
    exposure,
    evidence,
    confidence: Math.round((0.35 + 0.07 * Math.min(inputs, 8)) * 100) / 100,
    disclaimer: DISCLAIMER,
  };
}
