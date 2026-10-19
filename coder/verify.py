"""Verifier for Coroner Coder: a patch only counts as a fix if it compiles, still looks like the same ERC-20, and the
flagged patterns are gone. Same source rules as the site's pre-mortem (coroner-app/worker/premortem.ts), ported to Python.

  python coder/verify.py contract.sol           # scan a file and print the flags
"""
import re, sys, json, functools

RULES = [
    ("mint_with_live_owner", re.compile(r"function\s+(mint|_mint|issue)\b", re.I)),
    ("blacklist_function", re.compile(r"(blacklist|isBlacklisted|_blocked\[)", re.I)),
    ("pause_function", re.compile(r"(function\s+pause\b|whenNotPaused|_pause\()", re.I)),
    ("tax_changeable", re.compile(r"function\s+(set|update)\w*(tax|fee)\w*\s*\(", re.I)),
    ("risky_opcode", re.compile(r"(selfdestruct|delegatecall|tx\.origin)", re.I)),
]
ONLY_OWNER = re.compile(r"onlyOwner")
RENOUNCE = re.compile(r"renounceOwnership")

FIX_TEXT = {
    "mint_with_live_owner": "Removed the mint function; the supply is fixed at deploy.",
    "blacklist_function": "Removed the blacklist logic so no wallet can be blocked.",
    "pause_function": "Removed pause so transfers cannot be halted.",
    "tax_changeable": "Made the fee a constant and removed the fee setter.",
    "risky_opcode": "Removed the risky opcode; a standard token does not need it.",
    "owner_privileges": "Added renounceOwnership so the remaining owner powers can be given up.",
}

# What a patched ERC-20 must still expose.
REQUIRED_ABI = {
    ("function", "name"), ("function", "symbol"), ("function", "decimals"), ("function", "totalSupply"), ("function", "balanceOf"),
    ("function", "transfer"), ("function", "allowance"), ("function", "approve"), ("function", "transferFrom"),
    ("event", "Transfer"), ("event", "Approval"),
}


def scan(source: str):
    """Returns [(code, [(line_no, text), ...]), ...] like the site's scanner."""
    out = []
    lines = source.split("\n")
    for code, rx in RULES:
        hits = [(i + 1, t.strip()[:140]) for i, t in enumerate(lines) if rx.search(t)]
        if hits:
            out.append((code, hits[:3]))
    owners = sum(1 for t in lines if ONLY_OWNER.search(t))
    if owners >= 3 and not RENOUNCE.search(source):
        out.append(("owner_privileges", [(0, f"{owners} owner-only functions, no renounceOwnership")]))
    return out


def flag_codes(source: str):
    return [c for c, _ in scan(source)]


@functools.lru_cache(maxsize=1)
def _solc():
    import solcx
    if not any(str(v) == "0.8.24" for v in solcx.get_installed_solc_versions()):
        solcx.install_solc("0.8.24")
    return solcx


def compile_abi(source: str):
    """Returns (ok, abi_or_error). Uses solc 0.8.24; sources must be self-contained (no imports)."""
    solcx = _solc()
    try:
        out = solcx.compile_source(source, solc_version="0.8.24", output_values=["abi"])
    except Exception as e:  # noqa: BLE001 - solcx raises several types
        return False, str(e)[:300]
    if not out:
        return False, "no contract"
    # the largest ABI is the token
    abi = max(out.values(), key=lambda c: len(c["abi"]))["abi"]
    return True, abi


def abi_keys(abi):
    return {(x["type"], x.get("name")) for x in abi if x["type"] in ("function", "event")}


def judge(original: str, patched: str, flags_before=None):
    """Score one patch. Returns a dict of booleans plus details."""
    before = flags_before if flags_before is not None else flag_codes(original)
    res = {"compiles": False, "abi_kept": False, "flags_cleared": False, "no_new_flags": False, "ok": False, "remaining": []}
    ok, abi = compile_abi(patched)
    if not ok:
        res["error"] = abi
        return res
    res["compiles"] = True
    ook, oabi = compile_abi(original)
    need = REQUIRED_ABI if not ook else (REQUIRED_ABI & abi_keys(oabi))
    res["abi_kept"] = need <= abi_keys(abi)
    after = flag_codes(patched)
    res["remaining"] = [c for c in after if c in before]
    res["flags_cleared"] = not res["remaining"]
    res["no_new_flags"] = not [c for c in after if c not in before]
    res["ok"] = res["compiles"] and res["abi_kept"] and res["flags_cleared"] and res["no_new_flags"]
    return res


if __name__ == "__main__":
    src = open(sys.argv[1], encoding="utf8").read()
    print(json.dumps(scan(src), indent=2))
