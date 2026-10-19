"""Build the Coroner Coder dataset: flawed token contracts and compile-verified fixes.

Every example is self-checking: the corrected contract must compile with solc 0.8.24, keep the ERC-20 interface and clear
the flagged patterns (see verify.py). Examples that fail their own check are dropped, so the targets are correct by construction.

Three source styles. A and B are used for training and in-distribution evaluation. C is never trained on: it measures
whether the model fixes contracts written in a layout it has not seen.

  python coder/gen_data.py            # writes data/coder/{train,eval_in,eval_out}.jsonl
"""
import json, random, sys, pathlib, collections

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import verify  # noqa: E402

SYSTEM = (
    "You are Coroner Coder. You are given a Solidity token contract and the risk flags a scanner raised on it. "
    "Return the full corrected contract in one ```solidity block, then a short 'Changes:' list. "
    "Keep it a working ERC-20 with the same public interface. Remove only what the flags point at; do not add features. "
    "If there are no flags, return the contract unchanged and say so."
)

NAMES = ["Tacocat", "Moonpaw", "Quokka", "Nimbus", "Brickwall", "Pixel Fox", "Lumen", "Otter Cash", "Gridlock", "Saffron", "Drift", "Harbor", "Velvet", "Kelp", "Ember", "Orbit Cat", "Basalt", "Mango", "Zephyr", "Tundra"]
SYMS = ["TACO", "MPAW", "QKA", "NMB", "BRK", "PXF", "LUM", "OTR", "GRID", "SAF", "DRFT", "HRB", "VLV", "KELP", "EMB", "ORB", "BSLT", "MNGO", "ZEPH", "TNDR"]
FEATURES = ["mint", "blacklist", "pause", "tax", "kill", "deleg", "txo", "priv"]


def pick_params(rng, style):
    i = rng.randrange(len(NAMES))
    return {
        "style": style,
        "name": NAMES[i] if rng.random() < 0.8 else NAMES[i] + " " + rng.choice(["Coin", "Token", "Inu", "AI"]),
        "symbol": SYMS[i],
        "contract": NAMES[i].replace(" ", "") + rng.choice(["", "Token", "Coin"]),
        "decimals": rng.choice([18, 18, 18, 9, 6]),
        "supply": rng.choice([1_000_000, 21_000_000, 100_000_000, 1_000_000_000, 69_000_000]),
        "pragma": rng.choice(["^0.8.19", "^0.8.20", "^0.8.24", ">=0.8.19 <0.9.0"]),
        "fee_bps": rng.choice([100, 200, 300, 500, 900, 1500, 2500]),
        "mint_variant": rng.choice(["ext", "ext", "internal"]),
        "pause_variant": rng.choice(["flag", "modifier"]),
        "banner": rng.random() < 0.4,
        "events_first": rng.random() < 0.5,
    }


# ---------------------------------------------------------------- rendering
def render(P, feats, tax_mode=None, renounce=False):
    """feats: set of features present. tax_mode: None | 'var' | 'const'. Returns Solidity source."""
    style = P["style"]
    S = {"A": _style_a, "B": _style_b, "C": _style_c}[style]
    return S(P, set(feats), tax_mode, renounce)


def _header(P):
    b = "// " + P["name"] + " (" + P["symbol"] + ")\n" if P["banner"] else ""
    return f"// SPDX-License-Identifier: MIT\n{b}pragma solidity {P['pragma']};\n\n"


def _owner_gated(feats):
    return bool(feats & {"mint", "blacklist", "pause", "tax", "kill", "deleg", "priv"}) or False


def _owner_text(P, feats, renounce, style):
    if not (_owner_gated(feats) or "txo" in feats):
        return "", ""
    check = "tx.origin" if "txo" in feats else "msg.sender"
    mod = f'    modifier onlyOwner() {{ require({check} == owner, "not owner"); _; }}\n'
    state = "    address public owner;\n"
    fn = '    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0), "zero"); owner = newOwner; }\n'
    if renounce:
        fn += "    function renounceOwnership() external onlyOwner { owner = address(0); }\n"
    return state, mod + fn


