// Narrator: turns a rule-engine verdict into a short plain-language report.
// Deterministic text built only from the verdict's own flags and evidence: it never adds a fact.
// Pure functions, no imports, so the browser, the Worker and the MCP server can share the logic.

type FlagLike = { code: string; text: string; evidence_ids?: string[] };
type VerdictLike = {
  mode?: string;
  risk_class?: string;
  status?: string;
  cause_pattern?: string;
  flags?: FlagLike[];
  fixes?: { flag_code: string; suggestion: string }[];
  confidence?: number;
};

const HEADLINE: Record<string, string> = {
  low: "No serious red flags in the checks that could run.",
  medium: "Some things deserve a closer look before you commit money.",
  high: "Several risk signals showed up. Treat this as high risk.",
  dead: "This token looks dead: the numbers show almost no activity.",
  unknown: "There is not enough data to say how this one ended.",
};

const WHAT_TO_CHECK: Record<string, string> = {
  mint_with_live_owner: "Look for who the owner is and whether they can still create new tokens.",
  blacklist_function: "Find out who can block wallets, and whether that power is published.",
  pause_function: "Check whether transfers can be frozen, and by whom.",
  top1_concentration: "Open the top holder's address and see whether it is a team, exchange or lock wallet.",
  top10_concentration: "Compare the top holders; a few wallets can move the price alone.",
  thin_liquidity: "Small pools move a lot on small trades. Try a tiny trade first, if at all.",
  no_pool: "Without a pool there is nowhere to trade. Wait until one exists and is funded.",
  very_new_pool: "Brand-new pools have little history. Give it time before judging.",
  lp_removed: "Check the pool's liquidity history to see who removed it.",
  bled_out: "Trading faded while the pool stayed. Look at what changed after day one.",
  never_lived: "It never got going. There is little to learn from the market data.",
  clone: "Compare it with the older token that shares the symbol before you trust the name.",
};

const MODE_NOUN: Record<string, string> = { live: "token", draft: "launch draft", autopsy: "token" };

export function narrate(v: VerdictLike): string {
  const mode = v.mode ?? "live";
  const noun = MODE_NOUN[mode] ?? "token";
  const key = mode === "autopsy" && v.status === "unknown" ? "unknown" : (v.risk_class ?? "low");
  const flags = v.flags ?? [];
  const lines: string[] = [];

  lines.push(`${mode === "draft" ? "Pre-mortem" : mode === "autopsy" ? "Autopsy" : "Verdict"} for this ${noun}: ${(v.risk_class ?? "low").toUpperCase()}. ${HEADLINE[key] ?? HEADLINE.low}`);

  if (flags.length) {
    lines.push("What the numbers show:");
    for (const f of flags.slice(0, 6)) lines.push(`- ${f.text}`);
    const checks = [...new Set(flags.map((f) => WHAT_TO_CHECK[f.code]).filter(Boolean))].slice(0, 3);
    if (checks.length) {
      lines.push("What to check next:");
      for (const c of checks) lines.push(`- ${c}`);
    }
  } else {
    lines.push("None of the checks that could run raised a flag. That is not a guarantee: checks that need data we did not have were skipped.");
  }

  if (mode === "draft" && v.fixes?.length) {
    lines.push("What to change before you launch:");
    for (const x of v.fixes.slice(0, 4)) lines.push(`- ${x.suggestion}`);
  }

  if (typeof v.confidence === "number") lines.push(`Confidence in this reading: ${Math.round(v.confidence * 100)}%. It reflects how much data was available, not how likely the outcome is.`);
  lines.push("This is a rule-based reading, written in plain words. It adds no new facts. Risk classification, not financial advice.");
  return lines.join("\n");
}
