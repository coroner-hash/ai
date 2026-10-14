"""coroner-facts v0: deterministic fact builder for a Robinhood Chain token.

Every value returned is read from public data (JSON-RPC + GeckoTerminal). The model
never computes numbers; it only reads this dict and cites keys as evidence ids.

Usage: python coroner_facts.py <token_address>
Env:   RPC_URL (default https://rpc.ordofi.network; the official RPC is DNS-blocked on some ISPs)
"""
import json, os, sys, time, datetime, urllib.request

RPC_URL = os.environ.get("RPC_URL", "https://rpc.ordofi.network")
GT = "https://api.geckoterminal.com/api/v2/networks/robinhood"
ZERO = "0x" + "0" * 40
DEAD = "0x000000000000000000000000000000000000dead"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# 4-byte selectors. Heuristic: presence in bytecode means the function may exist, not that it is abusable.
SELECTORS = {
    "mint": ["40c10f19", "a0712d68"],          # mint(address,uint256), mint(uint256)
    "owner": ["8da5cb5b"],                     # owner()
    "renounce": ["715018a6"],                  # renounceOwnership()
    "transfer_ownership": ["f2fde38b"],
    "pause": ["8456cb59"],                     # pause()
    "blacklist": ["f9f92be4", "fe575a87", "0ecb93c0"],  # blacklist(address), isBlacklisted(address), addBlackList(address)
}


