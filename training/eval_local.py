"""Generate replies from a LoRA adapter (Unsloth) for an eval file, one JSON line per row: {"reply": "..."}.
Then score them:  python training/eval_model.py --replies outputs/replies.jsonl --eval data/smoke/eval.jsonl

Usage (Colab, after train_lora.py):
  python training/eval_local.py --adapter outputs/smoke --eval data/smoke/eval.jsonl --out outputs/replies.jsonl
"""
import argparse, json

ap = argparse.ArgumentParser()
ap.add_argument("--adapter", required=True)
ap.add_argument("--eval", default="data/smoke/eval.jsonl")
ap.add_argument("--out", default="outputs/replies.jsonl")
ap.add_argument("--max_new", type=int, default=900)
a = ap.parse_args()

from unsloth import FastLanguageModel  # noqa: E402

model, tok = FastLanguageModel.from_pretrained(a.adapter, max_seq_length=2048, load_in_4bit=True)
FastLanguageModel.for_inference(model)

rows = [json.loads(l) for l in open(a.eval, encoding="utf8") if l.strip()]
with open(a.out, "w", encoding="utf8") as fh:
    for i, r in enumerate(rows):
        msgs = r["messages"][:2]  # system + user; the assistant turn is what we want to generate
        try:
            ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt", enable_thinking=False)
        except TypeError:
            ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt")
        ids = ids.to("cuda")
        out = model.generate(input_ids=ids, max_new_tokens=a.max_new, do_sample=False, use_cache=True)
        text = tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True)
        fh.write(json.dumps({"reply": text}) + "\n")
        if (i + 1) % 10 == 0:
            print(i + 1, "/", len(rows))
print("wrote", a.out)
