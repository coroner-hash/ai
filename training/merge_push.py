"""Merge the trained LoRA into the base model (16-bit safetensors) and upload it to Hugging Face.

Run ONLY after the evaluation gate passed. Uploads to a PRIVATE repo; make it public yourself after checking the model card.

  export HF_TOKEN=...   (type it in the pod terminal yourself; never paste it into chat or a file in git)
  python training/merge_push.py --adapter outputs/coroner-31b-lora --repo coronerai/coroner-31b

Needs plenty of system RAM (aim for 64 GB+) and about 150 GB of disk: the 16-bit weights are around 62 GB.
"""
import argparse, os, sys

ap = argparse.ArgumentParser()
ap.add_argument("--adapter", required=True)
ap.add_argument("--repo", required=True, help="e.g. coronerai/coroner-31b")
ap.add_argument("--public", action="store_true", help="upload as public (default: private)")
a = ap.parse_args()

token = os.environ.get("HF_TOKEN")
if not token:
    sys.exit("Set HF_TOKEN first (export HF_TOKEN=...) by typing it in this terminal.")

from unsloth import FastLanguageModel  # noqa: E402

model, tok = FastLanguageModel.from_pretrained(a.adapter, max_seq_length=2048, load_in_4bit=True)
model.push_to_hub_merged(a.repo, tok, save_method="merged_16bit", token=token, private=not a.public)
print("pushed", a.repo, "(public)" if a.public else "(private)")
