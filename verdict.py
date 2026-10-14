"""Reference (rule-based) verdict builder. v0.

Turns a facts dict (coroner_facts.build_facts) into a verdict that follows schema/verdict.schema.json.
It is the BASELINE the model must beat and a source of training targets. Every flag cites fact keys.
"""
import json, sys, pathlib

DISCLAIMER = "Risk classification from public on-chain data. Not financial advice."
RANK = {"low": 0, "medium": 1, "high": 2}

FIXES = {
    "mint_with_live_owner": ("Remove the mint function, or renounce ownership after the initial mint.",
                             "- function mint(address to, uint256 amount) external onlyOwner {...}"),
    "blacklist_function": ("Remove the blacklist function; if one is required, document who controls it.", None),
    "pause_function": ("Remove pause() or put it behind a timelock so holders can exit.", None),
    "top1_concentration": ("Split the top wallet's allocation or vest it; state the wallet publicly.", None),
    "top10_concentration": ("Widen distribution before launch (airdrop, vesting, larger public float).", None),
    "thin_liquidity": ("Add more liquidity and lock it (lock contract or burned LP) before promoting the token.", None),
    "no_pool": ("Create and fund a pool before announcing the token.", None),
    "very_new_pool": ("Wait for the pool to age before judging; early numbers are noisy.", None),
}


def flag(code, level, text, ev):
    return {"code": code, "level": level, "text": text, "evidence_ids": ev}


def flags_from_facts(f, clone_of=None):
    out = []
    if f.get("contract.selector_mint") and f.get("contract.owner_renounced") is False:
        out.append(flag("mint_with_live_owner", "high",
                        "Contract has a mint function and the owner has not renounced; supply may be increased.",
                        ["contract.selector_mint", "contract.owner_renounced", "contract.owner"]))
    if f.get("contract.selector_blacklist"):
        out.append(flag("blacklist_function", "medium",
                        "Contract bytecode contains a blacklist function; selected wallets may be blocked from trading.",
                        ["contract.selector_blacklist"]))
    if f.get("contract.selector_pause"):
        out.append(flag("pause_function", "medium", "Contract bytecode contains pause(); transfers may be halted.",
                        ["contract.selector_pause"]))
    t1, t10 = f.get("holders.top1_pct"), f.get("holders.top10_pct")
    if t1 is not None and not f.get("holders.top1_is_contract"):
        if t1 >= 25:
            out.append(flag("top1_concentration", "high", f"One wallet holds {t1}% of supply.", ["holders.top1_pct", "holders.top1_address"]))
        elif t1 >= 10:
            out.append(flag("top1_concentration", "medium", f"One wallet holds {t1}% of supply.", ["holders.top1_pct", "holders.top1_address"]))
    if t10 is not None and t10 >= 50:
        out.append(flag("top10_concentration", "medium", f"Top 10 wallets hold {t10}% of supply.", ["holders.top10_pct"]))
    if f.get("market.pool_count") == 0:
        out.append(flag("no_pool", "medium", "No trading pool found for this token.", ["market.pool_count"]))
    else:
        liq = f.get("market.liq_usd")
        if liq and 0 < liq < 1000:  # liq == 0 is unreliable on some v4 pools, so it is not flagged
            out.append(flag("thin_liquidity", "medium", f"Reported liquidity is only ${liq:,.0f}.", ["market.liq_usd"]))
        age = f.get("market.top_pool_age_hours")
        if age is not None and age < 6:
            out.append(flag("very_new_pool", "low", f"Main pool is {age} hours old.", ["market.top_pool_age_hours"]))
    if clone_of:
        out.append(flag("possible_clone", "medium", f"Symbol matches an older, more active token ({clone_of}).", ["clone_of"]))
    return out


def build_verdict(facts, mode="live", label=None):
    clone_of = (label or {}).get("clone_of")
    fl = flags_from_facts(facts, clone_of)
    dead = bool(label and label.get("status") == "dead")
    if dead:
        risk = "dead"
    else:
        worst = max([RANK[x["level"]] for x in fl], default=0)
        risk = "high" if worst == 2 or sum(x["level"] == "medium" for x in fl) >= 3 else ("medium" if worst == 1 else "low")
    cause = (label or {}).get("cause_pattern") or ("clone" if clone_of else ("hidden_privilege" if any(x["code"] in ("mint_with_live_owner", "blacklist_function") for x in fl) else "none"))
    used = sorted({k for x in fl for k in x["evidence_ids"]})
    evidence = {k: (facts.get(k) if k != "clone_of" else clone_of) for k in used}
    known = sum(facts.get(k) is not None for k in ("holders.count", "market.liq_usd", "contract.owner_renounced", "token.supply"))
    v = {
        "mode": mode, "risk_class": risk, "cause_pattern": cause, "clone_of": clone_of,
        "flags": [{k: x[k] for k in ("code", "text", "evidence_ids")} for x in fl],
        "evidence": evidence, "confidence": round(0.45 + 0.1 * known, 2), "disclaimer": DISCLAIMER,
    }
    if mode == "draft":
        v["fixes"] = [{"flag_code": x["code"], "suggestion": FIXES[x["code"]][0], "diff": FIXES[x["code"]][1]}
                      for x in fl if x["code"] in FIXES]
    return v


def validate(v):
    """Minimal check against schema/verdict.schema.json (no external deps). Returns a list of problems."""
    sch = json.loads((pathlib.Path(__file__).parent / "schema" / "verdict.schema.json").read_text(encoding="utf8"))
    p, props = [], sch["properties"]
    for k in sch["required"]:
        if k not in v:
            p.append(f"missing {k}")
    for k in ("mode", "risk_class", "cause_pattern"):
        if k in v and v[k] not in props[k]["enum"]:
            p.append(f"bad {k}: {v[k]}")
    if not 0 <= v.get("confidence", -1) <= 1:
        p.append("confidence out of range")
    if v.get("disclaimer") != DISCLAIMER:
        p.append("bad disclaimer")
    for x in v.get("flags", []):
        for k in ("code", "text", "evidence_ids"):
            if k not in x:
                p.append(f"flag missing {k}")
        for e in x.get("evidence_ids", []):
            if e not in v.get("evidence", {}):
                p.append(f"evidence id not echoed: {e}")
    return p


if __name__ == "__main__":
    facts = json.load(open(sys.argv[1], encoding="utf8"))
    v = build_verdict(facts, sys.argv[2] if len(sys.argv) > 2 else "live")
    print(json.dumps(v, indent=2))
    print("validation:", validate(v) or "OK", file=sys.stderr)