def _http(url, data=None, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, data=data,
                headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "coroner-facts/0.1"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except Exception as e:
            err = e
            time.sleep(3 * (i + 1))
    return {"_error": str(err)}


def rpc(method, params, tries=6):
    """JSON-RPC with backoff: the public RPC answers -32005 'network is busy' under load."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for i in range(tries):
        r = _http(RPC_URL, body, tries=1)
        if "result" in r:
            return r["result"]
        code = (r.get("error") or {}).get("code")
        if code in (-32005, -32000, 429) or "_error" in r:
            time.sleep(1.5 * (i + 1))
            continue
        return None  # real revert / unsupported
    return None


def call(to, data):
    return rpc("eth_call", [{"to": to, "data": data}, "latest"])


def dec_str(hexs):
    try:
        raw = bytes.fromhex(hexs[2:])
        if len(raw) >= 64:
            n = int.from_bytes(raw[32:64], "big")
            return raw[64:64 + n].decode("utf8", "replace")
        return raw.rstrip(b"\x00").decode("utf8", "replace")
    except Exception:
        return None


def gt(path):
    time.sleep(2.2)
    return _http(f"{GT}/{path}")


def implementation_of(addr, code):
    """EIP-1167 minimal proxy or EIP-1967 implementation slot; None if not a proxy."""
    h = code[2:].lower()
    if h.startswith("363d3d373d3d3d363d73") and len(h) >= 62:
        return "0x" + h[20:60]
    if len(h) < 400:  # short code: check the 1967 slot
        slot = rpc("eth_getStorageAt", [addr, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"])
        if slot and int(slot, 16) != 0:
            return "0x" + slot[-40:]
    return None


def holders_from_logs(token, supply, lookback_blocks=600_000, chunk=150_000):
    """Rebuild balances from Transfer logs (bounded lookback). Returns None if the RPC refuses."""
    head = int(rpc("eth_blockNumber", []) or "0x0", 16)
    if not head:
        return None
    bal = {}
    start = max(0, head - lookback_blocks)
    for lo in range(start, head + 1, chunk):
        hi = min(head, lo + chunk - 1)
        logs = rpc("eth_getLogs", [{"address": token, "topics": [TRANSFER], "fromBlock": hex(lo), "toBlock": hex(hi)}])
        if logs is None:
            return None
        for lg in logs:
            if len(lg["topics"]) < 3:
                continue
            frm = "0x" + lg["topics"][1][-40:]
            to = "0x" + lg["topics"][2][-40:]
            v = int(lg["data"], 16)
            bal[frm] = bal.get(frm, 0) - v
            bal[to] = bal.get(to, 0) + v
    bal = {a: b for a, b in bal.items() if b > 0 and a not in (ZERO, DEAD)}
    return bal, head


def build_facts(token):
    token = token.lower()
    f = {"_meta": {"token": token, "built_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                   "chain": "robinhood-4663", "sources": ["json-rpc", "geckoterminal"]}}

    # --- contract
    code = rpc("eth_getCode", [token, "latest"]) or "0x"
    f["contract.is_contract"] = len(code) > 2
    f["contract.code_bytes"] = (len(code) - 2) // 2
    hexcode = code[2:].lower()
    impl = implementation_of(token, code)
    f["contract.proxy_implementation"] = impl
    if impl:
        hexcode += (rpc("eth_getCode", [impl, "latest"]) or "0x")[2:].lower()
    for name, sels in SELECTORS.items():
        f[f"contract.selector_{name}"] = any(s in hexcode for s in sels)
    owner = call(token, "0x8da5cb5b") if f["contract.selector_owner"] else None
    if owner and len(owner) >= 66:
        o = "0x" + owner[-40:]
        f["contract.owner"] = o
        f["contract.owner_renounced"] = o in (ZERO, DEAD)
    else:
        f["contract.owner"] = None
        f["contract.owner_renounced"] = None

    # --- erc20
    f["token.name"] = dec_str(call(token, "0x06fdde03") or "0x")
    f["token.symbol"] = dec_str(call(token, "0x95d89b41") or "0x")
    dec = call(token, "0x313ce567")
    supply = call(token, "0x18160ddd")
    f["token.decimals"] = int(dec, 16) if dec and dec != "0x" else None
    f["token.supply_raw"] = str(int(supply, 16)) if supply and supply != "0x" else None
    d = f["token.decimals"]
    f["token.supply"] = (int(f["token.supply_raw"]) / 10 ** d) if d is not None and f["token.supply_raw"] else None

    # --- market (GeckoTerminal)
    pools = gt(f"tokens/{token}/pools").get("data", [])
    f["market.pool_count"] = len(pools)
    if pools:
        top = max(pools, key=lambda p: float(p["attributes"].get("reserve_in_usd") or 0))["attributes"]
        created = datetime.datetime.fromisoformat(top["pool_created_at"].replace("Z", "+00:00"))
        age_h = (datetime.datetime.now(datetime.timezone.utc) - created).total_seconds() / 3600
        f["market.top_pool_name"] = top["name"]
        f["market.top_pool_created"] = top["pool_created_at"]
        f["market.top_pool_age_hours"] = round(age_h, 1)
        f["market.liq_usd"] = float(top.get("reserve_in_usd") or 0)
        f["market.vol_h24_usd"] = float(top["volume_usd"]["h24"])
        f["market.fdv_usd"] = float(top["fdv_usd"]) if top.get("fdv_usd") else None
        tx = top.get("transactions", {}).get("h24", {})
        f["market.buys_h24"], f["market.sells_h24"] = tx.get("buys"), tx.get("sells")
        f["market.price_change_h24_pct"] = float(top["price_change_percentage"]["h24"]) if top.get("price_change_percentage", {}).get("h24") else None

    # --- holders (rebuilt from Transfer logs; bounded lookback)
    if f["token.supply_raw"]:
        res = holders_from_logs(token, int(f["token.supply_raw"]))
        if res:
            bal, head = res
            tot = int(f["token.supply_raw"])
            ranked = sorted(bal.values(), reverse=True)
            f["holders.count"] = len(bal)
            f["holders.top1_pct"] = round(100 * ranked[0] / tot, 2) if ranked else None
            f["holders.top10_pct"] = round(100 * sum(ranked[:10]) / tot, 2) if ranked else None
            f["holders.lookback_blocks"] = 600_000
            top_addr = max(bal, key=bal.get) if bal else None
            f["holders.top1_address"] = top_addr
            if top_addr:  # a contract top holder is usually the pool/PoolManager, not a person
                f["holders.top1_is_contract"] = len((rpc("eth_getCode", [top_addr, "latest"]) or "0x")) > 2
        else:
            f["holders.count"] = None
    return f


if __name__ == "__main__":
    print(json.dumps(build_facts(sys.argv[1]), indent=2))
