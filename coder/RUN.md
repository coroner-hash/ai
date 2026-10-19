# Coroner Coder: train, evaluate, and the GGUF build, on one rented pod

Budget: about $3 of the $5.7 left. One L40S 48 GB pod, **Volume disk 150 GB**, template RunPod PyTorch 2.x (CUDA, not ROCm), 1 GPU.

## 0. Pod terminal, setup (one block at a time)
```bash
nvidia-smi
```
```bash
cd /workspace && pip install unsloth py-solc-x && git clone https://github.com/coroner-hash/ai.git && cd ai && mkdir -p outputs && python -c "import solcx; solcx.install_solc('0.8.24')"
```

## 1. Baseline: the base model with no training (about 10 minutes)
```bash
export HF_HOME=/workspace/hf_cache
python coder/eval_coder.py --model unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit --eval data/coder/eval_out.jsonl --out outputs/base_out.jsonl --n 40 && python coder/score.py --replies outputs/base_out.jsonl --eval data/coder/eval_out.jsonl | tee outputs/score_base_out.txt
```

## 2. Train (about 40 to 60 minutes)
```bash
export HF_HOME=/workspace/hf_cache
MODEL=unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit TRAIN_FILE=data/coder/train.jsonl MAX_SEQ=4096 OUT_DIR=outputs/coder-lora python training/train_lora.py 2>&1 | tee outputs/coder_train.log
```
Check the first lines: `chat markers:` must show `<|im_start|>user` and `<|im_start|>assistant`.

## 3. Evaluate the tuned model (about 25 minutes)
```bash
export HF_HOME=/workspace/hf_cache
python coder/eval_coder.py --model outputs/coder-lora --eval data/coder/eval_out.jsonl --out outputs/tuned_out.jsonl --n 40 && python coder/score.py --replies outputs/tuned_out.jsonl --eval data/coder/eval_out.jsonl | tee outputs/score_tuned_out.txt
python coder/eval_coder.py --model outputs/coder-lora --eval data/coder/eval_in.jsonl --out outputs/tuned_in.jsonl --n 40 && python coder/score.py --replies outputs/tuned_in.jsonl --eval data/coder/eval_in.jsonl | tee outputs/score_tuned_in.txt
```
`eval_out` is a contract layout the model never saw in training; it is the honest number. Send me the three score files and the first and last loss lines.

## 4. Merge and upload the Coder (only after I say go)
```bash
export HF_TOKEN=            # type the token after = yourself
python training/merge_push.py --adapter outputs/coder-lora --repo coronerai/coroner-coder-7b
```
It creates a private repo; we make it public after the model card.

## 5. GGUF of Coroner 31B
```bash
bash release/make_gguf.sh
```
Send me the last lines (the file size and the JSON from the test). Upload only after I say go.

## 6. Stop paying
Pods, Stop, then Terminate. Revoke the Hugging Face token at huggingface.co/settings/tokens. Never paste the token in chat or leave it on a line you copy.