def _extras(feats, ev_name="Transfer"):
    out = ""
    if "kill" in feats:
        out += "    function destroy() external onlyOwner { selfdestruct(payable(owner)); }\n"
    if "deleg" in feats:
        out += ('    function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory) {\n'
                '        (bool ok, bytes memory ret) = target.delegatecall(data);\n        require(ok, "call failed");\n        return ret;\n    }\n')
    if "priv" in feats:
        out += ("    uint256 public maxWallet;\n    address public treasury;\n"
                "    function setMaxWallet(uint256 v) external onlyOwner { maxWallet = v; }\n"
                "    function setTreasury(address t) external onlyOwner { treasury = t; }\n"
                "    function rescueEth() external onlyOwner { payable(owner).transfer(address(this).balance); }\n")
    return out


def _supply(P):
    return f"{P['supply']} * 10 ** {P['decimals']}"


def _style_a(P, feats, tax_mode, renounce):
    owner_state, owner_fn = _owner_text(P, feats, renounce, "A")
    s = _header(P) + f"contract {P['contract']} {{\n"
    s += f'    string public name = "{P["name"]}";\n    string public symbol = "{P["symbol"]}";\n    uint8 public decimals = {P["decimals"]};\n'
    s += "    uint256 public totalSupply;\n    mapping(address => uint256) public balanceOf;\n    mapping(address => mapping(address => uint256)) public allowance;\n"
    s += owner_state
    if "blacklist" in feats:
        s += "    mapping(address => bool) public isBlacklisted;\n"
    if "pause" in feats:
        s += "    bool public paused;\n"
    if tax_mode == "var":
        s += f"    uint256 public feeBps = {P['fee_bps']};\n    address public feeWallet;\n"
    elif tax_mode == "const":
        s += f"    uint256 public constant FEE_BPS = {min(P['fee_bps'], 500)};\n    address public feeWallet;\n"
    ev = "    event Transfer(address indexed from, address indexed to, uint256 value);\n    event Approval(address indexed owner, address indexed spender, uint256 value);\n"
    s += ev + "\n"
    ctor = "    constructor() {\n"
    if owner_state:
        ctor += "        owner = msg.sender;\n"
    if tax_mode:
        ctor += "        feeWallet = msg.sender;\n"
    if "mint" in feats and P["mint_variant"] == "internal":
        ctor += f"        _mint(msg.sender, {_supply(P)});\n"
    else:
        ctor += f"        totalSupply = {_supply(P)};\n        balanceOf[msg.sender] = totalSupply;\n        emit Transfer(address(0), msg.sender, totalSupply);\n"
    ctor += "    }\n\n"
    s += ctor
    if owner_fn:
        s += owner_fn + "\n"
    if "mint" in feats:
        if P["mint_variant"] == "internal":
            s += "    function _mint(address to, uint256 amount) internal {\n        totalSupply += amount;\n        balanceOf[to] += amount;\n        emit Transfer(address(0), to, amount);\n    }\n"
            s += "    function mint(address to, uint256 amount) external onlyOwner { _mint(to, amount); }\n\n"
        else:
            s += "    function mint(address to, uint256 amount) external onlyOwner {\n        totalSupply += amount;\n        balanceOf[to] += amount;\n        emit Transfer(address(0), to, amount);\n    }\n\n"
    if "blacklist" in feats:
        s += "    function setBlacklist(address a, bool v) external onlyOwner { isBlacklisted[a] = v; }\n\n"
    if "pause" in feats:
        s += "    function pause() external onlyOwner { paused = true; }\n    function unpause() external onlyOwner { paused = false; }\n"
        if P["pause_variant"] == "modifier":
            s += '    modifier whenNotPaused() { require(!paused, "paused"); _; }\n'
        s += "\n"
    if tax_mode == "var":
        s += "    function setFeeBps(uint256 v) external onlyOwner { feeBps = v; }\n\n"
    ex = _extras(feats)
    if ex:
        s += ex + "\n"
    wnp = " whenNotPaused" if ("pause" in feats and P["pause_variant"] == "modifier") else ""
    s += f"    function transfer(address to, uint256 amount) external{wnp} returns (bool) {{ _move(msg.sender, to, amount); return true; }}\n"
    s += "    function approve(address spender, uint256 amount) external returns (bool) {\n        allowance[msg.sender][spender] = amount;\n        emit Approval(msg.sender, spender, amount);\n        return true;\n    }\n"
    s += f"    function transferFrom(address from, address to, uint256 amount) external{wnp} returns (bool) {{\n        uint256 a = allowance[from][msg.sender];\n        require(a >= amount, \"allowance\");\n        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;\n        _move(from, to, amount);\n        return true;\n    }}\n\n"
    s += "    function _move(address from, address to, uint256 amount) internal {\n"
    if "blacklist" in feats:
        s += '        require(!isBlacklisted[from] && !isBlacklisted[to], "blocked");\n'
    if "pause" in feats and P["pause_variant"] == "flag":
        s += '        require(!paused, "paused");\n'
    s += '        require(balanceOf[from] >= amount, "balance");\n'
    if tax_mode:
        fee = "feeBps" if tax_mode == "var" else "FEE_BPS"
        s += f"        uint256 fee = amount * {fee} / 10000;\n        balanceOf[from] -= amount;\n        balanceOf[to] += amount - fee;\n        balanceOf[feeWallet] += fee;\n        emit Transfer(from, to, amount - fee);\n        if (fee > 0) emit Transfer(from, feeWallet, fee);\n"
    else:
        s += "        balanceOf[from] -= amount;\n        balanceOf[to] += amount;\n        emit Transfer(from, to, amount);\n"
    s += "    }\n}\n"
    return s


