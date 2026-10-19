---
license: apache-2.0
base_model: coronerai/coroner-31b
library_name: gguf
pipeline_tag: text-generation
tags:
  - gguf
  - llama.cpp
  - token-risk
  - robinhood-chain
language:
  - en
---

![Coroner: every token dies. We write the report.](https://raw.githubusercontent.com/coroner-hash/ai/main/release/banner.png)

# Coroner 31B (GGUF, Q4_K_M)

A 4-bit build of [coroner-31b](https://huggingface.co/coronerai/coroner-31b) for llama.cpp. One file, 18.7 GB, 17.4 GiB (4.87 bits per weight; the 16-bit weights are about 62 GB).

> Risk classification from public on-chain data. Not financial advice. Labels describe patterns consistent with the numbers. They are not accusations about anyone.

## Run it
```bash
llama-cli -m coroner-31b-Q4_K_M.gguf --temp 0 -p "<system prompt and fact sheet>"
```
Use the chat template embedded in the file. The model expects the system prompt and the JSON fact sheet used in training; see the source repository: https://github.com/coroner-hash/ai

## What was measured
- The file converts, loads and answers with valid JSON in llama.cpp (build b1-7951f60), CPU only. Speed there: about 7.5 tokens per second reading the prompt and 0.7 generating, so use a GPU build.
- Built from the 16-bit model: converted to Q8_0, then requantized to Q4_K_M.

## What was not measured
- **Accuracy of this 4-bit build.** The evaluation table on the main model card was measured on the 16-bit weights. We have not scored this file on the same held-out set, so treat the numbers there as an upper bound for this build.
- Ollama and other runtimes were not tested. Whether it fits a 24 GB card is an estimate: the file is 18.7 GB, plus the context cache.

Source, data and the rule engine: https://github.com/coroner-hash/ai
