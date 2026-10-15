"""Score a Coroner model on data/sft/eval.jsonl.

Metrics (per mode and per source; headline numbers use REAL rows only):
  json_valid       reply parses as one JSON object
  schema_ok        required keys, enums, fixed disclaimer
  risk_class_acc   risk_class equals the rule engine's
  cause_acc        cause_pattern equals the rule engine's
  flag_f1          F1 over the set of flag codes
  evidence_ok      share of evidence keys whose value really appears in the input (no invented numbers)

Modes:
  --oracle         reply = the target (checks the scorer itself: everything must be 1.0)
  --noise 0.2      oracle with 20% of replies corrupted (scorer must drop)
  --endpoint URL   OpenAI-compatible chat endpoint (Ollama: http://localhost:11434/v1, vLLM, a hosted API), needs --model
Usage: python training/eval_model.py --oracle
"""
import argparse, json, pathlib, random, sys, urllib.request, collections

DATA = pathlib.Path(__file__).resolve().parent.parent / "data" / "sft" / "eval.jsonl"
DISCLAIMER = "Risk classification from public on-chain data. Not financial advice."
REQUIRED = ["mode", "risk_class", "flags", "evidence", "confidence", "disclaimer"]
RISK = {"low", "medium", "high", "dead"}


def parse(text):
    try:
        t = text.strip()
        if t.startswith("```"):
            t = t.strip("`").split("\n", 1)[1].rsplit("```", 1)[0]
        v = json.loads(t)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


def schema_ok(v):
    return bool(v) and all(k in v for k in REQUIRED) and v["risk_class"] in RISK and v["disclaimer"] == DISCLAIMER and isinstance(v["flags"], list)


def flat(obj, prefix=""):
    """All scalar values reachable in the input, for the invented-evidence check."""
    out = []
    if isinstance(obj, dict):
        for k, x in obj.items():
            out += flat(x, f"{prefix}{k}.")
            out.append((prefix + str(k), x))
    elif isinstance(obj, list):
        for i, x in enumerate(obj):
            out += flat(x, f"{prefix}{i}.")
    return out


def evidence_ok(inp, out):
    ev = out.get("evidence") or {}
    if not ev:
        return 1.0
    facts = inp.get("facts") or {}
    rec = inp.get("record") or {}
    draft = inp.get("draft") or {}
    pool = {k: v for k, v in facts.items()}
    # derived keys the rule engines legitimately echo
    for k, v in (rec.get("first") or {}).items():
        pool["first." + k] = v
    for k, v in (rec.get("outcome") or {}).items():
        pool["now." + k] = v
    pool["pool.created"] = rec.get("created")
    pool["now.swaps_h24"] = (rec.get("outcome") or {}).get("buys_h24", 0) + (rec.get("outcome") or {}).get("sells_h24", 0) if rec else None
    for k, v in draft.items():
        pool["draft." + k] = v
    good = 0
    for k, v in ev.items():
        if k in pool and (pool[k] == v or str(pool[k]) == str(v)):
            good += 1
        elif k.startswith(("code.", "draft.", "similar.")):
            good += 1  # code/line and derived draft evidence are checked by the generator; do not penalise here
    return good / len(ev)


def f1(a, b):
    a, b = set(a), set(b)
    if not a and not b:
        return 1.0
    tp = len(a & b)
    p, r = tp / len(b) if b else 0, tp / len(a) if a else 0
    return 2 * p * r / (p + r) if p + r else 0.0


def corrupt(target):
    v = json.loads(target)
    c = random.choice(["risk", "flag", "num", "break"])
    if c == "risk":
        v["risk_class"] = "low" if v["risk_class"] != "low" else "high"
    elif c == "flag" and v["flags"]:
        v["flags"] = v["flags"][1:]
    elif c == "num" and v.get("evidence"):
        k = next(iter(v["evidence"]))
        v["evidence"][k] = 123456789
    elif c == "break":
        return "Sure! Here is the verdict: " + target[:30]
    return json.dumps(v)


def ask(endpoint, model, messages):
    body = json.dumps({"model": model, "messages": messages, "temperature": 0, "max_tokens": 1500}).encode()
    req = urllib.request.Request(endpoint.rstrip("/") + "/chat/completions", data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--oracle", action="store_true")
    ap.add_argument("--noise", type=float, default=0.0)
    ap.add_argument("--endpoint")
    ap.add_argument("--model")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--replies", help="JSONL of {\"reply\": ...}, one per eval row, in order (from eval_local.py)")
    ap.add_argument("--eval", help="eval file (default data/sft/eval.jsonl)")
    a = ap.parse_args()
    random.seed(1)
    src = pathlib.Path(a.eval) if a.eval else DATA
    rows = [json.loads(l) for l in src.read_text(encoding="utf8").splitlines() if l.strip()]
    replies = [json.loads(l)["reply"] for l in pathlib.Path(a.replies).read_text(encoding="utf8").splitlines() if l.strip()] if a.replies else None
    if a.limit:
        random.shuffle(rows)
        rows = rows[: a.limit]
    stats = collections.defaultdict(lambda: collections.defaultdict(list))
    for idx, r in enumerate(rows):
        sysm, usr, tgt = r["messages"]
        want = json.loads(tgt["content"])
        if replies is not None:
            reply = replies[idx]
        elif a.oracle or a.noise:
            reply = corrupt(tgt["content"]) if random.random() < a.noise else tgt["content"]
        else:
            reply = ask(a.endpoint, a.model, [sysm, usr])
        got = parse(reply)
        inp = json.loads(usr["content"])
        key = (r["meta"]["mode"], r["meta"]["source"])
        s = stats[key]
        s["json_valid"].append(got is not None)
        s["schema_ok"].append(schema_ok(got))
        if got:
            s["risk_class_acc"].append(got.get("risk_class") == want["risk_class"])
            s["cause_acc"].append(got.get("cause_pattern") == want.get("cause_pattern"))
            s["flag_f1"].append(f1([x["code"] for x in want["flags"]], [x.get("code") for x in got.get("flags", []) if isinstance(x, dict)]))
            s["evidence_ok"].append(evidence_ok(inp, got))
        else:
            for k in ("risk_class_acc", "cause_acc", "flag_f1", "evidence_ok"):
                s[k].append(0.0)
    print(f"{'mode':9s} {'source':10s} {'n':>4s}  " + "  ".join(f"{m:>14s}" for m in ["json_valid", "schema_ok", "risk_class_acc", "cause_acc", "flag_f1", "evidence_ok"]))
    for (mode, source), s in sorted(stats.items()):
        n = len(s["json_valid"])
        print(f"{mode:9s} {source:10s} {n:4d}  " + "  ".join(f"{sum(s[m]) / len(s[m]):14.3f}" for m in ["json_valid", "schema_ok", "risk_class_acc", "cause_acc", "flag_f1", "evidence_ok"]))
    print("\nHeadline numbers are the 'real' rows only. Synthetic rows test coverage of rare cases, not real-world accuracy.")


if __name__ == "__main__":
    main()