def _style_b(P, feats, tax_mode, renounce):
    owner_state, owner_fn = _owner_text(P, feats, renounce, "B")
    s = _header(P) + f"contract {P['contract']} {{\n"
    s += "    mapping(address => uint256) private _balances;\n    mapping(address => mapping(address => uint256)) private _allowances;\n    uint256 private _totalSupply;\n"
    s += f'    string private _name = "{P["name"]}";\n    string private _symbol = "{P["symbol"]}";\n'
    s += owner_state
    if "blacklist" in feats:
        s += "    mapping(address => bool) private _isBlacklisted;\n"
    if "pause" in feats:
        s += "    bool private _paused;\n"
    if tax_mode == "var":
        s += f"    uint256 private _feeBps = {P['fee_bps']};\n    address private _feeWallet;\n"
    elif tax_mode == "const":
        s += f"    uint256 private constant FEE_BPS = {min(P['fee_bps'], 500)};\n    address private _feeWallet;\n"
    s += "\n    event Transfer(address indexed from, address indexed to, uint256 value);\n    event Approval(address indexed owner, address indexed spender, uint256 value);\n\n"
    s += "    constructor() {\n"
    if owner_state:
        s += "        owner = msg.sender;\n"
    if tax_mode:
        s += "        _feeWallet = msg.sender;\n"
    if "mint" in feats and P["mint_variant"] == "internal":
        s += f"        _mint(msg.sender, {_supply(P)});\n"
    else:
        s += f"        _totalSupply = {_supply(P)};\n        _balances[msg.sender] = _totalSupply;\n        emit Transfer(address(0), msg.sender, _totalSupply);\n"
    s += "    }\n\n"
    s += "    function name() public view returns (string memory) { return _name; }\n    function symbol() public view returns (string memory) { return _symbol; }\n"
    s += f"    function decimals() public pure returns (uint8) {{ return {P['decimals']}; }}\n    function totalSupply() public view returns (uint256) {{ return _totalSupply; }}\n"
    s += "    function balanceOf(address a) public view returns (uint256) { return _balances[a]; }\n    function allowance(address o, address sp) public view returns (uint256) { return _allowances[o][sp]; }\n\n"
    if owner_fn:
        s += owner_fn + "\n"
    if "mint" in feats:
        if P["mint_variant"] == "internal":
            s += "    function _mint(address to, uint256 amount) internal {\n        _totalSupply += amount;\n        _balances[to] += amount;\n        emit Transfer(address(0), to, amount);\n    }\n"
            s += "    function mint(address to, uint256 amount) external onlyOwner { _mint(to, amount); }\n\n"
        else:
            s += "    function mint(address to, uint256 amount) external onlyOwner {\n        _totalSupply += amount;\n        _balances[to] += amount;\n        emit Transfer(address(0), to, amount);\n    }\n\n"
    if "blacklist" in feats:
        s += "    function isBlacklisted(address a) public view returns (bool) { return _isBlacklisted[a]; }\n    function setBlacklist(address a, bool v) external onlyOwner { _isBlacklisted[a] = v; }\n\n"
    if "pause" in feats:
        s += "    function paused() public view returns (bool) { return _paused; }\n    function pause() external onlyOwner { _paused = true; }\n    function unpause() external onlyOwner { _paused = false; }\n\n"
    if tax_mode == "var":
        s += "    function feeBps() public view returns (uint256) { return _feeBps; }\n    function setFeeBps(uint256 v) external onlyOwner { _feeBps = v; }\n\n"
    ex = _extras(feats)
    if ex:
        s += ex + "\n"
    s += "    function transfer(address to, uint256 amount) public returns (bool) { _transfer(msg.sender, to, amount); return true; }\n"
    s += "    function approve(address spender, uint256 amount) public returns (bool) {\n        _allowances[msg.sender][spender] = amount;\n        emit Approval(msg.sender, spender, amount);\n        return true;\n    }\n"
    s += "    function transferFrom(address from, address to, uint256 amount) public returns (bool) {\n        uint256 current = _allowances[from][msg.sender];\n        require(current >= amount, \"insufficient allowance\");\n        if (current != type(uint256).max) _allowances[from][msg.sender] = current - amount;\n        _transfer(from, to, amount);\n        return true;\n    }\n\n"
    s += "    function _transfer(address from, address to, uint256 amount) internal {\n        require(to != address(0), \"zero address\");\n"
    if "blacklist" in feats:
        s += '        require(!_isBlacklisted[from] && !_isBlacklisted[to], "blocked");\n'
    if "pause" in feats:
        s += '        require(!_paused, "paused");\n'
    s += '        require(_balances[from] >= amount, "insufficient balance");\n'
    if tax_mode:
        fee = "_feeBps" if tax_mode == "var" else "FEE_BPS"
        s += f"        uint256 fee = (amount * {fee}) / 10000;\n        _balances[from] -= amount;\n        _balances[to] += amount - fee;\n        _balances[_feeWallet] += fee;\n        emit Transfer(from, to, amount - fee);\n        if (fee > 0) emit Transfer(from, _feeWallet, fee);\n"
    else:
        s += "        _balances[from] -= amount;\n        _balances[to] += amount;\n        emit Transfer(from, to, amount);\n"
    s += "    }\n}\n"
    return s


