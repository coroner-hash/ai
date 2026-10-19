"""Score Coroner Coder replies. A reply counts as a fix only if the patched contract compiles (solc 0.8.24),
keeps the ERC-20 interface, and clears every flag the scanner raised, without adding new ones.

  python coder/score.py --replies outputs/coder_replies.jsonl --eval data/coder/eval_out.jsonl

Reads the contract and flags from the eval row's user message, so the model's own output is the only thing judged.
"""
import argparse, json, re, sys, pathlib, collections

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import verify  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--replies", required=True)
ap.add_argument("--eval", required=True)
a = ap.parse_args()

BLOCK = re.compile(r"```(?:solidity|sol)?\s*\n(.*?)```", re.S)
rows = [json.loads(l) for l in open(a.eval, encoding="utf8") if l.strip()]
replies = [json.loads(l)["reply"] for l in open(a.replies, encoding="utf8") if l.strip()]
n = min(len(rows), len(replies))

tot = collections.Counter()
per_flag = collections.defaultdict(lambda: [0, 0])  # flag -> [ok, total]
unchanged = 0
for row, reply in zip(rows[:n], replies[:n]):
    user = row["messages"][1]["content"]
    m = BLOCK.search(user.split("Contract:", 1)[1])
    orig = m.group(1) if m else ""
    codes = row["meta"]["flags"]
    bm = BLOCK.search(reply)
    patched = bm.group(1) if bm else ""
    tot["n"] += 1
    if not bm:
        tot["no_block"] += 1
        j = {"compiles": False, "abi_kept": False, "flags_cleared": False, "no_new_flags": False, "ok": False}
    else:
        if patched.strip() == orig.strip() and codes:
            unchanged += 1
        j = verify.judge(orig, patched, codes)
    for k in ("compiles", "abi_kept", "flags_cleared", "no_new_flags", "ok"):
        tot[k] += int(j[k])
    for c in codes or ["(clean)"]:
        per_flag[c][0] += int(j["ok"])
        per_flag[c][1] += 1

print(f"{'metric':<18}{'value':>8}")
for k in ("compiles", "abi_kept", "flags_cleared", "no_new_flags", "ok"):
    print(f"{k:<18}{tot[k] / tot['n']:>8.3f}")
print(f"n = {tot['n']}   replies without a code block: {tot['no_block']}   returned unchanged despite flags: {unchanged}")
print("\nfixed (ok) per flag:")
for c, (ok, t) in sorted(per_flag.items()):
    print(f"  {c:<24}{ok}/{t}")
base = sum(1 for r in rows[:n] if not r["meta"]["flags"]) / n
print(f"\nBASELINE to beat: returning the contract unchanged scores ok = {base:.3f} (only the clean rows).")
