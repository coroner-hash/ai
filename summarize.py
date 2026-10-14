"""Summarize the collected dataset: counts per status/cause and a few readable examples."""
import json, collections, pathlib, labels

state = json.loads((pathlib.Path(__file__).parent / "data" / "state.json").read_text(encoding="utf8"))
count, examples = collections.Counter(), collections.defaultdict(list)
for addr, rec in state.items():
    l = labels.label(rec, state)
    key = (l["status"], l["cause_pattern"])
    count[key] += 1
    if len(examples[key]) < 3:
        examples[key].append((rec["symbol"], addr[:10], l["evidence"]))
print(f"{len(state)} pools")
for k, n in count.most_common():
    print(f"{n:5d}  {k[0]:8s} {k[1]}")
    for sym, a, ev in examples[k]:
        print(f"         {sym:14s} {a}  liq {ev.get('first.liq_usd')} -> {ev.get('now.liq_usd')}  vol {ev.get('first.vol_h24')} -> {ev.get('now.vol_h24')}")