def _style_c(P, feats, tax_mode, renounce):
    """Held-out layout: custom errors, constants, unchecked arithmetic, owner as immutable-style getter."""
    owner_state, owner_fn = _owner_text(P, feats, renounce, "C")
    s = _header(P) + f"contract {P['contract']} {{\n"
    s += "    error InsufficientBalance(uint256 have, uint256 need);\n    error InsufficientAllowance();\n    error Blocked();\n    error Halted();\n\n"
    s += f'    string public constant name = "{P["name"]}";\n    string public constant symbol = "{P["symbol"]}";\n    uint8 public constant decimals = {P["decimals"]};\n'
    s += "    uint256 public totalSupply;\n    mapping(address => uint256) public balanceOf;\n    mapping(address => mapping(address => uint256)) public allowance;\n"
    s += owner_state
    if "blacklist" in feats:
        s += "    mapping(address => bool) public isBlacklisted;\n"
    if "pause" in feats:
        s += "    bool public paused;\n"
    if tax_mode == "var":
        s += f"    uint16 public feeBps = {min(P['fee_bps'], 9000)};\n    address public feeSink;\n"
    elif tax_mode == "const":
        s += f"    uint16 public constant FEE_BPS = {min(P['fee_bps'], 500)};\n    address public feeSink;\n"
    s += "\n    event Transfer(address indexed from, address indexed to, uint256 value);\n    event Approval(address indexed owner, address indexed spender, uint256 value);\n\n"
    s += "    constructor() {\n"
    if owner_state:
        s += "        owner = msg.sender;\n"
    if tax_mode:
        s += "        feeSink = msg.sender;\n"
    if "mint" in feats and P["mint_variant"] == "internal":
        s += f"        _mint(msg.sender, {_supply(P)});\n"
    else:
        s += f"        uint256 initial = {_supply(P)};\n        totalSupply = initial;\n        balanceOf[msg.sender] = initial;\n        emit Transfer(address(0), msg.sender, initial);\n"
    s += "    }\n\n"
    if owner_fn:
        s += owner_fn + "\n"
    if "mint" in feats:
        if P["mint_variant"] == "internal":
            s += "    function _mint(address to, uint256 amount) internal {\n        totalSupply += amount;\n        balanceOf[to] += amount;\n        emit Transfer(address(0), to, amount);\n    }\n"
            s += "    function mint(address to, uint256 amount) external onlyOwner { _mint(to, amount); }\n\n"
        else:
            s += "    function mint(address to, uint256 amount) external onlyOwner {\n        totalSupply += amount;\n        unchecked { balanceOf[to] += amount; }\n        emit Transfer(address(0), to, amount);\n    }\n\n"
    if "blacklist" in feats:
        s += "    function blacklist(address a, bool v) external onlyOwner { isBlacklisted[a] = v; }\n\n"
    if "pause" in feats:
        s += "    function pause() external onlyOwner { paused = true; }\n    function unpause() external onlyOwner { paused = false; }\n\n"
    if tax_mode == "var":
        s += "    function updateFee(uint16 v) external onlyOwner { feeBps = v; }\n\n"
    ex = _extras(feats)
    if ex:
        s += ex + "\n"
    s += "    function approve(address spender, uint256 amount) external returns (bool) {\n        allowance[msg.sender][spender] = amount;\n        emit Approval(msg.sender, spender, amount);\n        return true;\n    }\n"
    s += "    function transfer(address to, uint256 amount) external returns (bool) {\n        _send(msg.sender, to, amount);\n        return true;\n    }\n"
    s += "    function transferFrom(address from, address to, uint256 amount) external returns (bool) {\n        uint256 a = allowance[from][msg.sender];\n        if (a < amount) revert InsufficientAllowance();\n        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;\n        _send(from, to, amount);\n        return true;\n    }\n\n"
    s += "    function _send(address from, address to, uint256 amount) private {\n"
    if "blacklist" in feats:
        s += "        if (isBlacklisted[from] || isBlacklisted[to]) revert Blocked();\n"
    if "pause" in feats:
        s += "        if (paused) revert Halted();\n"
    s += "        uint256 bal = balanceOf[from];\n        if (bal < amount) revert InsufficientBalance(bal, amount);\n"
    if tax_mode:
        fee = "feeBps" if tax_mode == "var" else "FEE_BPS"
        s += f"        uint256 fee = (amount * {fee}) / 10000;\n        unchecked {{\n            balanceOf[from] = bal - amount;\n            balanceOf[to] += amount - fee;\n            balanceOf[feeSink] += fee;\n        }}\n        emit Transfer(from, to, amount - fee);\n"
    else:
        s += "        unchecked {\n            balanceOf[from] = bal - amount;\n            balanceOf[to] += amount;\n        }\n        emit Transfer(from, to, amount);\n"
    s += "    }\n}\n"
    return s


