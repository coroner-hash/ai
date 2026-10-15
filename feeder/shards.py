"""Write small per-prefix shards so a browser can fetch one token's record without downloading everything.

data/shards/<xx>.json  where xx = first two hex chars of the token address (after 0x).
Content: { "<token>": [ {pool, symbol, name, created, dex, first, outcome}, ... ] }
Only shards whose content changed are rewritten, to keep commits small.
"""
import json, pathlib, collections

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
KEEP = ("liq_usd", "fdv_usd", "vol_h24", "buys_h24", "sells_h24", "at")


def slim(snap):
    return {k: snap.get(k) for k in KEEP} if snap else None


def write_shards(state):
    shards = collections.defaultdict(lambda: collections.defaultdict(list))
    for pool, rec in state.items():
        tok = rec["token"].lower()
        if not tok.startswith("0x") or len(tok) != 42 or not rec.get("outcome"):
            continue  # only pools with a 24h outcome can have an autopsy
        shards[tok[2:4]][tok].append({
            "pool": pool, "symbol": rec["symbol"], "name": rec["name"], "created": rec["created"], "dex": rec.get("dex"),
            "first": slim(rec["first"]), "outcome": slim(rec.get("outcome")),
        })
    out = DATA / "shards"
    out.mkdir(parents=True, exist_ok=True)
    changed = 0
    for prefix, tokens in shards.items():
        text = json.dumps(tokens, separators=(",", ":"), sort_keys=True)
        path = out / f"{prefix}.json"
        if not path.exists() or path.read_text(encoding="utf8") != text:
            path.write_text(text, encoding="utf8")
            changed += 1
    return changed
