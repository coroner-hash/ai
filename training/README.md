# Training Coroner

The dataset is built by the same rule engines the website runs (`worker/rules.ts`, `autopsy.ts`, `premortem.ts` in the app repo), so the first model learns to reproduce what the site does today. Its job is to match the rules reliably, then to improve on them where the rules are blind (context, messy text, contract code).

## What is in `data/sft`
| File | Content |
|---|---|
| `train.jsonl`, `eval.jsonl` | chat-format rows: system prompt, fact sheet as the user message, verdict JSON as the answer |
| `meta` per row | `mode` (live / autopsy / draft), `source` (real / synthetic), `split` |

Real rows come from tokens our collector watched (`data/facts.jsonl`). 20% of real tokens are held out by hashing the token address. Synthetic rows are seeded cases that cover rare flags (mint with a live owner, big holders, odd drafts). **Synthetic rows test coverage, not real-world accuracy.** Headline numbers use real rows only. Regenerate with `node --import ./scripts/ts-register.mjs scripts/gen-sft.mjs` in the app repo.

## Steps
1. **Check the scorer** (no model needed): `python training/eval_model.py --oracle` must print 1.000 everywhere; `--noise 0.2` must drop.
2. **Smoke test on a free Colab T4**: install Unsloth, upload `data/sft/train.jsonl`, run `MODEL=unsloth/Qwen3.5-0.8B MAX_STEPS=60 python training/train_lora.py`. Look for: a falling loss, no out-of-memory, and printed token counts under 2048.
3. **Evaluate the small model**: serve it (Ollama or vLLM) and run `python training/eval_model.py --endpoint http://localhost:11434/v1 --model coroner-small`.
4. **Real run** on a rented 24 GB GPU with `MODEL=google/gemma-4-31B-it` (QLoRA). Budget is about $10, so test the whole pipeline on step 2 first and do the paid run once.
5. Publish the merged bf16 safetensors to Hugging Face, with the model card and eval numbers, only after step 3 style numbers look right on the real rows.

## Known limits (be honest about them)
- Holder facts are missing from the real rows: Blockscout blocks server access and `eth_getLogs` needs a paid RPC plan. Holder cases appear only in synthetic rows.
- Most real tokens are plain factory tokens, so real rows are mostly low risk. Real autopsy rows are few (hundreds, growing daily).
- The model is evaluated against the rule engine, which is itself a baseline. A model that matches it perfectly is only as good as the rules. The daily accuracy ledger against real outcomes is what will show whether it adds value.
