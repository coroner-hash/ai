"""LoRA fine-tune for Coroner with Unsloth + TRL.  UNTESTED until the Colab smoke test below has been run.

Smoke test (free Colab T4, ~20-30 min): MODEL=unsloth/Qwen3.5-0.8B (or any small chat model), MAX_STEPS=60.
Real run (rented 24 GB GPU):               MODEL=google/gemma-4-31B-it  (QLoRA 4-bit, ~22 GB per Unsloth's guide).

Env vars: MODEL, TRAIN_FILE, MAX_STEPS (0 = full epoch), MAX_SEQ (default 2048), OUT_DIR, HF_REPO (optional, needs `huggingface-cli login` done by YOU).
Never paste a Hugging Face token into chat or commit it.
"""
import os, json, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chat_markers import detect, training_text  # noqa: E402

MODEL = os.environ.get("MODEL", "unsloth/Qwen3.5-0.8B")
TRAIN = os.environ.get("TRAIN_FILE", "data/sft/train.jsonl")
MAX_STEPS = int(os.environ.get("MAX_STEPS", "0"))
MAX_SEQ = int(os.environ.get("MAX_SEQ", "2048"))
OUT = os.environ.get("OUT_DIR", "outputs/coroner-lora")

from unsloth import FastLanguageModel  # noqa: E402  (imported first on purpose)
from unsloth.chat_templates import train_on_responses_only  # noqa: E402
from datasets import Dataset  # noqa: E402
from trl import SFTConfig, SFTTrainer  # noqa: E402

model, tok = FastLanguageModel.from_pretrained(MODEL, max_seq_length=MAX_SEQ, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0, bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
)

# Multimodal models (Qwen3.5, Gemma 4) return a Processor. Text work needs the tokenizer inside it,
# otherwise tok("...") is read as an image argument.
tok_text = getattr(tok, "tokenizer", tok)

rows = [json.loads(l) for l in open(TRAIN, encoding="utf8") if l.strip()]
# training text = the exact prompt the model sees at inference + the JSON answer + end-of-turn (see chat_markers.py)
MARKERS = detect(tok_text)
print("chat markers:", MARKERS)
ds = Dataset.from_list([{"text": training_text(tok_text, r["messages"], MARKERS)} for r in rows])
print("sample training text tail:", repr(ds[0]["text"][-160:]))
print(f"{len(ds)} examples; first example has {len(tok_text(ds[0]['text']).input_ids)} tokens")

trainer = SFTTrainer(
    model=model, tokenizer=tok_text, train_dataset=ds,
    args=SFTConfig(
        dataset_text_field="text", max_seq_length=MAX_SEQ, per_device_train_batch_size=1, gradient_accumulation_steps=16,
        warmup_steps=10, num_train_epochs=1 if not MAX_STEPS else 1, max_steps=MAX_STEPS if MAX_STEPS else -1,
        learning_rate=2e-4, lr_scheduler_type="cosine", logging_steps=5, optim="adamw_8bit", weight_decay=0.01,
        seed=3407, output_dir=OUT, report_to="none",
    ),
)
# learn only from the assistant's JSON, not from the fact sheet it was given
# (markers are detected from the model's own chat template; INSTR / RESP env vars override them)
trainer = train_on_responses_only(trainer, instruction_part=os.environ.get("INSTR", MARKERS["instruction_part"]), response_part=os.environ.get("RESP", MARKERS["response_part"]))
trainer.train()
model.save_pretrained(OUT)
tok.save_pretrained(OUT)
print("saved LoRA adapter to", OUT)

repo = os.environ.get("HF_REPO")
if repo:  # merge to 16-bit safetensors (what a hosted launch needs); requires a prior `huggingface-cli login`
    model.push_to_hub_merged(repo, tok, save_method="merged_16bit")
    print("pushed merged model to", repo)