# ---------------------------------------------------------------- examples
def make_example(rng, style, clean_p=0.08):
    P = pick_params(rng, style)
    if rng.random() < clean_p:
        src = render(P, set(), None, False)
        return P, src, src, [], set()
    k = rng.choice([1, 1, 2, 2, 3, 4])
    feats = set(rng.sample(FEATURES, k))
    tax_mode = "var" if "tax" in feats else (rng.choice([None, "const"]) if rng.random() < 0.3 else None)
    renounce_orig = False
    orig = render(P, feats, tax_mode, renounce_orig)
    flagged = verify.scan(orig)
    codes = [c for c, _ in flagged]
    if not codes:
        return None
    # patched: drop every flagged feature; keep owner block only when unflagged owner extras (priv) remain
    keep = {"priv"} if "priv" in feats else set()
    patched_feats = keep
    for tm in ("const" if tax_mode == "var" else tax_mode,):
        patched_tax = tm
    patched = render(P, patched_feats, patched_tax, renounce=bool(keep))
    return P, orig, patched, codes, feats


def build_prompt(src, flagged):
    if flagged:
        lines = []
        for code, hits in flagged:
            ev = "; ".join(f"line {n}: {t}" if n else t for n, t in hits[:2])
            lines.append(f"- {code}: {ev}")
        fl = "\n".join(lines)
    else:
        fl = "(none)"
    return f"Fix the flagged patterns in this token contract.\n\nFlags:\n{fl}\n\nContract:\n```solidity\n{src}```"


