---
license: apache-2.0
base_model: google/gemma-4-31B-it
library_name: transformers
pipeline_tag: text-generation
tags:
  - token-risk
  - robinhood-chain
  - json
  - lora
language:
  - en
---

# Coroner 31B

An open model that reads a fact sheet about a token on Robinhood Chain and replies with one JSON verdict: flags that cite the facts behind them, the evidence, a risk class and a cause pattern.

> Risk classification from public on-chain data. Not financial advice. Labels describe patterns consistent with the numbers. They are not accusations about anyone.

## What it does
Three modes, one answer format (`schema/verdict.schema.json` in the repository):
- `live`: a deployed token (contract facts, market facts, holders when available).
- `draft`: a launch draft before it ships (pre-mortem), with fixes.
- `autopsy`: a pool watched for at least 24 hours (first sighting versus re-check).

The model never fetches data. Open-source code builds the fact sheet from the chain; the model only reads it. Every number in a reply should appear in the fact sheet.

## Training
- Base: Gemma 4 31B-it (Apache 2.0). Method: LoRA (rank 16) on 4-bit weights, then merged to 16-bit.
- Data: __TRAIN_ROWS__ rows. Real rows come from tokens our public collector watched (from 14 Oct 2026); synthetic rows cover rare flags (mint with a live owner, large holders, unusual drafts) and are tagged as synthetic.
- **Targets come from the rule engine that runs on the website, not from human labels.** The first version therefore learns to reproduce those rules. It is as good as the rules plus whatever it generalises.
- Answers put the flags and evidence before the risk class, so the decision follows the reasoning.

## Evaluation
__EVAL_TABLE__

The baseline table is "always answer the most common value and never raise a flag". Numbers on real rows come from a small held-out set; treat them as indicative. A daily accuracy ledger against real outcomes will be published.

## Limits
- Holder data is missing from most real training rows (the free RPC tiers cannot reconstruct it), so holder reasoning is learned mostly from synthetic cases.
- "Dead" means under $50 of 24h volume and two swaps or fewer at the re-check. It is a blunt rule.
- Not tested on other chains. Not a price predictor. Do not use it to accuse people.

## Run it
Any OpenAI-compatible server with the chat template in this repository. Send the system prompt from the training data and the fact sheet as JSON. A 4-bit GGUF build for local use is planned, not released.

Source, data and the rule engine: https://github.com/coroner-hash/ai
