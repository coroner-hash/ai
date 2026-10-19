"""Build the files uploaded to the rented GPU: data/sft/train_4k.jsonl (4000 stratified rows) and
data/sft/eval_80.jsonl (35 live real + 35 autopsy real + 10 drafts: the real-data gate). Reproducible (seed 11).
Run after regenerating data/sft (answer key order, facts).
"""
import json, random, collections, pathlib

random.seed(11)
root = pathlib.Path(__file__).resolve().parent.parent
load = lambda p: [json.loads(l) for l in open(p, encoding="utf8") if l.strip()]
tr = load(root / "data/sft/train.jsonl")
ev = load(root / "data/sft/eval.jsonl")

by = collections.defaultdict(list)
for r in tr:
    by[(r["meta"]["mode"], r["meta"]["source"])].append(r)
for v in by.values():
    random.shuffle(v)
total = sum(len(v) for v in by.values())
t4 = []
for k, v in by.items():
    t4 += v[: max(1, round(4000 * len(v) / total))]
random.shuffle(t4)
t4 = t4[:4000]

pick = lambda mode, src: [r for r in ev if r["meta"]["mode"] == mode and r["meta"]["source"] == src]
live, aut, dr = pick("live", "real"), pick("autopsy", "real"), [r for r in ev if r["meta"]["mode"] == "draft"]
for x in (live, aut, dr):
    random.shuffle(x)
e80 = live[:35] + aut[:35] + dr[:10]
random.shuffle(e80)

for name, rows in (("train_4k", t4), ("eval_80", e80)):
    p = root / f"data/sft/{name}.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf8")
    print(name, len(rows), round(p.stat().st_size / 1e6, 1), "MB", dict(collections.Counter((r["meta"]["mode"], r["meta"]["source"]) for r in rows)))
print("answer key order check:", list(json.loads(t4[0]["messages"][2]["content"]).keys())[:4])