def build_answer(patched, codes, orig):
    if not codes:
        return f"```solidity\n{patched}```\n\nChanges:\n- No flagged patterns, so the contract is unchanged."
    changes = []
    for c in codes:
        if c == "owner_privileges":
            changes.append(verify.FIX_TEXT[c] if "renounceOwnership" in patched else "Removed the owner role; nothing left needs it.")
        elif c == "tax_changeable" and "FEE_BPS" in patched:
            changes.append(verify.FIX_TEXT[c])
        elif c == "tax_changeable":
            changes.append("Removed the fee setter and the fee.")
        else:
            changes.append(verify.FIX_TEXT[c])
    return f"```solidity\n{patched}```\n\nChanges:\n" + "\n".join(f"- {x}" for x in changes)


def to_row(P, orig, patched, codes, meta_extra):
    flagged = verify.scan(orig)
    return {
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": build_prompt(orig, flagged)},
            {"role": "assistant", "content": build_answer(patched, codes, orig)},
        ],
        "meta": {"style": P["style"], "flags": codes, **meta_extra},
    }


def generate(n, styles, seed, seen):
    rng = random.Random(seed)
    rows, dropped = [], 0
    while len(rows) < n:
        style = rng.choice(styles)
        ex = make_example(rng, style)
        if ex is None:
            continue
        P, orig, patched, codes, feats = ex
        if orig in seen:
            continue
        j = verify.judge(orig, patched, codes)
        if not j["ok"]:
            dropped += 1
            if dropped > 5 * n:
                sys.exit("too many self-check failures: " + json.dumps(j)[:300])
            continue
        seen.add(orig)
        rows.append(to_row(P, orig, patched, codes, {"features": sorted(feats)}))
    return rows, dropped


if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / "data" / "coder"
    out.mkdir(parents=True, exist_ok=True)
    seen = set()
    sets = {"train": (1400, ["A", "B"], 11), "eval_in": (60, ["A", "B"], 22), "eval_out": (60, ["C"], 33)}
    for name, (n, styles, seed) in sets.items():
        rows, dropped = generate(n, styles, seed, seen)
        (out / f"{name}.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf8")
        c = collections.Counter(f for r in rows for f in r["meta"]["flags"])
        print(name, len(rows), "rows;", dropped, "dropped by self-check;", dict(c))
