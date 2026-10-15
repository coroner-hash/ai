// Autopsy rules: label a tracked pool that has been watched for 24 hours (port of coroner/labels.py).
// Pure functions, no imports: the Worker and the dataset generator run this same code.
// Describes patterns consistent with the numbers. Never an accusation.
import { buildVerdict, type Facts } from "./rules";

export type PoolSnap = { liq_usd: number | null; fdv_usd: number | null; vol_h24: number | null; buys_h24?: number | null; sells_h24?: number | null };
export type PoolRec = { symbol: string; created: string; first: PoolSnap; outcome: PoolSnap | null };

export const DEAD_VOL_USD = 50; // 24h volume below this ...
export const DEAD_TX = 2; // ... and at most this many swaps in 24h => dead
export const LP_GONE_RATIO = 0.1; // liquidity now < 10% of first sighting => withdrawn
export const MIN_REAL_LIQ = 500; // ignore pools that never had meaningful liquidity
export const NEVER_LIVED_VOL = 500; // first-sighting 24h volume under this => never took off

export type Cause = "lp_removed" | "bled_out" | "never_lived" | "clone";
export type AutopsyLabel = { status: "alive" | "dead" | "unknown"; cause: Cause | "none" | null; swaps24: number };

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function autopsyLabel(rec: PoolRec, cloneOf: string | null = null): AutopsyLabel {
  const o = rec.outcome;
  if (!o) return { status: "unknown", cause: null, swaps24: 0 };
  const swaps24 = n(o.buys_h24) + n(o.sells_h24);
  const dead = n(o.vol_h24) < DEAD_VOL_USD && swaps24 <= DEAD_TX;
  if (!dead) return { status: "alive", cause: "none", swaps24 };
  const f = rec.first;
  let cause: Cause;
  if (n(f.liq_usd) >= MIN_REAL_LIQ && n(o.liq_usd) < LP_GONE_RATIO * n(f.liq_usd)) cause = "lp_removed";
  else if (n(f.vol_h24) < NEVER_LIVED_VOL) cause = cloneOf ? "clone" : "never_lived";
  else cause = "bled_out";
  return { status: "dead", cause, swaps24 };
}

const usd = (v: number | null | undefined) => "$" + Math.round(n(v)).toLocaleString("en-US");

export function buildAutopsy(facts: Facts, rec: PoolRec, cloneOf: string | null = null) {
  const label = autopsyLabel(rec, cloneOf);
  const base = buildVerdict(facts, "live");
  const f = rec.first, o = rec.outcome;
  const evidence: Record<string, unknown> = { ...base.evidence, "pool.created": rec.created, "first.liq_usd": f.liq_usd, "first.vol_h24": f.vol_h24 };
  const flags = [...base.flags];
  if (o) {
    Object.assign(evidence, { "now.liq_usd": o.liq_usd, "now.vol_h24": o.vol_h24, "now.swaps_h24": label.swaps24 });
  }
  let cause_pattern: string = "none";
  if (label.status === "dead" && label.cause) {
    cause_pattern = label.cause;
    const texts: Record<Cause, [string, string[]]> = {
      lp_removed: [`Liquidity went from ${usd(f.liq_usd)} to ${usd(o?.liq_usd)} within 24 hours, a pattern consistent with liquidity being withdrawn.`, ["first.liq_usd", "now.liq_usd"]],
      bled_out: [`Trading was real at first (${usd(f.vol_h24)} of 24h volume) and faded to ${usd(o?.vol_h24)} with ${label.swaps24} swaps, while the pool stayed in place.`, ["first.vol_h24", "now.vol_h24", "now.swaps_h24"]],
      never_lived: [`No meaningful activity: ${usd(f.vol_h24)} of 24h volume when first seen and ${usd(o?.vol_h24)} a day later.`, ["first.vol_h24", "now.vol_h24"]],
      clone: [`Never took off, and the symbol matches an older, busier token.`, ["first.vol_h24", "now.vol_h24", "similar.address"]],
    };
    const [text, ev] = texts[label.cause as Cause];
    flags.unshift({ code: label.cause as string, text, evidence_ids: ev });
    if (cloneOf) evidence["similar.address"] = cloneOf;
  }
  return {
    mode: "autopsy" as const,
    status: label.status,
    risk_class: label.status === "dead" ? "dead" : base.risk_class,
    cause_pattern,
    clone_of: cloneOf,
    flags,
    evidence,
    confidence: label.status === "unknown" ? 0.3 : label.status === "dead" ? 0.7 : 0.6,
    disclaimer: base.disclaimer,
  };
}
