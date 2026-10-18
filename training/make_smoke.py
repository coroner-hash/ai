"""Rebuild the small smoke-test dataset (data/smoke) from data/sft. Reproducible (seed 7).
train: 200 rows per mode (half real where available); eval: 30 rows per mode (half real).
Run after regenerating data/sft:  python training/make_smoke.py
"""
import json, pathlib, random, collections

random.seed(7)
root = pathlib.Path(__file__).resolve().parent.parent
load = lambda p: [json.loads(l) for l in open(p, encoding="utf8") if l.strip()]
size = lambda r: sum(len(m["content"]) for m in r["messages"])
tr = [r for r in load(root / "data/sft/train.jsonl") if size(r) < 6500]
ev = [r for r in load(root / "data/sft/eval.jsonl") if size(r) < 6500]


def sample(rows, per_mode):
    out = []
    for mode in ("live", "autopsy", "draft"):
        pool = [r for r in rows if r["meta"]["mode"] == mode]
        real = [r for r in pool if r["meta"]["source"] == "real"]
        syn = [r for r in pool if r["meta"]["source"] != "real"]
        random.shuffle(real)
        random.shuffle(syn)
        out += (real[: per_mode // 2] + syn)[:per_mode]
    random.shuffle(out)
    return out


(root / "data/smoke").mkdir(exist_ok=True)
for name, rows in (("train", sample(tr, 200)), ("eval", sample(ev, 30))):
    (root / f"data/smoke/{name}.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf8")
    print(name, len(rows), dict(collections.Counter((r["meta"]["mode"], r["meta"]["source"]) for r in rows)))
