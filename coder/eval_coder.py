"""Batched generation for Coroner Coder evaluation (the contracts are long, so one-by-one generation is too slow).

  python coder/eval_coder.py --model outputs/coder-lora --eval data/coder/eval_out.jsonl --out outputs/coder_out.jsonl [--n 60]
  --model can be the LoRA folder or a base model id (for the baseline run). Then: python coder/score.py ...
"""
import argparse, json, os

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--eval", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--n", type=int, default=0)
ap.add_argument("--batch", type=int, default=8)
ap.add_argument("--max_new", type=int, default=2400)
a = ap.parse_args()

from unsloth import FastLanguageModel  # noqa: E402
import torch  # noqa: E402

model, tok = FastLanguageModel.from_pretrained(a.model, max_seq_length=int(os.environ.get("MAX_SEQ", "6144")), load_in_4bit=True)
FastLanguageModel.for_inference(model)
tt = getattr(tok, "tokenizer", tok)
tt.padding_side = "left"
if tt.pad_token is None:
    tt.pad_token = tt.eos_token

rows = [json.loads(l) for l in open(a.eval, encoding="utf8") if l.strip()]
if a.n:
    rows = rows[: a.n]
prompts = [tt.apply_chat_template(r["messages"][:2], add_generation_prompt=True, tokenize=False) for r in rows]
with open(a.out, "w", encoding="utf8") as fh:
    for i in range(0, len(prompts), a.batch):
        chunk = prompts[i : i + a.batch]
        enc = tt(chunk, return_tensors="pt", padding=True).to("cuda")
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=a.max_new, do_sample=False, use_cache=True, pad_token_id=tt.pad_token_id)
        for j in range(len(chunk)):
            text = tt.decode(out[j][enc["input_ids"].shape[1]:], skip_special_tokens=True)
            fh.write(json.dumps({"reply": text}) + "\n")
        fh.flush()
        print(min(i + a.batch, len(prompts)), "/", len(prompts), flush=True)
print("wrote", a.out)
