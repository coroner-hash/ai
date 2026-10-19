# Smoke test round 2 on a cheap rented GPU (when Colab's free GPU is used up)

Same test as the Colab notebook, same small model (`Qwen3.5-0.8B`), same 600 / 90 rows. It also rehearses the real procedure at about $0.2 to $0.5.

## Rent
1. runpod.io, Billing: $10 of credit (the same credit the real run will use).
2. Pods, Deploy: any **24 GB** card on Community Cloud (RTX 3090, RTX 4090 or A5000; about $0.35 to $0.75 per hour, check runpod.io/pricing). Template **RunPod PyTorch 2.x**, container disk 20 GB, volume disk 40 GB. RAM does not matter for this test.
3. When it says Running: Connect, JupyterLab, Terminal.

## Run (one block at a time)
```bash
nvidia-smi
```
```bash
cd /workspace && pip install unsloth && git clone https://github.com/coroner-hash/ai.git && cd ai && mkdir -p outputs
```
```bash
MODEL=unsloth/Qwen3.5-0.8B MAX_STEPS=120 TRAIN_FILE=data/smoke/train.jsonl OUT_DIR=outputs/smoke python training/train_lora.py 2>&1 | tee outputs/train.log
```
```bash
python training/eval_local.py --adapter outputs/smoke --eval data/smoke/eval.jsonl --out outputs/replies.jsonl
```
```bash
python training/eval_model.py --replies outputs/replies.jsonl --eval data/smoke/eval.jsonl | tee outputs/score.txt
```
Send me the output of the last command (the score table with the BASELINE table under it) and the first and last `loss` lines from the training log.

## Stop paying
Pods, the pod's menu, **Terminate**. (Stop still charges for disk.)

## What to expect
An Ampere/Ada card trains in bf16, so it should be faster than the Colab T4 (which had to use float32). A 120-step run of this small model is roughly 10 to 20 minutes.
