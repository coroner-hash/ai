# Real training run: Gemma 4 31B on a rented 48 GB GPU

Decision (user, 19 Oct 2026): rent a 48 GB GPU directly. Budget about $10. Base model `unsloth/gemma-4-31B-it` (Apache 2.0, 31.27B parameters, architecture `Gemma4ForConditionalGeneration`, allowed by the hosting rules).

## Before you start
- [ ] The repo is pushed (the pod clones it).
- [ ] Two files from `D:\PW\DEC TECH\coroner\data\sft\`: `train_4k.jsonl` (8.2 MB, 4,000 rows) and `eval_80.jsonl` (0.2 MB, real rows only plus 10 drafts).
- [ ] A Hugging Face account `coronerai` and, when asked later, a **Write** token that you type only inside the pod terminal.

## 1. Rent the GPU (RunPod)
1. runpod.io: sign up, then **Billing**, add **$10** of credit. Do not add more: when credit runs out the pod stops and the disk can be lost.
2. **Pods, Deploy**. Pick **RTX A6000 (48 GB)** on Community Cloud (about $0.49/h, third-party tracker, check runpod.io/pricing). Alternatives: RTX 6000 Ada or L40S (faster, about $0.8 to $1/h).
3. Check the card's **RAM**: want 64 GB or more (merging the model needs it). If it shows less, pick another card or another machine.
4. Template: **RunPod PyTorch 2.x** (CUDA 12.x). Press **Edit** and set **Volume disk 150 GB**, container disk 30 GB. On-demand, not spot.
5. **Deploy**. When it says Running, **Connect, JupyterLab, Terminal**.

## 2. Set up (in the pod terminal, one block at a time)
```bash
nvidia-smi
```
Must show a 48 GB card.
```bash
cd /workspace && pip install unsloth && git clone https://github.com/coroner-hash/ai.git && cd ai && mkdir -p data/sft outputs
```
Then in the JupyterLab file panel open `/workspace/ai/data/sft` and **Upload** the two files.

## 3. Dry run (5 steps, about 10 to 15 minutes, costs under $0.30)
```bash
MODEL=unsloth/gemma-4-31B-it MAX_STEPS=5 TRAIN_FILE=data/sft/train_4k.jsonl OUT_DIR=outputs/dry python training/train_lora.py 2>&1 | tee outputs/dry.log
```
Check, and send me the output:
- `chat markers:` must show `<|turn>user\n` and `<|turn>model\n`.
- `sample training text tail:` must end with `...<channel|>{...}<turn|>` (the JSON answer inside).
- No out-of-memory error. In a second terminal run `nvidia-smi` while it trains; note the memory used.
- Seconds per step. Full run time = 250 steps x that number. If it is over about 5 hours, use `MAX_STEPS=150`.

## 4. Full run
```bash
MODEL=unsloth/gemma-4-31B-it MAX_STEPS=250 TRAIN_FILE=data/sft/train_4k.jsonl OUT_DIR=outputs/coroner-31b-lora python training/train_lora.py 2>&1 | tee outputs/train.log
```
Right after it finishes, **back up the adapter** (small) to your computer:
```bash
zip -r adapter.zip outputs/coroner-31b-lora
```
Then in the file panel right-click `adapter.zip`, **Download**.

## 5. Evaluation gate (about 30 to 40 minutes)
```bash
python training/eval_local.py --adapter outputs/coroner-31b-lora --eval data/sft/eval_80.jsonl --out outputs/replies.jsonl
python training/eval_model.py --replies outputs/replies.jsonl --eval data/sft/eval_80.jsonl | tee outputs/score.txt
```
Send me `score.txt` and `train.log`. Suggested gate on the **real** rows: `json_valid` at least 0.95, `risk_class_acc` at least 0.90, `evidence_ok` at least 0.95. If it fails we do not publish; we look at where it went wrong first.

## 6. Merge and upload (only after I say go)
```bash
export HF_TOKEN=            # type your token after the = yourself, then press Enter
python training/merge_push.py --adapter outputs/coroner-31b-lora --repo coronerai/coroner-31b
```
Uploads to a **private** repo. If the merge runs out of RAM, tell me: the fallback is a CPU pod with 128 GB RAM for the merge only (about $0.5).

## 7. Stop paying
Pods, the pod's menu, **Terminate** (Stop still charges for disk). Then revoke the Hugging Face token at huggingface.co/settings/tokens.

## After the upload (me)
Surplus pre-check on the repo head, model card with license and honest evaluation numbers, then your decision to make it public.
