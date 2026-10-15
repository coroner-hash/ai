"""Collect contract facts (RPC only) for tracked tokens -> data/facts.jsonl.

Market numbers come from the collector state (first sighting / 24h outcome). Holders are not collected here:
Blockscout blocks server egress and eth_getLogs needs a paid plan, so holder facts stay absent in this dataset.

Usage: RPC_URL=http://127.0.0.1:8546 python collect_facts.py [max_tokens=600]
"""
import json, pathlib, sys, concurrent.futures as cf

import coroner_facts as cfx
import labels

DATA = pathlib.Path(__file__).resolve().parent / "data"
STATE = json.loads((DATA / "state.json").read_text(encoding="utf8"))
OUT = DATA / "facts.jsonl"
MAX = int(sys.argv[1]) if len(sys.argv) > 1 else 600


def contract_only(token):
    f = {"token.address": token}
    code = cfx.rpc("eth_getCode", [token, "latest"]) or "0x"
    f["contract.is_contract"] = len(code) > 2
    f["contract.code_bytes"] = (len(code) - 2) // 2
    if len(code) <= 2:
        return f
    hexcode = code[2:].lower()
    impl = cfx.implementation_of(token, code)
    f["contract.proxy_implementation"] = impl
    if impl:
        hexcode += (cfx.rpc("eth_getCode", [impl, "latest"]) or "0x")[2:].lower()
    for name, sels in cfx.SELECTORS.items():
        f[f"contract.selector_{name}"] = any(s in hexcode for s in sels)
    f["token.name"] = cfx.dec_str(cfx.call(token, "0x06fdde03") or "0x")
    f["token.symbol"] = cfx.dec_str(cfx.call(token, "0x95d89b41") or "0x")
    dec, sup = cfx.call(token, "0x313ce567"), cfx.call(token, "0x18160ddd")
    f["token.decimals"] = int(dec, 16) if dec and dec != "0x" else None
    if sup and sup != "0x" and f["token.decimals"] is not None:
        f["token.supply"] = int(sup, 16) / 10 ** f["token.decimals"]
    if f["contract.selector_owner"]:
        o = cfx.call(token, "0x8da5cb5b")
        if o and len(o) >= 66:
            o = "0x" + o[-40:]
            f["contract.owner"], f["contract.owner_renounced"] = o, o in (cfx.ZERO, cfx.DEAD)
    return f


def market_from(rec, which):
    m = rec.get(which)
    if not m:
        return {}
    return {
        "market.pool_count": 1, "market.top_pool_name": rec["name"], "market.top_pool_created": rec["created"],
        "market.liq_usd": m.get("liq_usd"), "market.vol_h24_usd": m.get("vol_h24"), "market.fdv_usd": m.get("fdv_usd"),
        "market.buys_h24": m.get("buys_h24"), "market.sells_h24": m.get("sells_h24"), "market.source": "geckoterminal",
    }


def main():
    done = set()
    if OUT.exists():
        done = {json.loads(l)["token"] for l in OUT.read_text(encoding="utf8").splitlines() if l.strip()}
    # resolved tokens first (they carry a label), then the newest others
    items = sorted(STATE.items(), key=lambda kv: (kv[1].get("outcome") is None, kv[1]["created"]), reverse=False)
    resolved = [kv for kv in items if kv[1].get("outcome")]
    rest = sorted([kv for kv in items if not kv[1].get("outcome")], key=lambda kv: kv[1]["created"], reverse=True)
    todo = [kv for kv in resolved + rest if kv[1]["token"] not in done][: max(0, MAX - len(done))]
    print(f"{len(done)} done, collecting {len(todo)} (resolved available: {len(resolved)})")

    def work(kv):
        pool, rec = kv
        try:
            facts = contract_only(rec["token"])
        except Exception as e:  # keep going; one bad token must not stop the run
            return None
        lab = labels.label(rec, STATE)
        return {"token": rec["token"], "pool": pool, "symbol": rec["symbol"], "created": rec["created"], "dex": rec.get("dex"),
                "facts": facts, "market_first": market_from(rec, "first"), "market_now": market_from(rec, "outcome"), "label": lab}

    n = 0
    with open(OUT, "a", encoding="utf8") as fh, cf.ThreadPoolExecutor(max_workers=6) as ex:
        for row in ex.map(work, todo):
            if row:
                fh.write(json.dumps(row) + "\n")
                n += 1
                if n % 50 == 0:
                    fh.flush()
                    print(n, "collected")
    print("done:", n, "new rows ->", OUT)


if __name__ == "__main__":
    main()
